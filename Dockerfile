# MCPDog Dockerfile

# ---- 基础镜像 ----
# 固定 Node.js 版本，保证构建可复现
FROM node:20-alpine AS base
WORKDIR /usr/src/app

# 先复制依赖清单，利用 Docker 层缓存
COPY package*.json ./

# ---- 依赖安装阶段 ----
FROM base AS dependencies
# 安装全部依赖（含编译所需的开发依赖）
RUN npm install

# 安装 Web 前端依赖
COPY web/package*.json ./web/
RUN cd web && npm install

# ---- 编译阶段 ----
FROM dependencies AS build
# 复制应用源码
COPY . .
# 编译应用（TypeScript -> JavaScript）
RUN npm run build

# ---- 生产镜像阶段 ----
FROM base AS production

# 仅复制生产运行所需依赖
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
# 复制编译产物
COPY --from=build /usr/src/app/dist ./dist
# 复制 Web 前端构建产物
COPY --from=build /usr/src/app/web/dist ./web/dist
# 复制 package.json 作为运行时信息
COPY package.json .

# 创建非 root 用户运行，提升安全性
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /usr/src/app
USER appuser

# 暴露默认端口
# 38881：Web 管理界面
# 4000：MCP HTTP 传输
EXPOSE 38881 4000

# 启动命令
# 启动 daemon（含 Web 界面与全部传输协议）
CMD ["node", "dist/cli/cli-main.js", "start"]
