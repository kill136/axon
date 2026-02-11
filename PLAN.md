# 集成 Playwright CLI 浏览器能力到 Docker 部署

## 目标
让 Docker 容器中的 Claude Code 能通过 `playwright-cli` 操作 headless 浏览器，无需 MCP 协议，通过 Bash 工具直接调用 CLI 命令。

## 实施内容

### 1. 修改 Dockerfile —— 安装 Playwright + playwright-cli

当前 Dockerfile 基于 `node:18-slim`，需要：
- 安装 Chromium 浏览器及其系统依赖（字体、音视频库等）
- 全局安装 `@playwright/cli@latest`
- 设置 headless 模式环境变量

**具体改动**：在 Stage 2（Production）中增加 Chromium 系统依赖和 playwright-cli：

```dockerfile
# 安装 Chromium 系统依赖 + playwright-cli
RUN apt-get update && apt-get install -y --fix-missing \
    git \
    # Chromium 依赖
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    # 字体
    fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @playwright/cli@latest \
    && npx playwright install chromium --with-deps
```

### 2. 安装 playwright-cli SKILL 到镜像

playwright-cli 通过 `playwright-cli install --skills` 安装 SKILL.md 文件到 `~/.claude/skills/` 目录。但 Docker 中 `~/.claude` 是 volume 挂载点，所以需要：

- 在构建时，把 SKILL.md 文件直接放到 `/app/skills/playwright-cli/SKILL.md`
- 在容器启动时，如果 `~/.claude/skills/playwright-cli/SKILL.md` 不存在，自动复制过去

**更好的方案**：直接把 SKILL.md 放到项目目录的 `.claude/skills/playwright-cli/` 下，因为 skill 加载器会扫描项目目录（`projectSkillsDir`）。容器的 WORKDIR 是 `/workspace`，所以可以在镜像中预置 `/workspace/.claude/skills/playwright-cli/SKILL.md`。

但 `/workspace` 是用户映射的目录，不应该污染。

**最终方案**：在 Dockerfile 中构建完成后，把 SKILL.md 内容复制到 `/root/.claude/skills/playwright-cli/SKILL.md`（用户级别 skills 目录）。当用户挂载 `~/.claude` volume 时，如果他们没有这个文件，可以通过 entrypoint 脚本自动初始化。

### 3. 创建 entrypoint 脚本

替换当前的直接 `ENTRYPOINT ["node", "/app/dist/cli.js"]`，创建一个 shell 脚本：

```bash
#!/bin/bash
# 确保 playwright-cli SKILL 存在
mkdir -p /root/.claude/skills/playwright-cli
if [ ! -f /root/.claude/skills/playwright-cli/SKILL.md ]; then
  cp /app/skills/playwright-cli/SKILL.md /root/.claude/skills/playwright-cli/SKILL.md
fi

# 启动 Claude Code
exec node /app/dist/cli.js "$@"
```

### 4. 在项目中添加 SKILL.md 文件

在项目根目录创建 `skills/playwright-cli/SKILL.md`，内容从微软官方 playwright-cli 仓库获取（已获取完整内容）。

### 5. 更新 docker-compose.yml

添加共享内存（Chromium 需要）：

```yaml
services:
  claude:
    image: wbj66/claude-code-open:latest
    stdin_open: true
    tty: true
    shm_size: '2gb'  # Chromium 需要
    environment:
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
    volumes:
      - ~/.claude:/root/.claude
      - .:/workspace
```

### 6. 更新 .dockerignore

确保 `skills/` 目录不被忽略。

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `Dockerfile` | 修改：添加 Chromium 依赖、playwright-cli 安装、SKILL 预置、entrypoint |
| `docker-compose.yml` | 修改：添加 shm_size、环境变量 |
| `skills/playwright-cli/SKILL.md` | 新建：浏览器自动化 SKILL 定义 |
| `docker-entrypoint.sh` | 新建：容器启动脚本 |
| `.dockerignore` | 修改：确保 skills 不被忽略 |

## 镜像大小预估

- 当前镜像（node:18-slim + git）：约 250MB
- 新增 Chromium + 依赖：约 +400MB
- 总计：约 650MB（可接受，Playwright 官方镜像 1.2GB）

## 不做的事

- 不修改 Claude Code 源码 —— 浏览器能力完全通过 Bash 工具 + SKILL 暴露
- 不加 MCP 服务器 —— CLI 方式更轻量、更省 token
- 不加 VNC/noVNC —— headless 够用，AI 不需要看画面
- 不改工具系统 —— SKILL 自动授权 `Bash(playwright-cli:*)` 模式的命令
