# AXON.md



## Project Overview

This is an educational reverse-engineering project that recreates @anthropic-ai/claude-code v2.1.4. It's a TypeScript-based terminal application that provides an AI assistant with 25+ tools for file operations, code analysis, web access, and system commands.

## 铁律（每条都是硬性约束，没有例外）

### 铁律1：先读后改，无一例外
- **调用 Edit/Write 之前，必须先 Read 过目标文件**。没读过就不准改。
- **调用 Edit 之前，必须理解修改点的上下文**。至少读该文件相关的函数/类。
- 违反此条 = 直接产出错误代码。

### 铁律2：禁止猜测，必须求证
- **不确定的实现方式，必须先去 `node_modules/@anthropic-ai/claude-code` 找到官方源码**。
- 找不到就说"找不到"，**绝对不编、不猜、不"我觉得应该是"**。
- 官方源码被混淆了，但这不是猜测的借口。读不懂就多花时间读，读到懂为止。

### 铁律3：只改要求改的，不多不少
- **改完代码后自查：有没有超出用户请求范围的改动？有就撤掉**。
- 不加多余的注释、类型注解、错误处理、"顺手优化"。
- 用户要一行就改一行，要一个函数就改一个函数。

### 铁律4：敢说不对，不讨好
- **用户方案有问题就直接指出，不绕弯子，不说"您说得有道理但是..."**。
- 不给没用的鼓励和安慰。错就是错，直说。
- 只认代码和事实，不认"感觉"和"应该"。

### 铁律5：关键决策写 Notebook，不靠记忆
- 踩过的坑、做过的重要决策、发现的项目陷阱，**立刻写进 project notebook**。
- 下次对话开局就能看到，不会重蹈覆辙。
- 不写 = 下次必忘 = 必然重犯。

### 铁律6：三思而后行 ****这是最重要的纪律
- 每个方案出来后，重新思考缺点，至少自我反驳一次。
- 禁止写 todo 占位，直接实现功能。
- 每次回复结束前，必须自我反思自己给出方案是否有别的问题。

### 铁律7：采用第一性原理思考和解决问题

### 铁律8：先查 Skills，再动手
- **执行任务前，必须检查可用 Skills 列表中是否有匹配当前任务的 Skill**。
- 有匹配的 Skill 就**必须先调用**，获取专业指导后再动手。
- "我自己会"不是跳过 Skill 的理由——Skill 里有你没想到的最佳实践。
- 违反此条 = 用业余方式做了本可以专业完成的事。

### 铁律9：主动交互，禁止被动报告
- **遇到需要用户决策的情况，必须立即调用 AskUserQuestion 工具**。
- **禁止在文本回复中列出"选项1、选项2"然后被动等待**。
- **禁止说"你可以选择 A 或 B"——直接用工具问**。
- 工具调用 > 文本描述。用户需要输入 = 立即弹出交互式问题。
- 违反此条 = 被动的批处理思维，而不是主动的交互式 Agent。

## 项目性质
- 这是一个**复刻还原项目**，目标是还原 @anthropic-ai/claude-code v2.1.4。
- 唯一准则：**保持和官方一致**。不要"改进"，不要"优化"，不要"我觉得这样更好"。
- 官方源码路径：`node_modules/@anthropic-ai/claude-code`（高度压缩混淆）。
- 遇到解决不了的难题，直接 copy 官方实现的源码，第一性原理解决问题。
- 永远不要增加降级方案，遇到问题直接报错，不掩盖问题。
- docs/ 文档统一保存路径，tests/ 测试用例统一保存路径。
- 用中文回复。

## 行为红线
- 不要被用户的情绪或期望干扰判断，只相信自己看到的代码
- 用户的能力并不如你，当他提出的方案不正确时，必须直接指出问题

## 自我感知能力
- 你可以用 Browser 工具访问自己的 Web UI（导航守卫已对自身端口开白名单）
- 当用户反馈 UI 问题时，应该主动用 Browser 截图确认，而不是盲猜
- 注意：服务器可能以 HTTP 或 HTTPS 模式运行，系统提示词会注入正确的 URL，请使用注入的 URL 而非硬编码
## Development Commands

```bash
# Development mode (live TypeScript execution)
npm run dev

# Build TypeScript to dist/
npm run build

# Run compiled version
npm run start  # or: node dist/cli.js

# Type checking without compiling
npx tsc --noEmit
```

### Testing

```bash
npm test                    # Run all tests (vitest)
npm run test:unit           # Unit tests only (src/)
npm run test:integration    # Integration tests (tests/integration/)
npm run test:e2e            # End-to-end CLI tests
npm run test:coverage       # Run with coverage report
npm run test:watch          # Watch mode
npm run test:ui             # Vitest UI
```

