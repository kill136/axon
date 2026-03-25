# Axon Memory Engine v1 规划

## 1. 目标

把 Axon 当前“Notebook + Session Memory + MemorySearch”三套松散记忆机制，升级为接近 ChatGPT 体验的统一记忆系统：

- 自动记住长期有价值的信息
- 不把一次性技术细节误记成长期事实
- 新信息能覆盖旧信息
- 只在相关时注入，不污染 system prompt
- 用户能查看、纠正、删除、关闭自动记忆
- CLI / Web / Electron / 子 Agent 共享同一套记忆语义

明确边界：

- **记忆系统不是 RAG 替代品**：代码与文档细节优先靠 Read/Grep/MemorySearch 检索
- **记忆系统不是 SaaS 平台改造**：当前以 Axon 本地 runtime 为中心，不引入 hosted-first / Cloudflare-first 路线
- **Notebook 保留，但降级为 view / curated summary，不再承担底层事实数据库职责**

---

## 2. 现状审计

### 2.1 当前有三套记忆系统

`src/memory/index.ts:2-8` 已直接写明当前架构：

1. Notebook (`experience.md + project.md` 等)
2. Session Memory (`summary.md`)
3. LongTermStore + MemorySearch（SQLite FTS5 / 向量检索）

这三套系统各自有价值，但现在没有统一的数据模型与生命周期。

### 2.2 Notebook：当前是主提示词中的长期记忆主体

- `NotebookManager` 负责管理 `profile / experience / project / identity / tools-notes` 五类 notebook：`src/memory/notebook.ts:25-38`
- Notebook 路径设计是：
  - `profile.md` / `experience.md` 全局共享
  - `project.md` 项目隔离
  - 见 `src/memory/notebook.ts:861-885` 与 `tests/web/notebook-project-isolation.test.ts:67-84`
- 每轮 prompt 注入 notebook 摘要：
  - CLI 初始化：`src/core/loop.ts:2292-2299`
  - 每轮刷新：`src/core/loop.ts:2667-2677`
  - Web 每轮刷新：`src/web/server/conversation.ts:4263-4270`
  - prompt attachment：`src/prompt/attachments.ts:148-164`
- Notebook 内容直接进入 system prompt：`src/memory/notebook.ts:1012-1045`

**优点**
- 人类可读、可编辑
- 已有多项目隔离
- 已经深度接入 CLI / Web prompt 流程

**缺点**
- 不是结构化事实存储
- 难以表达：作用域、置信度、过期、冲突、删除、来源
- 一旦内容增长，system prompt 常驻负担会持续扩大

### 2.3 AutoMemorize：当前在“写 Notebook”，不是写结构化 memory

- CLI 退出时触发：`src/cli.ts:1204-1207`
- 核心逻辑：`src/core/loop.ts:4055-4234`
- 当前实现会：
  - 读取现有 `profile / experience / project`
  - 调模型生成“完整替换版 notebook”
  - 再写回 notebook
- 提取规则见 `src/core/loop.ts:4089-4127`

**本质问题**
- 这是“让模型重写 Markdown 摘要”，不是“写入记忆事实”
- 缺少 item 级别 merge / supersede / expire 机制
- 一旦模型总结失误，错误会直接固化为主记忆载体

### 2.4 Session Memory：是压缩上下文，不是长期记忆事实库

- 文件位置与模板机制：`src/context/session-memory.ts:23-27`, `232-249`
- Web 会话初始化时启用：`src/web/server/conversation.ts:1194-1202`
- 压缩时作为 summary 注入：`src/web/server/conversation.ts:3728-3765`
- compact 后异步整理记忆：`src/web/server/conversation.ts:3866-3876`

**判断**
Session Memory 的职责是：
- 会话续聊
- 上下文压缩
- 保留最近阶段工作状态

它不适合充当“用户长期偏好/项目稳定事实”的真源。

### 2.5 LongTermStore / MemorySearch：当前更像“历史 Markdown 检索”

