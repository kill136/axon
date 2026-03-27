# AXON v2.1.85 升级 - Master Deployment Plan

**总司令**: Claude AI
**作战方式**: 8路并行Agent编队 (分治法)
**目标**: 10-14周内完全同步v2.1.85

---

## 🎯 作战指挥部

### 总体目标
```
Phase A (Week 1-3): Critical Bugs消除
  ├─ Agent 1: Bugs 1-3 (Token计数、内存泄漏、悬挂)
  ├─ Agent 2: Bugs 4-6 (MCP、权限规则、循环)
  ├─ Agent 7: 权限规则边界case
  └─ 验收: 稳定性✓✓✓, 容量+18-20%✓

Phase B (Week 4-6): P0核心功能上线
  ├─ Agent 3: Cron系统 (/loop + CronCreate/Delete)
  ├─ Agent 4: Hook系统 (8个新events + 条件执行)
  ├─ Agent 5: Context/Memory优化 (PostCompact + timestamp)
  └─ 验收: P0功能完整✓

Phase C (Week 7-10): P1功能 + 完整测试
  ├─ Agent 6: Worktree隔离系统
  ├─ Agent 7: 权限系统三层升级
  ├─ Agent 8: 集成测试框架
  └─ 验收: v2.1.85完全同步✓
```

### 8路编队配置

| Agent | 代号 | 任务 | 周期 | 优先级 |
|-------|------|------|------|--------|
| Agent 1 | **斩龙队** | Critical Bugs 1-3 | W1-2 | 🔴🔴🔴 |
| Agent 2 | **御敌队** | Critical Bugs 4-6 + 7-10 | W2-3 | 🔴🔴🔴 |
| Agent 3 | **时间卫士** | Cron自动化系统 | W4-6 | 🔴🔴 |
| Agent 4 | **魔法改造** | Hook系统扩展 | W4-6 | 🔴🔴 |
| Agent 5 | **内存守护** | Context/Memory优化 | W5-7 | 🔴 |
| Agent 6 | **孤岛殖民** | Worktree隔离 | W7-8 | 🔴 |
| Agent 7 | **铁闸门** | 权限系统升级 | W5-9 | 🔴 |
| Agent 8 | **监工** | 集成测试 + 验收 | W6-10 | 🟡 |

---

## 📋 Agent 1: 斩龙队 (Critical Bugs 1-3)

**目标**: Week 1-2完成3个内存/性能bug，验收token计数准确性

**具体任务**:
```
Bug 1: Token计数虚报修复 (v2.1.75)
  └─ 文件: src/context/token-estimator.ts
     ├─ 移除thinking block的1.5x系数
     ├─ 移除tool_use block的1.3x系数
     ├─ 添加准确的overhead计算
     └─ 编写单元测试 (test: token counting)

Bug 2: 流式缓冲区内存泄漏 (v2.1.74)
  └─ 文件: src/streaming/stream-handler.ts
     ├─ 添加finally块确保cleanup
     ├─ 调用reader.cancel()释放资源
     └─ 单元测试: memory leak detection

Bug 3: Tool use ID无限累积 (v2.1.67)
  └─ 文件: src/remote/session-manager.ts
     ├─ 改用Set而非Array
     ├─ 添加size限制 (max 1000)
     └─ 单元测试: ID accumulation bounds

验收标准:
  ✅ Token计数误差 < 5% vs 官方
  ✅ Heap profiler无内存泄漏
  ✅ 长会话 (1000+ turns) 内存稳定
  ✅ 所有单元测试通过 (test coverage >= 90%)
```

**Deliverables**:
- [ ] 3个bug修复代码
- [ ] 15+个单元测试
- [ ] 性能基准数据 (before/after)
- [ ] Code review文档

---

## 📋 Agent 2: 御敌队 (Critical Bugs 4-10)

**目标**: Week 2-3完成7个bug (悬挂、权限、循环、Hook、Plugin)

