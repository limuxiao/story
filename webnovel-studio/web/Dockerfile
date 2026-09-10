# syntax=docker/dockerfile:1
# ============================================================
# webnovel-studio · 前端运行镜像 (Nginx)
#
# 注意：本镜像只负责托管「本地已编译」的静态资源 dist/，
#       不再包含 node 构建阶段，因此构建/部署时不会拉取 node 镜像。
#
# 前提：需先在本地执行 `npm run build` 产出 dist/
# 构建上下文必须是 web/ 目录（COPY 路径均相对该目录）
#   推荐（compose 已配好）：docker compose build web
#   手动构建：cd web && docker build -t webnovel-studio-web .
# ============================================================

FROM nginx:alpine-slim

# 前端静态资源（由本地 npm run build 预编译）
COPY dist /usr/share/nginx/html

# nginx 站点配置：托管静态文件 + 将 /api 反向代理到后端服务
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5278

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5278/ || exit 1
