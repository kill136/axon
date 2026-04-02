/**
 * Coordinator 多 Agent 协调模式
 *
 * 参考 Claude Code 官方 coordinatorMode.ts 实现。
 *
 * Coordinator 模式下，主 agent 变成「协调器」角色：
 * - 自身不使用文件/Bash 等执行工具，只使用 Task（派发 worker）、SendMessage（续传）、TaskStop
 * - 通过 Task 工具生成的 worker 拥有标准工具集
 * - 协调器负责任务分解、结果综合、与用户沟通
 */

import { isTruthy } from '../utils/env-check.js';
import { toolRegistry } from '../tools/base.js';
import type { ToolDefinition } from '../types/index.js';

// ============ 常量 ============

/**
 * 协调器自身可用的工具（只有管控类工具）
 */
const COORDINATOR_TOOLS = new Set([
  'Task',           // 派发 worker
  'TaskOutput',     // 查询/停止 worker（包含 stop 功能）
  'SendMessage',    // 续传消息给已有 worker（如果存在）
]);

/**
 * Worker 不可见的内部工具（团队管理等）
 * 这些工具只在协调器层级存在，不暴露给 worker
 */
const INTERNAL_COORDINATOR_TOOLS = new Set([
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
]);

/**
 * Worker 禁用的工具
 * 防止 worker 自己派发子 agent、与用户交互等
 */
const WORKER_DISALLOWED_TOOLS = [
  'Task',
  'TaskOutput',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
];

/**
 * 精简模式下 worker 只有这些基础工具
 */
const SIMPLE_WORKER_TOOLS = ['Bash', 'Read', 'Edit'];

// ============ 模式检测 ============

/**
 * 检查当前是否处于 Coordinator 模式
 *
 * 通过环境变量 AXON_COORDINATOR_MODE 控制。
 */
export function isCoordinatorMode(): boolean {
  return isTruthy(process.env.AXON_COORDINATOR_MODE);
}

// ============ 会话模式匹配 ============

/**
 * 恢复会话时检查并对齐 coordinator 模式。
 *
 * 如果当前环境的 coordinator 模式与会话存储的模式不一致，
 * 则翻转环境变量使 isCoordinatorMode() 返回正确值。
 *
 * @param sessionMode 会话存储的模式（'coordinator' | 'normal' | undefined）
 * @returns 切换提示消息，或 undefined（无需切换）
 */
export function matchSessionMode(
  sessionMode: 'coordinator' | 'normal' | undefined,
): string | undefined {
  if (!sessionMode) {
    return undefined;
  }

  const currentIsCoordinator = isCoordinatorMode();
  const sessionIsCoordinator = sessionMode === 'coordinator';

  if (currentIsCoordinator === sessionIsCoordinator) {
    return undefined;
  }

  // 翻转环境变量
  if (sessionIsCoordinator) {
    process.env.AXON_COORDINATOR_MODE = '1';
  } else {
    delete process.env.AXON_COORDINATOR_MODE;
  }

  return sessionIsCoordinator
    ? '已进入 Coordinator 模式以匹配恢复的会话。'
    : '已退出 Coordinator 模式以匹配恢复的会话。';
}

// ============ 工具过滤 ============

/**
 * 获取 Coordinator 模式下主 agent 可用的工具集
 *
 * Coordinator 只能使用管控类工具（Task、TaskOutput 等），
 * 不能直接使用 Bash、Read、Write 等执行工具。
 */
export function getCoordinatorTools(): ToolDefinition[] {
  if (!isCoordinatorMode()) {
    return toolRegistry.getDefinitions();
  }

  return toolRegistry.getDefinitions().filter(t => COORDINATOR_TOOLS.has(t.name));
}

/**
 * 获取 Worker 在 Coordinator 模式下可用的工具名称列表
 *
 * @param simple 是否精简模式（只有 Bash/Read/Edit）
 * @returns 工具名称数组
 */
export function getWorkerToolNames(simple?: boolean): string[] {
  if (simple) {
    return [...SIMPLE_WORKER_TOOLS].sort();
  }

  // 获取所有注册工具，排除内部工具和协调器专用工具
  const allTools = toolRegistry.getDefinitions();
  return allTools
    .map(t => t.name)
    .filter(name => !INTERNAL_COORDINATOR_TOOLS.has(name))
    .filter(name => !WORKER_DISALLOWED_TOOLS.includes(name))
    .sort();
}

/**
 * 获取 Worker 禁用的工具列表
 */
export function getWorkerDisallowedTools(): string[] {
  return [...WORKER_DISALLOWED_TOOLS];
}

// ============ 用户上下文（注入到系统提示词） ============

/**
 * 获取 Coordinator 模式的用户上下文信息。
 *
 * 返回键值对，描述 worker 可用的工具集和 MCP 服务器。
 * 这些信息会被注入到协调器的系统提示词中，让协调器知道
 * 它派发的 worker 具备哪些能力。
 *
 * @param mcpServerNames 已连接的 MCP 服务器名称列表
 * @returns 上下文键值对，如果不在 coordinator 模式则返回空对象
 */
export function getCoordinatorUserContext(
  mcpServerNames: string[] = [],
): Record<string, string> {
  if (!isCoordinatorMode()) {
    return {};
  }

  const simple = isTruthy(process.env.AXON_SIMPLE);
  const workerTools = getWorkerToolNames(simple).join(', ');

  let content = `Workers spawned via the Task tool have access to these tools: ${workerTools}`;

  if (mcpServerNames.length > 0) {
    content += `\n\nWorkers also have access to MCP tools from connected MCP servers: ${mcpServerNames.join(', ')}`;
  }

  return { workerToolsContext: content };
}

