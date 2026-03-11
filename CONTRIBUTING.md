# Contributing to Axon

Thanks for your interest in contributing! Axon is an open-source AI coding assistant, and we welcome contributions of all kinds — bug fixes, new features, documentation, Skills, plugins, and more.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- Git
- npm

### Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/claude-code-open.git
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

# Start development mode
npm run dev        # Terminal mode
npm run web        # Web IDE mode
```

### Running Tests

```bash
npm test                    # All tests
npm run test:unit           # Unit tests
npm run test:integration    # Integration tests
npm run test:e2e            # End-to-end tests
npx tsc --noEmit            # Type checking
```

## Ways to Contribute

### Report Bugs

1. Search [existing issues](https://github.com/kill136/claude-code-open/issues) first
2. Include: steps to reproduce, expected vs actual behavior, OS, Node.js version, browser (for Web UI)
3. Attach error logs or screenshots if possible

### Suggest Features

Open an issue describing the use case and motivation. Be specific about what problem it solves.

### Write Code

1. Fork the repo and create a branch from `private_web_ui`
2. Make your changes
3. Ensure `npx tsc --noEmit` passes
4. Ensure `npm test -- --run` passes
5. Write a clear commit message
6. Open a Pull Request

### Build a Skill

Skills are prompt-based capabilities that extend what Axon can do. They are Markdown files placed in `~/.axon/skills/<skill-name>/SKILL.md`. See existing skills for examples, or use the built-in `skill-creator` skill to scaffold one.

### Build a Plugin

Plugins are JavaScript/TypeScript modules with lifecycle hooks. Place them in `~/.axon/plugins/` and they are auto-loaded on startup.

### Build an MCP Server

Axon supports the [Model Context Protocol](https://modelcontextprotocol.io/). You can build an MCP server to integrate any external API or service. See the `mcp-builder` skill for guidance.

## Commit Message Convention

```
type(scope): description

# Examples
feat(tools): add database query tool
fix(web): resolve WebSocket reconnection issue
docs: update installation instructions
refactor(core): simplify conversation loop
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

## Project Structure

```
src/
├── core/           # Core engine (API client, session, conversation loop)
├── tools/          # 37+ built-in tools
├── web/
│   ├── server/     # Express + WebSocket backend
│   └── client/     # React frontend (Web IDE)
├── agents/         # Multi-agent coordination
├── blueprint/      # Blueprint task system
├── memory/         # Long-term memory & search
├── mcp/            # MCP protocol implementation
├── plugins/        # Plugin system
├── config/         # Configuration management
└── ...
```

## Code Style

- TypeScript with ES modules
- JSX for React (Web UI) and Ink (CLI UI) components
- Zod for schema validation
- Keep changes focused — one feature or fix per PR

## Need Help?

- [Discord](https://discord.gg/bNyJKk6PVZ)
- [Open an issue](https://github.com/kill136/claude-code-open/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
