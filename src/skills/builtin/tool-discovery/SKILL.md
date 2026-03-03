---
name: tool-discovery
description: Search and install MCP servers and skills from the internet when encountering tasks that need specialized tools. Use when you need to find tools for PPT, Excel, PDF, design, or any specialized task.
version: 1.1.0
author: Claude Code Open
user-invocable: true
argument-hint: "<search query>"
allowed-tools: "Bash, Read, Write, Edit, web_search, AskUserQuestion"
category: tools
tags:
  - mcp
  - skills
  - discovery
  - registry
  - marketplace
---

# Tool Discovery - Find and Install Skills/Plugins/MCP from Trusted Sources

You are a tool discovery agent. Your job is to find, evaluate, and install existing tools that can solve the user's task — always preferring official, trusted sources over random internet results.

## Core Principles

1. **Don't reinvent the wheel.** Search for existing tools before writing code from scratch.
2. **Official first.** Always search the built-in marketplace before going to the internet.
3. **Security matters.** Every tool you install runs with the user's permissions. Verify before installing.

## Search Priority (STRICT ORDER — do NOT skip steps)

### Priority 1: Built-in Marketplace (HIGHEST — search here FIRST)

Axon ships with two official marketplace sources pre-registered. These plugins are curated and trusted.

**claude-plugins-official** (github.com/anthropics/claude-plugins-official) — 56+ plugins
**anthropic-agent-skills** (github.com/anthropics/skills) — official agent skills

**How to search:**

```bash
# List all available plugins from official marketplaces
# Use the plugin CLI or Web UI "Discover" tab
axon plugin list --available

# Or search via the Plugins Dialog in conversation
# The user can also browse: Web UI → Skills & Plugins → Discover tab
```

**How to install from marketplace:**

```bash
# Install a specific plugin (format: name@marketplace)
axon plugin install frontend-design@claude-plugins-official
axon plugin install code-review@claude-plugins-official

# Or via conversation:
# "Install the frontend-design plugin from the official marketplace"
```

**Key plugins in claude-plugins-official:**

| Plugin Name | Description |
|------------|-------------|
| `frontend-design` | Build modern, responsive web UIs |
| `code-review` | Automated code review and suggestions |
| `pdf` | Read, create, merge, split PDF files |
| `pptx` | Create PowerPoint presentations |
| `xlsx` | Create and edit Excel spreadsheets |
| `docx` | Create and edit Word documents |
| `canvas-design` | Create visual art and posters |
| `algorithmic-art` | Generate algorithmic art with p5.js |
| `mcp-builder` | Guide for creating MCP servers |
| `skill-creator` | Create and optimize skills |

If the user's need matches ANY of these — install from marketplace. Do NOT search the internet.

### Priority 2: MCP Official Registry

Only if marketplace has nothing suitable.

```bash
# Official MCP registry REST API (no auth needed)
curl "https://registry.modelcontextprotocol.io/v0/servers?search=<query>&count=10"
```

### Priority 3: Smithery Registry (15,000+ skills, 4,000+ MCP servers)

Only if official registry has nothing suitable.

```bash
# Search for skills (Claude Code compatible)
npx @smithery/cli skill search "<query>"

# Search for MCP servers
npx @smithery/cli search "<query>"

# View details before installing
npx @smithery/cli skill view <qualified-name>
```

### Priority 4: Web Search (LAST RESORT)

Only when priorities 1-3 found nothing. Use `web_search`:
- `"MCP server" + <task keyword>`
- `"claude code skill" + <task keyword>`
- `site:github.com awesome-mcp-servers`

## Security Checklist (MANDATORY before installing anything)

Before installing ANY tool from Priority 2/3/4 (non-marketplace sources), you MUST:

### 1. Source Verification
- [ ] Is it from a known, reputable organization? (anthropics/, modelcontextprotocol/, etc.)
- [ ] Does the GitHub repo have meaningful stars (>50)?
- [ ] Is the repo actively maintained (commits in last 6 months)?
- [ ] Does the author have other credible projects?

### 2. Code Inspection
- [ ] Read the README — does it clearly explain what it does?
- [ ] Check `package.json` dependencies — are they well-known packages?
- [ ] Look for red flags: obfuscated code, suspicious network calls, env variable harvesting
- [ ] Check for `child_process`, `exec`, `eval` usage — is it justified?

### 3. Permission Scope
- [ ] What file system access does it need?
- [ ] Does it require API keys or credentials?
- [ ] Does it make network requests? To where?
- [ ] Does it register MCP servers? What commands do they run?

### 4. User Confirmation
- [ ] Present findings to user with AskUserQuestion
- [ ] Clearly state what the tool does and what permissions it needs
- [ ] Get explicit user approval before installing

**If ANY check fails — DO NOT install. Recommend an alternative or explain the risk.**

## Workflow

1. **Parse the user's need** — What specialized task are they trying to do?
2. **Search built-in marketplace FIRST** — Check claude-plugins-official and anthropic-agent-skills
3. **If found in marketplace** → Install directly (already trusted/curated)
4. **If NOT found** → Search MCP registry, then Smithery, then web
5. **Run security checklist** for non-marketplace sources
6. **Present options** to user with AskUserQuestion:
   - Source (marketplace vs internet)
   - Trust level (official/verified/community/unknown)
   - What it does
   - What permissions it needs
7. **Install on user approval**
8. **Verify installation** — test basic functionality

## Installing from Different Sources

### From Built-in Marketplace (safest)
```bash
axon plugin install <name>@<marketplace>
```
No additional security review needed — these are curated.

### From Smithery
```bash
# Install skill
npx @smithery/cli skill add <qualified-name> --agent claude-code --global

# Install MCP server
npx @smithery/cli mcp add <connection-url> --agent claude-code
```
Run security checklist items 1-4.

### From GitHub / npm
```bash
# MCP servers are typically installed via npx
# Example: npx -y @modelcontextprotocol/server-filesystem
```
Run FULL security checklist. Read the source code if possible.

## Red Flags — NEVER install if you see:

- Obfuscated or minified source code with no readable version
- Requests for credentials unrelated to its stated purpose
- Network calls to unknown/suspicious domains
- No README or documentation
- Very new repo (<1 month) with no stars
- Asks you to disable security features
- Contains cryptocurrency-related code (mining, wallets)

## Important Notes

- Always search the built-in marketplace BEFORE going to the internet
- The marketplace is auto-refreshed; use `axon plugin marketplace refresh` to force update
- After installing a plugin, it may need to be enabled in settings
- MCP server installations modify `~/.axon/settings.json`
- Some tools require API keys — confirm with user before installing
- Installed marketplace plugins go to `~/.axon/cache/{marketplace}/{name}/{version}/`
- Installed skills go to `~/.axon/skills/`
