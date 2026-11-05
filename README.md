# dsh-plugin-haloflux

把 **DSH × HALOFLUX 实时联动壁纸**做成 DSH 插件：不用开终端，在设置面板里就能启动/停止数据服务并查看健康状态。

## 它做什么

这个插件是**壁纸数据服务的管家**，不是壁纸本身：

| 插件负责 | 壁纸项目负责 |
|---|---|
| 启动/停止 `dsh-hud/server.mjs`（127.0.0.1:7788） | 环带动画、面板渲染、Lively 注入 |
| 健康检查（HTTP `/stats` 探测，不是猜进程） | 5 个 AI 平台会话解析、SSE 推送 |
| 崩溃后受限重试（最多 5 次，8 秒退避） | 多卡标题堆叠、现在任务滚动带 |
| DSH 退出时回收子进程，不留孤儿占端口 | 路径脱敏、用量统计 |

## 前置条件

先装壁纸本体（含 Lively + 数据桥源码）：

```powershell
git clone https://github.com/b1ub1u/dsh-hud-haloflux-live2.git
powershell -NoProfile -ExecutionPolicy Bypass -File dsh-hud-haloflux\dsh-hud\install.ps1
```

## 安装插件

```powershell
dsh plugin --profile desktop add link:<本目录绝对路径>
```

或从 npm（发布后）：

```powershell
dsh plugin --profile desktop add dsh-plugin-haloflux
```

装完重启 DSH，设置里出现「HALOFLUX 实时壁纸」一节。

## 配置

在插件配置里可以覆盖默认值：

| 键 | 默认 | 说明 |
|---|---|---|
| `projectDir` | 自动探测 | 壁纸项目根目录（含 `dsh-hud/server.mjs`） |
| `port` | `7788` | 数据服务端口 |
| `autoStart` | `true` | DSH 启动时自动拉起数据服务 |

自动探测顺序：`~/.dsh/haloflux` → `~/Documents/deepseek-harness/default-workspace/dsh-hud-haloflux` → 本机开发路径。

## 对外接口

插件注册三条 HTTP 路由供面板调用：

| 路由 | 作用 |
|---|---|
| `GET /plugins/dsh-plugin-haloflux/status` | 状态、端口、项目目录、pid、桥接统计、最近错误 |
| `GET /plugins/dsh-plugin-haloflux/start` | 启动数据服务 |
| `GET /plugins/dsh-plugin-haloflux/stop` | 停止由本插件托管的服务 |

## 设计取舍

- **不重启别人的进程**：如果 7788 上已有服务在应答，插件直接采纳（`adopted`），不会杀掉你以为是自己手动起的进程。
- **失败软着陆**：找不到项目、端口被占、子进程崩溃，都只把原因写进面板，插件本身不抛错、不卸载。
- **不碰会话日志**：读 `~/.dsh/sessions` 是壁纸桥的职责，插件不重复实现。
- **退避防抖**：8 秒内不重复启动，连续失败 5 次后停止自动重试，避免崩溃循环。

## 许可

- 本插件：MIT
- 壁纸视觉：HALOFLUX by Ryder191，PolyForm Noncommercial（**禁止商业用途**）

## 相关

- 壁纸项目：https://github.com/b1ub1u/dsh-hud-haloflux-live2
- 视觉本体：https://github.com/Ryder191/haloflux