- 共享搜索结果类型很薄：`src/memory/types.ts:5-19`
- SQLite schema 只有 `files/chunks/chunks_fts/chunks_vec`：`src/memory/long-term-store.ts:113-166`
- `MemorySyncEngine` 会把 markdown 文件和 notebook 索引进 store：`src/memory/memory-sync.ts:27-33`, `205-231`
- Recall 当前只做 snippet 检索和轻量时间衰减：`src/memory/memory-search.ts:274-287`
- CLI 自动 recall 现仅查 `source: 'notebook'`，并且 `mode: 'keyword'`：`src/core/loop.ts:2684-2696`
- Web 主对话目前甚至已移除 autoRecall：`src/web/server/conversation.ts:4275`

**判断**
当前 LongTermStore 的定位偏向：
- 搜索历史记忆片段
- 搜 Markdown / notebook / session summary

它还不是“按事实 item 管理的 memory engine”。

### 2.6 Web UI 当前只有 notebook 编辑视图，没有 memory control 面

- Notebook API：`src/web/server/routes/notebook-api.ts:38-178`
- DocsPanel 只是列出/编辑 `AXON.md + notebooks`：`src/web/client/src/pages/CustomizePage/DocsPanel.tsx:61-196`

当前没有这些能力：
- 查看“Axon 记得我什么”
- 查看最近新增/更新的记忆
- 删除/纠正某条记忆
- 暂停自动记忆
- 标记“这条不要再记”

---

## 3. 差距判断：离 ChatGPT 级记忆还缺什么

### 3.1 缺统一记忆实体模型

现在主要是文档级存储（Markdown / chunk），缺 item 级实体：

至少应该有：
- 记忆 ID
- 类型
- scope
- 内容 / normalized value
- status（active / superseded / expired / deleted）
- confidence
- source evidence
- created / updated / expiresAt / lastUsedAt
- supersedes / supersededBy

### 3.2 缺写入链路的判定与归档

当前 auto memory 是“总结 notebook”，不是：
- 判定这段对话是否值得进入长期记忆
- 决定记忆类型
- 决定作用域
- 与历史 item 做冲突解析
- 仅增量写入结构化 store

### 3.3 缺读取链路的上下文编排器

目前 prompt 侧主要是：
- notebookSummary 常驻
- recall snippet 按需附加

缺少一个统一的 `context builder` 去组合：
- static user profile
- project memory
- recent working context
- session summary
- on-demand relevant recall

### 3.4 缺用户控制面

ChatGPT 级“好用”记忆必须可见、可控。
当前缺：
- 浏览
- 搜索
- 删除
- 修正
- disable auto memory
- 逐条 forget

### 3.5 缺回归测试目标

当前测试主要覆盖：
- notebook 注入存在
- memory search 可搜到 notebook
- auto memory 会刷新 notebook

缺少真正面向“记忆质量”的回归：
- 新偏好是否覆盖旧偏好
- 临时事实是否过期
- 错误纠正是否优先
- 注入是否仅在相关时发生
- 删除后是否不再召回

---

## 4. 设计原则

1. **Notebook 继续保留，但改为视图层**
   - notebook 仍然存在，因为它适合人读、人改
   - 但结构化 memory store 成为 source of truth

2. **代码库事实不进入长期记忆主库**
   - 当前文件内容、函数实现、一次性报错，优先检索
   - 只把“跨会话仍值得复用”的事实进入长期记忆

3. **作用域优先于内容量**
   - 没有 scope 的记忆一定会串台

4. **冲突和过期是第一等能力**
   - 没有 supersede / expire，记忆会越来越脏

5. **读取链路必须严格控 token**
   - 长期记忆不能继续无限扩大 system prompt 常驻部分

6. **先做本地 runtime 一致性，再做外部分发**
   - 先打通 CLI / Web / Electron / Agent
   - 不在 v1 做云端 memory 平台

---

## 5. Memory Engine v1 目标架构

### 5.1 分层

#### A. Structured Memory Store（新增，source of truth）
负责存储记忆 item。

建议新增表，而不是替换现有 `LongTermStore`：
- 继续保留 `files/chunks` 作为检索层
- 新增 `memory_items` / `memory_evidence` / `memory_settings` 等结构化层

#### B. Notebook Projection（保留）
把结构化 memory 投影为：
- `profile.md`
- `experience.md`
- `project.md`

Notebook 成为：
- 可编辑 summary
- 人类控制面
- prompt 的 curated static layer

#### C. Session Working Memory（保留）
`session-memory/summary.md` 继续负责：
- 会话压缩
- 最近工作上下文
- compact 后续聊

