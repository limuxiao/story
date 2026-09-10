#!/usr/bin/env bash
# 在 amd64 服务器上用 docker compose 构建并启动「前后端分离双镜像」
#   web  : nginx 托管 web/dist，反代 /api -> api:5178   (对外 5278)
#   api  : NestJS + better-sqlite3                       (5178，数据卷 studio-data 持久化)
#
# 说明：api 镜像在 docker build 内做多阶段编译（含 better-sqlite3 原生模块），
#       在 amd64 服务器原生构建时是原生 amd64，稳定且快速，无需像本地 Mac 那样绕开。
#       前端 dist 为预编译静态产物（本地 npm run build 生成，已随包带入），直接 COPY 进 nginx。
#
# 用法：把 webnovel-studio-buildctx.tar.gz 传到服务器解压后，
#       cd webnovel-studio && bash scripts/build-on-server.sh
set -e
cd "$(dirname "$0")/.."

# 前端 dist 需存在（本地 build 好、已随包带入）；缺失则现场补构建
if [ ! -d web/dist ] || [ -z "$(ls -A web/dist 2>/dev/null)" ]; then
  echo ">>> web/dist 缺失，现场构建前端..."
  (cd web && npm ci && npm run build)
fi

echo ">>> docker compose 构建并启动 webnovel-studio (web + api) ..."
docker compose -f docker-compose.yml up -d --build

echo ""
echo "完成。访问 http://<服务器IP>:5278"
echo "  web  镜像: webnovel-studio-web:latest   (nginx :5278)"
echo "  api  镜像: webnovel-studio-api:latest   (:5178，数据卷 studio-data 持久化 SQLite)"
echo "查看日志: docker compose -f docker-compose.yml logs -f"
echo "停止    : docker compose -f docker-compose.yml down"
