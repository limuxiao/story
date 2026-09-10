#!/usr/bin/env bash
# 打包「双镜像 Docker 部署」所需文件，便于传到 amd64 服务器用 docker compose 构建
# 用法：bash scripts/pkg-for-server.sh  ->  生成 webnovel-studio-buildctx.tar.gz
set -e
cd "$(dirname "$0")/.."

OUT=webnovel-studio-buildctx.tar.gz

# 包含：docker-compose.yml + web/ + server/
#   web/  : 需预编译的 dist/（本地 npm run build 产物）+ Dockerfile + nginx.conf + 配置
#   server/: 需源码 + package* + tsconfig* + Dockerfile（docker build 内多阶段编译 better-sqlite3）
# 排除：node_modules / server/dist（重新构建）/ server/data（数据库）/ .git / 打包产物
tar --exclude='.git' \
    --exclude='node_modules' \
    --exclude='server/node_modules' \
    --exclude='server/dist' \
    --exclude='server/data' \
    --exclude='web/node_modules' \
    --exclude='*.tar' \
    --exclude='.DS_Store' \
    -czf "$OUT" \
    docker-compose.yml \
    web \
    server

ls -lh "$OUT"
echo ""
echo "已生成 $OUT"
echo "传到 amd64 服务器后："
echo "  tar -xzf $OUT"
echo "  cd webnovel-studio && bash scripts/build-on-server.sh"
