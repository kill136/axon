# AXON v2.1.85 完整实施路线图

**基础**: 5个Agent深度分析 + 官方Claude Code源码 + AXON现有架构
**目标**: 从v2.1.50升级至v2.1.85的可执行实施计划

---

## 📊 总体工作量估算

| 阶段 | 功能模块 | 工作人日 | 周期 | 风险 |
|------|---------|---------|------|------|
| **P0基础** | Hook + Agent + Ralph Loop + Cron | 32-44 | 4-6周 | 低-中 |
| **P1核心** | 权限系统 + Context优化 + Memory + Worktree | 42-58 | 5-7周 | 中 |
| **P2扩展** | MCP OAuth + 自动化编排 | 20-30 | 2-3周 | 中-高 |
| **集成测试** | E2E + 性能 + 兼容性 | 15-25 | 2-3周 | 低 |
| **总计** | | **109-157人日** | **13-19周** | **中** |

**并行优化**: Hook和权限可同步进行，能压缩到 **10-13周**

---

## 🎯 优先级清单 (按执行顺序)

### **第1阶段: P0 Hook系统基础** (Week 1-2)

#### Task 1.1: Hook系统扩展 - 8个新事件
**文件**: `src/hooks/index.ts`
**工作量**: 1人日

```typescript
// 添加到HookEvent enum
+ PostCompact = 'PostCompact'
+ Elicitation = 'Elicitation'
+ ElicitationResult = 'ElicitationResult'
+ WorktreeCreate = 'WorktreeCreate'
+ WorktreeRemove = 'WorktreeRemove'
+ BeforeSummarize = 'BeforeSummarize'
+ AfterSummarize = 'AfterSummarize'
+ PermissionDenied = 'PermissionDenied'

// 为每个事件定义对应的interface
export interface PostCompactHook { ... }
export interface ElicitationHook { ... }
// ...等8个
```

**验收**: `npm test` 通过所有Hook相关测试

---

#### Task 1.2: Agent Frontmatter解析 - 4个新字段
**文件**: `src/agents/parser.ts`, `src/agents/executor.ts`
**工作量**: 2人日

```yaml
# 支持的frontmatter格式
---
name: MyAgent
description: Does something
initialPrompt: "First prompt..."    # 新增
effort: "medium"                    # 新增: small|medium|large
maxTurns: 10                        # 新增: 迭代次数限制
disallowedTools: ["Bash", "Write"]  # 新增: 禁用工具列表
---

Agent code here...
```

**关键实现**:
- 解析YAML frontmatter
- 应用maxTurns到Agent执行循环
- 在工具调用前检查disallowedTools黑名单
- 在Agent启动时注入initialPrompt

**验收**:
- [ ] Agent能正确解析frontmatter
- [ ] maxTurns达到时强制停止（第5轮时停止）
- [ ] disallowedTools能有效阻止工具调用
- [ ] initialPrompt在Agent启动时注入
- [ ] 现有agents仍能工作（向后兼容）

---

### **第2阶段: P0 自指循环系统** (Week 3-4)

#### Task 2.1: Ralph Loop停止Hook处理
**文件**: `src/hooks/handlers/stop-hook-handler.ts` (新建)
**工作量**: 3人日
**关键参考**: `/tmp/claude-code-latest/plugins/ralph-wiggum/hooks/stop-hook.sh`

```typescript
// 状态文件: .claude/ralph-loop.local.md
// ---
// iteration: 1
// max_iterations: 10
// completion_promise: "✅ TASK COMPLETE"
// ---
// Original prompt to be re-submitted

async function handleStopHookForRalphLoop(context: StopHookContext) {
  const stateFile = '.claude/ralph-loop.local.md';

  // 1. 检查ralph-loop是否活跃
  if (!fileExists(stateFile)) {
    return { decision: 'allow' };  // 正常exit
  }

  // 2. 解析状态文件
  const state = parseStateFile(stateFile);
  const { iteration, max_iterations, completion_promise } = state;

  // 3. 达到迭代上限？
  if (iteration >= max_iterations) {
    deleteFile(stateFile);
    return { decision: 'allow' };
  }

  // 4. 检查completion_promise（使用精确匹配，不是模糊）
  const lastMessage = context.lastAssistantMessage;
  const promiseTag = `<promise>${completion_promise}</promise>`;

  if (lastMessage.includes(promiseTag)) {
    deleteFile(stateFile);
    return { decision: 'allow' };
  }

  // 5. 继续loop：阻止exit，重新提交prompt
  const nextIteration = iteration + 1;
  updateStateFile(stateFile, { iteration: nextIteration });

  const prompt = extractPromptFromStateFile(stateFile);
  const systemMsg = `🔄 Ralph iteration ${nextIteration}/${max_iterations} | To stop: output <promise>${completion_promise}</promise>`;

  return {
    decision: 'block',
    reason: prompt,
    systemMessage: systemMsg,
  };
}
```

