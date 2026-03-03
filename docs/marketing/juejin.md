# 掘金文章

## 标题

从逆向 @anthropic-ai/claude-code 到开源 AI 编程平台 Axon：Web IDE + 多智能体 + 37 个工具的实现之路

## 正文

### 起源

几个月前，我开始逆向 Anthropic 的 @anthropic-ai/claude-code（官方代码高度混淆压缩），想搞懂它到底是怎么工作的。逆向过程中，我发现了很多有趣的架构设计，同时也发现了很多可以改进的地方。

于是，一个"学习项目"逐渐演变成了一个完整的 AI 编程平台 — Axon。

### 它能做什么？

#### 1. Web IDE — 不只是聊天窗口

基于 React + Express + WebSocket 构建的浏览器 IDE：

- **Monaco 编辑器**：多标签页，语法高亮，和 VS Code 一样的编辑体验
- **文件树**：VS Code 风格，右键菜单，拖拽操作
- **AI 增强编辑**：悬停查看 AI 提示、选中代码问 AI、行内代码审查、自动生成测试
- **终端面板**：浏览器内终端
- **Git 面板**：查看状态、提交、分支管理
- **文件快照**：Checkpoint & Rewind，随时回滚

#### 2. 多智能体协作（Blueprint 系统）

这是最让我兴奋的功能。当任务太复杂，一个 AI 处理不了时：

1. **Smart Planner** 分析需求，拆解成独立子任务
2. **Lead Agent** 调度任务，分配给多个 Worker
3. **Autonomous Workers** 并行执行，每个 Worker 有完整的工具访问权限
4. **Swarm Console** 实时可视化所有 Agent 的工作状态

效果：一个需求描述进去，多个 Agent 同时工作，完整代码出来。

#### 3. 37+ 内置工具

| 类别 | 工具 |
|------|------|
| 文件操作 | Read, Write, Edit, MultiEdit |
| 搜索 | Glob, Grep (基于 ripgrep) |
| 执行 | Bash, 后台任务 |
| 浏览器 | Playwright 自动化 |
| 数据库 | PostgreSQL, MySQL, SQLite, Redis, MongoDB |
| 调试 | DAP 调试器 |
| 代码智能 | LSP, Tree-sitter 解析 |
| 任务管理 | TodoWrite, ScheduleTask |
| AI 协作 | Task (子代理), Blueprint, Agent Teams |
| 记忆 | MemorySearch, Notebook |

#### 4. 定时任务守护进程

```
"每天早上 9 点，审查昨天的 Git 提交，发现问题通知我的飞书"
```

- 自然语言配置时间
- 文件变化监听
- 桌面 + 飞书多渠道通知
- SQLite 持久化，重启不丢失

#### 5. 自我进化

AI 可以修改自己的源代码：编辑 TypeScript 文件 → tsc 编译检查 → 热重载服务器。有 dry-run 预览和审计日志，确保安全。

### 技术架构

五层架构：

1. **入口层**：CLI (Commander.js) + Web (Express + WebSocket)
2. **核心引擎**：API 客户端 + 会话管理 + 对话循环
3. **工具系统**：BaseTool → ToolRegistry 动态注册
4. **代理层**：Agent 调度 + Agent Teams + Blueprint 工作流
5. **扩展层**：Plugin + Hooks + MCP + i18n + Skills

### 如何使用

```bash
# 一键安装（推荐）
# Windows
irm https://raw.githubusercontent.com/kill136/claude-code-open/main/install.ps1 | iex

# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/main/install.sh | bash

# 手动安装
git clone https://github.com/kill136/claude-code-open.git
cd axon
npm install
npm run web  # 打开 http://localhost:3456
```

### 链接

- **GitHub**: https://github.com/kill136/claude-code-open
- **官网**: https://www.chatbi.site
- **在线体验**: http://voicegpt.site/
- **Discord**: https://discord.gg/bNyJKk6PVZ

MIT 协议，完全开源。欢迎 Star、Fork、提 Issue。

---

*这是一个教育研究项目，不是 Anthropic 官方产品。*
