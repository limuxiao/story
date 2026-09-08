# syntax=docker/dockerfile:1
# ============================================================
# webnovel-studio · 前端 (Vite + Vue3)
#
# 构建上下文必须是 web/ 目录（COPY 路径均相对该目录）
#   推荐（compose 已配好）：docker compose build web
#   手动构建：cd web && docker build -t webnovel-studio-web .
#   ✗ 错误用法：在项目根目录执行 docker build -f web/Dockerfile .
# ============================================================

########## 构建阶段 ##########
FROM node:22-alpine AS build

WORKDIR /app/web

# 先拷贝依赖清单以充分利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码并产出静态资源到 dist/
COPY . ./
RUN npm run build

########## 运行阶段 ##########
# nginx 托管静态文件，并将 /api 反向代理到后端服务
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 5278

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5278/ || exit 1
