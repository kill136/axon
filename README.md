# The world needs an open-source Claude Code. It will become the foundational infrastructure of AI in the future, running on every PC.

[![Website](https://img.shields.io/badge/Website-claude--code--open.vercel.app-blue?style=flat-square)](https://www.chatbi.site)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)

[visit website](https://www.chatbi.site) | [中文文档](README.zh-CN.md)

A reverse-engineered restoration based on `@anthropic-ai/claude-code` v2.1.37.

**For educational and research purposes only.**

## Disclaimer

This is an educational project for studying and learning CLI tool architecture design. This is **NOT** the official Claude Code source code, but a reimplementation based on public APIs and type definitions.

For the official Claude Code, please install the official version:
```bash
npm install -g @anthropic-ai/claude-code
```

## Features at a Glance

- **30+ Built-in Tools** - File ops, search, execution, web access, task management, scheduled tasks, and more
- **One-Click Installer** - Automated installation scripts for Windows, macOS, and Linux with desktop shortcut creation
- **Scheduled Task Daemon** - Background daemon for time-based tasks, interval jobs, file watching, and notifications
- **Web UI** - Full-featured browser interface with React frontend and WebSocket communication
- **Blueprint Multi-Agent System** - Lead agent, autonomous workers, task queue, and real-time coordination
- **Internationalization (i18n)** - Chinese and English language support
- **Unified Memory System** - Vector store, BM25 search, intent extraction, conversation memory
- **MCP Protocol** - Full Model Context Protocol support with auto-discovery
- **Multi-Provider** - Anthropic, AWS Bedrock, Google Vertex AI
- **Extended Thinking** - Extended reasoning mode support
- **Fast Mode** - Penguin mode for faster responses
- **Proxy Server** - Share your Claude subscription across devices
- **WeChat Bot** - WeChat messaging integration
- **Docker Support** - Containerized deployment
- **Teams** - Team collaboration features
- **Plugin & Hook System** - Extensible architecture with lifecycle hooks

## Quick Installation (Recommended)

### One-Click Install Script

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
```

The install script will automatically:
- ✅ Clone the repository
- ✅ Install all dependencies
- ✅ Build frontend and backend
- ✅ Create desktop shortcut
- ✅ Preset API configuration
- ✅ Link global commands

**After installation:**
1. Double-click the desktop shortcut "Claude Code WebUI"
2. Browser automatically opens http://localhost:3456
3. Start using!

### Manual Installation

If you prefer manual installation or development setup:

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

If prebuilt download fails (e.g., network issues accessing GitHub releases, or using an uncommon Node.js version), npm falls back to compiling from source. **Only in this case** do you need:

- **Python 3.6+** — required by node-gyp
- **Visual Studio Build Tools 2022** — provides the MSVC C++ compiler. Install the "Desktop development with C++" workload.

> Tip: If you're behind a corporate proxy, configure npm proxy settings (`npm config set proxy` / `https-proxy`) so prebuilt binaries can be downloaded successfully.

**Environment variable conflicts:**

The project reads API configuration from these environment variables:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API authentication |
| `ANTHROPIC_BASE_URL` | Custom API endpoint (default: `https://api.anthropic.com`) |

If you already have these variables set in your **Windows system/user environment** (e.g., for the official Claude Code or another project), they will take precedence over `settings.json` configuration.

To avoid conflicts, set them per terminal session instead of system-wide:

```powershell
# PowerShell (current session only)
$env:ANTHROPIC_API_KEY="your-key-for-this-project"
$env:ANTHROPIC_BASE_URL="https://your-api-endpoint"
```

```cmd
# CMD (current session only)
set ANTHROPIC_API_KEY=your-key-for-this-project
set ANTHROPIC_BASE_URL=https://your-api-endpoint
```

> Note: The `.env` file in the project root is **NOT** loaded automatically — the project does not use `dotenv`. Environment variables must be set via system settings, `settings.json`, or the `--env` CLI flag.

### Browser Automation Support

To use browser automation features (Playwright CLI), install manually:

```bash
npm run install:playwright
```

This will:
- Install `@playwright/cli` globally
- Download Chromium browser (~200MB)

**Note:**
- Docker deployment includes Playwright CLI by default
- npm deployment excludes it to keep the package lightweight

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

### WeChat Bot Mode

```bash
# Start WeChat bot
npm run wechat
```

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
| `CLAUDE_CODE_LANG` | Language (en/zh) | auto-detect |
| `BASH_MAX_OUTPUT_LENGTH` | Max Bash output length | 30000 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Max output tokens | 32000 |
| `USE_BUILTIN_RIPGREP` | Use system ripgrep | false |

### Multi-Provider Support

In addition to Anthropic's direct API, the project supports:

- **AWS Bedrock** - Set `ANTHROPIC_BEDROCK=1` and configure AWS credentials
- **Google Vertex AI** - Set `ANTHROPIC_VERTEX=1` and configure GCP credentials

## Project Structure

```
src/
├── cli.ts                  # CLI entry point (Commander.js)
├── web-cli.ts              # Web UI entry point
├── proxy-cli.ts            # Proxy server entry point
├── wechat-cli.ts           # WeChat bot entry point
├── index.ts                # Main export barrel
│
├── core/                   # Core engine
│   ├── client.ts           # Anthropic API client (streaming, retry, cost)
│   ├── session.ts          # Session state management
│   ├── loop.ts             # Conversation orchestrator
│   └── backgroundTasks.ts  # Async background task processing
│
├── tools/                  # 29+ tools
│   ├── base.ts             # BaseTool class & ToolRegistry
│   ├── bash.ts             # Bash execution (sandbox support)
│   ├── file.ts             # Read/Write/Edit/MultiEdit
│   ├── search.ts           # Glob/Grep search
│   ├── web.ts              # WebFetch/WebSearch
│   ├── todo.ts             # TodoWrite task management
│   ├── task-v2.ts          # Task sub-agents (v2)
│   ├── notebook.ts         # Jupyter Notebook editing
│   ├── planmode.ts         # EnterPlanMode/ExitPlanMode
│   ├── mcp.ts              # MCP protocol tools
│   ├── ask.ts              # AskUserQuestion
│   ├── tmux.ts             # Tmux multi-terminal (Linux/macOS)
│   ├── skill.ts            # Skill system
│   ├── lsp.ts              # LSP integration
│   └── blueprint/          # Blueprint multi-agent tools
│
├── web/                    # Web UI system
│   ├── server/             # Express + WebSocket backend
│   │   ├── index.ts        # Server entry
│   │   ├── websocket.ts    # WebSocket handler
│   │   ├── conversation.ts # Conversation manager
│   │   ├── session-manager.ts
│   │   ├── auth-manager.ts # Authentication
│   │   ├── routes/         # API routes
│   │   └── handlers/       # Request handlers
│   └── client/             # React frontend
│       └── src/
│           ├── App.tsx
│           ├── components/ # UI components
│           ├── hooks/      # Custom hooks
│           └── contexts/   # React contexts
│
├── blueprint/              # Blueprint multi-agent system
│   ├── smart-planner.ts    # Intelligent task planner
│   ├── lead-agent.ts       # Lead agent coordinator
│   ├── autonomous-worker.ts # Autonomous worker
│   ├── task-queue.ts       # Task priority queue
│   ├── task-reviewer.ts    # Quality reviewer
│   ├── realtime-coordinator.ts # Real-time coordination
│   └── model-selector.ts   # Adaptive model selection
│
├── agents/                 # Specialized sub-agents
│   ├── explore.ts          # Codebase exploration
│   ├── plan.ts             # Implementation planning
│   ├── guide.ts            # Documentation guide
│   ├── parallel.ts         # Parallel execution
│   ├── monitor.ts          # Monitoring agent
│   └── resume.ts           # Session resume agent
│
├── memory/                 # Unified memory system
│   ├── unified-memory.ts   # Memory manager
│   ├── chat-memory.ts      # Conversation memory
│   ├── vector-store.ts     # Vector storage
│   ├── bm25-engine.ts      # BM25 text search
│   ├── embedder.ts         # Embedding model
│   └── intent-extractor.ts # Intent extraction
│
├── i18n/                   # Internationalization
│   ├── index.ts            # t() function, initialization
│   └── locales/            # en.ts, zh.ts
│
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
├── providers/              # Cloud providers (Anthropic/Bedrock/Vertex)
├── fast-mode/              # Fast mode / Penguin mode
├── lsp/                    # Language Server Protocol
├── ui/                     # Terminal UI (Ink/React)
├── streaming/              # Streaming I/O
├── telemetry/              # Local telemetry
├── types/                  # TypeScript definitions
└── utils/                  # Utility functions
```

## Implemented Tools (30+)

| Tool | Status | Description |
| --- | --- | --- |
| **File Operations** | | |
| Read | Complete | File reading with image/PDF/Notebook support + external modification detection |
| Write | Complete | File writing with overwrite protection |
| Edit | Complete | File editing (string replacement) |
| MultiEdit | Complete | Batch file editing (atomic operations) |
| **Search & Discovery** | | |
| Glob | Complete | File pattern matching |
| Grep | Complete | Content search (ripgrep-based) with official output format |
| **Execution** | | |
| Bash | Complete | Command execution with background & sandbox support |
| TaskOutput | Complete | Get background command/agent output (unified UUID/task_id format) |
| KillShell | Complete | Terminate background processes |
| **Web Access** | | |
| WebFetch | Complete | Web page fetching with caching |
| WebSearch | Complete | Server-side web search |
| **Task Management** | | |
| TodoWrite | Complete | Task management with auto-reminder system |
| Task | Complete | Sub-agents (explore, plan, guide, etc.) |
| ScheduleTask | Complete | Create/cancel/list scheduled tasks with daemon execution |
| **Planning** | | |
| EnterPlanMode | Complete | Enter plan mode with permission system |
| ExitPlanMode | Complete | Exit plan mode |
| **Interaction** | | |
| AskUserQuestion | Complete | Ask user questions (multiSelect, options, validation) |
| **Code Tools** | | |
| NotebookEdit | Complete | Jupyter Notebook cell editing (replace/insert/delete) |
| LSP | Complete | Language Server Protocol integration |
| **Integration** | | |
| MCP Tools | Complete | ListMcpResources, ReadMcpResource, MCPSearch |
| Skill | Complete | Skill system with args parameter and permission checks |
| **Terminal** | | |
| Tmux | Complete | Multi-terminal session management (Linux/macOS) |
| **Multi-Agent** | | |
| Blueprint Tools | Complete | GenerateBlueprint, StartLeadAgent, DispatchWorker, etc. |
| Teammate | Complete | Team collaboration tools |

## Key Features

### Web UI

A full-featured browser-based interface built with React and Express:

```bash
npm run web
# Open http://localhost:3456
```

Features:
- Real-time WebSocket communication
- Session management and persistence
- Blueprint visualization
- Code browser with syntax highlighting
- Swarm multi-agent console
- Terminal integration
- OAuth and API key authentication

### Blueprint Multi-Agent System

Orchestrate complex tasks with multiple AI agents:

- **Smart Planner** - Intelligent task decomposition and planning
- **Lead Agent** - Coordinates worker agents and tracks progress
- **Autonomous Workers** - Independent task execution
- **Task Queue** - Priority-based task scheduling
- **Task Reviewer** - Quality assurance and verification
- **Real-time Coordinator** - Agent communication and synchronization
- **Model Selector** - Adaptive model selection per task complexity

### Internationalization (i18n)

Built-in support for Chinese and English:

```bash
# Set language via environment variable
export CLAUDE_CODE_LANG=zh

# Or configure in settings.json
{ "language": "zh" }
```

Detection priority: `settings.json` > `CLAUDE_CODE_LANG` > system locale > default (en)

### Unified Memory System

Persistent memory across conversations:

- **Vector Store** - Semantic similarity search
- **BM25 Engine** - Full-text search
- **Chat Memory** - Conversation history
- **Intent Extractor** - Understanding user intent
- **Link Memory** - URL and reference tracking
- **Identity Memory** - User context persistence

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

### Proxy Server

Share your Claude subscription across devices:

```bash
node dist/proxy-cli.js --proxy-key my-secret
```

Key features:
- Auto token refresh for expired OAuth tokens
- Billing header preservation
- Beta header management
- Identity injection
- Transparent SSE streaming forwarding
- `/health` and `/stats` endpoints

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

### Extended Thinking

Support for Claude's extended reasoning mode, enabling deeper analysis and more thorough problem-solving.

### Scheduled Task Daemon

A powerful background daemon system for automated task execution:

**Features:**
- **Time-based Tasks** - Schedule one-time or recurring tasks using natural language ("tomorrow 3pm", "every day at 9am", "in 2 hours")
- **File Watching** - Monitor file changes and trigger AI tasks automatically
- **Multi-channel Notifications** - Desktop notifications and Feishu (Lark) messaging support
- **Persistent Storage** - SQLite-based task storage survives restarts
- **Model Selection** - Choose different Claude models per task

**Usage:**
```bash
# Start daemon
claude daemon start

# Schedule a task via conversation
"Schedule a daily code review at 9am and notify me on Feishu"

# Or use the ScheduleTask tool directly
# Action: create, Type: interval, Trigger: "every day at 9am"
```

**Supported Task Types:**
- `once` - Execute at a specific time
- `interval` - Recurring execution (hourly, daily, weekly)
- `watch` - File/directory change monitoring

### Fast Mode

Penguin mode for faster responses using the same model with optimized output speed. Toggle with `/fast`.

### Sandbox Support (Bubblewrap)

**Linux only:** Bash commands execute in a sandboxed environment for enhanced security.

```bash
# Ubuntu/Debian
sudo apt install bubblewrap
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

# Build
npm run build

# Type checking
npx tsc --noEmit
```

## Tech Stack

- **TypeScript** - Type safety
- **Anthropic SDK** - API calls
- **Ink + React** - Terminal UI
- **Express + WebSocket** - Web UI backend
- **React** - Web UI frontend
- **Commander** - CLI framework
- **Chalk** - Terminal colors
- **Zod** - Schema validation
- **Tree-sitter** - Code parsing (WASM)
- **better-sqlite3** - Local database
- **Vitest** - Testing framework

## Community

- **Discord:** [Join our Discord](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter):** [@wangbingjie1989](https://x.com/wangbingjie1989)

## License

This project is for educational purposes only. Original Claude Code is owned by Anthropic PBC.

---

*This project is a reverse engineering study of obfuscated code and does not represent the official implementation.*

[中文版 README](README.zh-CN.md)
