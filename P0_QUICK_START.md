# AXON P0功能快速启动指南

> 基于Claude Code v2.1.85官方源码的深度分析，这是可立即执行的P0功能清单

---

## 🎯 4大P0功能，4-6周完成

### 1️⃣ Hook系统：+8个新事件（1-2天）

**文件**: `src/hooks/index.ts`

**具体改动**:
```typescript
// 在HookEvent enum中添加
export enum HookEvent {
  // 现有的16个...
  PostCompact = 'PostCompact',           // ← 新增
  Elicitation = 'Elicitation',           // ← 新增
  ElicitationResult = 'ElicitationResult', // ← 新增
  WorktreeCreate = 'WorktreeCreate',     // ← 新增
  WorktreeRemove = 'WorktreeRemove',     // ← 新增
  BeforeSummarize = 'BeforeSummarize',   // ← 新增
  AfterSummarize = 'AfterSummarize',     // ← 新增
  PermissionDenied = 'PermissionDenied', // ← 新增
}

// 为每个事件定义TypeScript interface
export interface PostCompactHook extends BaseHook {
  event: 'PostCompact';
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
}

export interface WorktreeCreateHook extends BaseHook {
  event: 'WorktreeCreate';
  worktreePath: string;
  branch: string;
  agentId?: string;
}

// ... 其他7个类似定义
```

**验收**: 运行 `npm test` 确保所有HookEvent枚举值都被识别

---

### 2️⃣ Agent Frontmatter：+4个关键字段（1-2天）

**文件**: `src/agents/parser.ts`

**解析逻辑**:
```typescript
export interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  // ↓ 新增4个字段
  initialPrompt?: string;              // Agent启动时的初始prompt
  effort?: 'small' | 'medium' | 'large'; // 工作量估算
  maxTurns?: number;                   // 最多迭代次数
  disallowedTools?: string[];          // 禁用的工具列表
}

// 解析实现
function parseAgentFrontmatter(content: string): AgentFrontmatter {
  // YAML格式: name: value
  const frontmatter = extractFrontmatter(content); // ---...---

  return {
    name: frontmatter['name'] || 'unknown',
    description: frontmatter['description'] || '',
    initialPrompt: frontmatter['initialPrompt'],
    effort: frontmatter['effort'], // 可选
    maxTurns: parseInt(frontmatter['maxTurns'] || '0'),
    disallowedTools: parseArray(frontmatter['disallowedTools']),
  };
}
```

**测试用例**:
```markdown
---
name: CodeReview
description: Performs code review on PRs
initialPrompt: "Please review this code for bugs and style issues"
effort: medium
maxTurns: 5
disallowedTools: ["Bash", "Write"]
---

// Agent code here
```

---

### 3️⃣ Ralph Wiggum Loop：自指迭代系统（3-4天）

**核心概念**: Claude在 Stop 事件时被 Hook 拦截，重新提交同一 prompt，以实现自迭代。

**三个关键文件**:

#### a) 状态文件格式 (`.claude/ralph-loop.local.md`)
```yaml
---
iteration: 1
max_iterations: 10
completion_promise: "✅ Task completed successfully"
---

Original prompt that gets re-submitted:
Please do something until you output <promise>✅ Task completed successfully</promise>
```

**YAML字段**:
- `iteration`: 当前迭代数 (1-indexed)
- `max_iterations`: 最大迭代数，达到后自动停止
- `completion_promise`: 完成标记，Claude输出这个文本时loop结束

