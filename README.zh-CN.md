# Claude Code (Open Source)

基于 `@anthropic-ai/claude-code` v2.1.37 的开源实现。它将成为未来 AI 的基础设施，运行在每台 PC 上。

[![Website](https://img.shields.io/badge/Website-claude--code--open.vercel.app-blue?style=flat-square)](https://www.chatbi.site)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)

[访问网站](https://www.chatbi.site) | [English README](README.md)

**仅用于教育和研究目的。**

## 免责声明

这是一个教育项目，用于研究和学习 CLI 工具的架构设计。这**不是**官方 Claude Code 的源代码，而是基于公开 API 和类型定义的重新实现。

如需使用官方 Claude Code，请安装官方版本：
```bash
npm install -g @anthropic-ai/claude-code
```

## 功能概览

- **30+ 内置工具** - 文件操作、搜索、执行、Web 访问、任务管理、定时任务等
- **一键安装脚本** - Windows、macOS、Linux 自动化安装脚本，自动创建桌面快捷方式
- **定时任务守护进程** - 后台守护进程支持定时任务、间隔任务、文件监控和通知推送
- **Web UI** - 完整的浏览器界面，React 前端 + WebSocket 实时通信
- **Blueprint 多 Agent 系统** - Lead Agent、自主 Worker、任务队列、实时协调
- **国际化 (i18n)** - 中英文双语支持
- **统一内存系统** - 向量存储、BM25 搜索、意图提取、对话记忆
- **MCP 协议** - 完整的 Model Context Protocol 支持，含自动发现
- **多云服务商** - Anthropic、AWS Bedrock、Google Vertex AI
- **Extended Thinking** - 扩展推理模式支持
- **快速模式** - Penguin 模式，加速响应
- **代理服务器** - 跨设备共享 Claude 订阅
- **微信机器人** - 微信消息集成
- **Docker 部署** - 容器化部署支持
- **团队协作** - 团队管理功能
- **插件与 Hook 系统** - 可扩展架构，支持生命周期钩子

## 快速安装（推荐）

### 一键安装脚本

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
```

安装脚本会自动完成：
- ✅ 克隆代码仓库
- ✅ 安装所有依赖
- ✅ 构建前端和后端
- ✅ 创建桌面快捷方式
- ✅ 预设 API 配置
- ✅ 全局命令链接

**安装完成后：**
1. 双击桌面快捷方式 "Claude Code WebUI"
2. 浏览器自动打开 http://localhost:3456
3. 开始使用！

### 手动安装

如果你想手动安装或进行开发：

```bash
# 克隆仓库
git clone https://github.com/kill136/claude-code-open.git
cd claude-code-open

# 安装依赖
npm install

# 构建前端
cd src/web/client
npm install
npm run build
cd ../../..

# 构建后端
npm run build

# 全局链接（可选）
npm link

# 可选：安装 Playwright CLI（浏览器自动化）
npm run install:playwright
```

### Windows 部署注意事项

**Native addon 编译（通常不需要）：**

项目依赖了 `better-sqlite3`、`node-pty`、`sharp` 等 native addon，但它们都自带 **Windows x64 预编译二进制**。正常情况下，`npm install` 会直接下载预编译文件，无需本地编译。

如果预编译下载失败（如无法访问 GitHub releases、或使用了冷门 Node.js 版本），npm 会回退到从源码编译。**仅在此情况下**才需要：

- **Python 3.6+** — node-gyp 依赖
- **Visual Studio Build Tools 2022** — 提供 MSVC C++ 编译器，安装时选择"使用 C++ 的桌面开发"工作负载

> 提示：如果在公司内网环境，配置 npm 代理（`npm config set proxy` / `https-proxy`）可确保预编译二进制正常下载。

**环境变量冲突：**

项目从以下环境变量读取 API 配置：

| 变量 | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API 认证 |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点（默认：`https://api.anthropic.com`） |

如果你的 **Windows 系统/用户环境变量**中已设置了这些变量（如用于官方 Claude Code 或其他项目），它们会覆盖 `settings.json` 中的配置。

避免冲突的方式 — 在终端窗口中按会话设置，而非设为系统级变量：

```powershell
# PowerShell（仅当前会话生效）
$env:ANTHROPIC_API_KEY="your-key-for-this-project"
$env:ANTHROPIC_BASE_URL="https://your-api-endpoint"
```

```cmd
# CMD（仅当前会话生效）
set ANTHROPIC_API_KEY=your-key-for-this-project
set ANTHROPIC_BASE_URL=https://your-api-endpoint
```

> 注意：项目根目录的 `.env` 文件**不会被自动加载** — 项目未使用 `dotenv`。环境变量需通过系统设置、`settings.json` 或 `--env` CLI 参数配置。

### 浏览器自动化支持

如需使用浏览器自动化功能（Playwright CLI），需手动安装：

```bash
npm run install:playwright
```

这会：
- 全局安装 `@playwright/cli`
- 下载 Chromium 浏览器（约 200MB）

**注意：**
- Docker 部署已内置 Playwright CLI，无需额外安装
- npm 部署默认不包含，按需安装

### Docker 部署

```bash
# 构建 Docker 镜像
docker build -t claude-code-open .

# 国内用户（使用镜像加速）
docker build --build-arg REGISTRY=docker.1ms.run -t claude-code-open .

# 运行 CLI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open

# 运行 Web UI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -p 3456:3456 \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open node /app/dist/web-cli.js --host 0.0.0.0
```

## 使用

### CLI 模式

```bash
# 交互模式
npm run dev

# 或构建后运行
node dist/cli.js

# 带初始 prompt
node dist/cli.js "你好，请帮我分析这个项目"

# 打印模式（非交互）
node dist/cli.js -p "解释这段代码"

# 指定模型（opus/sonnet/haiku）
node dist/cli.js -m opus "复杂任务"

# 恢复上一次会话
node dist/cli.js --resume

# 列出会话
node dist/cli.js --list

# 分叉会话
node dist/cli.js --fork <session-id>
```

### Web UI 模式

```bash
# 开发模式
npm run web

# 生产模式
npm run web:start

# 自定义端口和主机
npm run web -- -p 8080 -H 0.0.0.0

# 启用 ngrok 公网隧道
npm run web -- --ngrok
```

### 代理服务器模式

跨设备共享你的 Claude 订阅：

```bash
# 启动代理服务器
npm run proxy
# 或构建后
node dist/proxy-cli.js --proxy-key my-secret

# 客户端使用（在其他设备上）
export ANTHROPIC_API_KEY="my-secret"
export ANTHROPIC_BASE_URL="http://your-server-ip:8082"
claude
```

### 微信机器人模式

```bash
# 启动微信机器人
npm run wechat
```

## 配置

设置 API 密钥：

**Linux/macOS:**
```bash
export ANTHROPIC_API_KEY=your-api-key
```

**Windows PowerShell:**
```powershell
$env:ANTHROPIC_API_KEY="your-api-key"
```

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API 密钥 | - |
| `CLAUDE_CODE_LANG` | 语言（en/zh） | 自动检测 |
| `BASH_MAX_OUTPUT_LENGTH` | Bash 输出最大长度 | 30000 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 最大输出 tokens | 32000 |
| `USE_BUILTIN_RIPGREP` | 使用系统 ripgrep | false |

### 多云服务商支持

除了 Anthropic 直连 API，项目还支持：

- **AWS Bedrock** - 设置 `ANTHROPIC_BEDROCK=1` 并配置 AWS 凭证
- **Google Vertex AI** - 设置 `ANTHROPIC_VERTEX=1` 并配置 GCP 凭证

## 项目结构

```
src/
├── cli.ts                  # CLI 入口点（Commander.js）
├── web-cli.ts              # Web UI 入口点
├── proxy-cli.ts            # 代理服务器入口点
├── wechat-cli.ts           # 微信机器人入口点
├── index.ts                # 主导出文件
│
├── core/                   # 核心引擎
│   ├── client.ts           # Anthropic API 客户端（流式、重试、成本）
│   ├── session.ts          # 会话状态管理
│   ├── loop.ts             # 对话编排器
│   └── backgroundTasks.ts  # 异步后台任务处理
│
├── tools/                  # 29+ 工具
│   ├── base.ts             # BaseTool 基类 & ToolRegistry
│   ├── bash.ts             # Bash 执行（沙箱支持）
│   ├── file.ts             # Read/Write/Edit/MultiEdit
│   ├── search.ts           # Glob/Grep 搜索
│   ├── web.ts              # WebFetch/WebSearch
│   ├── todo.ts             # TodoWrite 任务管理
│   ├── task-v2.ts          # Task 子代理（v2）
│   ├── notebook.ts         # Jupyter Notebook 编辑
│   ├── planmode.ts         # EnterPlanMode/ExitPlanMode
│   ├── mcp.ts              # MCP 协议工具
│   ├── ask.ts              # AskUserQuestion
│   ├── tmux.ts             # Tmux 多终端（Linux/macOS）
│   ├── skill.ts            # 技能系统
│   ├── lsp.ts              # LSP 集成
│   └── blueprint/          # Blueprint 多 Agent 工具
│
├── web/                    # Web UI 系统
│   ├── server/             # Express + WebSocket 后端
│   │   ├── index.ts        # 服务器入口
│   │   ├── websocket.ts    # WebSocket 处理
│   │   ├── conversation.ts # 对话管理
│   │   ├── session-manager.ts
│   │   ├── auth-manager.ts # 认证管理
│   │   ├── routes/         # API 路由
│   │   └── handlers/       # 请求处理器
│   └── client/             # React 前端
│       └── src/
│           ├── App.tsx
│           ├── components/ # UI 组件
│           ├── hooks/      # 自定义 Hooks
│           └── contexts/   # React Context
│
├── blueprint/              # Blueprint 多 Agent 系统
│   ├── smart-planner.ts    # 智能任务规划器
│   ├── lead-agent.ts       # Lead Agent 协调器
│   ├── autonomous-worker.ts # 自主 Worker
│   ├── task-queue.ts       # 任务优先级队列
│   ├── task-reviewer.ts    # 质量评审器
│   ├── realtime-coordinator.ts # 实时协调器
│   └── model-selector.ts   # 自适应模型选择器
│
├── agents/                 # 专用子代理
│   ├── explore.ts          # 代码库探索
│   ├── plan.ts             # 实现规划
│   ├── guide.ts            # 文档引导
│   ├── parallel.ts         # 并行执行
│   ├── monitor.ts          # 监控代理
│   └── resume.ts           # 会话恢复代理
│
├── memory/                 # 统一内存系统
│   ├── unified-memory.ts   # 内存管理器
│   ├── chat-memory.ts      # 对话记忆
│   ├── vector-store.ts     # 向量存储
│   ├── bm25-engine.ts      # BM25 文本搜索
│   ├── embedder.ts         # 嵌入模型
│   └── intent-extractor.ts # 意图提取
│
├── i18n/                   # 国际化
│   ├── index.ts            # t() 函数、初始化
│   └── locales/            # en.ts, zh.ts
│
├── teams/                  # 团队管理
├── mcp/                    # MCP 协议（完整实现）
├── permissions/            # 权限系统
├── session/                # 会话持久化
├── context/                # 上下文管理与摘要
├── config/                 # 配置管理
├── models/                 # 模型配置（Anthropic/Bedrock/Vertex）
├── hooks/                  # Hook 系统
├── plugins/                # 插件系统
├── commands/               # 斜杠命令
├── auth/                   # 认证（API 密钥 + OAuth）
├── parser/                 # 代码解析（Tree-sitter WASM）
├── search/                 # 搜索（ripgrep 集成）
├── proxy/                  # 代理服务器
├── providers/              # 云服务商（Anthropic/Bedrock/Vertex）
├── fast-mode/              # 快速模式 / Penguin 模式
├── lsp/                    # 语言服务器协议
├── ui/                     # 终端 UI（Ink/React）
├── streaming/              # 流式 I/O
├── telemetry/              # 本地遥测
├── types/                  # TypeScript 类型定义
└── utils/                  # 工具函数
```

## 已实现工具（29+）

| 工具 | 状态 | 说明 |
| --- | --- | --- |
| **文件操作** | | |
| Read | 完成 | 文件读取，支持图像/PDF/Notebook + 外部修改检测 |
| Write | 完成 | 文件写入，带覆盖保护 |
| Edit | 完成 | 文件编辑（字符串替换） |
| MultiEdit | 完成 | 批量文件编辑（原子操作） |
| **搜索与发现** | | |
| Glob | 完成 | 文件模式匹配 |
| Grep | 完成 | 内容搜索（基于 ripgrep），官方输出格式 |
| **执行** | | |
| Bash | 完成 | 命令执行，支持后台和沙箱 |
| TaskOutput | 完成 | 获取后台命令/代理输出（统一 UUID/task_id 格式） |
| KillShell | 完成 | 终止后台进程 |
| **Web 访问** | | |
| WebFetch | 完成 | Web 页面获取，带缓存 |
| WebSearch | 完成 | 服务端 Web 搜索 |
| **任务管理** | | |
| TodoWrite | 完成 | 任务管理，带自动提醒系统 |
| Task | 完成 | 子代理（explore、plan、guide 等） |
| ScheduleTask | 完成 | 创建/取消/列出定时任务，由守护进程执行 |
| **规划** | | |
| EnterPlanMode | 完成 | 进入规划模式，带权限系统 |
| ExitPlanMode | 完成 | 退出规划模式 |
| **交互** | | |
| AskUserQuestion | 完成 | 询问用户问题（multiSelect、选项、验证） |
| **代码工具** | | |
| NotebookEdit | 完成 | Jupyter Notebook 单元格编辑（replace/insert/delete） |
| LSP | 完成 | 语言服务器协议集成 |
| **集成** | | |
| MCP 工具 | 完成 | ListMcpResources、ReadMcpResource、MCPSearch |
| Skill | 完成 | 技能系统，带 args 参数和权限检查 |
| **终端** | | |
| Tmux | 完成 | 多终端会话管理（Linux/macOS） |
| **多 Agent** | | |
| Blueprint 工具 | 完成 | GenerateBlueprint、StartLeadAgent、DispatchWorker 等 |
| Teammate | 完成 | 团队协作工具 |

## 核心功能

### Web UI

基于 React 和 Express 构建的完整浏览器界面：

```bash
npm run web
# 打开 http://localhost:3456
```

功能：
- WebSocket 实时通信
- 会话管理与持久化
- Blueprint 可视化
- 代码浏览器（语法高亮）
- Swarm 多 Agent 控制台
- 终端集成
- OAuth 和 API 密钥认证

### Blueprint 多 Agent 系统

通过多个 AI Agent 编排复杂任务：

- **智能规划器** - 智能任务拆解和规划
- **Lead Agent** - 协调 Worker Agent，追踪进度
- **自主 Worker** - 独立任务执行
- **任务队列** - 基于优先级的任务调度
- **任务评审器** - 质量保证和验证
- **实时协调器** - Agent 通信和同步
- **模型选择器** - 根据任务复杂度自适应选择模型

### 国际化 (i18n)

内置中英文双语支持：

```bash
# 通过环境变量设置语言
export CLAUDE_CODE_LANG=zh

# 或在 settings.json 中配置
{ "language": "zh" }
```

检测优先级：`settings.json` > `CLAUDE_CODE_LANG` > 系统 locale > 默认（en）

### 统一内存系统

跨对话的持久化记忆：

- **向量存储** - 语义相似度搜索
- **BM25 引擎** - 全文搜索
- **对话记忆** - 对话历史
- **意图提取** - 理解用户意图
- **链接记忆** - URL 和引用追踪
- **身份记忆** - 用户上下文持久化

### MCP 协议

完整的 Model Context Protocol 实现：

```json
// .claude/settings.json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

支持 stdio、HTTP 和 SSE 传输，含自动发现。

### 代理服务器

跨设备共享你的 Claude 订阅：

```bash
node dist/proxy-cli.js --proxy-key my-secret
```

核心特性：
- 自动刷新过期的 OAuth Token
- 保留 Billing Header 块结构
- Beta Header 管理
- 身份注入
- 透明 SSE 流式转发
- `/health` 和 `/stats` 端点

### Hooks 系统

在工具调用前后执行自定义脚本：

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "Bash",
      "command": "/path/to/script.sh",
      "blocking": true
    }
  ]
}
```

支持事件：`PreToolUse`、`PostToolUse`、`PrePromptSubmit`、`PostPromptSubmit`、`Notification`、`Stop`

### Extended Thinking

支持 Claude 扩展推理模式，实现更深入的分析和更彻底的问题解决。

### 定时任务守护进程

强大的后台守护进程系统，支持自动化任务执行：

**功能特性：**
- **基于时间的任务** - 使用自然语言调度一次性或循环任务（"明天下午3点"、"每天早上9点"、"2小时后"）
- **文件监控** - 监控文件变化并自动触发 AI 任务
- **多渠道通知** - 支持桌面通知和飞书（Lark）消息推送
- **持久化存储** - 基于 SQLite 的任务存储，重启后任务保持
- **模型选择** - 为每个任务选择不同的 Claude 模型

**使用方法：**
```bash
# 启动守护进程
claude daemon start

# 通过对话调度任务
"在每天早上9点进行代码审查，并通过飞书通知我"

# 或直接使用 ScheduleTask 工具
# 操作：create，类型：interval，触发时间："每天早上9点"
```

**支持的任务类型：**
- `once` - 在特定时间执行一次
- `interval` - 循环执行（每小时、每天、每周）
- `watch` - 文件/目录变化监控

### 快速模式

Penguin 模式，使用相同模型但优化输出速度。通过 `/fast` 切换。

### 沙箱支持（Bubblewrap）

**仅限 Linux：** Bash 命令在沙箱环境中执行，增强安全性。

```bash
# Ubuntu/Debian
sudo apt install bubblewrap
```

## 斜杠命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示帮助 |
| `/clear` | 清除对话历史 |
| `/status` | 显示会话状态 |
| `/resume` | 恢复历史会话 |
| `/context` | 显示上下文使用情况 |
| `/compact` | 压缩对话历史 |
| `/rename` | 重命名当前会话 |
| `/export` | 导出会话（JSON/Markdown） |
| `/transcript` | 导出会话转录记录 |
| `/config` | 查看配置 |
| `/tools` | 列出可用工具 |
| `/model` | 查看/切换模型 |
| `/fast` | 切换快速模式 |
| `/exit` | 退出 |

## 测试

```bash
npm test                    # 运行所有测试（vitest）
npm run test:unit           # 仅单元测试
npm run test:integration    # 集成测试
npm run test:e2e            # 端到端 CLI 测试
npm run test:coverage       # 覆盖率报告
npm run test:watch          # 监视模式
npm run test:ui             # Vitest UI
```

## 开发

```bash
# 开发模式（使用 tsx）
npm run dev

# Web UI 开发
npm run web

# 构建
npm run build

# 类型检查
npx tsc --noEmit
```

## 技术栈

- **TypeScript** - 类型安全
- **Anthropic SDK** - API 调用
- **Ink + React** - 终端 UI
- **Express + WebSocket** - Web UI 后端
- **React** - Web UI 前端
- **Commander** - CLI 框架
- **Chalk** - 终端颜色
- **Zod** - 模式验证
- **Tree-sitter** - 代码解析（WASM）
- **better-sqlite3** - 本地数据库
- **Vitest** - 测试框架

## 社区

- **Discord：** [加入我们的 Discord](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter)：** [@wangbingjie1989](https://x.com/wangbingjie1989)
- **微信：** h694623326

## 许可证

本项目仅用于教育目的。原始 Claude Code 归 Anthropic PBC 所有。

---

*这个项目是对混淆代码的逆向工程研究，不代表官方实现。*

[English README](README.md)
