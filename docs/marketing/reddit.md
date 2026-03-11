# Reddit Posts

---

## r/programming

### Title
I built an open-source AI coding assistant with a full Web IDE, multi-agent system, and 37+ tools (MIT licensed)

### Body
I've been building **Axon**, an open-source AI coding assistant that goes beyond a chat window — it's a full development environment where AI agents read, write, and execute code on your machine.

**Key features:**

- **Web IDE** — Browser-based IDE with Monaco editor, file tree, AI-enhanced editing (inline code review, test generation, hover tips)
- **Multi-agent system** — Blueprint system breaks complex projects into tasks, dispatches across parallel AI agents, monitors progress in real-time
- **37+ tools** — File operations, ripgrep search, shell execution, browser automation (Playwright), database client (PostgreSQL/MySQL/SQLite/Redis/MongoDB), LSP integration, scheduled tasks
- **Self-evolution** — The AI can edit its own source code and hot-reload new capabilities
- **Any model** — Works with Anthropic, OpenRouter, AWS Bedrock, Google Vertex AI, or any OpenAI-compatible endpoint
- **One-click install** — Scripts for Windows/macOS/Linux, Docker support

Tech stack: TypeScript, React, Express + WebSocket, Monaco Editor, Tree-sitter WASM, better-sqlite3

Everything runs locally. MIT licensed. No telemetry.

GitHub: https://github.com/kill136/claude-code-open
Website: https://www.chatbi.site
Live Demo: https://voicegpt.site

---

## r/ChatGPT / r/ClaudeAI

### Title
I open-sourced a full AI coding platform — Web IDE, multi-agent workflows, 37+ tools, works with any API provider

### Body
I've been building **Axon**, an open-source AI coding assistant with capabilities you won't find in most AI tools:

**Not just a chatbot — it's a full IDE:**
- Browser-based IDE with Monaco editor and file tree
- AI can review your code, generate tests, and suggest inline changes
- Terminal panel, Git integration, checkpoint/rewind for file snapshots

**Multi-agent collaboration:**
- Blueprint system breaks complex tasks across multiple AI agents
- Planner analyzes requirements, Lead Agent coordinates, Workers execute in parallel
- Real-time Swarm Console shows agent activity

**37+ built-in tools:**
- File ops, shell, web search, browser automation (Playwright)
- Database client (PostgreSQL, MySQL, SQLite, Redis, MongoDB)
- Scheduled task daemon with natural language ("every Friday at 5pm, summarize this week's commits")

**Self-evolution:**
- The AI can modify its own source code
- TypeScript compilation check before hot-reload
- Full audit log

**Works with any provider** — Anthropic, OpenRouter, AWS Bedrock, Google Vertex AI, DeepSeek, or any OpenAI-compatible API.

MIT licensed, runs locally, your data stays on your machine.

GitHub: https://github.com/kill136/claude-code-open
Live Demo: https://voicegpt.site
Discord: https://discord.gg/bNyJKk6PVZ

---

## r/LocalLLaMA

### Title
Axon: open-source AI coding assistant that works with any OpenAI-compatible API — Web IDE, multi-agent, 37+ tools

### Body
If you're running local models or using alternative API providers, **Axon** might be interesting to you.

It's an open-source AI coding assistant with a full Web IDE and 37+ tools. The key thing: **it works with any OpenAI-compatible endpoint**. Point `ANTHROPIC_BASE_URL` at your local server (LM Studio, Ollama with OpenAI compat, text-generation-webui, etc.) and it just works.

Features:
- Browser-based IDE with Monaco editor
- Multi-agent system for complex tasks
- File operations, shell, browser automation, database queries
- Skills marketplace and MCP protocol for extensibility
- Self-evolution (AI modifies its own code)

MIT licensed. One-click install. No telemetry.

GitHub: https://github.com/kill136/claude-code-open
Live Demo: https://voicegpt.site
