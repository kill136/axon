<div align="center">

# Axon

### The AI coding assistant that runs everywhere

**Use any model. Extend with plugins. Let AI agents build your project.**

[![npm](https://img.shields.io/npm/v/axon?style=flat-square&color=CB3837)](https://www.npmjs.com/package/axon)
[![License](https://img.shields.io/badge/License-Proprietary-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![Discord](https://img.shields.io/discord/1454020463486566432?style=flat-square&label=Discord&color=5865F2)](https://discord.gg/bNyJKk6PVZ)

[Website](https://www.chatbi.site) | [Live Demo](https://voicegpt.site) | [User Guide](https://www.chatbi.site/zh/user-guide.html) | [Discord](https://discord.gg/bNyJKk6PVZ) | [中文](README.zh-CN.md)

<a href="https://voicegpt.site">
<img src="demo-screenshots/demo.gif" width="720" alt="Axon Demo">
</a>

<sub><a href="https://youtu.be/OQ29pIgp5AI">Watch on YouTube</a> | <a href="https://github.com/kill136/axon/releases/download/v2.1.37/promo-video.mp4">Download video</a> | <a href="https://voicegpt.site">Try Live Demo</a></sub>

</div>

---

Axon is a free AI coding assistant with a built-in Web IDE, multi-agent task system, and self-evolution capabilities. It gives you full control — choose your AI provider, extend functionality through plugins and MCP servers, and even let the AI modify its own source code.

## Quick Start

```bash
# Install
npm install -g axon

# Set your API key (Anthropic, OpenRouter, DeepSeek, or any OpenAI-compatible provider)
# No API key? Get one at https://api.chatbi.site (Claude Sonnet & Opus, OpenAI-compatible)
export ANTHROPIC_API_KEY="sk-..."

# Terminal mode
axon

# Web IDE mode (opens at http://localhost:3456)
axon-web
```

### Other install methods

<details>
<summary>One-click installer (no Node.js required)</summary>

**Windows:** Download [install.bat](https://github.com/kill136/axon/releases/latest/download/install.bat) and double-click.

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/axon/private_web_ui/install.sh | bash
```

**China mirror:**
```bash
curl -fsSL https://gitee.com/lubanbbs/axon/raw/private_web_ui/install.sh | bash
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

# Terminal only
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.axon:/root/.axon \
  wbj66/axon
```
</details>


<details>
<summary>Uninstall</summary>

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/axon/private_web_ui/uninstall.sh | bash
```

**China mirror:**
```bash
curl -fsSL https://gitee.com/lubanbbs/axon/raw/private_web_ui/uninstall.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/kill136/axon/private_web_ui/uninstall.ps1 | iex
```

**Windows (cmd):**
```cmd
curl -fsSL https://raw.githubusercontent.com/kill136/axon/private_web_ui/uninstall.bat -o uninstall.bat && uninstall.bat
```
</details>

## What makes Axon different

### Web IDE

A full browser-based IDE — not just a chat window.

- **Monaco Editor** with multi-tab, syntax highlighting, and AI-powered hover tips
- **File tree** with right-click context menus, just like VS Code
- **AI-enhanced editing** — select code, ask AI, get inline changes
- **Real-time streaming** via WebSocket
- **Session management** — create, resume, fork, and export conversations
- **Checkpoint & Rewind** — snapshot files and time-travel through your session

<table>
<tr>
<td><img src="demo-screenshots/01-main.png" width="400" alt="Web IDE"></td>
<td><img src="demo-screenshots/05-typing.png" width="400" alt="Real-time Streaming"></td>
</tr>
</table>

### Multi-Agent Blueprint System

Give Axon a complex task and it breaks it down across multiple AI agents working in parallel.

- **Planner** decomposes the task into an execution graph
- **Lead Agent** coordinates workers and tracks progress
- **Workers** execute independently with full tool access
- **Task Queue** with priority scheduling and persistence
- **Auto-review** validates output before marking complete

<img src="demo-screenshots/02-blueprint.png" width="600" alt="Blueprint System">

### Self-Evolution

Axon can modify its own source code, compile, and hot-reload — adding new tools and capabilities on the fly.

```
You: "Add a tool that queries weather data"
Axon: *writes the tool code, compiles TypeScript, restarts, tool is ready*
```

### 37+ Built-in Tools

| Category | Tools |
|---|---|
| File ops | Read, Write, Edit, MultiEdit, Glob, Grep |
| Execution | Bash, background tasks, scheduled jobs |
| Web | Fetch pages, search the web |
| Code | Jupyter notebooks, LSP, Tree-sitter parsing |
| Browser | Playwright-based full browser automation |
| Planning | Plan mode, Blueprint, sub-agents |
| Memory | Long-term memory with semantic search, vector store, BM25 |
| Integration | MCP protocol, Skills marketplace, plugins |
| Perception | Camera (Eye), Microphone (Ear), Speech (Mouth) |

### Extensible by Design

- **MCP Protocol** — connect any [Model Context Protocol](https://modelcontextprotocol.io/) server
- **Skills** — community-contributed prompt-based capabilities (PDF, DOCX, XLSX, PPTX, and more)
- **Plugins** — write custom JavaScript/TypeScript extensions
- **Hooks** — pre/post tool execution callbacks
- **Custom tools** — create tools at runtime that persist across sessions

### Works with Any Provider

| Provider | Setup |
|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY=sk-ant-...` |
| **OpenRouter** | `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1` |
| **AWS Bedrock** | `CLAUDE_CODE_USE_BEDROCK=1` |
| **Google Vertex AI** | `CLAUDE_CODE_USE_VERTEX=1` |
| **Any OpenAI-compatible** | Set `ANTHROPIC_BASE_URL` to your endpoint |

### Proxy Server

Share your API key or Claude subscription with other devices on your network.

```bash
# On the host (has the API key)
axon-proxy -k my-secret

# On client machines
export ANTHROPIC_API_KEY="my-secret"
export ANTHROPIC_BASE_URL="http://<host-ip>:8082"
axon
```

<details>
<summary>Proxy options</summary>

| Flag | Default | Description |
|---|---|---|
| `-k, --proxy-key` | auto-generated | Key clients use to authenticate |
| `-p, --port` | `8082` | Port to listen on |
| `-H, --host` | `0.0.0.0` | Bind address |
| `--anthropic-key` | auto-detect | Override Anthropic API key |
| `--auth-token` | auto-detect | Override OAuth access token |
| `--target` | `https://api.anthropic.com` | Upstream API URL |

The proxy auto-detects credentials: `ANTHROPIC_API_KEY` env var > `~/.axon/.credentials.json` (OAuth).
</details>

## Configuration

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | API key (required) | - |
| `ANTHROPIC_BASE_URL` | Custom API endpoint | `https://api.anthropic.com` |
| `AXON_LANG` | Language (`en`/`zh`) | auto-detect |
| `AXON_CONFIG_DIR` | Config/data directory | `~/.axon` |

### MCP Servers

Add external tool servers in `.axon/settings.json`:

```json
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
```

## Community

- **Website:** [chatbi.site](https://www.chatbi.site)
- **Live Demo:** [voicegpt.site](https://voicegpt.site)
- **Discord:** [Join us](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter):** [@wangbingjie1989](https://x.com/wangbingjie1989)

## Contributing

PRs and issues are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Building a Skill or Plugin

The fastest way to extend Axon is to write a **Skill** (a prompt file with structured instructions) or a **Plugin** (a JS/TS module with lifecycle hooks). Both are auto-loaded from `~/.axon/skills/` and `~/.axon/plugins/`.

## Sponsors

Axon is free to use. Sponsorships keep development going. [See sponsor tiers →](SPONSORS.md)

### Founding Sponsors

- **Jack Darcy** — jack@jackdarcy.com.au

*Your name/logo here — [become a sponsor](SPONSORS.md)*

<a href="https://paypal.me/wangbingjie20"><img src="https://img.shields.io/badge/PayPal-Sponsor-00457C?style=for-the-badge&logo=paypal" alt="PayPal"></a>

<p>
<img src="wechat.jpg" width="180" alt="WeChat Pay">&nbsp;&nbsp;&nbsp;
<img src="alipay.jpg" width="180" alt="Alipay">
</p>

## License

Axon is proprietary software. Free for personal use. For commercial or enterprise use, please contact **kill.136@163.com**.

[中文版 README](README.zh-CN.md)