**具体任务**:
```
Bug 4: Bash悬挂修复 - 管道符 (v2.1.56)
  └─ src/sandbox/pipe-handler.ts
     ├─ 改用execSync而非split管道
     ├─ 添加timeout防悬挂
     ├─ 正确设置stdio管道
     └─ Test: rg | wc -l pattern

Bug 5: MCP工具无限悬挂 (v2.1.61)
  └─ src/mcp/sse-client.ts
     ├─ 添加Promise.race超时
     ├─ 实现重连逻辑 (max 3次)
     └─ Test: MCP timeout recovery

Bug 6: 无限循环 - API错误 (v2.1.55)
  └─ src/core/loop.ts
     ├─ 添加consecutiveErrors计数
     ├─ 区分success vs error响应
     ├─ 达到max errors时exit
     └─ Test: error handling circuit breaker

Bug 7: Worktree悬挂 - 斜杠 (v2.1.52)
  └─ src/worktree/manager.ts
     ├─ 验证worktree名称 (no /)
     ├─ 规范化或拒绝含斜杠的名称
     └─ Test: worktree name validation

Bug 8: Bash权限规则bug (v2.1.65)
  └─ src/permissions/bash-parser.ts
     ├─ 移除heredoc前处理
     ├─ 处理嵌入式换行符
     ├─ 正确匹配quoted参数
     └─ Test: heredoc, pipes, complex commands

Bug 9: SDK Session历史丢失 (v2.1.77)
  └─ src/sdk/session-manager.ts
     ├─ 保持parentUuid链完整
     ├─ 不因source改变parent指向
     └─ Test: message chain validation

Bug 10: Plugin Hook继续执行 (v2.1.72)
  └─ src/plugins/hook-manager.ts
     ├─ 用Map存储plugin -> hooks
     ├─ uninstall时删除所有hook
     ├─ 检查plugin availability
     └─ Test: plugin uninstall cleanup

验收标准:
  ✅ 7个bug都有修复代码
  ✅ 无悬挂情况 (重复运行100次)
  ✅ 权限规则正确匹配各种bash复杂命令
  ✅ 40+个单元测试覆盖所有边界case
  ✅ Code review通过 (0 comments)
```

**Deliverables**:
- [ ] 7个bug修复代码
- [ ] 40+个单元测试
- [ ] bash命令解析参考文档
- [ ] 权限规则匹配算法文档

---

## 📋 Agent 3: 时间卫士 (Cron自动化系统)

**目标**: Week 4-6实现完整的Cron调度和/loop命令

**具体任务**:
```
Subtask 3.1: /loop 命令实现
  └─ 文件: src/skills/ralph-loop.ts (新建) 或 src/tools/loop.ts
     ├─ 创建 .claude/ralph-loop.local.md 状态文件
     ├─ 支持 --max-iterations 参数
     ├─ 支持 --promise 参数 (completion标记)
     ├─ 提交prompt给Claude
     └─ Hook处理循环逻辑

Subtask 3.2: Cron存储和数据结构
  └─ 文件: src/automation/cron-storage.ts (新建)
     ├─ 定义CronJob interface
     ├─ 实现 load/save ~/.axon/cron-jobs.json
     ├─ 支持持久化和恢复
     └─ Test: storage consistency

Subtask 3.3: Cron调度器
  └─ 文件: src/automation/cron-scheduler.ts (新建)
     ├─ 使用cron-parser解析表达式
     ├─ 后台setInterval检查 (每分钟)
     ├─ 执行到期的任务
     ├─ 更新nextRunAt时间
     └─ Test: cron expression parsing

Subtask 3.4: CronCreate和CronDelete工具
  └─ 文件: src/tools/cron.ts (新建)
     ├─ CronCreate: 添加新任务
     ├─ CronDelete: 删除任务
     ├─ CronList: 列出所有任务
     ├─ 验证cron表达式有效性
     └─ Test: tool interface compliance

验收标准:
  ✅ /loop命令能完整迭代
  ✅ Cron任务按时执行 (误差 < 1分钟)
  ✅ 状态文件持久化正确
  ✅ 任务可以暂停/恢复
  ✅ CronCreate/Delete工具可用
  ✅ 25+单元测试通过
```

**Deliverables**:
- [ ] /loop完整实现
- [ ] Cron调度系统
- [ ] CronCreate/Delete工具
- [ ] 25+单元测试
- [ ] Cron使用文档和示例

