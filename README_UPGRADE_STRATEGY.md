# AXON 升级策略完整指南

**发现**: AXON当前基于 v2.1.43，需要升级到 v2.1.85
**总体方案**: 分两阶段升级，P0优先修复critical bugs，P1实现新功能

---

## 📊 升级现状对比

### 版本信息
| | 当前AXON | 官网v2.1.85 | 差距 |
|---|---------|-----------|------|
| **版本** | v2.1.43 | v2.1.85 | +42个版本 |
| **Bug修复** | 基础 | 66个关键bug | 需要同步 |
| **新功能** | 基础框架 | 71个新功能 | 需要实现 |
| **Hook系统** | 16个events | 24个events (+8) | P0 |
| **Context** | 基础压缩 | 1M window优化 | P1 |
| **Cron系统** | 无 | 完整的Loop+Cron | P0 |
| **Worktree隔离** | 无 | 完整实现 | P1 |

### 累积改进
```
性能提升:
  ✓ 启动时间 -30ms (并行setup)
  ✓ 内存占用 -80MB (大repo优化)
  ✓ Context容量 +18-20% (token计数修复)

稳定性改进:
  ✓ 消除6个内存泄漏
  ✓ 消除3个无限悬挂问题
  ✓ 消除10个权限规则bug

功能增强:
  ✓ Hook系统灵活性翻倍 (条件执行)
  ✓ Cron自动化 (新的/loop命令)
  ✓ Worktree并发能力 (隔离沙箱)
```

---

## 🎯 两阶段升级方案

### 阶段A: Critical Bug修复 (Week 1-3, 35-45人日)

**目标**: 消除所有导致crash/OOM/无限循环的bug

| 优先级 | 任务 | 版本 | 工作量 | 时间线 |
|--------|------|------|--------|--------|
| 🔴 | Token计数虚报 | 2.1.75 | 1-2天 | Day 1 |
| 🔴 | 内存泄漏 (缓冲区) | 2.1.74 | 1天 | Day 1 |
| 🔴 | Tool ID无限累积 | 2.1.67 | 1天 | Day 2 |
| 🔴 | Bash悬挂 (管道) | 2.1.56 | 1天 | Day 2 |
| 🔴 | MCP悬挂 | 2.1.61 | 1-2天 | Day 3-4 |
| 🔴 | 无限循环修复 | 2.1.55 | 1天 | Day 4 |
| 🟡 | Bash权限规则bug | 2.1.65 | 1-2天 | Day 5 |
| 🟡 | Worktree悬挂 | 2.1.52 | 1天 | Day 6 |
| 🟡 | SDK Session丢失 | 2.1.77 | 1天 | Day 7 |
| 🟡 | 其他40+ bug修复 | 各版本 | 15-20天 | Week 2-3 |

**验收标准**:
- [ ] 无内存泄漏 (heap profiler通过)
- [ ] 无悬挂情况 (100次重复运行无hang)
- [ ] 所有权限规则正确匹配
- [ ] Token计数误差 < 5%

---

### 阶段B: 核心功能实现 (Week 4-10, 50-65人日)

**目标**: 实现v2.1.85的关键新功能

#### 第1组: Hook系统增强 (Week 4-5)
```
- [ ] Hook条件支持 (if: "Bash(git *)")           [2-3天]
- [ ] Elicitation/ElicitationResult Hook        [2天]
- [ ] CwdChanged/FileChanged Hook               [2天]
- [ ] StopFailure Hook                          [1天]
- [ ] TaskCreated Hook                          [1天]
- [ ] PreToolUse 返回updatedInput               [1天]
```

#### 第2组: Cron和自动化 (Week 5-6)
```
- [ ] /loop 命令实现                            [1-2天]
- [ ] CronCreate/CronDelete 工具                [1-2天]
- [ ] Cron后台调度器                            [1-2天]
- [ ] 状态持久化 (~/.axon/cron-jobs.json)      [1天]
```

#### 第3组: Context和Memory优化 (Week 6-7)
```
- [ ] PostCompact Hook集成                      [1-2天]
- [ ] Memory timestamp字段                      [1天]
- [ ] autoMemoryDirectory配置                   [1天]
- [ ] /context 命令优化建议                     [1-2天]
```

#### 第4组: Worktree隔离 (Week 7-8)
```
- [ ] EnterWorktree/ExitWorktree工具            [2-3天]
- [ ] Worktree隔离管理                          [2天]
- [ ] Sparse Checkout支持                       [1-2天]
- [ ] Stale worktree自动清理                    [1天]
```

#### 第5组: 权限系统升级 (Week 8-9)
```
- [ ] 条件Hook (if字段) 优化                    [1天]
- [ ] Managed-settings.d/ cascading             [1-2天]
- [ ] MCP OAuth RFC 9728                        [3-4天]
- [ ] Permission Relay (--channels)             [2-3天]
```