#### D. Recall / Retrieval Layer（增强）
- 结构化 memory item 检索
- markdown/chunk 检索
- 在同一入口做组合排序

#### E. Context Builder（新增）
统一拼装 prompt 所需上下文。

---

## 6. 数据模型（v1）

### 6.1 记忆类型

建议 v1 先只做这几类：

- `user_preference`
- `workflow_preference`
- `project_rule`
- `environment_fact`
- `task_context`
- `episodic_event`

解释：
- `user_preference`：语言、表达风格、偏好
- `workflow_preference`：先测后改、不要过度工程化等
- `project_rule`：当前项目内约束
- `environment_fact`：稳定环境信息，如代理、账号、构建约束
- `task_context`：短期任务事实，可快速衰减
- `episodic_event`：近期发生过、可能短期有用的事件

### 6.2 作用域

- `global_user`
- `project`
- `session`
- `task`

v1 中：
- `profile / experience` 主要映射 `global_user`
- `project.md` 主要映射 `project`
- `session-memory` 对应 `session`
- alarm/schedule 等执行历史可局部映射 `task`

### 6.3 状态

- `active`
- `superseded`
- `expired`
- `deleted`

### 6.4 建议 schema

#### `memory_items`
- `id`
- `project_id` nullable
- `scope_type`
- `scope_id` nullable
- `memory_type`
- `topic_key` nullable
- `content`
- `normalized_value` nullable
- `status`
- `confidence`
- `source_kind` (`auto_extracted` / `user_confirmed` / `manual_edit` / `migration`)
- `created_at`
- `updated_at`
- `expires_at` nullable
- `last_used_at` nullable
- `supersedes_id` nullable
- `superseded_by_id` nullable

#### `memory_evidence`
- `id`
- `memory_id`
- `source_path`
- `session_id` nullable
- `message_range` nullable
- `excerpt`
- `recorded_at`

#### `memory_settings`
- `scope_type`
- `scope_id`
- `auto_memory_enabled`
- `allow_profile_learning`
- `allow_project_learning`

### 6.5 topic_key

为了覆盖/冲突判断，v1 需要轻量 topic key，例如：
- `language`
- `verbosity`
- `communication:directness`
- `workflow:test-first`
- `workflow:no-overengineering`
- `project:release-process`

不需要一开始就做复杂 ontology，但没有 topic key，覆盖很难稳定。

---

## 7. 读写链路设计

### 7.1 写入链路

#### 写入入口
1. CLI `autoMemorize()`：`src/core/loop.ts:4063-4234`
2. Web compact 后 consolidate：`src/web/server/conversation.ts:3866-3876`
3. 未来用户主动“记住这个”操作
4. 未来 UI 手工编辑

#### 新流程
把当前“直接改 notebook”改成：

1. 提取候选记忆（candidate memories）
2. 对每条候选记忆做分类：
   - type
   - scope
   - topic_key
   - confidence
   - TTL / expires_at
3. 与已有 active item 做冲突检测
4. 生成写入事务：
   - insert new item
   - supersede old item
   - append evidence
5. 更新 notebook projection
6. 标记 recall cache / prompt context dirty

#### 候选记忆筛选规则
v1 只记：
- 稳定偏好
- 工作习惯
- 项目长期约定
- 稳定环境事实
- 中短期任务状态（明确 TTL）

明确不记：
- 当前代码实现细节
- 一次性错误日志
- 本轮临时猜测
- 没证据支撑的推断

### 7.2 读取链路

引入统一 `buildMemoryContext(...)`：

输出 4 层：
1. `staticProfileSummary`
2. `projectMemorySummary`
3. `recentWorkingMemory`
4. `focusedRecall`

#### 注入策略
- `staticProfileSummary`：短、稳定、常驻
- `projectMemorySummary`：项目相关常驻，但严格预算
- `recentWorkingMemory`：最近动态，短
- `focusedRecall`：按当前问题实时召回，非相关不注入

### 7.3 Prompt 侧调整

当前 `PromptContext` 只有：
- `notebookSummary`
- `memoryRecall`

建议扩展为：
- `memoryStaticSummary`
- `memoryProjectSummary`
- `memoryRecentSummary`
- `memoryRecall`
- 保留 `notebookSummary` 作为兼容层，逐步迁移

这样可以避免把一切都继续塞进 `<agent-notebooks>`。