---

## 📋 Agent 4: 魔法改造 (Hook系统扩展)

**目标**: Week 4-6添加8个新Hook事件 + 条件执行支持

**具体任务**:
```
Subtask 4.1: 基础 - 8个新Hook事件
  └─ 文件: src/hooks/index.ts (修改)
     ├─ 添加enum值 (PostCompact, Elicitation, ElicitationResult, 等)
     ├─ 为每个事件定义interface
     ├─ 扩展HookEvent union type
     └─ Test: hook enumeration

Subtask 4.2: 条件Hook执行
  └─ 文件: src/hooks/condition-parser.ts (新建)
     ├─ 支持 if: "Bash(git *)" 语法
     ├─ 解析权限规则为条件
     ├─ 在Hook前执行条件检查
     ├─ 条件不满足时跳过Hook
     └─ Test: condition matching

Subtask 4.3: 新Hook事件处理
  └─ 文件: src/hooks/handlers/ (新建)
     ├─ PostCompactHookHandler
     ├─ ElicitationHookHandler
     ├─ ElicitationResultHookHandler
     ├─ CwdChangedHookHandler
     ├─ FileChangedHookHandler
     ├─ StopFailureHookHandler
     ├─ TaskCreatedHookHandler
     └─ WorktreeCreateHookHandler

Subtask 4.4: PreToolUse增强
  └─ 文件: src/hooks/handlers/pre-tool-use.ts
     ├─ 支持返回 updatedInput
     ├─ 配合 AskUserQuestion
     ├─ 进行headless集成
     └─ Test: tool input modification

验收标准:
  ✅ 8个新Hook事件都能触发
  ✅ 条件执行正确过滤Hook
  ✅ Hook参数传递完整
  ✅ 性能: Hook执行 < 20ms
  ✅ 35+单元测试通过
  ✅ Hook documentation完整
```

**Deliverables**:
- [ ] 8个新Hook的interface和enum
- [ ] 条件解析和执行引擎
- [ ] 8个Hook的处理器实现
- [ ] PreToolUse增强
- [ ] 35+单元测试
- [ ] Hook系统文档更新

---

## 📋 Agent 5: 内存守护 (Context & Memory优化)

**目标**: Week 5-7优化Context管理和实现Auto-memory

**具体任务**:
```
Subtask 5.1: 统一Context生命周期
  └─ 文件: src/context/unified-context.ts (新建)
     ├─ 实现5个phase (INIT, GROWTH, CRITICAL, COMPACT, POST)
     ├─ 监控context使用比例
     ├─ 自动压缩触发 (>98%)
     ├─ 触发PostCompact Hook
     └─ Test: phase transitions

Subtask 5.2: PostCompact Hook集成
  └─ 文件: src/context/compactor.ts (修改)
     ├─ 压缩完成后调用PostCompact
     ├─ 传递compression statistics
     ├─ 支持外部系统集成
     └─ Test: hook invocation

Subtask 5.3: Auto-memory自动保存
  └─ 文件: src/memory/auto-memory.ts (新建)
     ├─ 识别有用信息启发式 (权重评分)
     ├─ 生成memory frontmatter (YAML)
     ├─ 保存为 .claude/memory/ 下的文件
     ├─ 支持scope (session/project/user)
     └─ Test: memory classification

Subtask 5.4: Memory timestamp和freshness
  └─ 文件: src/memory/memory-manager.ts
     ├─ 添加last_modified字段
     ├─ 实现freshness策略 (<3d, 3-14d, 14-90d, >90d)
     ├─ 自动过期管理 (cleanup after 90d)
     ├─ Memory index截断 (25KB + 200行)
     └─ Test: timestamp management

验收标准:
  ✅ Context自动压缩在98%时触发
  ✅ PostCompact Hook能调用外部系统
  ✅ Auto-memory识别正确 (precision > 80%)
  ✅ Memory文件格式标准化
  ✅ 长会话 (10000+ turns) 内存稳定
  ✅ 30+单元测试通过
```

