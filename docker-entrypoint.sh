#!/bin/bash
set -e

# 初始化 playwright-cli SKILL（volume 挂载可能覆盖预置文件）
SKILL_DIR="/root/.claude/skills/playwright-cli"
SKILL_SRC="/app/skills/playwright-cli/SKILL.md"
if [ -f "$SKILL_SRC" ] && [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  mkdir -p "$SKILL_DIR"
  cp "$SKILL_SRC" "$SKILL_DIR/SKILL.md"
fi

exec node /app/dist/cli.js "$@"
