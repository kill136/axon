# V2EX 帖子

## 标题

[开源] Axon — 开源 AI 编程助手，Web IDE + 多智能体 + 37+ 工具，支持任意模型

## 正文

分享一个我做的开源项目 **Axon**，一个完整的 AI 编程助手。MIT 协议，完全本地运行。

### 核心卖点

**支持任意 AI 服务商** —— 不锁定模型，Anthropic、OpenRouter、DeepSeek、硅基流动、AWS Bedrock、Google Vertex AI，或者任何 OpenAI 兼容的 API 都能用。填个 Key 就行。

**Web IDE，不只是聊天框**
- Monaco 编辑器 + 文件树 + AI 增强编辑
- 行内代码审查、测试生成、AI 悬浮提示
- 终端面板、Git 集成、文件快照回滚

**多智能体协作（Blueprint）**
- 规划器分析需求 → Lead Agent 调度 → Worker 并行执行
- Swarm Console 实时监控多个 Agent 的任务进度
- 一个需求进去，完整代码出来

**37+ 内置工具**
- 文件操作、ripgrep 搜索、Shell 执行、浏览器自动化
- 数据库客户端（PostgreSQL/MySQL/SQLite/Redis/MongoDB）
- 定时任务守护进程（自然语言调度："每天早上 9 点审查昨天的提交"）

**自我进化**
- AI 可以修改自己的源码、编译检查、热重载
- 你可以让它自己给自己加新工具

**可扩展**
- MCP 协议支持
- Skills 技能市场（社区贡献的 PDF、DOCX、XLSX 等处理能力）
- 插件系统、Hook 系统

### 安装

```bash
npm install -g axon
export ANTHROPIC_API_KEY="sk-..."
axon-web  # 打开 http://localhost:3456
```

一键安装脚本（无需 Node.js）：Windows/macOS/Linux 都有。Docker 也支持。

### 链接

- GitHub：https://github.com/kill136/claude-code-open
- 官网：https://www.chatbi.site
- 在线体验：https://voicegpt.site
- Discord：https://discord.gg/bNyJKk6PVZ

### 技术栈

TypeScript + React + Express + WebSocket + Monaco Editor + Tree-sitter WASM + better-sqlite3

数据不出你的机器，没有遥测。欢迎 Star、提 Issue、PR。

---

## 掘金版本

### 标题

开源了一个 AI 编程助手 Axon：Web IDE + 多智能体 + 支持任意模型

### 正文

> 和 Cursor 比：免费、开源、不锁定编辑器、支持任意模型
> 和 Claude Code 比：有 Web IDE、多智能体、可自我进化

做了几个月，从一个小工具做成了完整的 AI 编程平台，今天开源出来。

#### 一句话介绍

Axon 是一个开源的 AI 编程助手，自带浏览器 IDE，支持多个 AI Agent 并行工作，能用任何 AI 模型。

#### 功能亮点

**1. Web IDE**

不是在终端里聊天。打开浏览器，就是一个完整的 IDE：Monaco 编辑器、文件树、AI 增强编辑、终端面板。

**2. 多智能体系统**

复杂项目不需要你一步步引导。给一个需求，Blueprint 系统自动拆任务、派多个 AI Agent 并行执行、自动评审。

**3. 37+ 工具**

文件读写、代码搜索、Shell 执行、浏览器自动化、数据库连接（5 种数据库）、定时任务、长期记忆……

**4. 自我进化**

这个 AI 能修改自己的源码。你可以说「加一个查天气的工具」，它会写代码、编译、重启，然后工具就能用了。

**5. 支持任意模型**

Anthropic、OpenRouter、DeepSeek、硅基流动、AWS Bedrock、Google Vertex AI。只要是 OpenAI 兼容接口就行。

#### 安装

```bash
npm install -g axon
axon-web
```

或者用一键安装脚本，不需要 Node.js。

#### 链接

- GitHub：[github.com/kill136/claude-code-open](https://github.com/kill136/claude-code-open)
- 在线体验：[voicegpt.site](https://voicegpt.site)
- Discord：[discord.gg/bNyJKk6PVZ](https://discord.gg/bNyJKk6PVZ)

MIT 协议，数据完全本地，没有遥测。Star 一下吧。
