# AXON.md

## Project Overview
开源 AI 编程助手，起源于 Claude Code 复刻，已发展为独立产品 (v2.6.1)。提供 Terminal CLI、Web IDE、桌面应用 (Electron)、代理服务器四种运行模式，内置 45+ 工具，支持多智能体蓝图、自我进化、浏览器自动化、感知系统等原创能力。

## 核心纪律

### 求证优先
- 不确定的实现 → 先查 `node_modules/@anthropic-ai/claude-code` 官方源码，不猜不编
- 遇到 bug → 修复根因再继续，禁止绕过（绕过 = 掩盖 bug = 下次必重现）

### 三思而后行（最重要）
- 每个方案必须自我反驳一次，检查缺点
- 禁止 todo 占位，直接实现
- 回复前自查：有没有更好的方案？有没有遗漏？

### 关键决策写 Notebook
- 踩过的坑、重要决策、项目陷阱 → 立刻写 project notebook
- 不写 = 下次必忘 = 必然重犯

### 工具不够用就改进工具
- 四个层次：内置工具(src/tools/) → Skills(~/.axon/skills/) → MCP servers → 插件(plugins/)
- 遇到能力不足 → 改进对应层的源码/配置，不放弃不让用户手动

### 大任务自主执行
- 多个独立子任务 → Task tool 并行分发
- 持续性任务 → ScheduleTask 安排
- 用户说"开始"= 全部开始，不做一步停一步

## 项目约定
- 核心工具行为仍参考官方实现以保持兼容：`node_modules/@anthropic-ai/claude-code`（混淆但可读）
- Web IDE、多智能体、桌面应用、感知系统等为 Axon 独有功能
- 遇到问题直接报错，不加降级方案
- 用中文回复
- 只要你写出了功能或者修改了功能，就必须写或修改对应的test，这很关键！
- docs/ 放文档，tests/ 放测试

## 架构概览

### 入口 (4 个 CLI)
| 命令 | 源码 | 说明 |
|---|---|---|
| `axon` | `src/cli.ts` | 终端交互模式 (React + Ink) |
| `axon-web` | `src/web-cli.ts` | Web IDE 服务器 (Express + React SPA) |
| `axon-proxy` | `src/proxy-cli.ts` | API 代理服务器 |
| `mcp-cli` | `src/mcp-cli.ts` | 独立 MCP 服务器模式 |

### 核心引擎 (`src/core/`)
- `client.ts` - API 调用封装（重试、token 计数、费用计算）
- `session.ts` - 会话状态管理
- `loop.ts` - 对话编排器（工具过滤、多轮对话）

### 工具系统 (`src/tools/`, 45+ 工具)
| 类别 | 工具 |
|---|---|
| 文件 | Read, Write, Edit, MultiEdit, Glob, Grep |
| 执行 | Bash, Cron, 后台任务 |
| Web | WebFetch, WebSearch |
| 代码 | NotebookEdit, NotebookWrite, LSP |
| 浏览器 | Playwright 全浏览器自动化 |
| 智能体 | Agent, Blueprint, LeadAgent, DispatchWorker |
| 规划 | PlanMode, Goal, Task, TodoWrite |
| 记忆 | MemorySearch (embedding + BM25 混合搜索) |
| 感知 | Eye (摄像头), Ear (麦克风) |
| 集成 | MCP, Skills, CreateTool, SelfEvolve, Schedule |

### Web IDE (`src/web/`)
- **Server** - Express + WebSocket + tRPC, 25+ API 路由模块
- **Client** - React SPA, Monaco Editor, 文件树, 多标签, 检查点/回退, 蓝图控制台
- **Shared** - 共享类型

### 多智能体系统
- **Blueprint** (`src/blueprint/`) - 任务分解为执行图，规划器 + 主管 + Worker
- **Agents** (`src/agents/`) - 子代理类型：Explore, Plan, Guide, Monitor, Parallel, Resume

### 关键子系统
- **Session** (`src/session/`) - 会话持久化 (~/.axon/sessions/)
- **Memory** (`src/memory/`) - 长期记忆，embedding 向量 + BM25 混合搜索
- **Browser** (`src/browser/`) - Playwright 控制器, 导航守卫, Chrome 扩展中继
- **Checkpoint/Rewind** (`src/checkpoint/`, `src/rewind/`) - 文件快照与时间旅行
- **Permissions** (`src/permissions/`) - 细粒度权限系统
- **Security** (`src/security/`, `src/sandbox/`, `src/trust/`) - 沙箱, 代码签名, 信任管理
- **Providers** (`src/providers/`, `src/models/`) - 多服务商 (Anthropic, Bedrock, Vertex, OpenAI 兼容)
- **Desktop** (`electron/`) - Electron 桌面应用
- **Perception** (`src/eye/`, `src/ear/`) - 摄像头 (Python) + 麦克风
- **i18n** (`src/i18n/`) - 国际化 (中/英)
- **LSP** (`src/lsp/`) - Language Server Protocol
- **Remote/Daemon** (`src/remote/`, `src/daemon/`) - 远程执行, 后台守护进程

## 自我感知
- 可用 Browser 访问自己的 Web UI（使用系统提示词注入的 URL）
- UI 问题 → 主动 Browser 截图确认，不盲猜
- 可通过 Web UI 创建新对话克隆自己，用于自我测试和回归验证

## Development Commands
```bash
npm run dev          # Development mode (tsx)
npm run build        # Build to dist/
npm run web          # Web IDE dev mode
npm run proxy        # Proxy server dev mode
npm test             # Run all tests (vitest)
npx tsc --noEmit     # Type check
```
