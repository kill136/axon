# Twitter / X Posts

---

## Main Announcement Thread

### Tweet 1 (Hook)

I built an open-source AI coding assistant with a full Web IDE, multi-agent system, and 37+ tools.

It works with any model — Anthropic, OpenRouter, DeepSeek, AWS Bedrock, or your own endpoint.

MIT licensed. Runs locally. No telemetry.

GitHub: github.com/kill136/claude-code-open

Thread:

### Tweet 2 (Web IDE)

The Web IDE is a real IDE, not a chat sidebar.

- Monaco editor with file tree
- AI inline code review & test generation
- Terminal panel + Git integration
- Checkpoint/rewind for file snapshots

All in your browser. No VS Code extension needed.

### Tweet 3 (Multi-Agent)

The Blueprint system breaks complex tasks across multiple AI agents:

- Planner decomposes requirements
- Lead Agent coordinates execution
- Workers run in parallel with full tool access
- Swarm Console shows progress in real-time

One requirement in, complete code out.

### Tweet 4 (Tools + Self-Evolution)

37+ built-in tools:

- File ops, ripgrep, shell execution
- Playwright browser automation
- Database client (PG, MySQL, SQLite, Redis, Mongo)
- Scheduled task daemon
- Long-term memory with vector search

And it can modify its own source code and hot-reload.

### Tweet 5 (Getting Started)

Get started in 60 seconds:

```
npm install -g axon
export ANTHROPIC_API_KEY="sk-..."
axon-web
```

Open localhost:3456 and start coding.

One-click installers for Windows/macOS/Linux too.

Live demo: voicegpt.site
Discord: discord.gg/bNyJKk6PVZ

---

## Standalone Tweets (for different days)

### Standalone 1 — Self Evolution

Wild feature in Axon: the AI can modify its own source code.

Edit TypeScript → run tsc type check → hot-reload the server.

Ask it to "add a weather tool" and it writes the code, compiles, restarts, done.

github.com/kill136/claude-code-open

### Standalone 2 — Any Model

Axon doesn't lock you into one AI provider.

Set ANTHROPIC_BASE_URL to OpenRouter, DeepSeek, a local LM Studio server, or any OpenAI-compatible endpoint.

Same 37+ tools, same Web IDE, your choice of model.

github.com/kill136/claude-code-open

### Standalone 3 — Blueprint Multi-Agent

Give Axon a complex task and it decomposes it across multiple AI agents.

- Planner creates the execution graph
- Lead Agent coordinates workers
- Workers execute in parallel
- Auto-review validates everything

Like a dev team, but AI.

github.com/kill136/claude-code-open

### Standalone 4 — Database Tool

Axon has a built-in database client.

Connect to PostgreSQL, MySQL, SQLite, Redis, or MongoDB right from the AI conversation.

Query data, describe tables, explore schemas — all through natural language.

github.com/kill136/claude-code-open

### Standalone 5 — Perception System

Axon can see and hear.

- Eye: camera integration for visual context
- Ear: microphone transcription via Web Speech API
- Mouth: text-to-speech for AI responses

An AI assistant that perceives the physical world.

github.com/kill136/claude-code-open

### Standalone 6 — MCP + Skills

Axon supports MCP (Model Context Protocol) for unlimited tool extensibility.

Plus a Skills marketplace — community-contributed prompt-based capabilities for PDF, DOCX, XLSX, PPTX, and more.

Build a Skill in 10 minutes.

github.com/kill136/claude-code-open

### Standalone 7 — vs Cursor

Cursor: $20/month, closed source, locked to their editor.

Axon: Free, MIT licensed, any model, any provider, browser-based IDE, multi-agent system, self-evolution.

Open source wins.

github.com/kill136/claude-code-open
