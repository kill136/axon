# Claude Code Open - Open Source AI Coding Platform

> The world needs an open-source Claude Code. It will become the foundational infrastructure of AI in the future, running on every PC.

[![Website](https://img.shields.io/badge/Website-chatbi.site-blue?style=flat-square)](https://www.chatbi.site)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-voicegpt.site:3456-orange?style=flat-square)](http://voicegpt.site:3456/)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)

[Visit Website](https://www.chatbi.site) | [Live Demo](http://voicegpt.site:3456/) | [中文文档](README.zh-CN.md) | [操作手册](https://www.chatbi.site/zh/user-guide.html) | [Discord](https://discord.gg/bNyJKk6PVZ)

<div align="center">

### Demo

<a href="http://voicegpt.site:3456/">
<img src="demo-screenshots/01-main.png" width="720" alt="Claude Code Open - Web IDE Interface">
</a>

**Web UI IDE** &bull; **Blueprint Multi-Agent** &bull; **37+ Tools** &bull; **Self-Evolution**

<table>
<tr>
<td><img src="demo-screenshots/02-blueprint.png" width="400" alt="Blueprint System"></td>
<td><img src="demo-screenshots/05-typing.png" width="400" alt="Real-time AI Streaming"></td>
</tr>
<tr>
<td align="center"><b>Blueprint Multi-Agent System</b></td>
<td align="center"><b>Real-time AI Streaming</b></td>
</tr>
</table>

> [Watch Promo Video](demo-screenshots/promo-video.mp4) &bull; [Try Live Demo](http://voicegpt.site:3456/) &bull; [Join Discord](https://discord.gg/bNyJKk6PVZ)

</div>

A reverse-engineered open-source reimplementation based on `@anthropic-ai/claude-code`.

**For educational and research purposes only.**

## Disclaimer

This is an educational project for studying and learning CLI tool architecture design. This is **NOT** the official Claude Code source code, but a reimplementation based on public APIs and type definitions.

For the official Claude Code, please install the official version:
```bash
npm install -g @anthropic-ai/claude-code
```

## Features at a Glance

| Category | Highlights |
| --- | --- |
| **37+ Built-in Tools** | File ops, search, execution, web access, task management, scheduled tasks, browser automation, and more |
| **Web UI IDE** | Full browser IDE with Monaco editor, file tree, AI-enhanced editing, Blueprint visualization, Swarm console |
| **Blueprint Multi-Agent** | Smart Planner + Lead Agent + Autonomous Workers + Task Queue + Quality Reviewer + E2E Testing |
| **One-Click Installer** | Automated scripts for Windows/macOS/Linux with auto dependency detection (Node.js, Git, g++, make) |
| **Scheduled Task Daemon** | Background daemon for time-based tasks, interval jobs, file watching, and multi-channel notifications |
| **Self-Evolution** | AI can modify its own source code with safety checks and hot-reload |
| **Checkpoint & Rewind** | File snapshot management and session time-travel |
| **Memory System** | Vector store, BM25 search, intent extraction, conversation memory |
| **MCP Protocol** | Full Model Context Protocol with auto-discovery (stdio, HTTP, SSE) |
| **Multi-Provider** | Anthropic, AWS Bedrock, Google Vertex AI |
| **Proxy Server** | Share your Claude subscription across devices |
| **Browser Automation** | Custom browser control + Chrome MCP integration + Playwright support |
| **i18n** | Chinese and English language support |
| **Feishu Bot** | Feishu (Lark) messaging integration with Web UI mode |
| **WeChat Bot** | WeChat messaging integration |
| **Docker Support** | Containerized deployment with mirror acceleration |
| **Auto-Update** | Version management with rollback support |
| **Plugin & Hook System** | Extensible architecture with lifecycle hooks |
| **Fast Mode** | Optimized output speed using the same model |
| **Extended Thinking** | Extended reasoning mode for deeper analysis |
| **Teams** | Team collaboration features |

## Why Claude Code Open?

- **Open Source & Transparent** — Full MIT licensed source code. No black boxes, complete community-driven development.
- **Web UI IDE Experience** — Not just a CLI. A complete browser-based IDE with Monaco editor, VS Code-style file tree, AI-enhanced code editing (hover tips, ask AI, code tour, heatmap decorations), Blueprint visualization, and Swarm multi-agent console.
- **Multi-Agent Collaboration** — Blueprint system breaks complex tasks across multiple AI agents working in parallel, with E2E testing, visual comparison, and verification services.
- **24/7 Automation** — Scheduled task daemon runs AI workflows automatically: natural language time config, file watching, multi-channel notifications (Desktop + Feishu), SQLite persistence.
- **One-Click Install** — Single command for Windows/macOS/Linux. Auto-detects and installs missing dependencies (Node.js, Git, g++, make). Creates desktop shortcuts automatically.
- **Self-Evolution** — The AI can modify its own source code, run TypeScript compilation checks, and hot-reload — enabling continuous self-improvement.

## Quick Installation (Recommended)

### Windows Quick Install (Easiest)

**Option A: One-Click Installer** — download and double-click, no command line needed!

[![Windows Installer](https://img.shields.io/badge/Windows-Download%20Installer-blue?style=for-the-badge&logo=windows)](https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.bat)
[![Gitee Mirror](https://img.shields.io/badge/Gitee-China%20Mirror-orange?style=for-the-badge&logo=gitee)](https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.bat)

1. Click the button above to download `install.bat`
2. Double-click the downloaded file to run
3. Done! The installer handles everything (Node.js, dependencies, build, shortcut)

**Option B: Pre-built Package** — download, unzip, run. No build needed!

[![Download Release](https://img.shields.io/badge/Download-Pre--built%20Package-green?style=for-the-badge&logo=github)](https://github.com/kill136/claude-code-open/releases/latest)

1. Download `claude-code-open-windows-x64-*.zip` from the latest Release
2. Unzip to any folder
3. Double-click `start.bat` to launch (requires [Node.js](https://nodejs.org/) pre-installed)

---

### macOS / Linux Quick Install

**Option A: One-Click Install Script**

```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
```

China mirror:
```bash
curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.sh | bash
```

**Option B: Pre-built Package** — download, extract, run!

[![Download Release](https://img.shields.io/badge/Download-Pre--built%20Package-green?style=for-the-badge&logo=github)](https://github.com/kill136/claude-code-open/releases/latest)

| Platform | File |
| --- | --- |
| macOS Apple Silicon (M1/M2/M3/M4) | `claude-code-open-macos-arm64-*.tar.gz` |
| macOS Intel | `claude-code-open-macos-x64-*.tar.gz` |
| Linux x64 | `claude-code-open-linux-x64-*.tar.gz` |

```bash
# Extract and run (requires Node.js pre-installed)
tar -xzf claude-code-open-*.tar.gz
cd claude-code-open-*/
./start.sh
```

---

### Advanced: PowerShell (Windows)

```powershell
irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.ps1 | iex
```

The install script will automatically:
- ✅ Detect and install missing dependencies (Node.js, Git, g++, make)
- ✅ Clone the repository
- ✅ Install all npm dependencies
- ✅ Build frontend and backend
- ✅ Create desktop shortcut
- ✅ Preset API configuration
- ✅ Link global commands

**After installation:**
1. Double-click the desktop shortcut "Claude Code WebUI"
2. Browser opens http://localhost:3456 automatically
3. Start using!

### Manual Installation

```bash
# Clone repository
git clone https://github.com/kill136/claude-code-open.git
cd claude-code-open

# Install dependencies
npm install

# Build frontend
cd src/web/client
npm install
npm run build
cd ../../..

# Build backend
npm run build

# Link globally (optional)
npm link

# Optional: Install Playwright CLI (browser automation)
npm run install:playwright
```

### Windows Notes

**Native addon compilation (usually NOT required):**

The project depends on native addons (`better-sqlite3`, `node-pty`, `sharp`, etc.), but they all ship with **prebuilt binaries** for Windows x64. Under normal circumstances, `npm install` downloads the prebuilt binaries directly — no compilation needed.

If prebuilt download fails (e.g., network issues, uncommon Node.js version), npm falls back to compiling from source. **Only in this case** do you need:

- **Python 3.6+** — required by node-gyp
- **Visual Studio Build Tools 2022** — "Desktop development with C++" workload

**Environment variable conflicts:**

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API authentication |
| `ANTHROPIC_BASE_URL` | Custom API endpoint (default: `https://api.anthropic.com`) |

If you already have these set system-wide, set them per session to avoid conflicts:

```powershell
# PowerShell (current session only)
$env:ANTHROPIC_API_KEY="your-key-for-this-project"
$env:ANTHROPIC_BASE_URL="https://your-api-endpoint"
```

> Note: The `.env` file in the project root is **NOT** loaded automatically. Environment variables must be set via system settings, `settings.json`, or the `--env` CLI flag.

### Docker Deployment

```bash
# Build Docker image
docker build -t claude-code-open .

# For users in China (with mirror acceleration)
docker build --build-arg REGISTRY=docker.1ms.run -t claude-code-open .

# Run CLI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open

# Run Web UI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -p 3456:3456 \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open node /app/dist/web-cli.js --host 0.0.0.0
```

## Usage

### CLI Mode

```bash
# Interactive mode
npm run dev

# Or run after building
node dist/cli.js

# With initial prompt
node dist/cli.js "Hello, please analyze this project"

# Print mode (non-interactive)
node dist/cli.js -p "Explain this code"

# Specify model (opus/sonnet/haiku)
node dist/cli.js -m opus "Complex task"

# Resume last session
node dist/cli.js --resume

# List sessions
node dist/cli.js --list

# Fork a session
node dist/cli.js --fork <session-id>
```

### Web UI Mode

```bash
# Development mode
npm run web

# Production mode
npm run web:start

# Custom port and host
npm run web -- -p 8080 -H 0.0.0.0

# With ngrok public tunnel
npm run web -- --ngrok

# Self-evolution mode
npm run web:evolve
```

### Proxy Server Mode

Share your Claude subscription with other devices:

```bash
# Start proxy server
npm run proxy
# or after building
node dist/proxy-cli.js --proxy-key my-secret

# Client usage (on other devices)
export ANTHROPIC_API_KEY="my-secret"
export ANTHROPIC_BASE_URL="http://your-server-ip:8082"
claude
```

### Feishu Bot Mode

```bash
# Start Feishu bot
npm run feishu

# Feishu bot with Web UI
npm run feishu:webui
```

### WeChat Bot Mode

```bash
npm run wechat
```

## Web UI Features

The Web UI is a full-featured browser-based IDE built with React, Express, and WebSocket:

```bash
npm run web
# Open http://localhost:3456
```

**Core Features:**
- **Monaco Editor** — Multi-tab code editing with syntax highlighting
- **File Tree** — VS Code-style file browser with right-click context menus
- **AI-Enhanced Editing** — Intelligent hover tips, select-to-ask AI, code tour, heatmap decorations
- **Real-time WebSocket** — Live streaming of AI responses
- **Session Management** — Create, resume, fork, and export sessions
- **Blueprint Visualization** — Visual task decomposition and agent coordination
- **Swarm Console** — Multi-agent monitoring with task tree, architecture flow graph
- **Terminal Integration** — In-browser terminal panel
- **Checkpoint & Rewind** — File snapshot management and session time-travel
- **Continuous Development** — Cycle review, impact analysis, TDD panel
- **Authentication** — OAuth and API key support
- **Artifacts Panel** — Rich content rendering
- **Debug Panel** — Development debugging tools

## Blueprint Multi-Agent System

Orchestrate complex tasks with multiple AI agents working in parallel:

- **Smart Planner** — Intelligent task decomposition and planning (97KB of planning logic)
- **Lead Agent** — Coordinates worker agents, tracks progress, auto-project-selection
- **Autonomous Workers** — Independent task execution with full tool access
- **Task Queue** — Priority-based task scheduling with persistence
- **Task Reviewer** — Quality assurance and verification
- **Real-time Coordinator** — Agent communication, synchronization, and conflict resolution
- **Model Selector** — Adaptive model selection per task complexity
- **E2E Test Agent** — End-to-end testing automation
- **Environment Checker** — Runtime environment validation
- **Visual Comparator** — Visual diff and comparison
- **Verification Service** — Result verification pipeline

## Scheduled Task Daemon

A background daemon system for automated task execution:

**Features:**
- **Time-based Tasks** — Natural language scheduling ("tomorrow 3pm", "every day at 9am", "in 2 hours")
- **File Watching** — Monitor file changes and trigger AI tasks automatically
- **Multi-channel Notifications** — Desktop notifications and Feishu (Lark) messaging
- **Persistent Storage** — SQLite-based task storage survives restarts
- **Model Selection** — Choose different Claude models per task

**Usage:**
```bash
# Start daemon
claude daemon start

# Schedule via conversation
"Schedule a daily code review at 9am and notify me on Feishu"
```

**Task Types:** `once` (one-time), `interval` (recurring), `watch` (file monitoring)

## Implemented Tools (37+)

| Tool | Description |
| --- | --- |
| **File Operations** | |
| Read | File reading with image/PDF/Notebook support + external modification detection |
| Write | File writing with overwrite protection |
| Edit | File editing (string replacement) |
| MultiEdit | Batch file editing (atomic operations) |
| **Search & Discovery** | |
| Glob | File pattern matching |
| Grep | Content search (ripgrep-based) |
| **Execution** | |
| Bash | Command execution with background & sandbox support |
| BashHistory | Command history tracking |
| TaskOutput | Get background command/agent output |
| **Web Access** | |
| WebFetch | Web page fetching with caching |
| WebSearch | Server-side web search |
| **Task Management** | |
| TodoWrite | Task management with auto-reminder system |
| Task | Sub-agents (explore, plan, guide, etc.) |
| TaskStatus | Query task execution status |
| ScheduleTask | Create/cancel/list scheduled tasks |
| **Planning** | |
| EnterPlanMode | Enter plan mode |
| ExitPlanMode | Exit plan mode |
| **Interaction** | |
| AskUserQuestion | Ask user questions (multiSelect, options, validation) |
| **Code Tools** | |
| NotebookEdit | Jupyter Notebook cell editing |
| NotebookWrite | Jupyter Notebook creation |
| LSP | Language Server Protocol integration |
| **Integration** | |
| MCP Tools | ListMcpResources, ReadMcpResource, MCPSearch |
| Skill | Skill system with args parameter |
| **Browser** | |
| Browser | Custom browser automation and control |
| **Memory** | |
| MemorySearch | Semantic memory search |
| **Multi-Agent** | |
| GenerateBlueprint | Generate task execution blueprints |
| GenerateDesign | Generate design documents |
| StartLeadAgent | Launch lead agent coordinator |
| DispatchWorker | Dispatch autonomous worker agents |
| SubmitReview | Submit quality reviews |
| SubmitE2EResult | Submit E2E test results |
| TriggerE2ETest | Trigger E2E testing |
| UpdateTaskPlan | Update task execution plans |
| **Advanced** | |
| SelfEvolve | AI self-modification with safety checks |
| StructuredOutput | Structured data output |
| OutputPersistence | Persistent output storage |
| Teammate | Team collaboration |

## Configuration

Set up your API key:

**Linux/macOS:**
```bash
export ANTHROPIC_API_KEY=your-api-key
```

**Windows PowerShell:**
```powershell
$env:ANTHROPIC_API_KEY="your-api-key"
```

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API Key | - |
| `ANTHROPIC_BASE_URL` | Custom API endpoint | `https://api.anthropic.com` |
| `CLAUDE_CODE_LANG` | Language (en/zh) | auto-detect |
| `BASH_MAX_OUTPUT_LENGTH` | Max Bash output length | 30000 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Max output tokens | 32000 |
| `USE_BUILTIN_RIPGREP` | Use system ripgrep | false |

### Multi-Provider Support

- **Anthropic** — Direct API (default)
- **AWS Bedrock** — Set `ANTHROPIC_BEDROCK=1` and configure AWS credentials
- **Google Vertex AI** — Set `ANTHROPIC_VERTEX=1` and configure GCP credentials

### MCP Protocol

Full Model Context Protocol implementation:

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

Supports stdio, HTTP, and SSE transports with auto-discovery.

### Hooks System

Execute custom scripts before/after tool calls:

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

Events: `PreToolUse`, `PostToolUse`, `PrePromptSubmit`, `PostPromptSubmit`, `Notification`, `Stop`

## Project Structure

```
src/
├── cli.ts                  # CLI entry point (Commander.js)
├── web-cli.ts              # Web UI entry point
├── proxy-cli.ts            # Proxy server entry point
├── feishu-cli.ts           # Feishu bot entry point
├── wechat-cli.ts           # WeChat bot entry point
├── index.ts                # Main export barrel
│
├── core/                   # Core engine
│   ├── client.ts           # Anthropic API client (streaming, retry, cost)
│   ├── session.ts          # Session state management
│   ├── loop.ts             # Conversation orchestrator
│   └── backgroundTasks.ts  # Async background task processing
│
├── tools/                  # 37+ tools (see tools table above)
│
├── web/                    # Web UI system
│   ├── server/             # Express + WebSocket backend
│   │   ├── websocket.ts    # WebSocket handler
│   │   ├── conversation.ts # Conversation manager
│   │   ├── session-manager.ts
│   │   ├── auth-manager.ts # Authentication
│   │   ├── routes/         # API routes
│   │   └── handlers/       # Request handlers
│   └── client/             # React frontend
│       └── src/
│           ├── components/
│           │   ├── CodeView/        # Monaco editor + file tree + AI hooks
│           │   ├── BlueprintSummaryCard/
│           │   ├── continuous/      # Continuous dev panels
│           │   ├── config/          # Settings panels
│           │   └── ...              # 40+ UI components
│           ├── hooks/      # Custom React hooks
│           └── contexts/   # React contexts
│
├── blueprint/              # Blueprint multi-agent system (16 files)
│   ├── smart-planner.ts    # Intelligent task planner
│   ├── lead-agent.ts       # Lead agent coordinator
│   ├── autonomous-worker.ts # Autonomous worker
│   ├── task-queue.ts       # Task priority queue
│   ├── task-reviewer.ts    # Quality reviewer
│   ├── realtime-coordinator.ts # Real-time coordination
│   ├── model-selector.ts   # Adaptive model selection
│   ├── e2e-test-agent.ts   # E2E testing agent
│   ├── verification-service.ts # Result verification
│   ├── visual-comparator.ts # Visual diff
│   └── ...
│
├── agents/                 # Specialized sub-agents
│   ├── explore.ts          # Codebase exploration
│   ├── plan.ts             # Implementation planning
│   ├── guide.ts            # Documentation guide
│   ├── parallel.ts         # Parallel execution
│   ├── monitor.ts          # Monitoring agent
│   └── resume.ts           # Session resume
│
├── memory/                 # Unified memory system
│   ├── unified-memory.ts   # Memory manager
│   ├── vector-store.ts     # Vector storage
│   ├── bm25-engine.ts      # BM25 text search
│   ├── chat-memory.ts      # Conversation memory
│   ├── embedder.ts         # Embedding model
│   └── intent-extractor.ts # Intent extraction
│
├── checkpoint/             # File snapshot management
├── rewind/                 # Session time-travel
├── updater/                # Auto-update system
├── browser/                # Custom browser control
├── chrome/                 # Chrome integration
├── chrome-mcp/             # Chrome MCP bridge
├── daemon/                 # Scheduled task daemon
├── feishu/                 # Feishu (Lark) integration
├── wechat/                 # WeChat integration
├── i18n/                   # Internationalization (en, zh)
├── teams/                  # Team management
├── mcp/                    # MCP protocol (full implementation)
├── permissions/            # Permission system
├── session/                # Session persistence
├── context/                # Context management & summarization
├── config/                 # Configuration management
├── models/                 # Model config (Anthropic/Bedrock/Vertex)
├── hooks/                  # Hook system
├── plugins/                # Plugin system
├── commands/               # Slash commands
├── auth/                   # Authentication (API Key + OAuth)
├── parser/                 # Code parsing (Tree-sitter WASM)
├── search/                 # Search (ripgrep integration)
├── proxy/                  # Proxy server
├── providers/              # Cloud providers
├── fast-mode/              # Fast mode
├── lsp/                    # Language Server Protocol
├── git/                    # Git operations
├── github/                 # GitHub integration
├── sandbox/                # Sandbox execution
├── security/               # Security constraints
├── trust/                  # Trust verification
├── ratelimit/              # Rate limiting
├── rules/                  # Rule engine
├── diagnostics/            # Diagnostic tools
├── notifications/          # Notification system
├── ui/                     # Terminal UI (Ink/React)
├── streaming/              # Streaming I/O
├── telemetry/              # Local telemetry
├── types/                  # TypeScript definitions
└── utils/                  # Utility functions
```

## Slash Commands

| Command | Description |
| --- | --- |
| `/help` | Show help |
| `/clear` | Clear conversation history |
| `/status` | Show session status |
| `/resume` | Resume a previous session |
| `/context` | Show context usage |
| `/compact` | Compress conversation history |
| `/rename` | Rename current session |
| `/export` | Export session (JSON/Markdown) |
| `/transcript` | Export session transcript |
| `/config` | View configuration |
| `/tools` | List available tools |
| `/model` | View/switch model |
| `/fast` | Toggle fast mode |
| `/exit` | Exit |

## Testing

```bash
npm test                    # Run all tests (vitest)
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:e2e            # End-to-end CLI tests
npm run test:coverage       # Run with coverage report
npm run test:watch          # Watch mode
npm run test:ui             # Vitest UI
```

## Development

```bash
# Development mode (using tsx)
npm run dev

# Web UI development
npm run web

# Web UI with file watch
npm run web:dev

# Build
npm run build

# Type checking
npx tsc --noEmit
```

## Tech Stack

- **TypeScript** — Type safety
- **Anthropic SDK** — API calls
- **Ink + React** — Terminal UI
- **Express + WebSocket** — Web backend
- **React + Monaco Editor** — Web frontend
- **Commander** — CLI framework
- **Zod** — Schema validation
- **Tree-sitter WASM** — Code parsing
- **better-sqlite3** — Local database
- **sharp** — Image processing
- **ngrok** — Public tunnel
- **Vitest** — Testing framework

## Community

- **Website:** https://www.chatbi.site
- **Discord:** [Join our Discord](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter):** [@wangbingjie1989](https://x.com/wangbingjie1989)

## License

This project is for educational purposes only. Original Claude Code is owned by Anthropic PBC.

---

*This project is a reverse engineering study of obfuscated code and does not represent the official implementation.*

[中文版 README](README.zh-CN.md)
