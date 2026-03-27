# AXON 从 v2.1.43 到 v2.1.85 同步优先级清单

**版本范围**: 2.1.43 → 2.1.85 (35个版本)
**关键发现**: 66个严重bug修复 + 71个新功能 + 45个Hook更新 + 83个Context/Memory改进

---

## 🔴 P0 严重Bug修复 (必须修复)

### 1. 内存泄漏和死锁修复

| 优先级 | Bug | 版本 | 影响 | 修复成本 |
|--------|-----|------|------|---------|
| 🔴 | 内存泄漏: 流式API缓冲区在早期终止时未释放，导致Node.js/npm代码路径上RSS增长无界 | 2.1.74 | 高 - 导致OOM | 中 |
| 🔴 | 远程会话内存泄漏: tool use ID无限累积 | 2.1.67 | 高 | 小 |
| 🔴 | Bash工具悬挂: `rg ... \| wc -l` 在沙箱模式下返回0 | 2.1.56 | 高 - 数据丢失 | 小 |
| 🔴 | MCP工具调用无限悬挂: SSE连接中断时 | 2.1.61 | 高 | 中 |
| 🔴 | Worktree悬挂: 名称含有斜杠时 | 2.1.52 | 中 | 小 |
| 🔴 | Node.js 18崩溃 | 2.1.60 | 高 - 环境限制 | 小 |
| 🔴 | MacOS挂起: 语音输入模块加载阻塞主线程 | 2.1.74 | 中 | 小 |
| 🔴 | 无限循环: API错误触发Stop Hook时 | 2.1.55 | 高 - 要求重启 | 中 |

### 2. 数据丢失/损坏修复

| Bug | 版本 | 详情 | 修复成本 |
|-----|------|------|---------|
| SDK会话历史丢失 | 2.1.77 | Hook进度消息破坏parentUuid链 | 小 |
| 后台subagent不可见 | 2.1.68 | Context压缩后agents消失 | 小 |
| 计划文件覆盖 | 2.1.71 | Fork时共享同一个plan file | 小 |
| 内存膨胀: 图片处理失败 | 2.1.75 | Read工具将巨大图片放入context | 小 |
| Bash输出丢失 | 2.1.74 | 多个会话在同一目录运行时 | 小 |

### 3. 权限和安全修复

| Bug | 版本 | 详情 | 修复成本 |
|-----|------|------|---------|
| `--mcp-config`绕过managed policy | 2.1.44 | CLI标志不遵守权限设置 | 小 |
| 插件黑名单失效 | 2.1.54 | 被组织策略禁用的插件仍可安装 | 小 |
| Bash权限规则匹配失败 | 2.1.65 | 通配符不匹配heredocs和嵌入式换行符 | 中 |
| "Always Allow"过度宽松 | 2.1.72 | 权限规则建议太宽泛，重新匹配 | 小 |
| 管理设置验证缺陷 | 2.1.60 | 非托管设置可以禁用托管hooks | 小 |

### 4. Context/Token计数Bug

| Bug | 版本 | 详情 | 影响 | 修复 |
|-----|------|------|------|------|
| **Token过度计数** | 2.1.75 | thinking/tool_use block乘以虚假系数 | 🔴 高 | 移除1.5x和1.3x系数 |
| `/compact`失败 | 2.1.67 | 大会话的压缩请求本身超出context | 中 | 阶段处理 |
| 推迟工具schema丢失 | 2.1.76 | ToolSearch加载的工具在压缩后失效 | 中 | 缓存schema |

---

## 🟢 P1 关键新功能 (应该尽快实现)

### Hook系统大升级 (v2.1.50-2.1.85之间)

| 功能 | 版本 | 详情 | 优先级 |
|------|------|------|--------|
| **条件Hook** | 2.1.54 | Hook支持`if:`字段，使用权限规则语法 (e.g., `Bash(git *)`) | P0 |
| **Elicitation Hook** | 2.1.76 | MCP请求用户输入的拦截和覆盖 | P1 |
| **ElicitationResult Hook** | 2.1.76 | 用户完成Elicitation后的响应处理 | P1 |
| **TaskCreated Hook** | 2.1.56 | 任务创建时触发 | P1 |
| **CwdChanged Hook** | 2.1.59 | 目录改变时触发 (direnv支持) | P1 |
| **FileChanged Hook** | 2.1.59 | 文件变更时触发 (reactive管理) | P1 |
| **StopFailure Hook** | 2.1.72 | API错误导致turn结束时触发 | P1 |
| **PreToolUse返回updatedInput** | 2.1.77 | Hook可以修改工具输入，配合AskUserQuestion | P1 |
| **Http Hook支持Worktree** | 2.1.72 | WorktreeCreate支持http类型Hook | P1 |

