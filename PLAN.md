# 5 项 OpenClaw 借鉴改进计划

## 概述

基于 OpenClaw 研究成果，实施 5 项改进。按依赖关系和复杂度排序。

---

## Task 1: WS 背压控制 (websocket.ts)

**问题**: 当前 broadcast 无背压检测，慢客户端会导致 Node.js 进程内存膨胀。

**方案**: 参考 OpenClaw `server-broadcast.ts` 的 `bufferedAmount` 检查模式。

**改动文件**: `src/web/server/websocket.ts`

### 具体实现

1. **在文件顶部定义背压常量**:
```typescript
const MAX_BUFFERED_BYTES = 10 * 1024 * 1024; // 10MB per connection
```

2. **改造 `sendMessage()` 函数** (line 1371):
   - 在 `ws.readyState === WebSocket.OPEN` 检查后，加 `ws.bufferedAmount > MAX_BUFFERED_BYTES` 检查
   - 超限时 `ws.terminate()` 断开慢客户端，记录 warn 日志
   - 不影响现有的 closedWsLogged 逻辑

3. **改造 `broadcastMessage()` (line 183)、`broadcastToSubscribers()` (line 269)、`broadcastToAllClients()` (line 283)**:
   - 统一提取为带背压检查的内部函数 `safeSend(ws, messageStr)`
   - 检查 `bufferedAmount`，超限时 terminate 并从 clients Map 中删除

4. **不需要 `dropIfSlow` 模式** — 我们不是多租户，单用户场景下直接 terminate 更合理

### 代码量估计: ~40 行

---

## Task 2: settings.json 未知字段告警 (config/index.ts)

**问题**: UserConfigSchema 使用 `.passthrough()`，写错字段名（如 `enabed`）完全静默。

**方案**: 参考 OpenClaw 的 `.strict()` 模式。但我们不能直接用 `.strict()` 因为 channels、connectors 等扩展字段会被拒绝。折中方案：加载后对比 schema 已知字段和实际字段，未知字段打 warn。

**改动文件**: `src/config/index.ts`

### 具体实现

1. **新增 `warnUnknownFields()` 私有方法** (ConfigManager 类中):
   - 获取 `UserConfigSchema.shape` 的所有 key（即 schema 定义的合法字段名）
   - 遍历 loadedConfig 的顶层 key
   - 对不在 schema 中且不在白名单的 key，打 `console.warn` 告警
   - **白名单**: `channels`、`connectors`、`plugins`、`hooks`、`customTools`、`browserSettings` — 这些是已知的扩展字段，不在 UserConfigSchema 中但合法

2. **调用时机**: 在 `loadAndMergeConfig()` 完成后调用，只对 user/project/local 三个配置文件分别检查

3. **保留 `.passthrough()`** 不改 — 校验仍然宽松，只是多了告警

### 代码量估计: ~35 行

---

## Task 3: Credentials 脱敏 (websocket.ts + config-service.ts)

**问题**: IM 通道的 credentials（bot token 等）通过 WS 明文传输到前端，Web UI 配置对话框中也明文显示。

**方案**: 参考 OpenClaw 的 `REDACTED_SENTINEL` + `isSensitiveConfigPath()` 模式。在 WS 传输层自动脱敏。

**改动文件**: 
- `src/web/server/websocket.ts` — channel:list 响应中脱敏 credentials
- `src/web/server/channels/index.ts` — getAllStatus() 输出时脱敏
- `src/env/sensitive.ts` — 复用已有的 `maskSensitive()` 函数

### 具体实现

1. **在 `ChannelManager` 中新增 `getAllStatusRedacted()` 方法**:
   - 调用 `getAllStatus()` 获取原始数据
   - 遍历每个 channel 的 `credentials` 字段
   - 对 value 调用 `maskSensitive()` — 已有函数，直接复用
   - 返回脱敏后的状态

2. **修改 websocket.ts 中 `channel:list` 消息处理**:
   - 改为调用 `getAllStatusRedacted()` 而非 `getAllStatus()`
   - 前端显示 `sk-a***5678` 而非明文 token

3. **修改 `channel:config_update` 处理逻辑**:
   - 前端提交配置时，如果 credential 值为 `maskSensitive()` 格式（即含 `***`），跳过更新该字段
   - 防止用户点保存时把脱敏后的值写回

4. **不修改前端** — 纯后端脱敏，前端无感知

### 代码量估计: ~50 行

---

## Task 4: 插件钩子分类 — void hooks vs blocking hooks (plugins/index.ts)

**问题**: 当前 `executeHook()` 全部串行执行且允许修改 context。对于 `onSessionStart`、`onSessionEnd` 等通知型钩子，应该并行且不允许修改数据（void hook）。对于 `beforeMessage`、`beforeToolCall` 应该串行且能修改（blocking hook）。

**方案**: 参考 OpenClaw 的 void/blocking 双模式。

