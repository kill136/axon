# Product Hunt Launch Kit — Axon

## Tagline (60 chars max)

**Free, open-source AI coding platform with multi-agent IDE**

---

## Short Description (150 chars)

Axon is a free AI coding assistant with a browser-based IDE, multi-agent task system, 37+ tools, and self-evolution. Use any model. No lock-in. MIT licensed.

---

## Detailed Description (500 words)

### What is Axon?

Axon is a free, open-source AI coding platform that gives developers superpowers — without charging $20/month for them.

It started as an open-source alternative to proprietary AI coding tools. Today, it's grown into a full platform: a browser-based IDE, a multi-agent task orchestration system, 37+ built-in tools, and the ability to extend itself by modifying its own source code.

### What makes it different?

**1. Web IDE — Open your browser, start coding**
No installs required. Axon's Web IDE includes a Monaco code editor, file tree, terminal, real-time AI streaming, session management, and file checkpoints. Access it from any device — your laptop, a server, even an iPad.

**2. Blueprint Multi-Agent System**
Describe a complex task like "add a full auth system with roles and permissions." Axon's Blueprint system breaks it into subtasks, spins up parallel AI workers, handles dependencies, retries failures, and delivers the result. You describe the goal; agents do the work.

**3. 37+ Built-in Tools**
File operations, code search, Bash execution, browser automation (Playwright), database queries (Postgres, MySQL, SQLite, Redis, MongoDB), scheduled tasks, Jupyter notebooks, Git operations, web search, and more — all accessible through natural language.

**4. Works with Any Model**
Claude, GPT-4, DeepSeek, OpenRouter, AWS Bedrock, Google Vertex, or any OpenAI-compatible endpoint. Use DeepSeek V3 and cut your AI costs by 90%.

**5. Self-Evolution**
Axon can read and modify its own TypeScript source code, compile, and hot-reload — adding new tools and capabilities on the fly.

**6. Fully Extensible**
MCP Protocol servers, community Skills, JavaScript plugins, execution hooks, runtime custom tools — extend Axon any way you want.

### Who is it for?

- Developers who want AI assistance without vendor lock-in
- Teams that need a self-hosted AI coding environment
- Builders who want to customize their AI tools deeply
- Anyone tired of paying subscriptions for basic AI features

### Quick Start

```bash
npm install -g axon
axon-web
```

Or try the live demo at https://voicegpt.site — no install needed.

---

## Topics / Tags

- Developer Tools
- Artificial Intelligence
- Open Source
- Productivity
- Web App

---

## Maker's First Comment

Hey Product Hunt! I'm the developer behind Axon.

I built Axon because I was frustrated with the current state of AI coding tools. Every good tool wanted a monthly subscription, locked you into their editor, and only worked with specific models. I wanted something different — something open, flexible, and free.

Axon started as a weekend project to replicate the Claude Code CLI. But once I had the foundation, I couldn't stop adding features. A Web IDE so I could code from my browser. A multi-agent system so complex tasks could run in parallel. Browser automation. Database queries. Scheduled tasks. Self-evolution so the AI could literally improve itself.

Today Axon has 37+ tools, supports any AI model, runs everywhere (terminal, browser, Docker, Electron), and is completely MIT licensed. You can fork it, modify it, or contribute back.

Some things I'm particularly proud of:
- The Blueprint system can take a vague request like "refactor this module" and autonomously break it into 12 subtasks across 4 parallel workers
- Self-evolution: ask Axon to add a new tool, and it writes the code, compiles, and hot-reloads
- Using DeepSeek V3, the cost per task is roughly 1/10th of comparable paid tools

I'd love your feedback. What features would make this more useful for your workflow?

GitHub: https://github.com/kill136/claude-code-open
Live Demo: https://voicegpt.site
Discord: https://discord.gg/bNyJKk6PVZ

---

## Screenshot Captions (5 screenshots)

### Screenshot 1: Web IDE
**Title:** Full browser-based IDE
**Caption:** Monaco editor with file tree, terminal, and real-time AI streaming. No installs — just open your browser.

### Screenshot 2: Blueprint System
**Title:** Multi-agent task orchestration
**Caption:** Describe a complex task. Axon's Blueprint breaks it into parallel subtasks and dispatches AI workers automatically.

### Screenshot 3: Tool System
**Title:** 37+ built-in tools
**Caption:** Database queries, browser automation, Git operations, web search, file analysis — all through natural language.

### Screenshot 4: Model Flexibility
**Title:** Works with any AI model
**Caption:** Claude, GPT-4, DeepSeek, OpenRouter, Bedrock, Vertex — or any OpenAI-compatible endpoint. Your choice.

### Screenshot 5: Self-Evolution
**Title:** AI that improves itself
**Caption:** Ask Axon to add a new capability. It writes the code, compiles TypeScript, and hot-reloads — no restart needed.

---

## Launch Day Strategy

### Best Launch Day
**Tuesday or Wednesday** — highest traffic on Product Hunt. Avoid Mondays (competition from weekend builds) and Fridays (lower engagement).

### Launch Time
**12:01 AM PST (Pacific)** — Product Hunt resets daily at midnight PST. Launching at 12:01 gives you a full 24 hours of visibility.

### Day-of Checklist

1. **00:01 PST** — Submit product, post Maker's Comment immediately
2. **00:15 PST** — Share on Twitter/X with link to PH page
3. **00:30 PST** — Post in Discord community, ask for upvotes
4. **01:00 PST** — Post on Reddit (r/programming, r/opensource)
5. **06:00 PST** — Share on WeChat/V2EX for Chinese developer community
6. **08:00 PST** — Check comments, respond to every question within 30 min
7. **12:00 PST** — Second Twitter/X push ("We're live on Product Hunt!")
8. **16:00 PST** — Thank voters, share progress update
9. **20:00 PST** — Final push on social media before day ends

### Upvote Strategy
- Ask Discord members to upvote (don't spam — genuine requests)
- DM developer friends who use AI tools
- Post in relevant Slack/Discord communities you're already part of
- Don't buy upvotes — PH detects and penalizes this

---

## FAQ — Anticipated Questions & Answers

### Q1: How is this different from Claude Code / Cursor / Cline?
**A:** Axon is fully open-source (MIT), works with any AI model (not just Claude), includes a Web IDE and multi-agent system, and can modify its own source code. Unlike Claude Code (CLI-only) or Cursor ($20/month, locked editor), Axon gives you everything for free with no lock-in.

### Q2: Is this production-ready?
**A:** Axon is actively used in production by its developers and community. It's at v2.1.40 with 37+ tools and comprehensive test coverage. That said, it's open source — you can inspect every line of code and judge for yourself.

### Q3: How much does it actually cost to use?
**A:** Axon itself is free. You pay for API calls to your chosen AI provider. Using Claude Sonnet, costs are similar to Cursor. Using DeepSeek V3, costs drop to roughly 1/10th. You can also use free/local models via OpenAI-compatible endpoints.

### Q4: Can I self-host this for my team?
**A:** Yes. Run `axon-web -H 0.0.0.0` and share it across your network. There's also a proxy server for sharing API keys. Docker support included. No license restrictions (MIT).

### Q5: What about data privacy?
**A:** Axon runs locally on your machine. Your code never touches our servers. API calls go directly from your machine to your chosen AI provider. No telemetry, no data collection. You can verify this — the source code is fully open.