#### b) Stop Hook处理逻辑 (`src/hooks/stop-hook-handler.ts`)
```typescript
async function handleStopHook(context: StopHookContext): Promise<HookResponse> {
  const stateFile = '.claude/ralph-loop.local.md';

  // 1. 检查是否存在ralph-loop
  if (!fileExists(stateFile)) {
    return { decision: 'allow' }; // 正常exit
  }

  // 2. 解析状态文件
  const state = parseStateFile(stateFile);
  const { iteration, max_iterations, completion_promise } = state;

  // 3. 达到上限？
  if (iteration >= max_iterations) {
    deleteFile(stateFile);
    return { decision: 'allow' };
  }

  // 4. 检查completion_promise是否满足
  const lastMessage = context.lastAssistantMessage;
  if (lastMessage.includes(`<promise>${completion_promise}</promise>`)) {
    deleteFile(stateFile);
    return { decision: 'allow' };
  }

  // 5. 继续loop：阻止exit，重新提交prompt
  const nextIteration = iteration + 1;
  updateStateFile(stateFile, { iteration: nextIteration });

  const originalPrompt = extractPromptFromStateFile(stateFile);
  const systemMsg = `🔄 Ralph iteration ${nextIteration}/${max_iterations} | To stop: output <promise>${completion_promise}</promise>`;

  return {
    decision: 'block',                    // 阻止Claude的stop请求
    reason: originalPrompt,               // 重新提交这个prompt
    systemMessage: systemMsg,             // 显示迭代计数
  };
}
```

#### c) 用户命令 (`/ralph-loop` skill)
```bash
# 启动一个10轮迭代，等待<promise>完成标记
/ralph-loop "Do something iteratively" --max-iterations 10 --promise "✅ Done"

# 执行流程：
# 1. 创建 .claude/ralph-loop.local.md 状态文件
# 2. 提交prompt给Claude
# 3. Claude处理，触发Stop
# 4. Stop Hook检查promise → 未满足
# 5. Stop Hook阻止exit，重新提交prompt
# 6. 回到第3步，直到promise满足或达到max_iterations
```

---

### 4️⃣ Cron任务系统：后台自动化（2-3天）

**三个部分**:

#### a) 数据存储 (`~/.axon/cron-jobs.json`)
```json
{
  "jobs": [
    {
      "id": "job-001",
      "cron": "0 9 * * *",
      "prompt": "Run daily standup report",
      "recurring": true,
      "maxIterations": 5,
      "status": "scheduled",
      "createdAt": "2026-03-27T10:00:00Z",
      "nextRunAt": "2026-03-28T09:00:00Z"
    }
  ]
}
```

#### b) CronCreate工具 (`src/tools/cron.ts`)
```typescript
interface CronCreateInput {
  cron: string;        // "0 9 * * 1-5" (weekdays at 9am)
  prompt: string;      // Task description
  recurring?: boolean; // Default: true
  maxIterations?: number; // Default: 0 (infinite)
}

interface CronCreateOutput {
  jobId: string;
  nextRun: string;
  message: string;
}

async function cronCreate(input: CronCreateInput): Promise<CronCreateOutput> {
  // 1. 验证cron表达式 (使用 cron-parser 库)
  const schedule = parseCron(input.cron);

  // 2. 创建job记录
  const job = {
    id: generateId(),
    cron: input.cron,
    prompt: input.prompt,
    recurring: input.recurring ?? true,
    status: 'scheduled',
    createdAt: new Date(),
    nextRunAt: schedule.next(),
  };

  // 3. 保存到 ~/.axon/cron-jobs.json
  const jobs = loadCronJobs();
  jobs.push(job);
  saveCronJobs(jobs);

  return {
    jobId: job.id,
    nextRun: job.nextRunAt.toISOString(),
    message: `✅ Cron job scheduled: ${input.cron}`,
  };
}
```

#### c) CronExecutor后台进程 (`src/automation/cron-executor.ts`)
```typescript
// 在主loop中周期性调用
async function executeDueCronJobs() {
  const now = new Date();
  const jobs = loadCronJobs();

  for (const job of jobs) {
    if (job.nextRunAt <= now && job.status === 'scheduled') {
      // 提交job的prompt
      await submitPromptToAI(job.prompt);

      // 更新下一次运行时间
      const nextRun = parseCron(job.cron).next();
      updateJobNextRun(job.id, nextRun);
    }
  }
}

// 在loop初始化时启动
setInterval(() => executeDueCronJobs(), 60000); // 每分钟检查一次
```

---

## 📊 依赖顺序

```
开发顺序 (必须按序进行):
1. Hook扩展 (必须先有这8个事件)
   ↓
2. Agent Frontmatter (maxTurns字段被Ralph Loop需要)
   ↓
3. Ralph Loop (需要Stop Hook的PostCompact/Elicitation)
   ↓
4. Cron系统 (可基于Ralph Loop实现)
```

