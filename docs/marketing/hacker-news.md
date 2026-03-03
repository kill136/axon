# Hacker News Post (Show HN)

## Title

Show HN: Axon – Open-source AI coding platform with Web IDE, multi-agent system, 37+ tools

## Body

Hey HN,

I've been working on an open-source AI coding platform that started as a reverse-engineering study of Anthropic's Axon CLI, but evolved into something much more capable.

**What it does:**
- Full Web IDE with Monaco editor, file tree, and AI-enhanced editing (hover tips, code review, test generation)
- Blueprint multi-agent system: break complex tasks into subtasks and dispatch them across multiple AI agents working in parallel
- 37+ built-in tools: file ops, search, shell execution, browser automation, database client, debugger, scheduled tasks, and more
- Scheduled task daemon: natural language scheduling ("every day at 9am, review my commits"), file watching, Feishu/desktop notifications
- Self-evolution: the AI can modify its own source code, run type checks, and hot-reload
- MCP protocol support for external tool integration
- One-click installers for Windows/macOS/Linux
- Docker deployment

**Tech stack:** TypeScript, React + Ink, Express + WebSocket, Monaco Editor, better-sqlite3, Tree-sitter WASM

**Why I built this:** I wanted to understand how Axon works internally, and along the way I added capabilities I wished the official tool had — a web UI, multi-agent workflows, scheduled automation, and full extensibility.

It's MIT licensed and runs entirely locally. Your data never leaves your machine.

- Website: https://www.chatbi.site
- GitHub: https://github.com/kill136/axon
- Live Demo: http://voicegpt.site/
- Discord: https://discord.gg/bNyJKk6PVZ

Would love feedback on the architecture and any feature suggestions.
