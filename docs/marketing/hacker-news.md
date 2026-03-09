# Hacker News Post (Show HN)

## Title

Show HN: Axon – Open-source AI coding assistant with Web IDE, multi-agent system, and self-evolution

## Body

Hey HN,

I've been building an open-source AI coding assistant called Axon. It's a terminal + web IDE tool where an AI agent writes code on your machine with 37+ tools — file editing, shell execution, browser automation, database queries, and more.

**What sets it apart from Cursor/Cline/etc:**

- **Web IDE** — Full browser-based IDE with Monaco editor, file tree, and AI-enhanced editing. Not just a chat sidebar bolted onto an editor.
- **Multi-agent system** — Blueprint system breaks complex tasks across multiple AI agents running in parallel. One requirement goes in, coordinated code comes out.
- **Self-evolution** — The AI can modify its own source code, run TypeScript type checks, and hot-reload. You can ask it to add a new tool and it will.
- **Works with any provider** — Anthropic, OpenRouter, AWS Bedrock, Google Vertex AI, or any OpenAI-compatible endpoint. Bring your own API key.
- **MCP protocol** — Connect external tool servers for unlimited extensibility.
- **Scheduled automation** — Cron-like daemon with natural language scheduling and file watching.
- **Perception** — Experimental camera/microphone/speech integration for multimodal interaction.

**Tech stack:** TypeScript, React, Express + WebSocket, Monaco Editor, better-sqlite3, Tree-sitter WASM, Playwright

It runs entirely locally, MIT licensed, no telemetry. One-click installers for all platforms plus Docker.

- GitHub: https://github.com/kill136/claude-code-open
- Live Demo: https://voicegpt.site
- Website: https://www.chatbi.site
- Discord: https://discord.gg/bNyJKk6PVZ

Would love feedback on the architecture and feature ideas.