---

## ✅ 每日进度检查清单

### 第1-2天：Hook系统
- [ ] 添加8个新HookEvent枚举值
- [ ] 为每个事件定义TypeScript interface
- [ ] 修改Hook执行器识别新事件
- [ ] 编写单元测试确保所有事件能触发
- [ ] `npm test` 全绿

### 第3-4天：Agent Frontmatter
- [ ] 解析YAML frontmatter的逻辑
- [ ] 在Agent类中应用initialPrompt、effort、maxTurns、disallowedTools
- [ ] 在AgentExecutor中检查disallowedTools（如果包含某工具，阻止使用）
- [ ] 编写测试用例，特别是maxTurns的强制限制
- [ ] 验证现有agents仍能工作（向后兼容）

### 第5-7天：Ralph Loop
- [ ] 实现状态文件解析 (`.claude/ralph-loop.local.md`)
- [ ] 在Stop Hook中添加ralph-loop检查逻辑
- [ ] 实现completion_promise精确匹配 (使用Perl正则处理multiline)
- [ ] 添加max_iterations硬限制和超时保护
- [ ] 创建/ralph-loop命令和完整测试
- [ ] **关键**: 写详细注释，这部分逻辑复杂

### 第8-9天：Cron系统
- [ ] 定义CronJob数据结构
- [ ] 实现CronCreate和CronDelete工具
- [ ] 实现后台CronExecutor (setInterval)
- [ ] 解决时区问题（cron表达式使用本地时区）
- [ ] 添加job持久化和恢复逻辑

---

## 🔍 代码参考源

**官方实现位置**（参考用）:
```
Ralph Wiggum完整实现:
  /tmp/claude-code-latest/plugins/ralph-wiggum/
  ├─ README.md          # 完整文档
  ├─ hooks/stop-hook.sh # Stop Hook的参考实现（bash）
  └─ scripts/setup-ralph-loop.sh

Hook系统文档:
  /tmp/claude-code-latest/plugins/plugin-dev/
  └─ skills/hook-development/SKILL.md

权限规则引擎:
  /tmp/claude-code-latest/plugins/hookify/
  ├─ core/rule_engine.py
  └─ matchers/
```

**AXON现有相关代码**:
```
src/hooks/index.ts          # Hook系统核心
src/agents/executor.ts      # Agent执行器
src/agents/parser.ts        # Agent解析器
src/permissions/index.ts    # 权限检查
src/tools/registry.ts       # 工具注册
```

---

## 🚨 常见陷阱

❌ **不要**在开始前等待其他功能完成
✅ **应该**并行开发Hook和Agent Frontmatter

❌ **不要**忽视maxTurns的强制执行
✅ **应该**在第5轮时强制停止，即使Claude没有调用stop

❌ **不要**使用简单的字符串匹配检查completion_promise
✅ **应该**使用<promise>标签包装的精确匹配

❌ **不要**让ralph-loop状态文件包含敏感信息
✅ **应该**只存储iteration计数和promise文本

❌ **不要**在Hook执行器中做耗时操作（会阻塞主loop）
✅ **应该**用异步处理或队列系统

---

## 📈 性能目标

| 指标 | 目标 |
|------|------|
| Hook触发延迟 | < 100ms |
| Ralph Loop迭代间延迟 | < 500ms |
| Cron check per minute | < 10ms |
| 状态文件I/O | < 50ms |

如果超过这些，需要优化：
- Hook执行改为异步
- 状态文件改用内存缓存
- Cron检查间隔增加

---

## 🎓 学习资源

推荐阅读顺序：
1. `/tmp/claude-code-latest/CHANGELOG.md` - 全局概览
2. `/tmp/claude-code-latest/plugins/ralph-wiggum/README.md` - Ralph Loop详解
3. `/tmp/claude-code-latest/plugins/ralph-wiggum/hooks/stop-hook.sh` - 核心实现参考
4. `AXON_v2.1.85_UPGRADE_BLUEPRINT.md` - 整体架构
5. 本文档 - 快速启动

---

**预计P0完成时间**: 4-6周（2人并行，包括充分测试）

立即开始！🚀

