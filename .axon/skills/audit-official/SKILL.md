---
name: audit-official
description: 对比 Axon 项目与 Claude Code 官方实现的差异。检查工具定义、系统提示词、API 调用方式是否与官方源码或文档一致，发现偏差和优化空间。Use this skill whenever the user mentions 对齐官方、对比官方、audit、和官方比较、官网更新了、sync with official、check against upstream，even if they just say "看看官方怎么做的" or "对齐一下"。
disable-model-invocation: true
argument-hint: [模块名，如 tools/bash, prompt, skills]
---

# 对齐官方源码审计

## 参考源

### 1. 官方 npm 包（混淆但可读）
```
node_modules/@anthropic-ai/claude-code/
```
- 代码高度压缩混淆，但逻辑可以反推
- 搜索关键字（如工具名、提示词片段）定位代码

### 2. 官方文档
```
https://code.claude.com/docs/en/
```
（旧域名 docs.anthropic.com 已 301 重定向）

主要页面：
- `/docs/en/overview` — 概述
- `/docs/en/skills` — Skills 系统
- `/docs/en/sub-agents` — 子代理
- `/docs/en/agent-teams` — 多代理协作
- `/docs/en/plugins` — 插件系统
- `/docs/en/hooks-guide` — Hooks
- `/docs/en/settings` — 配置
- `/docs/en/cli-reference` — CLI 参考

### 3. 官方 GitHub
```
https://github.com/anthropics/claude-code
```

## 审计流程

### Step 1: 确定审计范围
- 如果提供了 `$ARGUMENTS`（如 `tools/bash`），聚焦该模块
- 如果未提供，让用户选择审计哪个模块

### Step 2: 读取本地实现
- 读取我们的源码（`src/` 下对应模块）
- 提取关键逻辑：接口定义、参数、行为

### Step 3: 获取官方参考
- 先搜索 `node_modules/@anthropic-ai/claude-code/` 中的对应代码
- 如果找不到或读不懂，用 WebFetch 获取官方文档
- 对比关键差异

### Step 4: 输出报告
```markdown
## 审计报告: [模块名]

### 一致的部分
- ✅ 工具 schema 与官方一致
- ✅ 系统提示词结构对齐

### 发现的差异
- ⚠️ 我们的 Bash description 多了 2000 chars（官方更精简）
- ❌ 官方新增了 `argument-hint` 字段，我们未支持

### 建议改进
1. 精简 Bash description，对齐官方结构
2. 新增 `argument-hint` frontmatter 字段支持
```

### Step 5: 用户决策
对于每个差异，让用户决定是否修复：
- 有些差异是我们的优势（如额外功能），不需要对齐
- 有些差异是缺失/过时，需要更新

## 注意事项
- 官方源码被混淆了，变量名无意义，但字符串常量和结构可以识别
- 不要盲目对齐，我们有很多官方没有的原创功能（Web IDE、感知系统、自我进化等）
- 重点对齐：工具 schema、系统提示词、API 调用约定、Skills 格式规范
- 官方文档域名已迁移到 `code.claude.com/docs/en/`
