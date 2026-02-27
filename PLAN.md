# Web UI API 额度使用量显示

## 需求
用户需要在 Web UI 中看到 Anthropic API 的 Plan 使用量（类似 claude.ai/settings/usage 页面），包括：
- 当前会话周期的使用率百分比
- 每周限制的使用率
- 重置时间

## 数据来源
Anthropic API 每次响应都会返回 `anthropic-ratelimit-unified-*` 系列响应头：
- `anthropic-ratelimit-unified-status`: allowed / allowed_warning / rejected
- `anthropic-ratelimit-unified-reset`: 重置时间 (Unix timestamp)
- `anthropic-ratelimit-unified-5h-utilization`: 5 小时窗口使用率 (0-1)
- `anthropic-ratelimit-unified-7d-utilization`: 7 天窗口使用率 (0-1)
- `anthropic-ratelimit-unified-representative-claim`: 限制类型
- `anthropic-ratelimit-unified-fallback`: 是否有降级可用

CLI 的 `loop.ts` 已经有 `parseRateLimitHeaders()` 和 `updateRateLimitStatus()` 函数（~line 290-363），但 `conversation.ts` 的流式处理没有处理 `response_headers` 事件。

## 实现方案

### 1. 后端：conversation.ts 添加 response_headers 处理

**文件**: `src/web/server/conversation.ts`

- 从 `../../core/loop.js` 导出 `parseRateLimitHeaders` 函数（需要先在 loop.ts 中 export）
- 在 StreamCallbacks 接口添加 `onRateLimitUpdate` 回调
- 在 for-await 循环的 switch 中添加 `case 'response_headers'`，解析 headers 并调用回调

```typescript
// StreamCallbacks 新增：
onRateLimitUpdate?: (info: {
  status: string;        // allowed | allowed_warning | rejected
  utilization5h?: number; // 5h 使用率 (0-1)
  utilization7d?: number; // 7d 使用率 (0-1)
  resetsAt?: number;     // 重置时间 Unix timestamp (seconds)
  rateLimitType?: string;
}) => void;
```

### 2. 后端：loop.ts 导出 parseRateLimitHeaders

**文件**: `src/core/loop.ts`

- 导出 `parseRateLimitHeaders` 函数（当前是模块内部函数）
- 或者直接在 conversation.ts 中内联解析逻辑（更简单，避免跨模块依赖）

**决定**: 直接在 conversation.ts 中内联解析。因为 conversation.ts 已经不依赖 loop.ts 的流式处理，保持独立性更好。

### 3. 后端：websocket.ts 注册回调

**文件**: `src/web/server/websocket.ts`

在 `onContextUpdate` 回调旁边添加：

```typescript
onRateLimitUpdate: (info) => {
  sendMessage(getActiveWs(), {
    type: 'rate_limit_update',
    payload: { ...info, sessionId: chatSessionId },
  });
},
```

### 4. 前端：useMessageHandler 处理消息

**文件**: `src/web/client/src/hooks/useMessageHandler.ts`

- 新增 `rateLimitInfo` state
- 在 switch 中添加 `case 'rate_limit_update'`
- 返回 `rateLimitInfo`

### 5. 前端：创建 ApiUsageBar 组件

**文件**: `src/web/client/src/components/ApiUsageBar.tsx` + `ApiUsageBar.css`

显示一个紧凑的使用量指示器，类似 ContextBar 风格：
- 显示 5h 使用率进度条 + 百分比
- hover 时显示详细信息（7d 使用率、重置时间）
- 颜色分级：绿/黄/红

### 6. 前端：在 InputArea 中集成

**文件**: `src/web/client/src/components/InputArea.tsx`

在 ContextBar 旁边添加 ApiUsageBar。

### 7. App.tsx 传递 props

**文件**: `src/web/client/src/App.tsx`

从 useMessageHandler 获取 rateLimitInfo，传递给 InputArea。

## 修改文件清单

1. `src/web/server/conversation.ts` - 添加 response_headers case + StreamCallbacks
2. `src/web/server/websocket.ts` - 注册 onRateLimitUpdate 回调
3. `src/web/client/src/hooks/useMessageHandler.ts` - 处理 rate_limit_update 消息
4. `src/web/client/src/components/ApiUsageBar.tsx` - 新组件
5. `src/web/client/src/components/ApiUsageBar.css` - 新样式
6. `src/web/client/src/components/InputArea.tsx` - 集成 ApiUsageBar
7. `src/web/client/src/App.tsx` - 传递 rateLimitInfo
8. `src/web/client/src/components/ContextBar.tsx` - 导出 formatTokens 等工具函数（可选复用）

## 注意事项
- response_headers 只在每次 API 调用完成后才有，不是实时更新
- 如果用户刚进入页面还没有发过消息，不会有使用量数据，不显示即可
- 5h 和 7d 使用率可能不同时存在，只显示有的那个
