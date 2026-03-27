# AXON v2.1.85 升级蓝图

**当前状态**: AXON v2.1.50 (reverse-engineered)
**目标版本**: Official Claude Code v2.1.85
**总体范围**: 8个主要功能模块、35+个新特性、3层权限架构

---

## 📊 执行摘要

### 功能差异分析

| 模块 | AXON现状 | 官网v2.1.85 | 差异 | 优先级 |
|------|---------|----------|------|--------|
| **Hook系统** | 16 events | 24 events | +8 events | P0 |
| **Agent系统** | 基础框架 | frontmatter + 4字段 | +initialPrompt, effort, maxTurns, disallowedTools | P0 |
| **权限系统** | 基础type检查 | 3层架构 + 条件规则 + 托管策略 | 条件语法、managed-settings.json、cascade | P1 |
| **Cron/Loop** | 无 | Ralph Wiggum完整系统 | 状态机、completion_promise、迭代反馈 | P0 |
| **Context管理** | 基础压缩 | 1M窗口 + PostCompact hook + 智能摘要 | token计数优化、PostCompact事件 | P1 |
| **Memory系统** | 长期存储 | Auto-memory保存 + timestamp | YAML frontmatter、自动识别有用信息 | P1 |
| **MCP系统** | 基础集成 | RFC 9728 OAuth + Elicitation | token生命周期、protected resource metadata | P2 |
| **Worktree隔离** | 无 | 完整实现 | git worktree + sparse checkout + agent sandboxing | P1 |

---

## 🎯 P0优先级实现清单（必须先做）

### 1. Hook系统扩展 - 8个新事件

**现有状态**: 16个hook events
```
✓ PreToolUse, PostToolUse
✓ PrePromptSubmit, PostPromptSubmit
✓ Stop, StopFailure
✓ CwdChanged, FileChanged
✓ UserPromptSubmit
✓ AgentCreated, AgentResumed
✓ SessionCreated, SessionResumed
✓ TaskCreated, TaskUpdated
✓ PluginLoaded
```

**缺失的8个事件**:
```
- PostCompact       // Context压缩完成后触发
- Elicitation       // MCP请求前获取用户输入
- ElicitationResult // 用户完成Elicitation后
- WorktreeCreate    // Worktree创建时触发
- WorktreeRemove    // Worktree删除时触发
- BeforeSummarize   // Context摘要前
- AfterSummarize    // Context摘要后
- PermissionDenied  // 权限被拒时触发
```

**实现位置**: `src/hooks/index.ts`
```typescript
// 扩展HookEvent enum
export enum HookEvent {
  // 现有的16个...
  PostCompact = 'PostCompact',
  Elicitation = 'Elicitation',
  ElicitationResult = 'ElicitationResult',
  WorktreeCreate = 'WorktreeCreate',
  WorktreeRemove = 'WorktreeRemove',
  BeforeSummarize = 'BeforeSummarize',
  AfterSummarize = 'AfterSummarize',
  PermissionDenied = 'PermissionDenied',
}

// Hook类型扩展
export interface PostCompactHook {
  event: 'PostCompact';
  systemMessage?: string;
  updatedContext?: string;
}

export interface ElicitationHook {
  event: 'Elicitation';
  mcpServer: string;
  resourceName: string;
  requiredFields: string[];
  returnUrl?: string;  // 流程完成后回调URL
}
```

**工作量**: 小 (1-2天)
**风险**: 低（新增，不影响现有逻辑）

---

### 2. Agent系统 - Frontmatter 4字段扩展

**现有状态**:
```typescript
interface Agent {
  name: string;
  description: string;
  tools?: string[];
  // 其他字段...
}
```

**需要添加**:
```yaml
---
name: MyAgent
description: Does something specific
initialPrompt: "First prompt to send to agent"
effort: "small|medium|large"        # 工作量预估
maxTurns: 10                         # 最多迭代次数
disallowedTools: ["Bash", "Write"]   # 禁用的工具
---

Agent implementation here...
```

**实现步骤**:
1. 扩展 `src/agents/agent.ts` 的 Agent接口
2. 修改 `src/agents/parser.ts` 解析frontmatter YAML
3. 在 `src/agents/executor.ts` 中应用这些约束