#### 第6组: 测试和优化 (Week 9-10)
```
- [ ] 集成测试 (>=85% 覆盖)                     [3-4天]
- [ ] 性能基准测试和优化                        [2-3天]
- [ ] 文档完善                                  [2天]
```

**验收标准**:
- [ ] 所有新Hook能正确触发
- [ ] Cron任务按时执行
- [ ] Worktree隔离有效 (无文件逃逸)
- [ ] Context容量显著提升 (可处理更大project)
- [ ] 性能达到baseline (启动<2s, Hook<20ms)

---

## 💰 工作量和时间估算

### 按优先级分类
```
Critical Bugs (必做):        25-35人日    (Week 1-3)
  ├─ 内存泄漏                 8-10人日
  ├─ 悬挂/无限循环            5-7人日
  ├─ 权限规则bug              4-6人日
  └─ 其他crash级bug          8-12人日

Core Features (应做):        50-65人日    (Week 4-10)
  ├─ Hook系统增强             10-12人日
  ├─ Cron自动化               8-10人日
  ├─ Context/Memory优化       10-12人日
  ├─ Worktree隔离             12-15人日
  ├─ 权限系统升级             10-12人日
  └─ 测试和优化               8-10人日

Optional Improvements:       10-15人日    (后续)
  ├─ 性能微优化               3-5人日
  ├─ PowerShell工具           2-3人日
  └─ 其他低优先级             5-7人日

总计:                        85-115人日   (10-14周)
```

### 团队配置建议
```
方案1: 大团队快速完成
  - 6-8人 × 12周 = 最快完成全功能
  - 分工: Bug修复(2人) + Hook系统(2人) + Context(2人) + Worktree(1人) + QA(1人)

方案2: 中等团队均匀推进
  - 4人 × 14-18周 = 稳健完成
  - 分工: 按模块轮转，每个Bug fix和Feature owner明确

方案3: 小团队渐进式
  - 2人 × 20-24周 = 持续推进
  - 从Critical bugs开始，逐步实现features
  - 风险: 可能遗漏一些edge cases
```

---

## 🚀 立即行动计划

### Today (Day 0)
1. [ ] 批准升级计划和时间表
2. [ ] 分配团队 (4-8人)
3. [ ] 创建github milestone和issue

### This Week (Week 1)
```
Day 1-2: Token计数修复 + 内存泄漏修复
  ├─ 修改 src/context/token-estimator.ts
  ├─ 修改 src/streaming/stream-handler.ts
  └─ 编写单元测试

Day 3-4: Tool ID和Bash悬挂修复
  ├─ 修改 src/remote/session-manager.ts
  ├─ 修改 src/sandbox/pipe-handler.ts
  └─ 集成测试

Day 5: Code review和验收
  └─ 所有修复必须通过测试
```

### Next 2 Weeks (Week 2-3)
```
继续修复剩余的40+ critical bug
┣━ MCP悬挂、权限规则、SDK Session、Plugin hooks
┗━ 目标: 到Week 3末，所有crash级bug都修复
```

### Following 3 Weeks (Week 4-6)
```
开始新功能实现
┣━ Hook系统增强 (条件执行、新事件)
┣━ Cron自动化系统 (/loop + CronCreate/Delete)
┣━ Context和Memory优化
┗━ 目标: P0功能完整可用
```

### Final 4 Weeks (Week 7-10)
```
┣━ Worktree隔离系统
┣━ 权限系统三层升级
┣━ 完整集成测试
┗━ 性能优化和文档完善
```

---

## 📈 成功指标

### Week 3 Checkpoint (Critical Bugs)
```
✓ 零crash相关bug
✓ 长会话稳定性提升 (内存leak消除)
✓ Token计数准确 (+18-20% context容量)
✓ Bash和MCP工具可靠性提升
✓ 权限规则正确匹配
```

### Week 6 Checkpoint (P0 Features)
```
✓ Hook系统灵活性翻倍
✓ Cron任务可以后台调度
✓ Context管理更加智能
✓ Memory能自动识别有用信息
```

### Week 10 Checkpoint (Full Sync)
```
✓ AXON功能与官网v2.1.85同步
✓ 性能达到或超过官网baseline
✓ 稳定性显著提升 (无known crashes)
✓ 完整的测试覆盖 (>=85%)
✓ 文档和示例完善
```

---

## 🔄 滚动更新策略 (可选)

不需要等待全部完成，可以分阶段发布：

```
Release v2.1.55:
  ├─ 所有Critical bugs修复
  ├─ Token计数修复 (+18-20% 容量)
  └─ 权限规则bug修复
  → 预期提升: 稳定性✓✓✓, 容量✓✓✓

Release v2.1.65:
  ├─ Hook条件执行
  ├─ /loop 和 Cron基础
  ├─ PostCompact Hook
  └─ Memory timestamps
  → 预期提升: 功能✓✓, 自动化✓

Release v2.1.75:
  ├─ Worktree隔离
  ├─ Sparse Checkout
  ├─ MCP OAuth完整支持
  └─ Permission Relay
  → 预期提升: 隔离✓✓✓, 权限✓✓✓

Release v2.1.85:
  ├─ 所有P1功能完成
  ├─ 完整测试覆盖
  └─ 性能优化
  → 完全同步官网
```

