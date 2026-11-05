/**
 * dsh-plugin-haloflux — host half.
 *
 * Cordis plugin shape: named exports `name` / `inject` / `apply`. DSH mounts the
 * row from cordis.patch.yml, calls `apply(ctx, config)` once the injected
 * services exist, and disposes through the returned lifecycle.
 *
 * What `apply` does:
 *
 *  - install three exact-path HTTP routes (status / start / stop) so the
 *    browser half never has to read the filesystem;
 *  - start the local HALOFLUX bridge when `autoStart` is on;
 *  - keep a 30 s health tick that restarts the bridge if it died and retries
 *    remain (bounded, never a crash loop);
 *  - on dispose, reap the child this plugin spawned so quitting DSH never
 *    leaves an orphan holding port 7788.
 *
 * Every failure path is soft: a missing checkout, a taken port or a dead spawn
 * leaves the plugin loaded and reports the reason to the panel.
 */
import { HaloFluxSupervisor, resolveProjectDir } from './supervisor.js'

/** Cordis row name; must match cordis.patch.yml and package.json. */
export const name = 'dsh-plugin-haloflux'

/** Services this plugin needs before `apply` may run. */
export const inject = ['webServer']

/** How often the supervisor re-checks the bridge. */
const HEALTH_TICK_MS = 30_000

/**
 * Register one exact-path HTTP route, trying both carrier spellings.
 * The plain `webServer.register` is attempted first; the connection-scoped
 * variant covers desktop carriers whose route table is fiber-scoped. A route
 * that cannot register anywhere is skipped rather than thrown.
 *
 * @param ctx - plugin context.
 * @param path - exact route path.
 * @param handler - Node request handler.
 * @returns true when some carrier accepted the route.
 */
function registerRoute(ctx, path, handler) {
  const attempts = []
  const webServer = ctx.get?.('webServer')
  if (webServer && typeof webServer.register === 'function') {
    attempts.push(() => webServer.register({ kind: 'exact', path, handler }))
  }
  const operatorCtx = ctx.get?.('connection')?.operator?.ctx
  const operatorWeb = operatorCtx?.get?.('webServer')
  if (operatorWeb && typeof operatorWeb.register === 'function') {
    attempts.push(() => operatorWeb.register({ kind: 'exact', path, handler }))
  }
  for (const attempt of attempts) {
    try {
      attempt()
      return true
    } catch {
      // try the next spelling
    }
  }
  return false
}

/**
 * Send one JSON body.
 * @param res - Node response.
 * @param body - value to serialize.
 */
function sendJson(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Cordis plugin entry.
 * @param ctx - plugin context carrying `webServer`.
 * @param config - optional `projectDir` / `port` / `autoStart`.
 */
export function apply(ctx, config = {}) {
  const settings = config || {}
  const supervisor = new HaloFluxSupervisor(ctx, settings)

  const routes = [
    ['/plugins/dsh-plugin-haloflux/status', async (req, res) => sendJson(res, await supervisor.status())],
    ['/plugins/dsh-plugin-haloflux/start', async (req, res) => sendJson(res, await supervisor.start())],
    ['/plugins/dsh-plugin-haloflux/stop', async (req, res) => sendJson(res, await supervisor.stop())],
  ]
  let wired = 0
  for (const [path, handler] of routes) {
    if (registerRoute(ctx, path, handler)) wired += 1
  }
  ctx.logger?.info?.(
    `[dsh-plugin-haloflux] 路由 ${wired}/${routes.length}；项目目录 = ${supervisor.projectDir ?? '未找到'}`,
  )

  if (settings.autoStart !== false) void supervisor.start()

  const timer = setInterval(() => {
    void (async () => {
      if (!supervisor.shouldRetry()) return
      const status = await supervisor.status()
      if (status.state === 'running') {
        supervisor.failures = 0
        return
      }
      await supervisor.start()
    })()
  }, HEALTH_TICK_MS)
  // A health tick must not keep the process alive on its own.
  timer.unref?.()

  // Cordis disposes whatever `apply` returns.
  return () => {
    clearInterval(timer)
    void supervisor.stop()
  }
}

export { HaloFluxSupervisor, resolveProjectDir }
