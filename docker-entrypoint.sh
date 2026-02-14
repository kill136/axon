#!/bin/bash
set -e

# 初始化 playwright-cli SKILL（volume 挂载可能覆盖预置文件）
SKILL_DIR="/root/.claude/skills/playwright-cli"
SKILL_SRC="/app/.claude/skills/playwright-cli/SKILL.md"
if [ -f "$SKILL_SRC" ] && [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  mkdir -p "$SKILL_DIR"
  cp "$SKILL_SRC" "$SKILL_DIR/SKILL.md"
fi

# 判断启动模式：
#   无参数 / 第一个参数以 - 开头  → WebUI（默认 --evolve 自进化模式）
#   第一个参数是 claude / claude-web / node 等 → 透传执行
#   其他 → 当作 CLI 提示词传给 claude
case "${1:-}" in
  ""|"-"*)
    # 默认启动 WebUI + 自进化模式
    # 用 tsx 直接运行 TypeScript 源码，--evolve 启用退出码 42 自动重启
    cd /app
    exec node_modules/.bin/tsx src/web-cli.ts --evolve -H 0.0.0.0 "$@"
    ;;
  "claude"|"claude-web"|"node"|"npm"|"npx"|"bash"|"sh")
    # 显式命令：透传执行
    exec "$@"
    ;;
  "--no-evolve")
    # 显式禁用自进化：用编译后的 dist 启动普通 WebUI
    shift
    exec node /app/dist/web-cli.js -H 0.0.0.0 "$@"
    ;;
  *)
    # 其他参数：当作 CLI 模式（用编译后的 dist）
    exec node /app/dist/cli.js "$@"
    ;;
esac
