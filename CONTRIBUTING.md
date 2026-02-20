# Contributing to Claude Code Open

Thank you for your interest in contributing! This guide will help you get started.

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
npm run dev        # CLI mode
npm run web        # Web UI mode
```

### Running Tests

```bash
npm test                    # All tests
npm run test:unit           # Unit tests
npm run test:integration    # Integration tests
npm run test:e2e            # End-to-end tests
npx tsc --noEmit            # Type checking
```

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/kill136/claude-code-open/issues) first
2. Use the **Bug Report** template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - OS, Node.js version, browser (for Web UI)
   - Error logs / screenshots

### Suggesting Features

1. Open an issue with the **Feature Request** template
2. Explain the use case and motivation
3. Be specific about what you want

### Submitting Code

1. Fork the repo and create a branch from `private_web_ui`
2. Make your changes
3. Ensure `npx tsc --noEmit` passes
4. Ensure `npm test -- --run` passes
5. Write a clear commit message
6. Open a Pull Request

### Commit Message Convention

```
type(scope): description

# Examples
feat(tools): add new database query tool
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
├── blueprint/      # Multi-agent system
├── memory/         # Memory & search system
├── mcp/            # MCP protocol implementation
└── ...             # See README for full structure
```

## Code Style

- TypeScript with ES modules
- No strict mode (tsconfig `strict: false`)
- JSX for Ink (CLI UI) and React (Web UI) components
- Zod for schema validation
- Keep changes focused — don't mix features with refactoring

## Need Help?

- [Discord](https://discord.gg/bNyJKk6PVZ)
- [Open an issue](https://github.com/kill136/claude-code-open/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
