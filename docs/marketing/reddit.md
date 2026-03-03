# Reddit Posts

---

## r/programming

### Title
I built an open-source AI coding platform with a Web IDE, multi-agent system, and 37+ tools (MIT licensed)

### Body
After months of reverse-engineering Anthropic's @anthropic-ai/claude-code, I ended up building something much bigger — an open-source AI coding platform that goes way beyond a chatbot.

**Key features:**

- **Web IDE** — Monaco editor, file tree, AI-enhanced editing (inline code review, test generation, intent-to-code)
- **Multi-agent system** — Break complex projects into tasks, dispatch across parallel AI agents, monitor progress in real-time
- **37+ tools** — File operations, ripgrep search, shell execution, browser automation, database client (PostgreSQL/MySQL/SQLite/Redis/MongoDB), DAP debugger, LSP integration
- **Scheduled tasks** — Natural language scheduling, file watching, desktop + Feishu notifications
- **Self-evolution** — The AI can edit its own source code and hot-reload
- **One-click install** — Scripts for Windows/macOS/Linux, Docker support

Tech stack: TypeScript, React, Express + WebSocket, Monaco Editor, Tree-sitter WASM, better-sqlite3

Everything runs locally. MIT licensed. No telemetry.

GitHub: https://github.com/kill136/axon
Website: https://www.chatbi.site
Live Demo: http://voicegpt.site/

---

## r/ChatGPT / r/ClaudeAI

### Title
I open-sourced a full AI coding platform based on Claude — Web IDE, multi-agent workflows, 37+ tools, scheduled automation

### Body
I've been building an open-source alternative to @anthropic-ai/claude-code that's grown into a complete AI coding platform. Here's what makes it different:

**Not just a chatbot — it's a full IDE:**
- Browser-based IDE with Monaco editor and file tree
- AI can review your code, generate tests, and suggest changes inline
- Terminal panel, Git integration, checkpoint/rewind for file snapshots

**Multi-agent collaboration:**
- Blueprint system breaks complex tasks across multiple AI agents
- Smart Planner analyzes requirements, Lead Agent coordinates, Workers execute in parallel
- Real-time Swarm Console shows agent activity

**37+ built-in tools:**
- File ops, shell, web search, browser automation (Playwright)
- Database client (PostgreSQL, MySQL, SQLite, Redis, MongoDB)
- DAP debugger, LSP code intelligence
- Scheduled task daemon with natural language ("every Friday at 5pm, summarize this week's commits")

**Self-evolution:**
- The AI can modify its own source code
- TypeScript compilation check before hot-reload
- Full audit log

MIT licensed, runs locally, supports Anthropic API / AWS Bedrock / Google Vertex AI.

GitHub: https://github.com/kill136/axon
Live Demo: http://voicegpt.site/
Discord: https://discord.gg/bNyJKk6PVZ
