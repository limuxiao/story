# syntax=docker/dockerfile:1
# ============================================================
# webnovel-studio · 后端 (NestJS + better-sqlite3)
#
# 构建上下文必须是 server/ 目录（COPY 路径均相对该目录）
#   推荐（compose 已配好）：docker compose build api
#   手动构建：cd server && docker build -t webnovel-studio-api .
#   ✗ 错误用法：在项目根目录执行 docker build -f server/Dockerfile .
#     那样 COPY 到的是根 package.json，会因缺少 build 脚本而失败
# ============================================================

########## 构建阶段 ##########
FROM node:22-alpine AS build

WORKDIR /app/server

# better-sqlite3 为原生模块：优先下载预编译包，
# 无法命中预编译时回退到源码编译，因此准备编译工具链
RUN apk add --no-cache python3 make g++

# 先拷贝依赖清单以充分利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码并编译（tsc 输出到 dist/）
COPY . ./
RUN npm run build

# 剔除开发期依赖，缩小运行时体积（不影响已编译产物与原生模块）
RUN npm prune --omit=dev

########## 运行阶段 ##########
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=5178

WORKDIR /app/server

# 编译产物 + 生产依赖（含与构建阶段一致的 better-sqlite3 原生绑定）
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/package.json ./package.json

# SQLite 数据目录：运行时以 named volume 挂载到这里实现持久化
# （首次启动会自动建表并灌入教程种子数据，无需手动初始化）
RUN mkdir -p /app/server/data && chown -R node:node /app/server

# 以非 root 用户运行
USER node

EXPOSE 5178

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:5178/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
