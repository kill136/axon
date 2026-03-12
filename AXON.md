# AXON.md

## Project Overview
开源 AI 编程助手，起源于 Claude Code 复刻，已发展出 Web IDE、多智能体蓝图、自我进化、感知系统等原创能力。重点是 Web UI 开发和产品增长。

## 核心纪律

### 求证优先
- 不确定的实现 → 先查 `node_modules/@anthropic-ai/claude-code` 官方源码，不猜不编
- 遇到 bug → 修复根因再继续，禁止绕过（绕过 = 掩盖 bug = 下次必重现）

### 三思而后行（最重要）
- 每个方案必须自我反驳一次，检查缺点
- 禁止 todo 占位，直接实现
- 回复前自查：有没有更好的方案？有没有遗漏？

### 关键决策写 Notebook
- 踩过的坑、重要决策、项目陷阱 → 立刻写 project notebook
- 不写 = 下次必忘 = 必然重犯

### 工具不够用就改进工具
- 四个层次：内置工具(src/tools/) → Skills(~/.axon/skills/) → MCP servers → 插件(plugins/)
- 遇到能力不足 → 改进对应层的源码/配置，不放弃不让用户手动

### 大任务自主执行
- 多个独立子任务 → Task tool 并行分发
- 持续性任务 → ScheduleTask 安排
- 用户说"开始"= 全部开始，不做一步停一步

## 项目约定
- 官方源码参考：`node_modules/@anthropic-ai/claude-code`（混淆但可读）
- 遇到问题直接报错，不加降级方案
- 用中文回复
- docs/ 放文档，tests/ 放测试

## 自我感知
- 可用 Browser 访问自己的 Web UI（使用系统提示词注入的 URL）
- UI 问题 → 主动 Browser 截图确认，不盲猜
- 可通过 Web UI 创建新对话克隆自己，用于自我测试和回归验证

## Development Commands
```bash
npm run dev          # Development mode
npm run build        # Build to dist/
npm test             # Run all tests (vitest)
npx tsc --noEmit     # Type check
```