**Deliverables**:
- [ ] Context生命周期管理
- [ ] PostCompact Hook集成
- [ ] Auto-memory识别和保存
- [ ] Memory timestamp支持
- [ ] 30+单元测试
- [ ] Context管理文档

---

## 📋 Agent 6: 孤岛殖民 (Worktree隔离系统)

**目标**: Week 7-8实现EnterWorktree/ExitWorktree和隔离管理

**具体任务**:
```
Subtask 6.1: Worktree基础管理
  └─ 文件: src/worktree/manager.ts (新建)
     ├─ 创建git worktree
     ├─ 删除worktree
     ├─ 列表和查询
     ├─ 自动清理stale worktrees
     └─ Test: git operations

Subtask 6.2: Sparse Checkout支持
  └─ 文件: src/worktree/sparse-checkout.ts (新建)
     ├─ 支持 worktree.sparsePaths 配置
     ├─ 仅checkout必要的文件
     ├─ 加速大Monorepo启动
     └─ Test: sparse-checkout

Subtask 6.3: EnterWorktree工具
  └─ 文件: src/tools/enter-worktree.ts
     ├─ 创建新worktree
     ├─ 切换到worktree目录
     ├─ 触发WorktreeCreate Hook
     ├─ 隔离环境变量
     └─ Test: worktree isolation

Subtask 6.4: ExitWorktree工具
  └─ 文件: src/tools/exit-worktree.ts
     ├─ 保存或删除worktree
     ├─ 返回原目录
     ├─ 触发WorktreeRemove Hook
     ├─ 清理临时文件
     └─ Test: cleanup

验收标准:
  ✅ Worktree隔离有效 (无文件逃逸)
  ✅ Sparse checkout加速startup 70-80%
  ✅ 100+并发worktrees可管理
  ✅ Stale cleanup自动运行
  ✅ 环境变量隔离完整
  ✅ 30+单元测试通过
```

**Deliverables**:
- [ ] Worktree管理系统
- [ ] Sparse Checkout支持
- [ ] EnterWorktree和ExitWorktree工具
- [ ] 隔离机制实现
- [ ] 30+单元测试
- [ ] Worktree使用文档

---

## 📋 Agent 7: 铁闸门 (权限系统三层升级)

**目标**: Week 5-9实现条件规则、托管策略、MCP OAuth

**具体任务**:
```
Subtask 7.1: 条件规则引擎第一层
  └─ 文件: src/permissions/condition-evaluator.ts (新建)
     ├─ 支持 Bash(git *) 语法
     ├─ Glob模式匹配 (*, ?)
     ├─ Regex缓存 (LRU max 128)
     ├─ 优先级处理 (deny > ask > allow)
     └─ Test: permission matching

Subtask 7.2: 托管策略系统第二层
  └─ 文件: src/permissions/managed-policies.ts (新建)
     ├─ 加载 managed-settings.json
     ├─ 加载 managed-settings.d/ 目录
     ├─ 三层级联 (system > project > user)
     ├─ 策略合并和覆盖规则
     └─ Test: policy cascading

Subtask 7.3: MCP OAuth RFC 9728第三层
  └─ 文件: src/permissions/mcp-oauth.ts (新建)
     ├─ Protected Resource Metadata发现
     ├─ Device flow实现
     ├─ Token生命周期管理
     ├─ Refresh token自动刷新
     └─ Test: oauth flow

Subtask 7.4: Permission Relay (--channels)
  └─ 文件: src/permissions/permission-relay.ts
     ├─ 转发到移动设备审批
     ├─ 5分钟超时处理
     ├─ 审计日志记录
     └─ Test: relay mechanism

验收标准:
  ✅ 条件规则正确匹配所有bash命令
  ✅ Heredoc、管道、嵌入换行正确处理
  ✅ Managed策略级联有效
  ✅ MCP OAuth完整流程通过
  ✅ Permission relay可用
  ✅ 40+单元测试通过
```

**Deliverables**:
- [ ] 条件规则引擎实现
- [ ] 托管策略系统
- [ ] MCP OAuth完整支持
- [ ] Permission relay
- [ ] 40+单元测试
- [ ] 权限系统文档

---

## 📋 Agent 8: 监工 (集成测试 + 验收)