**关键代码**:
```typescript
// src/agents/parser.ts
export interface AgentFrontmatter {
  name: string;
  description: string;
  initialPrompt?: string;
  effort?: 'small' | 'medium' | 'large';
  maxTurns?: number;
  disallowedTools?: string[];
  tools?: string[];
}

function parseAgentFrontmatter(content: string): AgentFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: 'unknown', description: '' };

  const yaml = match[1];
  // 简单YAML解析 (或使用js-yaml包)
  return {
    name: extractYamlField(yaml, 'name'),
    description: extractYamlField(yaml, 'description'),
    initialPrompt: extractYamlField(yaml, 'initialPrompt'),
    effort: extractYamlField(yaml, 'effort') as any,
    maxTurns: parseInt(extractYamlField(yaml, 'maxTurns') || '0'),
    disallowedTools: parseYamlArray(yaml, 'disallowedTools'),
  };
}
```

**工作量**: 小 (1-2天)
**风险**: 低（可向后兼容，新字段都是可选的）

---

### 3. Cron/Loop系统 - Ralph Wiggum完整实现

**这是一个自指反馈系统**，让Claude在loop中自我迭代。

**核心概念**:
```
Stop事件 → Stop Hook捕获
  ↓
检查 .claude/ralph-loop.local.md 状态文件
  ↓
如果 iteration < max_iterations 且 completion_promise未满足
  ↓
重新提交同一prompt，迭代计数+1
  ↓
Claude继续处理，再次触发Stop
  ↓
重复直到完成或达到上限
```

**实现文件结构**:
```
src/automation/
  ├── loop.ts              # Loop管理器
  ├── cron.ts              # Cron调度器
  ├── state-storage.ts     # .claude/ralph-loop.local.md管理
  └── completion-promise.ts # 完成条件检查

src/hooks/
  └── stop-hook-integration.ts # Stop hook与loop的集成
```

**状态文件格式** (`.claude/ralph-loop.local.md`):
```yaml
---
iteration: 1
max_iterations: 10
completion_promise: "✅ TASK COMPLETE"
---

your original prompt here
that will be re-submitted
on each iteration
```

**Stop Hook返回格式**:
```typescript
{
  decision: 'block',              // 阻止Claude的stop请求
  reason: 'The original prompt',  // 重新提交的prompt
  systemMessage: '🔄 Ralph iteration 2/10 | To stop: output <promise>✅ TASK COMPLETE</promise>'
}
```

**关键算法** (`src/automation/loop.ts`):
```typescript
async function continueRalphLoop(stateFile: string): Promise<boolean> {
  // 1. 解析状态文件
  const state = parseStateFile(stateFile);

  // 2. 检查是否达到上限
  if (state.iteration >= state.maxIterations) {
    deleteStateFile(stateFile);
    return false;  // Stop hook 不阻止
  }

  // 3. 检查completion_promise
  const lastAssistantMessage = getLastAssistantMessage();
  if (hasCompletionPromise(lastAssistantMessage, state.completionPromise)) {
    deleteStateFile(stateFile);
    return false;  // Stop hook 不阻止，循环结束
  }

  // 4. 更新迭代计数
  state.iteration++;
  saveStateFile(stateFile, state);

  // 5. Stop Hook阻止session exit，重新提交prompt
  return true;  // Stop hook 返回block decision
}
```

**工作量**: 中 (3-4天)
**风险**: 中 (需要仔细处理Stop Hook的阻止逻辑，避免死循环)

---

### 4. Cron任务系统 - 后台自动化调度

**存储位置**: `~/.axon/cron-jobs.json`

**数据结构**:
```typescript
interface CronJob {
  id: string;                    // 唯一ID
  cron: string;                  // 5-field cron表达式
  prompt: string;                // 要执行的prompt
  recurringEnabled: boolean;     // 是否循环
  createdAt: timestamp;
  lastRunAt?: timestamp;
  nextRunAt?: timestamp;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
}
```

