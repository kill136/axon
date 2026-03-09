# 技术设计：OpenAI SDK 集成方案

## 1. 问题定义

当前 Axon 后端**只有 Anthropic SDK 调用链**（`@anthropic-ai/sdk`），前端 SetupWizard 的 "OpenAI Provider" 选项是空架子。需要真正支持 OpenAI 消息格式的 API 调用。

### 1.1 当前架构（深度绑定 Anthropic）

```
ConversationLoop (loop.ts)
  └── ClaudeClient (client.ts)
        └── Anthropic SDK
              ├── client.beta.messages.create()  — 非流式
              └── client.beta.messages.stream()  — 流式
```

`ClaudeClient` 被以下 14 个文件直接引用：
1. `src/core/loop.ts` — 主对话循环
2. `src/web/server/conversation.ts` — WebSocket 会话管理（5 处 `new ClaudeClient`）
3. `src/web/server/api-manager.ts` — API 管理器
4. `src/web/server/routes/ai-hover.ts` — AI 悬停提示
5. `src/web/server/routes/ai-editor.ts` — AI 编辑器
6. `src/web/server/routes/autocomplete-api.ts` — 自动补全
7. `src/web/server/routes/config-api.ts` — 配置测试端点
8. `src/web/server/websocket-git-handlers.ts` — Git WebSocket
9. `src/wizard/onboarding.ts` — CLI 引导
10. `src/blueprint/smart-planner.ts` — 蓝图规划器
11. `src/blueprint/planner-session.ts` — 规划会话
12. `src/blueprint/agent-decision-maker.ts` — Agent 决策器
13. `src/hooks/index.ts` — Hook 系统
14. `src/core/client.ts` — 自身定义

### 1.2 Anthropic vs OpenAI 核心差异

| 维度 | Anthropic | OpenAI |
|------|-----------|--------|
| **System Prompt** | 独立 `system` 参数（`string \| TextBlock[]`） | `messages[0].role = 'system'` |
| **工具调用（请求）** | assistant content block: `{type:'tool_use', id, name, input}` | message 级: `tool_calls: [{id, type:'function', function:{name, arguments}}]` |
| **工具结果（响应）** | user 消息中的 content block: `{type:'tool_result', tool_use_id, content}` | 独立消息: `{role:'tool', tool_call_id, content}` |
| **工具定义** | `{name, description, input_schema}` | `{type:'function', function:{name, description, parameters}}` |
| **流式事件** | 6 种事件（message_start → content_block_start → content_block_delta → ...） | `choices[0].delta.content` / `choices[0].delta.tool_calls` / `[DONE]` |
| **Prompt Caching** | `cache_control: {type:'ephemeral'}` | 无 |
| **Extended Thinking** | `thinking` block + `budget_tokens` | 无直接对应（o-series 有 reasoning 但格式不同） |
| **Server Tools** | `web_search_20250305` server tool | 无 |
| **Token 格式** | `usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` | `usage.prompt_tokens` / `completion_tokens` |
| **Stop Reason** | `stop_reason: 'end_turn' \| 'tool_use' \| 'max_tokens'` | `finish_reason: 'stop' \| 'tool_calls' \| 'length'` |

---

## 2. 设计方案：Strategy Pattern + 消息适配器

### 2.1 架构总览

```
                      ┌──────────────────┐
                      │ ConversationLoop │
                      │   (loop.ts)      │
                      └────────┬─────────┘
                               │ 使用统一接口
                      ┌────────▼─────────┐
                      │   AIClient       │  ← 统一抽象接口（新建）
                      │   (interface)    │
                      └────────┬─────────┘
                    ┌──────────┼──────────┐
             ┌──────▼──────┐       ┌──────▼──────┐
             │AnthropicClient│     │OpenAIClient │
             │(现有 Claude  │     │(新建)       │
             │ Client 改名) │     │             │
             └──────┬──────┘     └──────┬──────┘
                    │                   │
             ┌──────▼──────┐    ┌──────▼──────┐
             │@anthropic-ai│    │  openai SDK  │
             │   /sdk      │    │  (v4.x)     │
             └─────────────┘    └─────────────┘
```

### 2.2 新增文件

| 文件 | 职责 |
|------|------|
| `src/core/ai-client.ts` | `AIClient` 接口定义 + 统一的请求/响应类型 |
| `src/core/openai-client.ts` | `OpenAIClient` 类 — 使用 OpenAI SDK 实现 `AIClient` |
| `src/core/client-factory.ts` | 工厂函数 `createAIClient(config)` — 根据 `apiProvider` 创建正确的 client |