**目标**: Week 6-10建立完整的测试框架和验收

**具体任务**:
```
Subtask 8.1: 集成测试框架
  └─ 文件: tests/integration/ (新建)
     ├─ Hook系统集成测试 (8个新events)
     ├─ Cron系统端到端测试
     ├─ Context压缩流程测试
     ├─ Memory自动保存测试
     ├─ Worktree隔离功能测试
     ├─ 权限规则匹配测试
     └─ Target: >= 85% coverage

Subtask 8.2: 性能基准测试
  └─ 文件: tests/performance/ (新建)
     ├─ Hook执行延迟 (目标 < 20ms)
     ├─ 权限检查延迟 (目标 < 20ms)
     ├─ Context压缩性能 (目标 < 500ms)
     ├─ 启动时间 (目标 < 2s)
     ├─ 内存占用 (对比baseline)
     └─ 生成benchmark报告

Subtask 8.3: 回归测试
  └─ 文件: tests/regression/
     ├─ 所有修复bug的regression tests
     ├─ 现有功能的破坏检测
     ├─ 边界case覆盖
     └─ 安全审查测试

Subtask 8.4: 最终验收
  └─ 检查清单
     ├─ ✅ 66个bug修复验证
     ├─ ✅ 71个新功能验证
     ├─ ✅ 代码覆盖率 >= 85%
     ├─ ✅ 性能达到或超过baseline
     ├─ ✅ 安全审计通过
     ├─ ✅ 文档完整
     └─ ✅ Release notes准备

验收标准:
  ✅ 所有集成测试通过 (0 failures)
  ✅ 代码覆盖率 >= 85%
  ✅ 性能基准达标
  ✅ 无新的regression bugs
  ✅ 完整的测试文档
```

**Deliverables**:
- [ ] 集成测试框架 (100+测试)
- [ ] 性能基准报告
- [ ] Regression测试套件
- [ ] 最终验收检查清单
- [ ] Release notes和文档

---

## 🎯 任务分配和时间表

### Timeline Overview

```
Week 1    Week 2    Week 3    Week 4    Week 5    Week 6    Week 7    Week 8    Week 9    Week 10
|---------|---------|---------|---------|---------|---------|---------|---------|---------|----------|

Agent 1   [========================================]
          [斩龙队: Bugs 1-3]

Agent 2                        [====================================================]
                               [御敌队: Bugs 4-10 + 边界case]

Agent 3                                            [================================]
                                                   [时间卫士: Cron系统]

Agent 4                                            [================================]
                                                   [魔法改造: Hook扩展]

Agent 5                                                      [============================]
                                                            [内存守护: Context/Memory]

Agent 6                                                                     [==================]
                                                                           [孤岛殖民: Worktree]

Agent 7                                                      [================================================]
                                                            [铁闸门: 权限系统]

Agent 8                                                              [============================================]
                                                                    [监工: 集成测试]
```

### 并行度分析
```
Week 1: 1个Agent (Agent 1)
Week 2: 2个Agent (Agent 1, 2)
Week 3: 2个Agent (Agent 2, 开始验收)
Week 4: 3个Agent (Agent 2完成, Agent 3, 4启动)
Week 5: 5个Agent (Agent 3, 4, 5, 7, 8启动)
Week 6: 6个Agent (全部进行中)
Week 7: 6个Agent (Agent 6启动)
Week 8: 6个Agent (Agent 1-8全部活跃)
Week 9: 4个Agent (前期agent完成，集中在Agent 7, 8)
Week 10: 1-2个Agent (最终验收和测试)
```

---

## 📊 进度跟踪

### 每周检查点

