# ============================================
# Stage 1: Build
# ============================================
FROM node:18-slim AS builder

# 使用中科大镜像源（解决国内网络问题）
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    true

RUN apt-get update && apt-get install -y --fix-missing \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制 package 文件，利用 Docker 缓存层
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install

# 复制源码并编译
COPY . .
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:18-slim

# 使用中科大镜像源
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    true

# 运行时依赖
RUN apt-get update && apt-get install -y --fix-missing \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 创建 .claude 目录（会被 volume 覆盖，但保底存在）
RUN mkdir -p /root/.claude

# 工作目录映射点
RUN mkdir -p /workspace
WORKDIR /workspace

ENTRYPOINT ["node", "/app/dist/cli.js"]
