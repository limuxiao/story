---
name: mediaedit-dev-server
description: 启动、停止、重启或检查 mediaEdit 项目的前端 Vite(:5173) 与后端 FastAPI/uvicorn(:8000) 开发服务。This skill should be used when the user asks to start, stop, restart or check the mediaEdit dev servers, e.g. "启动前后端", "启动服务", "把服务跑起来", "重启一下", "服务起来了吗", "打开编辑器", "start mediaEdit", "is the dev server running". Handles idempotent startup, HTTP health checks, port conflicts and log locations.
---

# mediaEdit 开发服务

## 用途

一键拉起 mediaEdit 编辑器所需的两个进程：后端 FastAPI/uvicorn 与前端 Vite。脚本幂等；已运行且健康的服务直接跳过，不会重复启动或占用端口。

## 何时使用

- 用户要求启动、重启、停止前后端服务，或询问服务是否在运行。
- 在浏览器验证编辑器、运行回归脚本、调用导出接口之前，先确认服务可用。
- 长时间放置或系统清理后进程被结束，需要恢复开发环境。
- 用户只说「启动」「跑起来」「打开编辑器」且当前工作区是 mediaEdit 相关项目时，同样适用。

## 快速使用

本 skill 为项目级，只在 `/Users/limuyan/cursor_ws/story` 工作区生效，不安装到用户全局目录；`.workbuddy/skills/mediaedit-dev-server` 是指向同一份内容的链接。直接执行脚本（无需切换工作目录，默认动作即 `start`）：

```bash
bash /Users/limuyan/cursor_ws/story/.codebuddy/skills/mediaedit-dev-server/scripts/dev_servers.sh
```

| 动作 | 命令 |
| --- | --- |
| 启动（默认） | `bash .../dev_servers.sh` 或 `... start` |
| 停止 | `... stop` |
| 重启 | `... restart` |
| 查状态 | `... status` |
| 帮助 | `... --help` |

执行 `start` 后把这两个地址回报给用户：编辑器 `http://127.0.0.1:5173/`，API 文档 `http://127.0.0.1:8000/docs`。

## 固定配置

| 项 | 值 |
| --- | --- |
| 项目根目录 | `/Users/limuyan/cursor_ws/story/mediaEdit` |
| 后端 | `backend/`，`venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`，健康检查 `GET /api/sources` |
| 前端 | `frontend/`，`npx vite --host 127.0.0.1 --port 5173`，健康检查 `GET /` |
| 日志 | `/tmp/mediaedit-backend.log`、`/tmp/mediaedit-frontend.log` |

后端解释器优先用项目自带的 `backend/venv/bin/python`，不存在时回退系统 `python3`。

可用环境变量覆盖：`MEDIAEDIT_ROOT`、`MEDIAEDIT_BACKEND_PORT`、`MEDIAEDIT_FRONTEND_PORT`、`MEDIAEDIT_LOG_DIR`。

## 脚本行为要点

- 启动前检查依赖：后端 `import fastapi, uvicorn`，前端 `node_modules/.bin/vite`；缺失时打印可复制的安装命令而非静默失败。
- 启动后用 HTTP 健康检查轮询（最多 30 秒），失败时打印对应日志尾部。
- 端口已被占用但健康检查不通过时报错退出，不误判为「已启动」，也不强杀无关进程。
- `stop` 按监听端口找 PID，先 `SIGTERM` 等待释放，必要时再 `SIGKILL`。
- 每次 `start`/`restart` 结束会打印 `status` 与日志路径。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 端口被占用且非本项目进程 | 用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` / `:5173` 查明 PID，让用户决定是否结束；或用环境变量换端口。 |
| 后端起不来 | 查看 `/tmp/mediaedit-backend.log`；常见原因是 `venv` 依赖缺失或 `backend/storage` 权限。按脚本提示安装 `backend/requirements.txt`。 |
| 前端起不来 | 查看 `/tmp/mediaedit-frontend.log`；常见原因是 `node_modules` 缺失，执行 `cd .../frontend && npm install`。 |
| 后端代码改了没生效 | 启动命令未启用 `--reload`；执行 `... restart`。 |
| 日志文件找不到 | `/tmp` 可能被系统清理；用 `MEDIAEDIT_LOG_DIR` 指向持久目录。 |
| 页面能开但素材/导出报错 | 先执行 `... status`，再用 `curl -fsS http://127.0.0.1:8000/api/sources` 确认后端；导出接口为 `POST /api/export`。 |

## 注意事项

- 只负责进程生命周期，不改业务代码、不修改预览渲染架构。
- 预览链路固定为 Worker 内 mp4box 解封装 + WebCodecs 解码 → 主线程 VideoFrame 绘制到离屏 canvas → PixiJS 纹理合成；排查启动问题时不得引入 `<video>` / `<audio>` DOM。
- 不要把服务启动成 `watch` 型前台进程；脚本用 `nohup` 后台运行，命令会立即返回。
