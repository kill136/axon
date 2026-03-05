# Axon

### Free & Open Source Axon with Web IDE, Multi-Agent, and Self-Evolution

[![npm](https://img.shields.io/npm/v/axon?style=flat-square&color=CB3837)](https://www.npmjs.com/package/axon)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![Discord](https://img.shields.io/discord/1454020463486566432?style=flat-square&label=Discord&color=5865F2)](https://discord.gg/bNyJKk6PVZ)

[Website](https://www.chatbi.site) | [Live Demo](https://voicegpt.site) | [User Guide](https://www.chatbi.site/zh/user-guide.html) | [Discord](https://discord.gg/bNyJKk6PVZ) | [中文](README.zh-CN.md)

<div align="center">

<a href="https://voicegpt.site">
<img src="demo-screenshots/demo.gif" width="720" alt="Axon Demo">
</a>

<sub><a href="https://youtu.be/OQ29pIgp5AI">Watch on YouTube</a> | <a href="https://github.com/kill136/claude-code-open/releases/download/v2.1.37/promo-video.mp4">Download video</a> | <a href="https://voicegpt.site">Try Live Demo</a></sub>

</div>

## Why Axon?

| | Official Axon | Axon |
|---|---|---|
| **Price** | $20/month (Max plan required) | Free (bring your own API key) |
| **Interface** | Terminal only | Terminal + **Web IDE** (Monaco editor, file tree, AI-enhanced editing) |
| **Complex tasks** | Single agent | **Multi-agent Blueprint** system (parallel workers, task queue, auto-review) |
| **Customization** | Closed source | Fully open source, **Self-Evolution** (AI modifies its own code) |
| **Deployment** | Local only | Local, Docker, Cloud, **share via Proxy Server** |
| **Integrations** | GitHub only | GitHub, Feishu, WeChat, MCP protocol, 37+ tools |

## Quick Start

```bash
# Install globally
npm install -g axon

# Set your API key
export ANTHROPIC_API_KEY="sk-..."  # or on Windows: $env:ANTHROPIC_API_KEY="sk-..."

# CLI mode
axon

# Web IDE mode
axon-web
```

That's it. Open `http://localhost:3456` for the Web IDE.

### Other install methods

<details>
<summary>One-click installer (no Node.js required)</summary>

**Windows:** Download [install.bat](https://github.com/kill136/claude-code-open/releases/latest/download/install.bat) and double-click.

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
```

**China mirror:**
```bash
curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.sh | bash
```
</details>

<details>
<summary>Docker</summary>

```bash
# Web IDE
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -p 3456:3456 \
  -v $(pwd):/workspace \
  -v ~/.axon:/root/.axon \
  wbj66/axon node /app/dist/web-cli.js --host 0.0.0.0

# CLI only
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.axon:/root/.axon \
  wbj66/axon
```
</details>

<details>
<summary>From source</summary>

```bash
git clone https://github.com/kill136/claude-code-open.git
cd axon
npm install && npm run build
node dist/cli.js        # CLI
node dist/web-cli.js    # Web IDE
```
</details>

<details>
<summary>Uninstall</summary>

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.sh | bash
```

**China mirror:**
```bash
curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/uninstall.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.ps1 | iex
```

**Windows (cmd):**
```cmd
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.bat -o uninstall.bat && uninstall.bat
```
</details>

## Key Features

### Web IDE

A full browser-based IDE built with React + Monaco Editor + WebSocket:

- **Monaco Editor** with multi-tab, syntax highlighting, AI hover tips
- **VS Code-style file tree** with right-click context menus
- **AI-enhanced editing** — select code and ask AI, code tour, heatmap decorations
- **Real-time streaming** of AI responses via WebSocket
- **Session management** — create, resume, fork, export
- **Checkpoint & Rewind** — file snapshots and session time-travel

<table>
<tr>
<td><img src="demo-screenshots/01-main.png" width="400" alt="Web IDE"></td>
<td><img src="demo-screenshots/05-typing.png" width="400" alt="Real-time Streaming"></td>
</tr>
</table>

### Blueprint Multi-Agent System

Break complex tasks across multiple AI agents working in parallel:

- **Smart Planner** — decomposes tasks into an execution plan
- **Lead Agent** — coordinates workers, tracks progress
- **Autonomous Workers** — independent execution with full tool access
- **Task Queue** — priority-based scheduling with persistence
- **Quality Reviewer** — automated review and verification

<img src="demo-screenshots/02-blueprint.png" width="600" alt="Blueprint System">

### Self-Evolution

The AI can modify its own source code, run TypeScript compilation checks, and hot-reload:

```
You: "Add a new tool that queries weather data"
Claude: *writes the tool, compiles, restarts itself, tool is now available*
```

### 37+ Built-in Tools

| Category | Tools |
|---|---|
| File ops | Read, Write, Edit, MultiEdit, Glob, Grep |
| Execution | Bash, background tasks, task output |
| Web | WebFetch, WebSearch |
| Code | NotebookEdit, LSP, Tree-sitter parsing |
| Browser | Playwright-based automation |
| Planning | Plan mode, Blueprint, sub-agents |
| Memory | Semantic search, vector store, BM25 |
| Integration | MCP protocol, Skills system |
| Scheduling | Cron-like daemon, file watching, notifications |

### More

- **Proxy Server** — share your API key across devices
- **Multi-provider** — Anthropic, AWS Bedrock, Google Vertex AI
- **Plugin & Hook system** — extend with custom logic
- **i18n** — English and Chinese
- **Feishu & WeChat bots** — messaging integrations

## Configuration

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | API key (required) | - |
| `ANTHROPIC_BASE_URL` | Custom API endpoint | `https://api.anthropic.com` |
| `AXON_LANG` | Language (`en`/`zh`) | auto-detect |
| `AXON_CONFIG_DIR` | Custom config/data directory | `~/.axon` |

### MCP Protocol

```json
// .axon/settings.json
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

## CLI Reference

```bash
axon                          # Interactive mode
axon "Analyze this project"   # With initial prompt
axon -p "Explain this code"   # Print mode (non-interactive)
axon -m opus "Complex task"   # Specify model
axon --resume                 # Resume last session
axon-web                      # Web IDE
axon-web -p 8080 -H 0.0.0.0  # Custom port and host
axon-web --ngrok              # Public tunnel
axon-web --evolve             # Self-evolution mode
axon-proxy -k my-secret       # Start local proxy server (share your quota)
```

### Proxy Server (Local Mode)

Share your Anthropic API key or Claude subscription quota with other devices on your network.

**On the host machine (has the API key / subscription):**

```bash
# Auto-detect local credentials (API key or OAuth subscription)
axon-proxy -k my-secret

# Manually specify API key
axon-proxy -k my-secret --anthropic-key sk-ant-xxx

# Custom port (default: 8082)
axon-proxy -k my-secret -p 9000
```

**On client machines (connect to the proxy):**

```bash
# Linux / macOS
export ANTHROPIC_API_KEY="my-secret"
export ANTHROPIC_BASE_URL="http://<host-ip>:8082"
axon

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY="my-secret"
$env:ANTHROPIC_BASE_URL="http://<host-ip>:8082"
axon

# Windows (CMD)
set ANTHROPIC_API_KEY=my-secret
set ANTHROPIC_BASE_URL=http://<host-ip>:8082
axon
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-k, --proxy-key` | auto-generated | Key clients use to authenticate |
| `-p, --port` | `8082` | Port to listen on |
| `-H, --host` | `0.0.0.0` | Bind address |
| `--anthropic-key` | auto-detect | Override Anthropic API key |
| `--auth-token` | auto-detect | Override OAuth access token |
| `--target` | `https://api.anthropic.com` | Upstream API URL |

The proxy auto-detects local credentials in this order: `ANTHROPIC_API_KEY` env var → `~/.axon/.credentials.json` (OAuth subscription).

## Community

- **Website:** [chatbi.site](https://www.chatbi.site)
- **Discord:** [Join us](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter):** [@wangbingjie1989](https://x.com/wangbingjie1989)

## Contributing

PRs and issues are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Acknowledgment

This project is inspired by Anthropic's @anthropic-ai/claude-code. It is an independent open-source reimplementation using public APIs. For the official version, see [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code).

## License

MIT

[中文版 README](README.zh-CN.md)