### 2.3 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/core/client.ts` | `ClaudeClient` 实现 `AIClient` 接口（签名不变，只是 implements） |
| `src/config/index.ts` | `apiProvider` 枚举加 `'openai-compatible'` |
| `src/web/server/services/config-service.ts` | `ApiConfig.apiProvider` 类型加 `'openai-compatible'` |
| `src/web/server/routes/config-api.ts` | `/api/config/api/test` 支持 OpenAI 格式测试 |
| `src/web/server/conversation.ts` | `new ClaudeClient` → `createAIClient()`（5 处） |
| `src/web/server/api-manager.ts` | 同上 |
| 其他 9 个引用文件 | 逐步替换（低优先级，可延后） |

---

## 3. 接口设计

### 3.1 `AIClient` 接口 (`src/core/ai-client.ts`)

```typescript
/**
 * 统一 AI 客户端接口
 * Anthropic 和 OpenAI 都实现此接口
 */
export interface AIClient {
  /**
   * 非流式消息调用
   */
  createMessage(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: AIClientOptions
  ): Promise<AIResponse>;

  /**
   * 流式消息调用
   */
  createMessageStream(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: AIClientStreamOptions
  ): AsyncGenerator<AIStreamEvent>;

  /**
   * 获取累计使用统计
   */
  getUsage(): UsageStats;

  /**
   * 获取当前模型名
   */
  getModel(): string;

  /**
   * 获取 provider 类型
   */
  getProvider(): 'anthropic' | 'openai-compatible';
}
```

### 3.2 统一请求/响应类型

```typescript
/** AI 调用选项 */
export interface AIClientOptions {
  enableThinking?: boolean;
  thinkingBudget?: number;
  toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
  promptBlocks?: PromptBlock[];
  toolSearchEnabled?: boolean;
}

/** AI 非流式响应 */
export interface AIResponse {
  content: ContentBlock[];           // 统一使用 Anthropic 的 ContentBlock 格式
  stopReason: string;                // 统一为 'end_turn' | 'tool_use' | 'max_tokens'
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    thinkingTokens?: number;
  };
  thinking?: ThinkingResult;
  model: string;
}

/** AI 流式事件（统一格式） */
export interface AIStreamEvent {
  type: 'text' | 'thinking' | 'tool_use_start' | 'tool_use_delta' |
        'server_tool_use_start' | 'web_search_result' | 'stop' |
        'usage' | 'error' | 'response_headers';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: string;
  searchResults?: any[];
  data?: any;
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number; ... };
  error?: string;
  headers?: Headers;
}
```

**关键设计决策：统一使用 Anthropic 的内部格式作为"通用格式"**

理由：
1. Anthropic 格式是现有代码的基础，改动最小
2. `loop.ts` 中所有工具处理逻辑已经基于 `tool_use` / `tool_result` content block
3. OpenAI 的 `tool_calls` / `role: 'tool'` 可以在 `OpenAIClient` 内部双向转换
4. 避免大规模修改 `loop.ts`、`conversation.ts` 等消费端

### 3.3 `OpenAIClient` 内部转换逻辑

```
发送消息时（Anthropic内部格式 → OpenAI API 格式）：
  1. system prompt: 独立参数 → messages[0].role='system'
  2. messages: ContentBlock[] → OpenAI message format
     - tool_use block → assistant.tool_calls[]
     - tool_result block → {role:'tool', tool_call_id, content}
  3. tools: {name, input_schema} → {type:'function', function:{name, parameters}}

接收响应时（OpenAI API 格式 → Anthropic内部格式）：
  1. choices[0].message.content → [{type:'text', text}]
  2. choices[0].message.tool_calls → [{type:'tool_use', id, name, input}]
  3. finish_reason: 'stop'→'end_turn', 'tool_calls'→'tool_use', 'length'→'max_tokens'
  4. usage.prompt_tokens → inputTokens, completion_tokens → outputTokens

流式事件转换：
  1. choices[0].delta.content → {type:'text', text}
  2. choices[0].delta.tool_calls[i].function.arguments → {type:'tool_use_delta', input}
  3. choices[0].delta.tool_calls[i] (首次) → {type:'tool_use_start', id, name}
  4. [DONE] → {type:'stop'} + {type:'usage'}
```

---

## 4. 实施步骤（有序，每步可验证）

### Phase 1：基础设施（不影响现有功能）

**Step 1.1：添加 openai 直接依赖**
```bash
npm install openai
```