**关键算法**:
- 使用Perl regex处理multiline的promise标签: `perl -0777 -pe 's/.*?<promise>(.*?)<\/promise>.*/$1/s'`
- 迭代计数必须是整数，并且 < max_iterations
- 状态文件应该原子更新（使用temp file + mv）
- completion_promise使用字面匹配（不是模式匹配）

**验收**:
- [ ] 基本循环：prompt → Claude → Stop → 重新提交 → 循环
- [ ] 迭代计数正确递增
- [ ] 第N次迭代时显示"Ralph iteration N/max"
- [ ] Promise精确匹配（不超匹配）
- [ ] max_iterations硬限制（第10次时强制停止）
- [ ] 清理状态文件

---

#### Task 2.2: /ralph-loop命令实现
**文件**: `src/tools/ralph-loop.ts` 或 `src/skills/ralph-loop.ts` (新建)
**工作量**: 2人日

```typescript
interface RalphLoopInput {
  prompt: string;                    // 要迭代的任务prompt
  maxIterations?: number;            // 默认: 10
  completionPromise?: string;        // 完成标记，默认: "✅ TASK COMPLETE"
}

async function ralphLoop(input: RalphLoopInput): Promise<string> {
  // 1. 创建状态文件 .claude/ralph-loop.local.md
  const state = {
    iteration: 1,
    max_iterations: input.maxIterations || 10,
    completion_promise: input.completionPromise || '✅ TASK COMPLETE',
  };

  const stateFile = '.claude/ralph-loop.local.md';
  saveStateFile(stateFile, state, input.prompt);

  // 2. 提交prompt给Claude
  await submitPromptToAI(input.prompt);

  // 3. Stop Hook会自动处理循环
  // (不需要这里做什么，Hook会阻止exit并重新提交)

  return {
    status: 'started',
    message: `🔄 Ralph loop started with max ${input.maxIterations || 10} iterations`,
  };
}
```

**使用方式**:
```bash
/ralph-loop "Refactor this code until you output <promise>✅ REFACTORING COMPLETE</promise>" --max-iterations 5 --promise "✅ REFACTORING COMPLETE"
```

**验收**:
- [ ] 命令能正确创建状态文件
- [ ] 命令能解析promise参数
- [ ] 命令能提交初始prompt
- [ ] Stop Hook能识别并处理ralph-loop

---

### **第3阶段: P0 Cron自动化系统** (Week 4-5)

#### Task 3.1: Cron任务存储和调度
**文件**: `src/automation/cron-scheduler.ts` (新建)
**工作量**: 3人日

```typescript
interface CronJob {
  id: string;
  cron: string;              // "0 9 * * 1-5"
  prompt: string;
  recurring: boolean;
  maxIterations?: number;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  nextRunAt: Date;
  lastRunAt?: Date;
}

// ~/.axon/cron-jobs.json
{
  "jobs": [
    {
      "id": "job-001",
      "cron": "0 9 * * 1-5",
      "prompt": "Run daily standup",
      "recurring": true,
      "status": "scheduled",
      "createdAt": "2026-03-27T10:00:00Z",
      "nextRunAt": "2026-03-28T09:00:00Z"
    }
  ]
}

class CronScheduler {
  // 启动后台调度
  start() {
    this.checkInterval = setInterval(() => this.executeUpcomingJobs(), 60000);
  }

  // 检查并执行到期的任务
  async executeUpcomingJobs() {
    const jobs = loadCronJobs();
    const now = new Date();

    for (const job of jobs) {
      if (job.nextRunAt <= now && job.status === 'scheduled') {
        await this.executeJob(job);
      }
    }
  }

  // 执行单个任务
  async executeJob(job: CronJob) {
    job.status = 'running';
    saveCronJobs();

    try {
      // 提交prompt给Claude
      await submitPromptToAI(job.prompt);

      job.lastRunAt = new Date();
      job.status = job.recurring ? 'scheduled' : 'completed';

      // 计算下一次运行时间
      if (job.recurring) {
        job.nextRunAt = this.computeNextRunTime(job.cron);
      }
    } catch (error) {
      job.status = 'failed';
      // 记录错误
    }

    saveCronJobs();
  }

  // 计算下一次运行时间 (使用cron-parser库)
  computeNextRunTime(cronExpr: string): Date {
    const interval = new CronExpression(cronExpr);
    return interval.getNextDate();
  }
}
```