### 核心功能新增

| 功能 | 版本 | 详情 | 必要性 |
|------|------|------|--------|
| **Loop命令** | 2.1.71 | `/loop` 递归执行 (Cron基础) | 🔴 关键 |
| **Cron调度工具** | 2.1.71 | CronCreate/CronDelete工具 | 🔴 关键 |
| **Worktree支持** | 2.1.63+ | EnterWorktree/ExitWorktree + 隔离 | 🔴 关键 |
| **Sparse Checkout** | 2.1.76 | `worktree.sparsePaths` 大Monorepo支持 | 中 |
| **PowerShell工具** | 2.1.78 | Windows原生PowerShell (可选预览) | 低 |
| **Transcript搜索** | 2.1.82 | `/` 搜索transcript历史 | 低 |
| **Agent团队支持** | 2.1.60+ | 多Agent协作框架 | P1 |

### Context和Memory重大改进

| 功能 | 版本 | 详情 | 优先级 |
|------|------|------|--------|
| **1M Context Window** | 2.1.75 | Opus 4.6默认支持1M (之前需额外支付) | P0 |
| **PostCompact Hook** | 2.1.76 | 压缩完成后的外部系统集成 | P1 |
| **Memory timestamp** | 2.1.75 | Memory文件的last-modified时间戳 | P1 |
| **autoMemoryDirectory配置** | 2.1.74 | 自定义memory存储位置 | P1 |
| **\`/context\`命令** | 2.1.74 | 可操作的context优化建议 | P1 |
| **Memory index截断** | 2.1.81 | 25KB + 200行双重限制 | P1 |

### 权限系统升级

| 功能 | 版本 | 详情 | 优先级 |
|------|------|------|--------|
| **托管策略cascading** | 2.1.60+ | managed-settings.json + managed-settings.d/ | P1 |
| **MCP OAuth全支持** | 2.1.53+ | RFC 9728 device flow + token lifecycle | P2 |
| **Permission Relay** | 2.1.81 | `--channels` 移动设备审批 | P2 |
| **Managed Policy管理UI** | 2.1.54+ | 文件系统级配置合并 | 中 |

---

## 🟡 P2 性能优化 (可后期做)

### 启动性能

| 优化 | 版本 | 提升 | 成本 |
|------|------|------|------|
| Bash解析原生模块 | 2.1.72 | 更快初始化，无内存泄漏 | 小 |
| 并行setup() | 2.1.79 | +30ms启动加速 | 小 |
| Plugin缓存加载 | 2.1.79 | Commands/skills无需重新fetch | 小 |
| 大Repo优化 | 2.1.73 | -80MB内存 (250k文件) | 小 |
| 音频模块延迟加载 | 2.1.72 | 消除5-8秒语音初始化冻结 | 小 |

### 内存和压缩优化

| 优化 | 版本 | 效果 | 成本 |
|------|------|------|------|
| MCP工具描述限制2KB | 2.1.76 | 防止OpenAPI膨胀 | 小 |
| 非流式fallback 64K -> 300s | 2.1.81 | 更少被截断 | 小 |
| Yoga→TypeScript布局 | 2.1.77 | 100k+ messages时流畅 | 中 |

---

## 📊 优先级实施顺序

### 第1周 (立即)
```
必做:
1. 内存泄漏修复 (6个)
   └─ 流式缓冲区、tool_use ID、bash悬挂、MCP悬挂
2. Token计数修复 (v2.1.75)
   └─ 移除thinking/tool_use虚假系数 → +18-20% 容量
3. Hook条件支持 (if: "Bash(git *)")
   └─ 性能和功能关键
```

### 第2-3周
```
4. Cron调度系统 (Loop + CronCreate/Delete)
5. Worktree隔离基础
6. Sparse Checkout支持
7. 权限规则Bug修复 (Bash通配符、heredoc等)
```

### 第4-5周
```
8. Hook新事件 (Elicitation, CwdChanged, FileChanged等)
9. PostCompact Hook
10. Memory timestamp支持
11. Permission Relay (--channels)
```

### 第6周+
```
12. 性能优化 (缓存、并行加载等)
13. PowerShell工具 (可选)
14. 高级功能 (Transcript搜索等)
```

---

## 💻 按模块修复清单

### Hook系统 (需要改动src/hooks/)
```
Priority 1 (Week 1-2):
- [ ] 添加条件Hook支持 (if字段)
- [ ] 处理Hook错误不阻止执行