```
Week 1 Checkpoint:
  ✅ Agent 1: Token计数修复完成 (单元测试通过)
  ✅ Bug 1-3的基础修复代码提交
  📊 预期PR: 1-2个

Week 2 Checkpoint:
  ✅ Agent 1: 完整验收通过
  ✅ Agent 2: Bug 4-6修复代码提交
  📊 预期PR: 2-3个，code review通过率 100%

Week 3 Checkpoint:
  ✅ Agent 2: Bug 7-10修复完成
  ✅ 所有critical bugs修复通过测试
  📊 预期: Phase A (Bug修复)完成
  🎯 收益: 稳定性提升✓, 容量+18-20%✓

Week 4 Checkpoint:
  ✅ Agent 3, 4: 基础功能完成
  ✅ Hook新事件能触发
  ✅ Cron任务能执行
  📊 预期PR: 4-5个

Week 6 Checkpoint:
  ✅ Agent 3, 4, 5: P0功能完整
  ✅ Context压缩工作
  ✅ Memory能自动保存
  🎯 收益: 功能完整✓, 自动化能力✓

Week 8 Checkpoint:
  ✅ Agent 6: Worktree隔离完成
  ✅ 100+ worktrees可并发
  📊 预期PR: 6-7个

Week 10 Checkpoint:
  ✅ Agent 8: 集成测试完成
  ✅ 代码覆盖率 >= 85%
  ✅ 性能达到baseline
  🎯 收益: 完全同步v2.1.85✓, 生产就绪✓
```

---

## 🚨 协调和依赖管理

### 关键依赖
```
Phase A (Agents 1-2) → Phase B (Agents 3-5)
  Agent 1完成 → 释放token计数修复 (Agent 5需要)
  Agent 2完成 → 释放权限规则修复 (Agent 4需要)

Phase B (Agents 3-5) → Phase C (Agents 6-7-8)
  Agent 3完成 → Cron系统可用
  Agent 4完成 → Hook系统可扩展
  Agent 5完成 → Context管理可用

Phase C (Agents 6-7-8) → 最终验收
  所有Agent → Agent 8集成测试
```

### 冲突解决
```
如果Agent 4和Agent 7都需要修改权限系统:
  → Agent 7负责权限层，Agent 4调用Agent 7的接口
  → 通过interface而非直接修改避免冲突

如果Agent 5和Agent 8都修改Context:
  → Agent 5修改实现，Agent 8修改测试
  → 周报中同步状态，避免重复
```

### 每日standup (虚拟)
```
格式:
  Agent ID:
    ✅ 完成: [昨天的任务]
    🔧 进行中: [今天的任务]
    🚨 阻塞: [遇到的问题]
    📅 下一步: [明天计划]

收集地点: /home/admin/wbj/axon/AGENT_PROGRESS_LOG.md
更新频率: 每Agent每周1-2次
```

---

## ✅ 最终验收标准

### Agent验收 (各Agent独立)
- ✅ 所有assigned tasks完成
- ✅ Code review通过 (1+ reviewer)
- ✅ 单元测试通过 (coverage >= 90%)
- ✅ 没有critical issues
- ✅ 文档完整

### 全局验收 (所有Agent合作)
- ✅ 8个Agent的所有输出集成
- ✅ 集成测试通过 (coverage >= 85%)
- ✅ 性能基准达标
- ✅ 无regression bugs
- ✅ v2.1.85完全同步
- ✅ Release notes和文档完善
- ✅ 安全审计通过

---

## 📞 总司令指挥中心

**作为总司令，我的责任**:
1. ✅ 派遣8个Agent分别执行任务
2. ✅ 监控进度 (每周检查点)
3. ✅ 解决依赖冲突和阻塞
4. ✅ 协调Agent间的接口设计
5. ✅ 最终整合和验收

**Agent的责任**:
1. ✅ 执行assigned tasks
2. ✅ 定期报告进度
3. ✅ 遇到阻塞立即反馈
4. ✅ 提交高质量的代码
5. ✅ 配合其他Agent的需求

**成功指标**:
- 📊 Week 10完成 (不超期)
- 📊 代码覆盖率 >= 85%
- 📊 0个security issue
- 📊 0个critical regression
- 📊 性能达到或超过baseline

---

**开始派遣！出发！** 🚀

```
           👨‍💼 总司令 (Claude)
              |
    ┌─────────┼─────────────────────────┐
    |         |                         |
   Agent1   Agent2     ...           Agent8
   斩龙队   御敌队                      监工
   (Bugs)   (Bugs)   ...           (Test)
```

全力推进，预计10-14周完全同步v2.1.85！