**关键实现**:
- 使用 `cron-parser` npm包解析cron表达式
- 后台每分钟检查一次到期的任务
- 任务执行时使用同样的prompt提交机制
- 支持recurring和maxIterations

**验收**:
- [ ] Cron表达式能正确解析
- [ ] 任务按时执行
- [ ] 循环任务正确计算nextRunAt
- [ ] 任务状态正确记录
- [ ] 后台调度不阻塞主loop

---

#### Task 3.2: CronCreate和CronDelete工具
**文件**: `src/tools/cron.ts` (新建)
**工作量**: 1人日

```typescript
interface CronCreateInput {
  cron: string;
  prompt: string;
  recurring?: boolean;
  maxIterations?: number;
}

async function cronCreate(input: CronCreateInput): Promise<void> {
  const job = {
    id: generateId(),
    cron: input.cron,
    prompt: input.prompt,
    recurring: input.recurring ?? true,
    status: 'scheduled',
    createdAt: new Date(),
    nextRunAt: parseNextRunTime(input.cron),
  };

  const jobs = loadCronJobs();
  jobs.push(job);
  saveCronJobs(jobs);

  return {
    jobId: job.id,
    nextRun: job.nextRunAt.toISOString(),
  };
}

async function cronDelete(jobId: string): Promise<void> {
  const jobs = loadCronJobs();
  const filtered = jobs.filter(j => j.id !== jobId);
  saveCronJobs(filtered);

  return { message: 'Job deleted' };
}
```

**使用方式**:
```bash
/cron-create --cron "0 9 * * 1-5" --prompt "Daily standup"
/cron-delete job-001
```

**验收**:
- [ ] CronCreate能创建任务
- [ ] CronDelete能删除任务
- [ ] 任务持久化到~/.axon/cron-jobs.json

---

### **第4阶段: P1 权限系统三层** (Week 5-7, 与P0并行可能)

#### Task 4.1: 条件规则引擎第一层
**文件**: `src/permissions/condition-parser.ts`, `src/permissions/condition-evaluator.ts` (新建)
**工作量**: 4人日
**参考**: `/tmp/claude-code-latest/plugins/hookify/core/rule_engine.py`

**权限规则语法**:
```
Bash(git *)           # 允许git开头的bash命令
Write(src/*)          # 允许写入src/目录的文件
Edit(*.ts)            # 允许编辑TS文件
Bash(npm:*)           # 允许npm开头的命令
```

```typescript
interface ConditionRule {
  toolName: string;        // Bash, Write, Edit, etc.
  pattern?: string;        // git *, src/*, etc.
  action: 'allow' | 'deny';
  priority?: number;       // deny > ask > allow
}

class ConditionEvaluator {
  // 解析规则: "Bash(git *)" → { toolName: 'Bash', pattern: 'git *' }
  parseRule(rule: string): ConditionRule {
    const match = rule.match(/^(\w+)\(([^)]*)\)$/);
    if (!match) throw new Error(`Invalid rule: ${rule}`);

    return {
      toolName: match[1],
      pattern: match[2] || '*',
      action: 'allow',
    };
  }

  // 检查规则是否匹配
  matchesRule(rule: ConditionRule, toolName: string, value: string): boolean {
    // Tool name match
    if (rule.toolName !== '*' && rule.toolName !== toolName) {
      return false;
    }

    // Pattern match (glob)
    if (rule.pattern === '*') return true;

    return this.matchGlobPattern(rule.pattern, value);
  }

  // Glob匹配: "git *" 匹配 "git clone", "git pull" 等
  matchGlobPattern(pattern: string, text: string): boolean {
    const regex = this.globToRegex(pattern);
    return regex.test(text);
  }

  // glob → regex: "git *" → /^git .*/
  globToRegex(glob: string): RegExp {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${regex}$`);
  }
}
```

**关键特性**:
- 支持glob模式匹配 (`*`, `?`)
- 优先级处理 (deny > ask > allow)
- 缓存编译的regex (~90% 性能提升)

**验收**:
- [ ] 规则解析正确
- [ ] Glob模式匹配准确
- [ ] 支持全通配符 `*`
- [ ] 性能达标 (< 20ms)

---

#### Task 4.2: 托管策略系统第二层
**文件**: `src/permissions/managed-policies.ts` (新建)
**工作量**: 2人日

```typescript
interface ManagedPolicy {
  allowManagedHooksOnly: boolean;
  allowManagedPermissionRulesOnly: boolean;
  blockedPlugins: string[];
  blockedMcpServers: string[];
  strictKnownMarketplaces: boolean;
}