**改动文件**: `src/plugins/index.ts`

### 具体实现

1. **定义钩子分类常量**:
```typescript
const VOID_HOOKS: Set<PluginHookType> = new Set([
  'afterMessage', 'onError', 'onSessionStart', 'onSessionEnd',
  'onPluginLoad', 'onPluginUnload'
]);
const BLOCKING_HOOKS: Set<PluginHookType> = new Set([
  'beforeMessage', 'afterMessage', 'beforeToolCall', 'afterToolCall'
]);
```
注：`afterMessage` 和 `afterToolCall` 出现在两个集合中 — `afterToolCall` 可能需要拦截，默认 blocking。实际按以下规则：
- `before*` → blocking (串行，可修改 context)
- `after*` → blocking (串行，可修改 context，用于后处理)
- `on*` → void (并行，不能修改 context)

2. **修改 `executeHook()` 方法** (line 1172):
   - 判断 hookType 是否在 VOID_HOOKS 中
   - **Void 模式**: `Promise.allSettled(hooks.map(h => h.handler(context)))` — 并行，忽略返回值
   - **Blocking 模式**: 保持现有串行逻辑不变
   - 两种模式都 catch 错误并 emit `hook:error`

3. **新增 `executeVoidHook()` 和 `executeBlockingHook()` 便捷方法** (可选，保持向后兼容):
   - `executeVoidHook(hookType, context)` — 仅触发 void hooks
   - `executeBlockingHook(hookType, context)` — 仅触发 blocking hooks
   - `executeHook()` 保持为自动判断入口

### 代码量估计: ~40 行

---

## Task 5: 记忆搜索增强 — 关键词提取 + 搜索质量 (memory/)

**问题**: 当前 FTS5 搜索是直接把用户 query 原文扔给 FTS5。对话式查询（如 "那个关于 API 超时的讨论"）包含大量停用词，降低搜索精度。

**方案**: 参考 OpenClaw `query-expansion.ts` 的关键词提取模式。不引入 sqlite-vec，纯优化 FTS5 搜索质量。

**改动文件**: 
- `src/memory/long-term-store.ts` — 搜索方法改进
- 新建 `src/memory/query-expansion.ts` — 关键词提取

### 具体实现

1. **新建 `src/memory/query-expansion.ts`** (~60 行):
```typescript
// 中英文停用词表
const STOP_WORDS_EN = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
  'that', 'this', 'those', 'these', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom']);

const STOP_WORDS_ZH = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '他', '她', '它', '那', '么', '吗', '呢', '吧', '啊', '把',
  '被', '比', '别', '从', '但', '当', '对', '而', '该', '跟', '还', '或', '给', '让',
  '如果', '所以', '虽然', '但是', '因为', '可以', '这个', '那个', '什么', '怎么', '哪个']);

export function extractKeywords(query: string): string[] {
  // 1. Unicode-aware tokenization
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) || [];
  // 2. 过滤停用词
  return tokens
    .filter(t => !STOP_WORDS_EN.has(t.toLowerCase()) && !STOP_WORDS_ZH.has(t))
    .slice(0, 20); // 最多 20 个关键词
}
```

2. **修改 `LongTermStore.search()` 方法**:
   - 导入 `extractKeywords()`
   - 搜索流程改为：
     a. 先用原始 query 做 FTS5 搜索
     b. 如果结果不足 maxResults 的一半，用提取的关键词 OR 连接做补充搜索
     c. 合并去重，按 score 排序
   - 关键词 query 格式: `keyword1 OR keyword2 OR keyword3`

3. **改进 FTS5 query 构建** (LongTermStore.search 中):
   - 当前直接 `tokenizeChinese(query)` 扔给 FTS5
   - 改为：对非 CJK token 也做停用词过滤，减少噪声

### 代码量估计: ~100 行 (60 新文件 + 40 修改)

---

## 实施顺序

1. **Task 1** (WS 背压) — 独立，不依赖其他
2. **Task 3** (Credentials 脱敏) — 独立，不依赖其他
3. **Task 2** (未知字段告警) — 独立，不依赖其他
4. **Task 4** (插件钩子分类) — 独立，不依赖其他
5. **Task 5** (记忆搜索增强) — 独立，不依赖其他

五个任务互不依赖，可以按任意顺序实施。按上述顺序从低复杂度到高复杂度推进。

## 编译验证

每个 Task 完成后执行 `npx tsc --noEmit` 验证。全部完成后执行 `npm run build`。

## 不做的事

- 不引入新依赖（sqlite-vec、chokidar 等）
- 不改 UserConfigSchema 为 `.strict()`（会破坏扩展字段）
- 不改前端代码（除非必要的类型更新）
- 不改 ConversationManager 核心引擎
- 不添加 WS 事件序号 seq（受益/成本不值得，我们不是多客户端高并发场景）