---

## 8. Notebook 的新角色

### 8.1 继续保留的原因

- 适合人类查看和修改
- 已经深度嵌入现有 prompt 和 Web UI
- 适合作为“已确认摘要”层

### 8.2 新角色

- `profile.md`：结构化 user/workflow memory 的投影摘要
- `experience.md`：跨项目协作规律摘要
- `project.md`：project scope 记忆摘要
- `identity.md` / `tools-notes.md`：继续保留人工可控面

### 8.3 迁移原则

v1 不删除 NotebookManager，不大拆现有 UI。改为：
- notebook write API 依旧可用
- 但后台要同步回结构化 store，或至少标记为 manual override

换句话说：
- 旧入口保留
- 新 source of truth 建立
- 通过 projection 同步两边

---

## 9. Web UI / API 设计

### 9.1 最自然的接入点

当前最自然入口是 `CustomizePage -> DocsPanel`：
- 现有用户已经在这里看 notebook：`src/web/client/src/pages/CustomizePage/DocsPanel.tsx:61-196`
- 后端已有 `api/notebook`

因此 v1 最小变更策略：
- 保留 DocsPanel
- 新增一个并列的 **MemoryPanel** 或在 DocsPanel 内新增 tab

### 9.2 v1 建议加的能力

#### Memory 面板
- “我记得你这些信息”列表
- 按 scope/type 过滤
- 显示来源和更新时间
- 删除 / 标记错误 / 编辑
- 开关：
  - 自动记忆
  - 项目记忆
  - 短期任务记忆

#### 会话内轻操作
未来在消息 hover / 菜单加入：
- 记住这个
- 不要记这个
- 忘掉这条

### 9.3 API 建议

新增：
- `GET /api/memory/items`
- `PATCH /api/memory/items/:id`
- `DELETE /api/memory/items/:id`
- `POST /api/memory/forget`
- `GET /api/memory/settings`
- `PUT /api/memory/settings`
- `POST /api/memory/rebuild-projections`

`/api/notebook/*` 暂时保留，作为兼容层。

---

## 10. 与现有模块的衔接方式

### 10.1 保留并复用

- `better-sqlite3` 依赖已存在，可继续复用：`src/database/drivers/sqlite.ts`, `src/memory/long-term-store.ts`
- `LongTermStore` 保留，用于 markdown/chunk/embedding 检索
- `NotebookManager` 保留，用于投影和人工编辑
- `Session Memory` 保留，用于 compact/续聊

### 10.2 新增的核心模块

建议新增：
- `src/memory/memory-engine.ts`
- `src/memory/memory-schema.ts`
- `src/memory/memory-extractor.ts`
- `src/memory/memory-context-builder.ts`
- `src/memory/memory-projection.ts`
- `src/memory/memory-settings.ts`

### 10.3 关键接入点

#### CLI
- `src/core/loop.ts`
  - 初始化 memory engine
  - `autoMemorize()` 改为写结构化 store + projection
  - `refreshPromptMemoryContext()` 改为走 context builder

#### Web
- `src/web/server/conversation.ts`
  - buildSystemPrompt 时改用统一 context builder
  - compact 后 consolidate 改为写 memory engine

#### Prompt
- `src/prompt/types.ts`
- `src/prompt/attachments.ts`
- `src/prompt/builder.ts`

#### API / UI
- `src/web/server/routes/notebook-api.ts`（兼容）
- 新增 `src/web/server/routes/memory-api.ts`
- `src/web/client/src/pages/CustomizePage/DocsPanel.tsx`
- 新增 `MemoryPanel` 相关前端组件

---

## 11. 分阶段实施

### Phase 1：建立结构化 memory store，但不破坏现有体验

目标：先落地基础设施与兼容层。

#### 改动
- 新增 memory item schema
- 新增 `MemoryEngine`
- 启动时初始化 store
- 提供基础 CRUD API
- 提供 notebook projection（从 memory store 生成 notebook 摘要）
- 提供只读 MemoryPanel

#### 不做
- 不马上替换所有 notebook 读写路径
- 不马上删掉 `memoryRecall/notebookSummary`

#### 测试
- 新增 memory engine CRUD 测试
- 新增 projection 测试
- 新增 project/global scope 测试

### Phase 2：改造 auto memory 写入链路

