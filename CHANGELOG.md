# 更新日志 / Changelog

## 1.0.0 — 2026-11-05

首个版本。

### 宿主半身（`src/`）
- **数据服务监管**：定位壁纸 checkout（自动探测三处常见路径，或由 `projectDir` 配置指定），
  spawn `dsh-hud/server.mjs` 并持有子进程句柄
- **健康探测**：每 30 秒 HTTP 探测 `/stats`，以「能否应答」判定存活——而不是猜进程在不在；
  进程在但不应答（zstd 解码卡住、端口被抢）会正确报为不健康
- **采纳已有进程**：端口上已有服务应答时直接 `adopted`，不杀用户手动起的进程
- **退避与上限**：8 秒内不重复启动；连续失败 5 次后停止自动重试，避免崩溃循环
- **生命周期回收**：插件停用时 `SIGTERM` 子进程，DSH 退出不留孤儿占端口
- **三条 HTTP 路由**：`/plugins/dsh-plugin-haloflux/{status,start,stop}`，
  同时尝试 `webServer.register` 与 connection-scoped 两种挂载拼写，任一成功即止
- **失败软着陆**：找不到项目、端口被占、spawn 异常都只写进 `lastError` 供面板显示，插件不抛错

### 浏览器半身（`lib/`）
- **设置面板**：显示运行状态（带呼吸点）、端口、项目目录、pid、桥接统计（会话数/壁纸连接数/RSS）、最近错误
- **一键控制**：启动 / 停止 / 刷新，按钮按状态自动禁用
- **5 秒轮询**：面板可见时定期刷新，卸载即清理定时器
- **零硬依赖**：只 `require('react')`；shell 原语缺失时用手写样式兜底

### 已知边界
- 插件**不含**壁纸本体（视觉、面板渲染、Lively 注入），那些在
  [dsh-hud-haloflux-live2](https://github.com/b1ub1u/dsh-hud-haloflux-live2) 项目里，需先装好
- 不做「一键装 Lively」：Lively 的安装与壁纸库注入留在项目侧 `install.ps1`，
  插件只负责服务生命周期（避免插件在后台静默改用户系统）