### CLI Usage

```bash
node dist/cli.js                        # Interactive mode
node dist/cli.js "Analyze this code"    # With initial prompt
node dist/cli.js -p "Explain this"      # Print mode (non-interactive)
node dist/cli.js -m opus "Complex task" # Specify model (opus/sonnet/haiku)
node dist/cli.js --resume               # Resume last session
```

## Architecture Overview

### Core Three-Layer Design

1. **Entry Layer** (`src/cli.ts`, `src/index.ts`)
   - CLI argument parsing with Commander.js
   - Main export barrel file

2. **Core Engine** (`src/core/`)
   - `client.ts` - Anthropic API wrapper with retry logic, token counting, cost calculation
   - `session.ts` - Session state management, message history, cost tracking
   - `loop.ts` - Main conversation orchestrator, handles tool filtering and multi-turn dialogues

3. **Tool System** (`src/tools/`)
   - All tools extend `BaseTool` and register in `ToolRegistry`
   - 25+ tools: Bash, Read, Write, Edit, MultiEdit, Glob, Grep, WebFetch, WebSearch, TodoWrite, Task, NotebookEdit, MCP, Tmux, Skills, etc.

### Key Data Flow

```
CLI Input → ConversationLoop → ClaudeClient (Anthropic API)
                ↓                      ↓
           ToolRegistry           Session State
                ↓                      ↓
          Tool Execution    Session Persistence (~/.axon/sessions/)
```

### Important Subsystems

- **Session Management** (`src/session/`) - Persists conversations to `~/.axon/sessions/` with 30-day expiry
- **Configuration** (`src/config/`) - Loads from `~/.axon/settings.json` and environment variables
- **Context Management** (`src/context/`) - Token estimation, auto-summarization when hitting limits
- **Hooks System** (`src/hooks/`) - Pre/post tool execution hooks for customization
- **Plugin System** (`src/plugins/`) - Extensible plugin architecture
- **UI Components** (`src/ui/`) - React + Ink terminal UI framework
- **Code Parser** (`src/parser/`) - Tree-sitter WASM for multi-language parsing
- **Ripgrep** (`src/search/ripgrep.ts`) - Vendored ripgrep binary support
- **Streaming I/O** (`src/streaming/`) - JSON message streaming for Claude API

## Tool System Architecture

Tools are the core of the application. Each tool:
1. Extends `BaseTool` class
2. Defines input schema with Zod
3. Implements `execute()` method
4. Registers in `ToolRegistry`
5. Can be filtered via allow/disallow lists

Tools communicate results back to the conversation loop, which feeds them to the Claude API for the next turn.

## Configuration

### Locations (Linux/macOS: `~/.axon/`, Windows: `%USERPROFILE%\.axon\`)

- **API Key:** `ANTHROPIC_API_KEY` or `AXON_API_KEY` env var, or `settings.json`
- **Sessions:** `sessions/` directory (JSON files, 30-day expiry)
- **MCP Servers:** Defined in `settings.json`
- **Skills:** `~/.axon/skills/` and `./.axon/commands/`
- **Plugins:** `~/.axon/plugins/` and `./.axon/plugins/`

### Key Environment Variables

- `ANTHROPIC_API_KEY` / `AXON_API_KEY` - API key for Claude
- `USE_BUILTIN_RIPGREP` - Set to `1`/`true` to use system ripgrep instead of vendored
- `BASH_MAX_OUTPUT_LENGTH` - Max Bash output length (default: 30000)
- `AXON_MAX_OUTPUT_TOKENS` - Max output tokens (default: 32000)

### Windows-Specific Notes

- Bubblewrap sandbox: Linux-only (Windows needs WSL)
- Tmux: Linux/macOS only (use Windows Terminal tabs/panes)
- Hook scripts: Use `.bat` or `.ps1` instead of `.sh`
- JSON paths: Use double backslashes (e.g., `"C:\\Users\\user\\projects"`)

## Key Design Patterns

- **Registry Pattern** - `ToolRegistry` for dynamic tool management
- **Plugin Pattern** - `PluginManager` with lifecycle hooks
- **Strategy Pattern** - Multiple permission modes (acceptEdits, bypassPermissions, plan)
- **Observer Pattern** - Event-driven hook system

## TypeScript Configuration

- **Target:** ES2022, **Module:** NodeNext (ES Modules)
- **JSX:** React (for Ink UI components)
- **Output:** `dist/` with source maps and declarations
- **Strict:** Disabled (`"strict": false`)