class ManagedPolicyManager {
  // 级联加载: 系统 → 项目 → 用户
  loadPolicies(): ManagedPolicy {
    let merged = defaultPolicy;

    // 1. 项目级
    if (fileExists('.axon/managed-settings.json')) {
      merged = mergePolicy(merged, loadJSON('.axon/managed-settings.json'));
    }

    // 2. 用户级
    if (fileExists('~/.axon/managed-settings.json')) {
      merged = mergePolicy(merged, loadJSON('~/.axon/managed-settings.json'));
    }

    return merged;
  }

  // 检查是否允许：规则优先级 deny > ask > allow
  checkPermission(request: ToolRequest): 'allow' | 'ask' | 'deny' {
    const policy = this.loadPolicies();

    // 如果启用了strictKnownMarketplaces，未知插件被拒绝
    if (policy.strictKnownMarketplaces && !isKnownPlugin(request.plugin)) {
      return 'deny';
    }

    // 检查黑名单
    if (policy.blockedPlugins.includes(request.plugin)) {
      return 'deny';
    }

    // 默认
    return 'allow';
  }
}
```

**验收**:
- [ ] 能正确加载managed-settings.json
- [ ] 策略级联合并正确
- [ ] 黑名单有效
- [ ] strictKnownMarketplaces生效

---

#### Task 4.3: MCP OAuth RFC 9728第三层 (P2, 可后期实现)
**文件**: `src/permissions/mcp-oauth.ts` (新建)
**工作量**: 5人日 (P2)
**关键**: 相对独立，可延后

---

### **第5阶段: P1 Context和Memory系统** (Week 6-8)

#### Task 5.1: 统一Context生命周期管理
**文件**: `src/context/unified-context.ts` (新建)
**工作量**: 3人日
**参考**: Context压缩和Memory系统Agent报告

**核心概念**:
```
Phase 1: INIT (5-10K tokens)
  └─ System prompt + tools + skills + memory

Phase 2: GROWTH (10-80%, Turn 1-150)
  └─ 对话积累，监控context使用

Phase 3: CRITICAL (80-98%, Turn 150-200)
  └─ 显示警告，用户可手动/compact
  └─ 自动压缩 (触发PostCompact Hook)

Phase 4: POST-COMPACT (15%, Turn 200+)
  └─ 循环继续，可再次压缩
```

```typescript
class UnifiedContextManager {
  // 监控context大小
  async monitorContext() {
    const tokens = estimateTokens(this.messages);
    const ratio = tokens / 1_000_000;  // 1M window

    if (ratio > 0.98) {
      // 硬限制：自动压缩
      await this.compactContext();
    } else if (ratio > 0.80) {
      // 软限制：显示警告
      this.showWarning(`Context usage: ${Math.round(ratio * 100)}%`);
    }
  }

  // 压缩context
  async compactContext() {
    // 1. 调用summarizer压缩消息
    const compressed = await summarizeMessages(this.messages);

    // 2. 触发PostCompact Hook
    await executeHook('PostCompact', {
      originalTokens: estimateTokens(this.messages),
      compressedTokens: estimateTokens(compressed),
      ratio: compressed.length / this.messages.length,
    });

    // 3. 替换消息
    this.messages = compressed;
  }