**Step 1.2：创建 `src/core/ai-client.ts`**
- 定义 `AIClient` 接口
- 定义统一的 `AIResponse`、`AIStreamEvent` 类型
- 纯类型文件，无运行时影响

**Step 1.3：更新 `src/config/index.ts`**
- `apiProvider` 枚举从 `['anthropic', 'bedrock', 'vertex']` 改为 `['anthropic', 'bedrock', 'vertex', 'openai-compatible']`

**Step 1.4：更新 `src/web/server/services/config-service.ts`**
- `ApiConfig.apiProvider` 类型加 `'openai-compatible'`

### Phase 2：实现 OpenAIClient

**Step 2.1：创建 `src/core/openai-client.ts`**
- 实现 `AIClient` 接口
- 消息格式转换（双向）
- 流式事件转换
- retry 逻辑（可复用 `retryLogic.ts`）
- 不支持的 Anthropic 特性（thinking, prompt caching, server tools）graceful 降级

**Step 2.2：创建 `src/core/client-factory.ts`**
- `createAIClient(config: ClientConfig & { apiProvider?: string }): AIClient`
- `apiProvider === 'openai-compatible'` → `new OpenAIClient(config)`
- 其他 → `new ClaudeClient(config)`

### Phase 3：让 ClaudeClient 实现 AIClient 接口

**Step 3.1：修改 `src/core/client.ts`**
- `ClaudeClient implements AIClient`
- 添加 `getUsage()`, `getModel()`, `getProvider()` 方法（已有 totalUsage，只需暴露）
- `createMessage` / `createMessageStream` 签名已经兼容，无需改变

### Phase 4：接入调用链

**Step 4.1：修改 `src/web/server/conversation.ts`**
- `import { createAIClient } from '../../core/client-factory.js'`
- 5 处 `new ClaudeClient(config)` → `createAIClient({...config, apiProvider})`
- `apiProvider` 从 `webConfigService.getApiConfig()` 获取

**Step 4.2：修改 `src/web/server/routes/config-api.ts`**
- `/api/config/api/test` 端点：根据 `apiProvider` 选择用 Anthropic SDK 还是 OpenAI SDK 测试

**Step 4.3：修改 `src/core/loop.ts`**
- `this.client` 类型从 `ClaudeClient` 改为 `AIClient`
- 构造时使用 `createAIClient(clientConfig)`

### Phase 5：前端对齐

**Step 5.1：修改 `SetupWizard.tsx`**
- `apiProvider: 'openai-compatible'` 已经是前端发送的值，现在后端能接受了

---

## 5. 不改什么（明确的非目标）

1. **不改 `loop.ts` 的工具处理逻辑** — OpenAIClient 负责在内部把 OpenAI 格式转成 Anthropic 内部格式
2. **不创建 MessageAdapter 抽象** — 转换逻辑内联在 OpenAIClient 中即可，没必要过度抽象
3. **不改类型系统 `types/messages.ts`** — 继续使用 Anthropic 风格的 ContentBlock，OpenAI 格式在 client 边界转换
4. **不改 streaming 模块 `src/streaming/`** — 那是 SSE 解析层，OpenAI SDK 自带 streaming 处理
5. **不一次性替换所有 14 个引用** — Phase 4 只改核心路径（conversation.ts + loop.ts + config-api.ts），其他文件延后

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| OpenAI function calling 参数格式转换出 bug | 高 | 中 | 单元测试覆盖所有转换路径 |
| 流式事件时序不一致（tool_use 的 delta 拼接） | 中 | 高 | 参考 OpenAI cookbook 的 streaming 处理 |
| 不支持 Anthropic 特有功能（thinking, caching） | 低 | 低 | OpenAIClient 明确跳过，不报错 |
| openai SDK 版本兼容性（vectra 用的 4.x） | 低 | 低 | 已有 4.104.0，直接装为直接依赖 |
| 第三方兼容端点的行为差异（DeepSeek, 硅基流动等） | 中 | 中 | 先支持标准 OpenAI API，后续按需适配 |

---

## 7. 验收标准

1. 用 OpenAI API Key + `api.openai.com` 能正常对话（非流式 + 流式）
2. 用 OpenRouter API Key + `openrouter.ai/api/v1` 能正常对话
3. 工具调用（至少 Bash、Read、Write）能正常工作
4. SetupWizard 选 OpenAI → 填 Key → 测试连接成功 → 开始对话
5. 现有 Anthropic 功能完全不受影响（回归测试）
6. 切换 Provider 后重建 client，不需重启服务