**CronCreate命令**:
```bash
/cron "0 9 * * *" "Run my daily task" --recurring
/cron "30 14 * * 1-5" "Weekly meeting prep" --max-iterations 5
```

**实现位置**:
- `src/automation/cron.ts` - 主调度器
- `src/tools/cron.ts` - CronCreate/CronDelete工具

**工作量**: 中 (2-3天)
**风险**: 低 (独立子系统，隔离较好)

---

## 🔐 P1优先级实现清单（第二阶段）

### 5. 权限系统三层架构

**现有状态**: 基础type检查
**目标状态**: 条件规则 + 托管策略 + MCP OAuth

#### 第一层：条件规则引擎

**权限规则语法**:
```
Bash(git *)           // 仅允许git命令
Write(src/*)          // 仅允许写src/目录
Edit(*.ts)            // 仅允许编辑TS文件
Bash(npm:*)           // npm开头的命令
```

**实现** (`src/permissions/condition-parser.ts`):
```typescript
interface ConditionRule {
  toolName: string;           // Bash, Write, Edit, etc.
  pattern?: string;           // git *, src/*, etc.
  action: 'allow' | 'deny';
  message?: string;
}

function parseConditionRule(rule: string): ConditionRule {
  // Bash(git *) → { toolName: 'Bash', pattern: 'git *', action: 'allow' }
  const match = rule.match(/^(\w+)\(([^)]*)\)$/);
  if (!match) throw new Error(`Invalid rule: ${rule}`);

  const [, toolName, pattern] = match;
  return {
    toolName,
    pattern: pattern || '*',
    action: 'allow',
  };
}

function matchesCondition(rule: ConditionRule, context: ToolContext): boolean {
  const { toolName, pattern } = rule;

  // Tool name match
  if (toolName !== '*' && toolName !== context.toolName) return false;

  // Pattern match (glob or regex)
  if (pattern === '*') return true;

  const value = extractToolField(context);
  return matchGlobPattern(pattern, value);
}
```

#### 第二层：托管策略系统

**文件**: `~/.axon/managed-settings.json` + `~/.axon/managed-settings.d/`

```json
{
  "allowManagedHooksOnly": false,
  "allowManagedPermissionRulesOnly": false,
  "strictKnownMarketplaces": true,
  "blockedPlugins": ["dangerous-plugin"],
  "blockedMcpServers": [],
  "requiredApprovalRules": [
    "Bash(rm *)",
    "Edit(/etc/*)"
  ]
}
```

**级联规则**:
1. 组织级 (managed-settings.d/)
2. 项目级 (.axon/managed-settings.json)
3. 用户级 (~/.axon/settings.json)
→ 优先级从高到低应用

#### 第三层：MCP OAuth流程

**RFC 9728 Protected Resource Metadata**:

```typescript
interface ElicitationRequest {
  mcpServer: string;
  resourceName: string;
  requiredFields: {
    name: string;
    type: 'string' | 'secret' | 'file' | 'url';
    description: string;
  }[];
  returnUrl?: string;
}

// Elicitation Hook触发
const elicitationHook = {
  event: 'Elicitation',
  message: {
    mcpServer: 'slack-bot',
    resourceName: 'channel',
    requiredFields: [
      { name: 'channel_id', type: 'string', description: 'Slack channel ID' }
    ]
  }
};

// 用户完成后，Elicitation Result返回
const resultHook = {
  event: 'ElicitationResult',
  tokenResponse: {
    access_token: '...',
    token_type: 'Bearer',
    expires_in: 3600,
  }
};
```

**工作量**: 大 (5-7天)
**风险**: 中 (多层交互，需要充分测试)

---

### 6. Context管理优化 - 1M窗口

**现有状态**: 基础token计数和压缩
**需要优化**:

1. **PostCompact Hook集成**
```typescript
// src/context/compactor.ts
async function compactContext() {
  const compressed = await summarizeMessages();

  // 触发PostCompact Hook
  await executeHook('PostCompact', {
    originalTokens: 800000,
    compressedTokens: 200000,
    ratio: 0.25,
    summary: compressed,
  });

  return compressed;
}
```

