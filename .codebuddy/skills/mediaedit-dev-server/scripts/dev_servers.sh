#!/usr/bin/env bash
# mediaEdit 开发服务：幂等地启动 / 停止 / 重启 / 检查前后端。
# 默认路径固定；可通过环境变量覆盖，便于项目迁移。
set -euo pipefail

ROOT="${MEDIAEDIT_ROOT:-/Users/limuyan/cursor_ws/story/mediaEdit}"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_PORT="${MEDIAEDIT_BACKEND_PORT:-8000}"
FRONTEND_PORT="${MEDIAEDIT_FRONTEND_PORT:-5173}"
LOG_DIR="${MEDIAEDIT_LOG_DIR:-/tmp}"
BACKEND_LOG="$LOG_DIR/mediaedit-backend.log"
FRONTEND_LOG="$LOG_DIR/mediaedit-frontend.log"

usage() {
  cat <<EOF
Usage: $(basename "$0") [start|stop|restart|status]   (default: start)

  start    启动后端 + 前端；已在运行且健康的服务直接跳过
  stop     按监听端口停止两个服务
  restart  先 stop 再 start
  status   报告端口占用、URL 与日志位置

Environment overrides:
  MEDIAEDIT_ROOT          项目根目录 (default $ROOT)
  MEDIAEDIT_BACKEND_PORT  后端端口   (default $BACKEND_PORT)
  MEDIAEDIT_FRONTEND_PORT 前端端口   (default $FRONTEND_PORT)
  MEDIAEDIT_LOG_DIR       日志目录   (default $LOG_DIR)

URLs after start:
  Editor : http://127.0.0.1:$FRONTEND_PORT/
  API    : http://127.0.0.1:$BACKEND_PORT/api/sources
  Docs   : http://127.0.0.1:$BACKEND_PORT/docs
EOF
}

port_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true
}

wait_http() {
  local url="$1" i
  for i in $(seq 1 60); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

start_backend() {
  local pid py
  pid="$(port_pid "$BACKEND_PORT")"
  if [ -n "$pid" ]; then
    if curl -fsS -o /dev/null "http://127.0.0.1:$BACKEND_PORT/api/sources" 2>/dev/null; then
      echo "backend   already up : http://127.0.0.1:$BACKEND_PORT (pid $pid)"
      return 0
    fi
    echo "backend   port $BACKEND_PORT is held by pid $pid but /api/sources is not healthy" >&2
    return 1
  fi

  py="$BACKEND_DIR/venv/bin/python"
  [ -x "$py" ] || py="python3"
  if ! "$py" -c 'import fastapi, uvicorn' >/dev/null 2>&1; then
    echo "backend   deps missing; run: $py -m pip install -r $BACKEND_DIR/requirements.txt" >&2
    return 1
  fi

  (
    cd "$BACKEND_DIR" || exit 1
    nohup "$py" -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" \
      > "$BACKEND_LOG" 2>&1 < /dev/null &
  )
  if ! wait_http "http://127.0.0.1:$BACKEND_PORT/api/sources"; then
    echo "backend   failed to start; tail of $BACKEND_LOG:" >&2
    tail -n 20 "$BACKEND_LOG" >&2 || true
    return 1
  fi
  echo "backend   started    : http://127.0.0.1:$BACKEND_PORT (pid $(port_pid "$BACKEND_PORT"))"
}

start_frontend() {
  local pid
  pid="$(port_pid "$FRONTEND_PORT")"
  if [ -n "$pid" ]; then
    if curl -fsS -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/" 2>/dev/null; then
      echo "frontend  already up : http://127.0.0.1:$FRONTEND_PORT (pid $pid)"
      return 0
    fi
    echo "frontend  port $FRONTEND_PORT is held by pid $pid but / is not healthy" >&2
    return 1
  fi

  if [ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]; then
    echo "frontend  deps missing; run: cd $FRONTEND_DIR && npm install" >&2
    return 1
  fi

  (
    cd "$FRONTEND_DIR" || exit 1
    nohup npx vite --host 127.0.0.1 --port "$FRONTEND_PORT" \
      > "$FRONTEND_LOG" 2>&1 < /dev/null &
  )
  if ! wait_http "http://127.0.0.1:$FRONTEND_PORT/"; then
    echo "frontend  failed to start; tail of $FRONTEND_LOG:" >&2
    tail -n 20 "$FRONTEND_LOG" >&2 || true
    return 1
  fi
  echo "frontend  started    : http://127.0.0.1:$FRONTEND_PORT (pid $(port_pid "$FRONTEND_PORT"))"
}

stop_one() {
  local name="$1" port="$2" pid i
  pid="$(port_pid "$port")"
  if [ -z "$pid" ]; then
    echo "$name  not running (:$port)"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for i in $(seq 1 20); do
    [ -z "$(port_pid "$port")" ] && break
    sleep 0.3
  done
  if [ -n "$(port_pid "$port")" ]; then
    echo "$name  still listening; sending SIGKILL" >&2
    kill -9 "$pid" 2>/dev/null || true
  fi
  echo "$name  stopped     (:$port, pid $pid)"
}

status() {
  local b f
  b="$(port_pid "$BACKEND_PORT")"
  f="$(port_pid "$FRONTEND_PORT")"
  echo "mediaEdit dev servers ($ROOT)"
  if [ -n "$b" ]; then echo "  backend  : running  pid $b  http://127.0.0.1:$BACKEND_PORT"; else echo "  backend  : stopped"; fi
  if [ -n "$f" ]; then echo "  frontend : running  pid $f  http://127.0.0.1:$FRONTEND_PORT"; else echo "  frontend : stopped"; fi
  echo "  logs     : $BACKEND_LOG , $FRONTEND_LOG"
}

case "${1:-start}" in
  start)
    start_backend || exit 1
    start_frontend || exit 1
    status
    ;;
  stop)
    stop_one "backend " "$BACKEND_PORT"
    stop_one "frontend" "$FRONTEND_PORT"
    ;;
  restart)
    stop_one "backend " "$BACKEND_PORT"
    stop_one "frontend" "$FRONTEND_PORT"
    sleep 1
    start_backend || exit 1
    start_frontend || exit 1
    status
    ;;
  status)
    status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
