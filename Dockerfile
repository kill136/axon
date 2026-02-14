# ============================================
# Stage 1: Build
# ============================================
# 使用 REGISTRY 参数支持 Docker Hub 镜像加速
# 默认直连，国内用户构建时加: --build-arg REGISTRY=docker.1ms.run
ARG REGISTRY=docker.io
FROM ${REGISTRY}/library/node:18-slim AS builder

# 替换为阿里云镜像源
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null; \
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
# Stage 2: Production (with Self-Evolve support)
# ============================================
ARG REGISTRY=docker.io
FROM ${REGISTRY}/library/node:18-slim

# 替换为阿里云镜像源
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null; \
    true

# 运行时依赖 + Chromium 系统依赖
RUN apt-get update && apt-get install -y --fix-missing \
    git \
    # Chromium 运行时依赖
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    # CJK 字体 + emoji
    fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制编译产物 + 完整 node_modules（含 tsx、typescript）
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 自进化模式需要：源码 + tsconfig（tsx 直接运行 .ts，tsc --noEmit 做编译检查）
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

COPY .claude/skills /app/.claude/skills

# 安装 playwright-cli 并下载 Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g @playwright/cli@latest \
    && npx playwright install chromium

# 创建 .claude 目录（会被 volume 覆盖，但保底存在）
RUN mkdir -p /root/.claude /app/.claude/skills/playwright-cli

# 入口脚本
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 工作目录映射点
RUN mkdir -p /workspace
WORKDIR /workspace

ENTRYPOINT ["/app/docker-entrypoint.sh"]
