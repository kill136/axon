---
name: changelog
description: 从 git 历史自动生成 Changelog。分析两个 tag 之间的提交，按类型分类（feat/fix/chore/refactor），生成可读的 changelog 文档。Use this skill whenever the user mentions changelog、更新日志、release notes、发布说明、变更记录，even if they just say "看看改了啥" or "写个更新说明"。
argument-hint: [起始tag..终止tag，如 v2.1.45..v2.1.46]
---

# 自动生成 Changelog

## 流程

### Step 1: 确定范围
- 如果提供了 `$ARGUMENTS`（如 `v2.1.45..v2.1.46`），使用指定范围
- 如果未提供，取最新两个 tag 之间的提交：
```bash
PREV_TAG=$(git tag --sort=-creatordate | head -2 | tail -1)
CURRENT_TAG=$(git tag --sort=-creatordate | head -1)
```

### Step 2: 提取提交
```bash
git log $PREV_TAG..$CURRENT_TAG --oneline --no-merges
```

### Step 3: 分类
按 commit message 前缀分类：

| 前缀 | 类别 | 显示标题 |
|------|------|---------|
| `feat:` / `feat(` | Features | New Features |
| `fix:` / `fix(` | Bug Fixes | Bug Fixes |
| `refactor:` | Refactor | Refactoring |
| `perf:` | Performance | Performance |
| `chore:` | Chores | Maintenance |
| `docs:` | Documentation | Documentation |
| `style:` | Style | Style Changes |
| `test:` | Tests | Tests |
| 其他 | Other | Other Changes |

### Step 4: 生成 Markdown
```markdown
## What's Changed in vX.Y.Z

### New Features
- feat(web): add dark mode support (#123)
- feat: implement voice synthesis

### Bug Fixes
- fix: resolve WebSocket reconnection issue
- fix(i18n): correct missing translation keys

### Maintenance
- chore: bump dependencies
- chore: rebuild frontend assets

**Full Changelog**: https://github.com/kill136/claude-code-open/compare/vPREV...vCURRENT
```

### Step 5: 输出
- 直接在对话中输出 changelog
- 如果用户需要，写入文件（如 `CHANGELOG.md` 或 release body）

## 注意事项
- commit message 没有遵循 conventional commits 时，尽量从内容推断分类
- 忽略 merge commits
- GitHub release 的 changelog 由 `.github/workflows/release.yml` 自动生成，此 skill 用于手动生成或预览