2. **Token计数修复** (v2.1.75的bug修复)
```typescript
// 原来: thinking block计数错误
// 修复后:
function countTokens(message: Message): number {
  let count = 0;

  for (const block of message.content) {
    if (block.type === 'thinking') {
      // thinking block: count as-is (不乘以1.3)
      count += estimateTokens(block.thinking);
    } else if (block.type === 'tool_use') {
      // tool_use: input + output各自计数
      count += estimateTokens(block.input);
      count += estimateTokens(block.result);
    } else if (block.type === 'text') {
      count += estimateTokens(block.text);
    }
  }
  return count;
}
```

**工作量**: 中 (2-3天)
**风险**: 低 (incremental优化)

---

### 7. Auto-memory系统 - 自动保存有用信息

**实现** (`src/memory/auto-memory.ts`):

```typescript
async function autoMemorizeMessage(message: Message) {
  // 1. 识别"有用"的信息
  const useful = isUsefulInformation(message);
  if (!useful) return;

  // 2. 生成frontmatter
  const memory = {
    name: generateMemoryTitle(message),
    description: generateDescription(message),
    type: classifyMemoryType(message),  // user, feedback, project, reference
    lastModified: new Date().toISOString(),
  };

  // 3. 保存为YAML + Markdown
  const content = `---
name: ${memory.name}
description: ${memory.description}
type: ${memory.type}
lastModified: ${memory.lastModified}
---

${extractMemoryContent(message)}
`;

  // 4. 写入内存文件
  const memoryPath = `.claude/memory/${sanitize(memory.name)}.md`;
  await writeFile(memoryPath, content);
}
```

**启发式判断**:
- 提到"重要"、"关键"、"必须记住"的信息
- 用户显式要求"记住"
- 之前犯过的错误 (feedback类型)
- 项目决策和约束

**工作量**: 小-中 (2-3天)
**风险**: 低 (可选功能，不影响核心逻辑)

---

### 8. Worktree隔离系统 - Agent沙箱环保

**实现位置**: `src/agents/worktree.ts`

```typescript
async function createAgentWorktree(agent: Agent): Promise<Worktree> {
  // 1. 创建git worktree
  const worktreePath = `.claude/worktrees/${agent.id}`;
  await exec(`git worktree add ${worktreePath} -b ${agent.id} HEAD`);

  // 2. 可选: sparse checkout (只检出必要文件)
  if (agent.scope?.includes('files')) {
    await exec(`git sparse-checkout set ${agent.filePattern}`, { cwd: worktreePath });
  }

  // 3. 返回隔离环境
  return {
    path: worktreePath,
    branch: agent.id,
    workdir: worktreePath,
    cleanup: async () => {
      await exec(`git worktree remove ${worktreePath}`);
    }
  };
}
```

**Agent执行流程**:
```
Agent启动 → 创建worktree → 在worktree中执行 → 提交到worktree分支 → 清理worktree
```

**好处**:
- 并行agent之间不互相干扰
- Agent可以独立提交、reset、merge
- 失败时可以安全清理

**工作量**: 中 (3-4天)
**风险**: 中 (git操作，需要错误处理)

---

## 📋 完整依赖关系

```
基础 (必须先做)
├─ Hook扩展 (8个新事件)
│  ├─ PostCompact → Context优化需要
│  ├─ Elicitation → MCP OAuth需要
│  └─ WorktreeCreate/Remove → Worktree隔离需要
│
├─ Agent Frontmatter解析
│  └─ maxTurns → Ralph Loop需要
│
├─ Ralph Loop完整系统
│  ├─ 需要 Stop Hook正确实现
│  └─ 需要 Agent系统maxTurns约束
│
└─ Cron调度
   └─ 需要 Ralph Loop进行迭代

上层应用 (依赖基础完成)
├─ 权限三层架构
│  ├─ 需要 Hook系统(Elicitation, PermissionDenied)
│  └─ 需要 Agent frontmatter(disallowedTools)
│
├─ Context 1M优化
│  ├─ 需要 Hook系统(PostCompact, BeforeSummarize, AfterSummarize)
│  └─ 需要 正确的token计数
│
├─ Auto-memory
│  └─ 可独立实现
│
└─ Worktree隔离
   └─ 需要 Hook系统(WorktreeCreate, WorktreeRemove)
```

