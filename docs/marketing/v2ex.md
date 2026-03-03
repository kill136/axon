# V2EX 帖子

## 标题

[开源] Axon — 开源 AI 编程平台，Web IDE + 多智能体 + 37+ 工具，MIT 协议

## 正文

花了几个月逆向还原 Anthropic 的 @anthropic-ai/claude-code，结果越做越大，最后做成了一个完整的 AI 编程平台。MIT 协议，完全开源。

### 核心特性

**Web IDE**
- Monaco 编辑器 + 文件树 + AI 增强编辑
- 行内代码审查、测试生成、意图转代码
- 终端面板、Git 集成、文件快照回滚

**多智能体协作（Blueprint）**
- Smart Planner 分析需求 → Lead Agent 调度 → Worker 并行执行
- Swarm Console 实时监控多个 Agent 的任务进度
- 一个需求进去，完整代码出来

**37+ 内置工具**
- 文件操作、ripgrep 搜索、Shell 执行、浏览器自动化
- 数据库客户端（PostgreSQL/MySQL/SQLite/Redis/MongoDB）
- DAP 调试器、LSP 代码智能
- 定时任务守护进程（自然语言调度："每天早上 9 点审查昨天的提交"）

**自我进化**
- AI 可以修改自己的源码、安装依赖、热重载
- TypeScript 编译检查 + 审计日志

**其他**
- 一键安装脚本（Windows/macOS/Linux）
- Docker 部署
- MCP 协议支持
- 支持 Anthropic / AWS Bedrock / Google Vertex AI
- 飞书机器人集成
- 中英文国际化

### 链接

- GitHub：https://github.com/kill136/axon
- 官网：https://www.chatbi.site
- 在线体验：http://voicegpt.site/
- Discord：https://discord.gg/bNyJKk6PVZ

### 技术栈

TypeScript + React + Express + WebSocket + Monaco Editor + Tree-sitter WASM + better-sqlite3

完全本地运行，数据不出你的机器。欢迎 Star、提 Issue、PR。