目标：从“重写 notebook”迁移到“写 memory items + 更新 projection”。

#### 改动
- `ConversationLoop.autoMemorize()` 改用 candidate -> item pipeline
- Web consolidate 跟随改造
- 增加 supersede / expire / evidence

#### 测试
- 偏好覆盖旧偏好
- 项目规则不串项目
- 临时 task context 有 TTL
- manual override 优先级高于 auto extracted

### Phase 3：改造 prompt 读取链路

目标：让记忆注入更像 ChatGPT。

#### 改动
- 引入 `MemoryContextBuilder`
- 将 prompt 常驻层与按需 recall 层拆开
- Web/CLI 共用统一 builder
- `memoryRecall` 不再只查 notebook chunk，而是先查结构化 memory item，再补 markdown recall

#### 测试
- 非相关问题不注入无关偏好
- 相关问题能召回最新偏好
- 删除后的 item 不再注入

### Phase 4：用户控制面

目标：让记忆可见、可控。

#### 改动
- MemoryPanel 支持 browse/search/filter/delete/edit/toggle
- 支持“忘掉这条”
- 支持关闭自动记忆

#### 测试
- API CRUD
- UI 交互回归
- 设置持久化

---

## 12. 风险与权衡

### 12.1 为什么不直接替换 LongTermStore

不建议直接把结构化 memory 混进 `chunks` 表里。
原因：
- 检索 chunk 和记忆 item 是两种数据模型
- 强行复用会让 schema 与排序逻辑混乱

更合理的是：
- `LongTermStore` 继续服务检索
- `MemoryEngine` 专门服务事实记忆
- 在 recall 层组合

### 12.2 为什么 v1 仍保留 notebook 注入

因为 notebook 当前已经深度嵌入系统：
- CLI prompt
- Web prompt
- DocsPanel
- 多项测试

如果一次性移除，风险过高。v1 应先让 notebook 退居 projection 层，而不是直接砍掉。

### 12.3 为什么不先做 connector / cloud 同步

因为当前目标是：
- 做出 ChatGPT 级记忆体验

而不是：
- 做大而全外部知识接入平台

优先级必须聚焦在：
- memory correctness
- memory retrieval timing
- user control

---

## 13. 需要修改的关键文件（第一轮）

### Memory 核心
- `src/memory/index.ts`
- `src/memory/types.ts`
- `src/memory/long-term-store.ts`
- 新增 `src/memory/memory-engine.ts`
- 新增 `src/memory/memory-context-builder.ts`
- 新增 `src/memory/memory-projection.ts`
- 新增 `src/memory/memory-extractor.ts`

### Prompt/Runtime
- `src/core/loop.ts`
- `src/web/server/conversation.ts`
- `src/prompt/types.ts`
- `src/prompt/attachments.ts`
- `src/prompt/builder.ts`

### Web API / UI
- `src/web/server/routes/api.ts`
- 新增 `src/web/server/routes/memory-api.ts`
- `src/web/client/src/pages/CustomizePage/DocsPanel.tsx`
- 新增 `src/web/client/src/pages/CustomizePage/MemoryPanel.tsx`

### Tests
- `tests/core/auto-memory.test.ts`
- `tests/memory/memory-search.test.ts`
- `tests/memory/notebook-sync.test.ts`
- 新增 `tests/memory/memory-engine.test.ts`
- 新增 `tests/memory/memory-projection.test.ts`
- 新增 `tests/web/memory-api.test.ts`
- 新增前端 MemoryPanel 测试

---

## 14. 推荐实施顺序

### 推荐方案

1. 先落结构化 store + API + projection
2. 再改 auto memory 写入
3. 再统一 prompt context builder
4. 最后做 UI 控制面完善

### 不推荐方案

- 直接重写 NotebookManager
- 直接移除 notebook 注入
- 先做复杂 graph UI
- 先做 connector/云同步

---

## 15. 本次建议

建议批准后按以下顺序实现：

### 第一步
落 `Memory Engine v1` 基础设施：
- schema
- engine
- projection
- 基础 API
- 基础测试

### 第二步
把 CLI/Web 的 auto memory 改成写结构化 store。

### 第三步
统一 prompt 注入逻辑。

这条路线的优点是：
- 风险最小
- 能逐步替换现有 notebook 主导结构
- 每一步都有可测试、可回滚边界
