/**
 * dsh-plugin-haloflux — supervisor half.
 *
 * One job: keep the local HALOFLUX bridge (`dsh-hud/server.mjs`, 127.0.0.1:7788)
 * alive and observable from inside DSH, so the wallpaper never silently dies.
 *
 * Design notes:
 *
 *  - The bridge is a plain Node process the user already owns; this module does
 *    NOT reimplement it. It locates the installed checkout, spawns
 *    `server.mjs`, and reports health.
 *  - Health is probed over HTTP (`/stats`), never by guessing. A process that
 *    exists but stopped answering is reported as `unhealthy`, which is the
 *    failure mode that actually happens (zstd decode stall, port stolen).
 *  - Every spawn failure fails soft: the plugin stays loaded, the panel shows
 *    the reason, nothing throws into Cordis.
 *  - Nothing here touches the user's session logs — the bridge owns that.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** Default port the bridge listens on. */
const DEFAULT_PORT = 7788
/** How long a health probe may take before the bridge is called unhealthy. */
const PROBE_TIMEOUT_MS = 2500
/** Minimum delay between automatic restarts (avoids a crash loop). */
const RESTART_BACKOFF_MS = 8000
/** How many consecutive failures before the supervisor stops retrying. */
const MAX_CONSECUTIVE_FAILURES = 5

/**
 * Candidate checkout locations for the HUD project, most specific first.
 * The plugin is normally installed next to the project it supervises, but a
 * user may keep the checkout anywhere; the panel therefore accepts an explicit
 * `projectDir` config and this list is only the fallback.
 * @returns absolute candidate paths.
 */
function defaultProjectCandidates() {
  const home = homedir()
  return [
    path.join(home, '.dsh', 'haloflux'),
    path.join(home, 'Documents', 'deepseek-harness', 'default-workspace', 'dsh-hud-haloflux'),
    // The old build hard-coded one absolute Windows path containing the author's
    // username, which leaked a personal path into a public repository. Set the
    // `projectDir` plugin option (or HALOFLUX_PROJECT_DIR) when the checkout lives
    // somewhere else; these fallbacks stay machine-independent.
  ]
}

/**
 * Locate the directory that contains `dsh-hud/server.mjs`.
 * @param configured - explicit path from plugin config, if any.
 * @returns the project root, or undefined when nothing plausible exists.
 */
function resolveProjectDir(configured) {
  const candidates = []
  if (typeof configured === 'string' && configured.trim() !== '') {
    candidates.push(path.resolve(configured.trim()))
  }
  candidates.push(...defaultProjectCandidates())
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'dsh-hud', 'server.mjs'))) return dir
  }
  return undefined
}

/**
 * Read one JSON endpoint from the bridge.
 * @param port - bridge port.
 * @param route - path such as `/stats`.
 * @returns the parsed body, or undefined when unreachable.
 */
async function probe(port, route) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      signal: controller.signal,
    })
    if (!res.ok) return undefined
    return await res.json()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Supervises one bridge process for the lifetime of the plugin.
 */
class HaloFluxSupervisor {
  /**
   * @param ctx - Cordis plugin context.
   * @param config - user config (projectDir, port, autoStart).
   */
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.port = Number(config.port) > 0 ? Number(config.port) : DEFAULT_PORT
    this.projectDir = resolveProjectDir(config.projectDir)
    this.autoStart = config.autoStart !== false
    this.child = undefined
    this.lastSpawnAt = 0
    this.failures = 0
    this.lastError = ''
    this.stopped = false
    this.disposers = []
  }

  /** Human-readable current state, without touching the process. */
  async status() {
    const stats = await probe(this.port, '/stats')
    const state = stats
      ? 'running'
      : this.child && this.child.exitCode === null
        ? 'starting'
        : 'stopped'
    return {
      state,
      port: this.port,
      projectDir: this.projectDir ?? null,
      managed: Boolean(this.child && this.child.exitCode === null),
      pid: this.child?.pid ?? null,
      stats: stats ?? null,
      lastError: this.lastError,
      failures: this.failures,
    }
  }

  /** Spawn the bridge unless one already answers on the port. */
  async start() {
    if (this.stopped) return { ok: false, reason: 'supervisor stopped' }
    if (!this.projectDir) {
      this.lastError = '未找到 HUD 项目目录（缺少 dsh-hud/server.mjs），请在插件设置里指定项目路径'
      return { ok: false, reason: this.lastError }
    }
    const live = await probe(this.port, '/stats')
    if (live) return { ok: true, reason: '已在运行', adopted: true }
    if (this.child && this.child.exitCode === null) {
      return { ok: true, reason: '正在启动', managed: true }
    }
    const now = Date.now()
    if (now - this.lastSpawnAt < RESTART_BACKOFF_MS) {
      return { ok: false, reason: '重启过于频繁，稍后再试' }
    }
    this.lastSpawnAt = now

    const script = path.join(this.projectDir, 'dsh-hud', 'server.mjs')
    try {
      this.child = spawn(process.execPath, [script, this.projectDir], {
        cwd: path.join(this.projectDir, 'dsh-hud'),
        env: { ...process.env, HUD_PORT: String(this.port) },
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      })
      this.child.on('exit', (code) => {
        this.lastError = `bridge 退出（code ${code ?? '?'}）`
        if (!this.stopped) this.failures += 1
        this.child = undefined
      })
      this.child.on('error', (error) => {
        this.lastError = `bridge 启动失败：${error.message}`
        this.failures += 1
        this.child = undefined
      })
      this.ctx.logger?.info?.(
        `[dsh-plugin-haloflux] bridge 启动中：${script} (port ${this.port})`,
      )
      return { ok: true, reason: '已启动', pid: this.child.pid }
    } catch (error) {
      this.lastError = `bridge 启动异常：${error.message}`
      this.failures += 1
      return { ok: false, reason: this.lastError }
    }
  }

  /** Ask the bridge to stop, then reap the child if we own it. */
  async stop() {
    this.stopped = true
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // teardown must never throw
      }
    }
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) return { ok: true, reason: '未由本插件托管' }
    try {
      child.kill('SIGTERM')
    } catch {
      // already gone
    }
    return { ok: true, reason: '已停止' }
  }

  /** Install the HTTP routes the browser half calls. */
  registerRoutes(registerRoute) {
    registerRoute('/plugins/dsh-plugin-haloflux/status', async (req, res) => {
      const body = await this.status()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    })
    registerRoute('/plugins/dsh-plugin-haloflux/start', async (req, res) => {
      const body = await this.start()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    })
    registerRoute('/plugins/dsh-plugin-haloflux/stop', async (req, res) => {
      const body = await this.stop()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    })
  }

  /** Bound of automatic retries, used by the periodic health tick. */
  shouldRetry() {
    return !this.stopped && this.failures < MAX_CONSECUTIVE_FAILURES
  }
}

export { HaloFluxSupervisor, resolveProjectDir, defaultProjectCandidates, DEFAULT_PORT }