  // 更准确的token计数 (v2.1.75修复)
  estimateTokens(messages: Message[]): number {
    let count = 0;

    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          count += block.text.length / 4;  // 平均1token=4字符
        } else if (block.type === 'thinking') {
          // v2.1.75修复: 不乘以1.5系数
          count += block.thinking.length / 4 + 50;  // overhead
        } else if (block.type === 'tool_use') {
          // v2.1.75修复: 不乘以1.3系数
          count += estimateTokens(block.input) + estimateTokens(block.result);
        }
      }
    }

    return count;
  }
}
```

**关键修复** (v2.1.75):
- Thinking block: 移除1.5x系数 → +18-20% 实际容量
- Tool_use block: 移除1.3x系数 → 更准确的计数

**验收**:
- [ ] Context大小监控正确
- [ ] 自动压缩在98%时触发
- [ ] PostCompact Hook被正确调用
- [ ] Token计数与官方一致（±5%）

---

#### Task 5.2: Auto-Memory自动保存系统
**文件**: `src/memory/auto-memory.ts` (新建)
**工作量**: 3人日

**识别有用信息的启发式**:
```
权重评分:
- 代码块 (>20行) = 0.9
- 架构/设计 (>500字符) = 0.85
- 错误分析 (bug fix) = 0.8
- 文档 (>1000字符) = 0.7
- 配置密钥 = 0.0 (不保存，安全问题)

触发条件: score > 0.7 且非配置密钥
```

```typescript
class AutoMemoryManager {
  // 识别有用信息
  isUsefulInformation(message: Message): boolean {
    let score = 0;

    for (const block of message.content) {
      if (block.type === 'code') {
        // 代码块：>20行
        const lines = block.code.split('\n').length;
        if (lines > 20) score += 0.9;
      } else if (block.type === 'text') {
        const text = block.text;

        // 关键字: "架构", "设计", "流程"
        if (/架构|设计|流程|方案/.test(text)) score += 0.85;

        // 错误分析: "bug", "fix", "问题"
        if (/bug|fix|问题|错误|原因/.test(text)) score += 0.8;

        // 长文档: >1000字符
        if (text.length > 1000) score += 0.7;
      }
    }

    return score > 0.7;
  }

  // 生成memory frontmatter
  generateFrontmatter(message: Message) {
    return {
      id: generateId(),
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
      type: this.classifyType(message),  // code_snippet|design_doc|bug_analysis
      scope: 'session',  // 可后期改为project|user
      tags: this.extractTags(message),
    };
  }

  // 保存memory
  async saveMemory(message: Message) {
    if (!this.isUsefulInformation(message)) return;

    const frontmatter = this.generateFrontmatter(message);
    const content = this.extractContent(message);

    const yaml = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const memoryFile = `.claude/memory/${frontmatter.id}.md`;
    await writeFile(memoryFile, `---\n${yaml}\n---\n\n${content}`);
  }
}
```

**freshness策略**:
- < 3天: HIGH (95% 自动注入)
- 3-14天: MEDIUM (60% 话题相关时注入)
- 14-90天: LOW (20% 仅@mention时)
- > 90天: STALE (5% 搜索只)

**验收**:
- [ ] 能正确识别有用信息
- [ ] Memory文件格式正确
- [ ] last_modified时间戳正确
- [ ] freshness策略生效

---

### **第6阶段: P1 Worktree隔离系统** (Week 7-8)

#### Task 6.1: Worktree隔离管理
**文件**: `src/worktree/worktree-manager.ts` (新建)
**工作量**: 4人日
**参考**: Worktree隔离架构和性能优化设计Agent报告

```typescript
interface WorktreeConfig {
  path: string;
  branch: string;
  agentId: string;
  sparse?: string[];  // 可选: 只检出这些路径
  timeout?: number;   // 默认: 3600s
}

class WorktreeManager {
  // 创建worktree
  async createWorktree(config: WorktreeConfig): Promise<Worktree> {
    const { path, branch, agentId, sparse } = config;

    // 1. 创建git worktree
    await exec(`git worktree add ${path} -b ${branch} HEAD`);

    // 2. 可选: sparse checkout
    if (sparse && sparse.length > 0) {
      await exec(`git sparse-checkout set ${sparse.join(' ')}`, { cwd: path });
    }

    // 3. 触发WorktreeCreate Hook
    await executeHook('WorktreeCreate', {
      worktreePath: path,
      branch: branch,
      agentId: agentId,
    });

    return new Worktree(path, branch, agentId);
  }

  // 清理worktree
  async removeWorktree(path: string) {
    // 1. 触发WorktreeRemove Hook
    await executeHook('WorktreeRemove', { worktreePath: path });

    // 2. 删除worktree
    await exec(`git worktree remove ${path}`);
  }