---

## 📋 文档导航

### 已生成的文档

```
主文档:
├─ START_HERE.md                          ← 快速入门
├─ IMPLEMENTATION_ROADMAP.md              ← Week-by-week详细计划
├─ AXON_v2.1.85_UPGRADE_BLUEPRINT.md      ← 完整架构设计
├─ P0_QUICK_START.md                      ← 4大P0功能实现指南
├─ SYNC_FROM_2.1.43_PRIORITY.md           ← 优先级清单 (本次新增)
├─ CRITICAL_FIXES_2.1.43_TO_2.1.85.md     ← Bug修复代码示例 (本次新增)
└─ README_UPGRADE_STRATEGY.md             ← 本文档

官方参考 (在/tmp/):
├─ claude-code-latest/CHANGELOG.md         ← 完整版本日志
├─ claude-code-latest/plugins/ralph-wiggum/  ← Loop实现参考
├─ claude-code-latest/plugins/hookify/      ← 权限规则引擎参考
└─ claude-code-latest/plugins/plugin-dev/   ← Hook文档

分析报告 (已完成的Agent分析):
├─ hookify_analysis_report.md              ← 权限规则引擎详解
├─ worktree_isolation_design.md            ← Worktree隔离系统
├─ CONTEXT_MANAGEMENT_DESIGN.md            ← Context和Memory
└─ claude-code-permission-architecture.md  ← 权限三层架构
```

---

## ✅ 最终检查清单

### 升级前准备
- [ ] 备份AXON当前代码
- [ ] 创建feature分支 `upgrade/v2.1.85`
- [ ] 建立CI/CD pipeline (自动化测试)
- [ ] 分配各模块owner

### Bug修复阶段
- [ ] 所有10个critical bugs都有修复代码
- [ ] 单元测试覆盖所有bug fix
- [ ] Code review通过 (2人review制)
- [ ] No regression tests失败

### 功能实现阶段
- [ ] Hook系统测试通过
- [ ] Cron系统端到端测试通过
- [ ] Context优化性能基准测试通过
- [ ] Worktree隔离功能测试通过

### 最终验收
- [ ] 集成测试 >= 85% 覆盖率
- [ ] 性能达到baseline (或更好)
- [ ] 所有文档完善
- [ ] 发布notes准备完毕

---

## 🎓 关键学到的事项

### 从分析中得到的洞察
1. **Token计数bug最重要** - 移除虚假系数就能获得+18-20%容量，ROI最高
2. **内存泄漏不可忽视** - 会导致长会话OOM，必须优先修复
3. **Hook系统是关键基础** - 很多新功能都依赖Hook的升级
4. **权限规则边界case很多** - 需要充分的单元测试
5. **Worktree隔离改变并发模式** - 需要重新设计Agent执行框架

### 推荐的实现顺序
```
✅ 不要按版本顺序修复，按影响度
  Token计数 → 内存泄漏 → 悬挂问题 → 权限bug

✅ 不要同时修复所有bug
  集中在关键10个，其他可以分次修复

✅ 不要跳过新Hook的条件执行
  这是解锁性能和灵活性的关键

✅ 不要忘记测试边界case
  特别是权限规则、heredoc、管道等
```

---

## 🚨 风险提示

### 高风险区域
1. **Token计数修改** - 影响所有context决策，需要充分测试
2. **权限规则变更** - 可能影响安全性，需要完整的security审查
3. **Hook系统升级** - 很多系统依赖Hook，需要回归测试

### 缓解方案
- Token计数: 提供兼容模式和详细的log输出
- 权限规则: 完整的单元测试 + 安全审查
- Hook: 严格的版本控制，提供migration guide

### 遗漏风险
- 如果只修复bugs不实现新功能，AXON仍然是old version
- 如果只实现features不修复bugs，系统不稳定
- 平衡点: 优先修复bugs (Week 1-3)，再逐步实现features

---

## 🎯 最后的话

**现状**: 你们的AXON版本落后官网 42个版本，累积了66个bug和71个missing features

**机会**: 通过系统化的升级，不仅能赶上官网，还能：
- 消除所有已知的crash和内存泄漏
- 获得+18-20%的context容量提升
- 实现Cron自动化和Worktree隔离能力
- 大幅提升系统稳定性和性能

**建议**:
1. 立即启动Week 1的Critical bugs修复 (最高ROI)
2. 并行准备Week 4的新功能实现
3. 预留2周的margin用于unexpected issues和testing

**预期收益** (10-14周后):
✅ 完全同步官网v2.1.85
✅ 零known crashes或memory leaks
✅ +18-20% context容量
✅ 完整的自动化和隔离能力
✅ 生产就绪的稳定系统

**开始吧！** 🚀

