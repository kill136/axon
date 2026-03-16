# 委派任务执行过程可见化

## 问题
委派任务在后台创建新会话执行，但用户无法感知——既不知道有任务在执行，也看不到执行过程。

## 方案：三层可见化

### 1. useMessageHandler 中处理 `session_created` 的后台会话标记
**问题**：当前 `session_created` 会无条件将 `sessionIdRef` 切换到新会话，后台创建的委派任务会话不应打断用户。

**修改**：`src/web/client/src/hooks/useMessageHandler.ts`
- 在 `session_created` 处理中，检查 `payload.tags` 是否包含 `delegated-task`
- 如果是后台任务创建的会话，**不切换** `sessionIdRef`
- 而是弹出 CrossSessionToast 通知用户

### 2. 扩展 CrossSessionNotification 支持委派任务类型
**修改**：`src/web/client/src/hooks/useMessageHandler.ts`
- `CrossSessionNotification` 类型增加 `type: 'delegated_task'` 
- 新增字段 `taskDescription?: string`、`fromAgent?: string`

**修改**：`src/web/client/src/components/CrossSessionToast.tsx`
- 增加 delegated_task 类型的展示：显示来源 Agent 名、任务描述
- 图标用 `🤝`

### 3. 后端 broadcast session_created 时携带 delegated-task 元信息
**修改**：`src/web/server/index.ts` 中 `task:delegated` handler
- 在 `session_created` payload 中增加 `fromAgent` 和 `taskDescription` 字段
- 已有 `tags: ['delegated-task']`，足够前端判断

### 修改文件清单
1. `src/web/client/src/hooks/useMessageHandler.ts` — session_created 判断 + CrossSessionNotification 扩展
2. `src/web/client/src/components/CrossSessionToast.tsx` — delegated_task 展示
3. `src/web/server/index.ts` — session_created payload 增加元信息
4. `src/web/client/src/i18n/locales/en/common.ts` + `zh/common.ts` — 新增翻译 key
5. 测试文件更新