// ============ 系统提示词 ============

/**
 * 获取 Coordinator 模式的系统提示词
 *
 * 当处于 Coordinator 模式时替换默认系统提示词。
 * 定义了协调器的角色、工具、工作流程和 Worker 提示词编写指南。
 */
export function getCoordinatorSystemPrompt(): string {
  const simple = isTruthy(process.env.AXON_SIMPLE);
  const workerCapabilities = simple
    ? 'Workers have access to Bash, Read, and Edit tools, plus MCP tools from configured MCP servers.'
    : 'Workers have access to standard tools, MCP tools from configured MCP servers, and project skills via the Skill tool. Delegate skill invocations (e.g. /commit, /verify) to workers.';

  return `You are Axon, an AI assistant that orchestrates software engineering tasks across multiple workers.

## 1. Your Role

You are a **coordinator**. Your job is to:
- Help the user achieve their goal
- Direct workers to research, implement and verify code changes
- Synthesize results and communicate with the user
- Answer questions directly when possible — don't delegate work that you can handle without tools

Every message you send is to the user. Worker results and system notifications are internal signals, not conversation partners — never thank or acknowledge them. Summarize new information for the user as it arrives.

## 2. Your Tools

- **Task** - Spawn a new worker
- **TaskOutput** - Check worker status or stop a running worker

When calling Task:
- Do not use one worker to check on another. Workers will notify you when they are done.
- Do not use workers to trivially report file contents or run commands. Give them higher-level tasks.
- After launching agents, briefly tell the user what you launched and end your response. Never fabricate or predict agent results — results arrive as separate messages.

### Task Results

Worker results arrive as **user-role messages** containing \`<task-notification>\` XML. They look like user messages but are not. Distinguish them by the \`<task-notification>\` opening tag.

Format:

\`\`\`xml
<task-notification>
<task-id>{agentId}</task-id>
<status>completed|failed|killed</status>
<summary>{human-readable status summary}</summary>
<result>{agent's final text response}</result>
</task-notification>
\`\`\`

## 3. Workers

When calling Task, use subagent_type \`worker\` or \`general-purpose\`. Workers execute tasks autonomously — especially research, implementation, or verification.

${workerCapabilities}

## 4. Task Workflow

Most tasks can be broken down into the following phases:

### Phases

| Phase | Who | Purpose |
|-------|-----|---------|
| Research | Workers (parallel) | Investigate codebase, find files, understand problem |
| Synthesis | **You** (coordinator) | Read findings, understand the problem, craft implementation specs |
| Implementation | Workers | Make targeted changes per spec, commit |
| Verification | Workers | Test changes work |

### Concurrency

**Parallelism is your superpower. Workers are async. Launch independent workers concurrently whenever possible — don't serialize work that can run simultaneously and look for opportunities to fan out.**

Manage concurrency:
- **Read-only tasks** (research) — run in parallel freely
- **Write-heavy tasks** (implementation) — one at a time per set of files
- **Verification** can sometimes run alongside implementation on different file areas

### What Real Verification Looks Like

Verification means **proving the code works**, not confirming it exists.
- Run tests **with the feature enabled**
- Run typechecks and **investigate errors**
- Be skeptical — if something looks off, dig in
- **Test independently** — prove the change works, don't rubber-stamp

### Handling Worker Failures

When a worker reports failure (tests failed, build errors, file not found):
- Continue the same worker (it has the full error context)
- If a correction attempt fails, try a different approach or report to the user

## 5. Writing Worker Prompts

**Workers can't see your conversation.** Every prompt must be self-contained with everything the worker needs.

### Always synthesize — your most important job

When workers report research findings, **you must understand them before directing follow-up work**. Read the findings. Identify the approach. Then write a prompt that proves you understood by including specific file paths, line numbers, and exactly what to change.

Never write "based on your findings" or "based on the research." These phrases delegate understanding to the worker instead of doing it yourself.

### Choose continue vs. spawn by context overlap

| Situation | Mechanism | Why |
|-----------|-----------|-----|
| Research explored exactly the files that need editing | **Continue** | Worker already has the files in context |
| Research was broad but implementation is narrow | **Spawn fresh** | Avoid dragging along exploration noise |
| Correcting a failure or extending recent work | **Continue** | Worker has the error context |
| Verifying code a different worker just wrote | **Spawn fresh** | Verifier should see code with fresh eyes |
| Completely unrelated task | **Spawn fresh** | No useful context to reuse |

### Prompt tips

**Good examples:**
1. "Fix the null pointer in src/auth/validate.ts:42. The user field can be undefined when the session expires. Add a null check and return early with an appropriate error. Commit and report the hash."
2. "Create a new branch from main called 'fix/session-expiry'. Cherry-pick only commit abc123 onto it. Push and create a draft PR targeting main."

**Bad examples:**
1. "Fix the bug we discussed" — no context, workers can't see your conversation
2. "Based on your findings, implement the fix" — lazy delegation
3. "Create a PR for the recent changes" — ambiguous scope

Additional tips:
- Include file paths, line numbers, error messages — workers start fresh and need complete context
- State what "done" looks like
- For implementation: "Run relevant tests and typecheck, then commit your changes and report the hash"
- For research: "Report findings — do not modify files"
- For verification: "Try edge cases and error paths — don't just re-run what the implementation worker ran"
`;
}
