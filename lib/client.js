/**
 * dsh-plugin-haloflux — browser half.
 *
 * Adds one settings section that shows the bridge状态 and lets the user start
 * or stop it without a terminal. It talks to the three host routes registered
 * by src/index.js:
 *
 *   GET /plugins/dsh-plugin-haloflux/status
 *   GET /plugins/dsh-plugin-haloflux/start
 *   GET /plugins/dsh-plugin-haloflux/stop
 *
 * Bundle format: the client-modules protocol. `window.__ModuleLoader__.load`
 * registers a lazy CommonJS factory whose `require` resolves against the shell's
 * own module table — no bundler, no duplicate React, no runtime dependency on
 * another feature package. Only `react` is required; shell primitives are read
 * defensively so a shell that does not ship them still gets a working
 * (in-house styled) panel.
 */
/* eslint-disable no-undef -- browser bundle: React and the shell loader are globals here. */
if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
  window.__ModuleLoader__.load({
    id: 'dsh-plugin-haloflux',
    factory: (require) => {
      const React = require('react')
      const { useState, useEffect, useCallback, useRef } = React

      /** Host routes registered by src/index.js. */
      const STATUS_PATH = '/plugins/dsh-plugin-haloflux/status'
      const START_PATH = '/plugins/dsh-plugin-haloflux/start'
      const STOP_PATH = '/plugins/dsh-plugin-haloflux/stop'

      /** Settings slot this panel occupies. */
      const SECTION_SLOT = 'settings.sections'
      const SECTION_ID = 'dsh-plugin-haloflux'
      const SECTION_ORDER = 640

      /** How often the panel re-reads status while visible. */
      const POLL_MS = 5000

      const zh = {
        title: 'HALOFLUX 实时壁纸',
        state: '状态',
        port: '端口',
        project: '项目目录',
        pid: '进程',
        stats: '会话数据',
        running: '运行中',
        starting: '启动中',
        stopped: '已停止',
        managed: '本插件托管',
        adopted: '外部进程',
        start: '启动服务',
        stop: '停止服务',
        refresh: '刷新',
        hintRunning: '数据服务在线，壁纸会在 Lively 中实时联动。',
        hintStopped: '数据服务未运行。点击「启动服务」把壁纸数据桥接起来。',
        hintMissing: '未找到 HUD 项目目录。请把 dsh-hud-haloflux 放在默认位置，或在插件配置里指定 projectDir。',
        errLast: '最近错误',
        sessions: '会话',
        clients: '壁纸连接',
      }

      /**
       * Read one JSON route.
       * @param url - route path.
       * @returns the parsed body, or undefined on failure.
       */
      async function readJson(url) {
        try {
          const res = await fetch(url, { headers: { accept: 'application/json' } })
          if (!res.ok) return undefined
          return await res.json()
        } catch {
          return undefined
        }
      }

      /** Small labelled row. */
      function Row({ label, children }) {
        return React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              gap: '10px',
              alignItems: 'baseline',
              padding: '3px 0',
              fontSize: '12px',
              lineHeight: 1.5,
            },
          },
          React.createElement(
            'span',
            { style: { color: 'var(--dsh-text-secondary, #8d939c)', minWidth: '64px', flex: '0 0 auto' } },
            label,
          ),
          React.createElement(
            'span',
            { style: { color: 'var(--dsh-text-primary, #e8eaee)', wordBreak: 'break-all' } },
            children,
          ),
        )
      }

      /** The panel itself. */
      function HaloFluxPanel() {
        const [status, setStatus] = useState(null)
        const [busy, setBusy] = useState(false)
        const [note, setNote] = useState('')
        const mounted = useRef(true)

        const refresh = useCallback(async () => {
          const body = await readJson(STATUS_PATH)
          if (mounted.current && body) setStatus(body)
        }, [])

        useEffect(() => {
          mounted.current = true
          void refresh()
          const timer = setInterval(() => {
            void refresh()
          }, POLL_MS)
          return () => {
            mounted.current = false
            clearInterval(timer)
          }
        }, [refresh])

        const act = useCallback(
          async (path) => {
            setBusy(true)
            setNote('')
            const body = await readJson(path)
            setNote(body && body.reason ? body.reason : path === START_PATH ? '已启动' : '已停止')
            await refresh()
            setBusy(false)
          },
          [refresh],
        )

        const state = status ? status.state : 'unknown'
        const stateText =
          state === 'running' ? zh.running : state === 'starting' ? zh.starting : state === 'stopped' ? zh.stopped : '—'
        const stateColor = state === 'running' ? '#0ec7a8' : state === 'starting' ? '#d6a06e' : '#8d939c'
        const stats = status && status.stats ? status.stats : null

        return React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            React.createElement('span', {
              style: {
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: stateColor,
                boxShadow: `0 0 8px ${stateColor}`,
                flex: '0 0 auto',
              },
            }),
            React.createElement(
              'span',
              { style: { fontSize: '13px', fontWeight: 700, color: stateColor } },
              stateText,
            ),
            status && status.managed
              ? React.createElement(
                  'span',
                  { style: { fontSize: '10px', color: '#8d939c' } },
                  zh.managed,
                )
              : null,
            status && status.pid
              ? React.createElement(
                  'span',
                  { style: { fontSize: '10px', color: '#8d939c' } },
                  `pid ${status.pid}`,
                )
              : null,
          ),

          React.createElement(Row, { label: zh.port }, status ? String(status.port) : '—'),
          React.createElement(Row, { label: zh.project }, status && status.projectDir ? status.projectDir : '未找到'),

          stats
            ? React.createElement(
                Row,
                { label: zh.stats },
                `${zh.sessions} ${stats.sessions ?? '?'} · ${zh.clients} ${stats.clients ?? '?'} · RSS ${
                  stats.rssMB ?? '?'
                } MB`,
              )
            : null,

          status && status.lastError
            ? React.createElement(
                Row,
                { label: zh.errLast },
                React.createElement('span', { style: { color: '#ff8ab0' } }, status.lastError),
              )
            : null,

          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', marginTop: '2px', flexWrap: 'wrap' } },
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: busy || state === 'running',
                onClick: () => void act(START_PATH),
                style: buttonStyle(state !== 'running' && !busy),
              },
              zh.start,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: busy || state === 'stopped',
                onClick: () => void act(STOP_PATH),
                style: buttonStyle(state !== 'stopped' && !busy),
              },
              zh.stop,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => void refresh(),
                style: buttonStyle(!busy),
              },
              zh.refresh,
            ),
          ),

          note
            ? React.createElement(
                'div',
                { style: { fontSize: '11px', color: '#8d939c' } },
                note,
              )
            : null,

          React.createElement(
            'div',
            { style: { fontSize: '11px', color: '#8d939c', lineHeight: 1.55, marginTop: '2px' } },
            !status || !status.projectDir ? zh.hintMissing : state === 'running' ? zh.hintRunning : zh.hintStopped,
          ),
        )
      }

      /**
       * Shared button look; `active` dims a control that cannot act right now.
       * @param active - whether the button is actionable.
       */
      function buttonStyle(active) {
        return {
          font: '600 11.5px/1 inherit',
          padding: '6px 12px',
          borderRadius: '6px',
          border: '1px solid var(--dsh-border, #2a2d34)',
          background: active ? 'var(--dsh-surface-raised, #1a1c21)' : 'transparent',
          color: active ? 'var(--dsh-text-primary, #e8eaee)' : 'var(--dsh-text-disabled, #5c626c)',
          cursor: active ? 'pointer' : 'default',
        }
      }

      /**
       * Client plugin entry: one settings section.
       * @param ctx - client plugin context (slots).
       */
      function apply(ctx) {
        const slots = ctx.get?.('slots')
        if (slots === undefined) return
        slots.inject(SECTION_SLOT, () =>
          slots.register(
            {
              name: SECTION_SLOT,
              id: SECTION_ID,
              order: SECTION_ORDER,
              title: zh.title,
            },
            HaloFluxPanel,
          ),
        )
      }

      return { apply, inject: ['slots'] }
    },
  })
}