---

## ⏱️ 工作量估算

| 功能 | 工作天数 | 优先级 | 依赖 |
|------|--------|--------|------|
| Hook 8个新事件 | 1-2 | P0 | 无 |
| Agent Frontmatter 4字段 | 1-2 | P0 | Hook系统 |
| Ralph Loop完整系统 | 3-4 | P0 | Hook + Agent frontmatter |
| Cron调度系统 | 2-3 | P0 | Ralph Loop |
| **P0小计** | **8-11** | | |
| 权限三层架构 | 5-7 | P1 | Hook + Agent |
| Context 1M优化 | 2-3 | P1 | Hook系统 |
| Auto-memory | 2-3 | P1 | 无 |
| Worktree隔离 | 3-4 | P1 | Hook + Agent |
| **P1小计** | **12-17** | | |
| MCP RFC 9728 | 4-6 | P2 | Hook + 权限系统 |
| Managed policies cascade | 3-4 | P2 | 权限系统 |

**总计**: 27-42人天 (4-6周，按2人并行)

---

## 🔧 实现顺序建议

**第1周**:
1. Hook系统扩展 (✓ 完成P0基础)
2. Agent Frontmatter解析 (✓ 完成P0基础)

**第2周**:
3. Ralph Loop核心实现 (✓ 完成P0核心)
4. Cron调度基础框架

**第3周**:
5. 权限条件规则引擎第一层 (P1启动)
6. Context优化与PostCompact hook

**第4-5周**:
7. 权限托管策略第二层
8. Auto-memory自动识别
9. Worktree隔离

**第6周**:
10. MCP OAuth RFC 9728
11. 集成测试和性能基准测试

---

## ✅ 验收标准

### P0功能验收
- [ ] 8个Hook新事件都能正确触发和处理
- [ ] Agent frontmatter能正确解析和应用
- [ ] Ralph Loop能完成至少5次迭代并停止
- [ ] Cron任务能按时间表执行
- [ ] 现有功能完全向后兼容

### P1功能验收
- [ ] 权限规则能正确匹配Bash、Write、Edit命令
- [ ] Context压缩时能成功触发PostCompact Hook
- [ ] Auto-memory能识别并保存"有用信息"
- [ ] Agent在worktree中隔离执行不相互影响

### 性能指标
- [ ] Hook触发延迟 < 100ms
- [ ] Ralph Loop迭代间延迟 < 500ms
- [ ] Cron任务不阻塞主loop
- [ ] Context压缩提高30%以上空间利用率

---

## 🚨 风险和缓解

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|--------|
| Ralph Loop死循环 | 中 | 高 | max_iterations硬限制，超时自动停止 |
| Hook调用顺序不确定 | 中 | 中 | 明确定义Hook执行顺序，添加依赖检查 |
| 权限规则冲突 | 中 | 中 | 定义优先级规则，unit test覆盖冲突场景 |
| Worktree cleanup失败 | 低 | 中 | 添加垃圾清理脚本，记录日志 |
| MCP OAuth token过期 | 中 | 低 | 自动refresh机制，用户通知 |

---

## 📚 参考资源

**官方源码位置**:
- `/tmp/claude-code-latest/plugins/ralph-wiggum/` - Ralph Loop完整实现
- `/tmp/claude-code-latest/plugins/hookify/` - 权限规则引擎
- `/tmp/claude-code-latest/CHANGELOG.md` - 完整更新日志

**AXON当前相关文件**:
- `src/hooks/index.ts` - Hook系统核心
- `src/agents/` - Agent执行框架
- `src/permissions/` - 权限系统框架
- `src/context/` - Context管理
- `src/memory/` - Memory存储

---

## 🚀 下一步行动

1. **审核此蓝图** - 确认优先级和依赖关系
2. **创建详细任务** - 为每个模块创建具体的实现任务
3. **建立测试框架** - 在开始编码前准备单元测试骨架
4. **启动P0实现** - 并行开始Hook和Agent frontmatter