Priority 2 (Week 3-4):
- [ ] Elicitation/ElicitationResult Hook
- [ ] CwdChanged/FileChanged Hook
- [ ] StopFailure Hook
- [ ] TaskCreated Hook
```

### 权限系统 (src/permissions/)
```
Priority 1:
- [ ] 修复Bash通配符匹配 (heredoc, 管道)
- [ ] 修复"Always Allow"过度宽松
- [ ] 修复--mcp-config绕过问题
- [ ] 条件Hook的if语法支持

Priority 2:
- [ ] Managed-settings.d/ cascading
- [ ] MCP OAuth完整流程
- [ ] Permission Relay (--channels)
```

### Context/Memory (src/context/, src/memory/)
```
Priority 1:
- [ ] Token计数修复 (移除虚假系数)
- [ ] PostCompact Hook集成
- [ ] Memory timestamp字段

Priority 2:
- [ ] autoMemoryDirectory配置
- [ ] /context命令优化建议
- [ ] Memory index截断 (25KB + 200行)
```

### 自动化系统 (新增 src/automation/)
```
Priority 1:
- [ ] /loop 命令实现
- [ ] CronCreate/CronDelete工具
- [ ] Cron后台调度器

Priority 2:
- [ ] Worktree隔离 (EnterWorktree/ExitWorktree)
- [ ] Sparse Checkout支持
```

### Bug修复清单 (按严重度)
```
Critical (Week 1):
- [ ] 内存泄漏 (缓冲区、tool_use ID、bash)
- [ ] 无限循环修复
- [ ] 权限规则边界case

High (Week 2-3):
- [ ] Bash/Read工具修复
- [ ] Hook订阅问题
- [ ] SSH相关问题

Medium (Week 4+):
- [ ] UI glitch修复
- [ ] 性能细节优化
```

---

## 🎯 估算工作量

### 必做 (严重Bug修复)
```
内存泄漏修复:          3-5人日
Hook bug修复:          2-3人日
权限规则bug修复:       2-3人日
Token计数修复:         1-2人日
──────────────────
小计:                 8-13人日
```

### 应该做 (关键新功能)
```
条件Hook (if支持):     2-3人日
Cron系统:              3-5人日
Worktree隔离:          4-6人日
Hook新事件8个:         3-4人日
PostCompact集成:       1-2人日
Memory timestamp:      1人日
Sparse Checkout:       2人日
──────────────────
小计:                 16-23人日
```

### 可后期做 (优化)
```
性能优化:              3-5人日
PowerShell工具:        2-3人日
Permission Relay:      3-4人日
其他细节:              3-5人日
──────────────────
小计:                 11-17人日
```

**总计**: 35-53人日 (4-6人周期内完成所有P0+P1)

---

## ✅ 验收标准

### Bug修复验收
- [ ] 无内存泄漏 (valgrind或heap profiler通过)
- [ ] 无悬挂情况 (重复运行100次无hang)
- [ ] 所有权限规则正确匹配
- [ ] Token计数与官方±2% 误差范围

### 新功能验收
- [ ] Cron任务按时执行
- [ ] Hook条件正确过滤
- [ ] Worktree隔离有效 (无文件逃逸)
- [ ] Memory timestamp正确记录

### 性能验收
- [ ] 启动时间 < 2秒 (不含MCP连接)
- [ ] Hook触发延迟 < 20ms
- [ ] Context压缩不阻塞主loop

---

## 📈 影响评估

### 用户可感知的改进
```
✓ 无突然崩溃或OOM
✓ 内存使用稳定可控
✓ 1M context支持大型项目
✓ Cron自动化能力
✓ Worktree并行能力
✓ Hook灵活性大幅提升
```

### 开发效率提升
```
✓ 内存泄漏修复 → 长会话稳定
✓ Bash工具bug修复 → 可靠的命令执行
✓ Sparse checkout → 大Monorepo快速启动
✓ Worktree隔离 → 并发Agent能力
```

### 兼容性
```
✓ 所有改动向后兼容
✓ 新Hook是可选的
✓ 旧权限规则继续工作
✗ 需要重新启动session应用新Hook条件
```

---

## 🚀 立即行动

**Today**:
- [ ] 确认从2.1.43升级到2.1.85的优先级
- [ ] 按照上述顺序分配3-4周的开发任务
- [ ] 从内存泄漏修复开始 (最高ROI)

**This Week**:
1. 修复6个内存泄漏
2. 修复Token计数bug (+18-20% 容量)
3. 添加Hook条件支持

**Next 2-3 Weeks**:
4. Cron系统
5. Worktree隔离
6. 权限规则bug修复

**Expected Outcome**:
- AXON从v2.1.43快速稳定到v2.1.85核心功能
- 内存和性能显著改善
- Hook系统灵活性翻倍