  // 检测stale worktrees并清理
  async cleanupStaleWorktrees(maxAge: number = 86400) {
    // 列出所有worktrees
    const worktrees = await this.listWorktrees();

    for (const wt of worktrees) {
      const age = (new Date() - wt.createdAt) / 1000;
      if (age > maxAge) {
        await this.removeWorktree(wt.path);
      }
    }
  }
}
```

**性能优化** (参考官方v2.1.76+):
- 启动时间: 300-800ms → 50-150ms (-70-80%)
- Token节省: 90% (14K → 1.6K tokens)
- 并发能力: 10-15 → 100+ worktrees

**验收**:
- [ ] Worktree能正确创建
- [ ] Sparse checkout生效
- [ ] Hook触发时机正确
- [ ] Cleanup不破坏repo
- [ ] 性能达到目标

---

### **第7阶段: 集成测试和优化** (Week 9-10)

#### Task 7.1: 集成测试套件
**文件**: `tests/integration/` (新建)
**工作量**: 4人日

覆盖范围:
```
- Hook系统: 8个新事件都能触发和处理
- Agent: maxTurns强制停止, frontmatter解析
- Ralph Loop: 完整迭代流程, promise检测
- Cron: 任务按时执行, 状态正确
- 权限: 规则匹配, 策略级联
- Context: 压缩触发, PostCompact Hook
- Memory: 自动保存, freshness策略
- Worktree: 创建/清理, Hook触发

目标: >= 85% 代码覆盖率
```

**验收**:
- [ ] 所有集成测试通过
- [ ] 代码覆盖率 >= 85%
- [ ] 无新的regres关键bug
- [ ] 性能满足baseline

---

## 📈 风险和缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Ralph Loop死循环 | 中 | 高 | max_iterations硬限制 + timeout |
| Hook执行阻塞 | 中 | 中 | 添加timeout + 异步执行 |
| 权限规则冲突 | 中 | 中 | 明确优先级 + unit test |
| Worktree超时 | 低 | 中 | Worktree池 + 重试逻辑 |
| Context压缩失败 | 低 | 低 | Rollback + 日志记录 |

---

## ✅ 最终验收清单

**功能验收**:
- [ ] 所有P0功能完整可用
- [ ] 现有功能零破坏 (向后兼容)
- [ ] 文档完整 (API + 使用例)
- [ ] 代码审查通过

**性能验收**:
- [ ] Hook执行 < 20ms
- [ ] 权限检查 < 20ms
- [ ] Context压缩 < 500ms
- [ ] 系统响应 < 500ms

**质量验收**:
- [ ] 集成测试通过率 >= 95%
- [ ] 代码覆盖率 >= 85%
- [ ] 无P0/P1级bugs
- [ ] 安全审计通过

---

## 🚀 立即行动

**Today**:
1. 批准此路线图
2. 分配开发团队 (4-6人)
3. 创建github issue和milestone
4. 安排首次standup

**Next Week**:
1. 完成Task 1.1和1.2 (Hook + Agent)
2. 启动Task 2.1和2.2 (Ralph Loop)
3. 设置CI/CD pipeline
4. 每日code review

**Target**:
- **Week 6**: P0功能完成 (Hook + Agent + Loop + Cron)
- **Week 10**: P1功能完成 (权限 + Context + Memory + Worktree)
- **Week 13**: 全部完成 + 集成测试通过

---

## 📊 工作量分解

```
Week 1-2: P0 Hook系统 (1人 × 2周)
          P0 Agent Frontmatter (1人 × 2周)
          = 2人周

Week 3-4: P0 Ralph Loop (2人 × 2周)
          P0 Cron系统 (1.5人 × 2周)
          = 3.5人周

Week 5-7: P1 权限系统 (2人 × 3周)  [可与P0并行]
          P1 Context + Memory (2人 × 2周)
          = 4人周

Week 7-8: P1 Worktree (2人 × 2周)  [可并行]
          = 2人周

Week 9-10: 集成测试 + 优化 (2人 × 2周)
           = 2人周

总计: 13.5人周 (6-8人团队, 10-13周内完成)
```

---

**已完成**: 5个Agent的深度分析 + 这份执行路线图
**下一步**: 核准路线图 → 分配团队 → 启动Week 1

