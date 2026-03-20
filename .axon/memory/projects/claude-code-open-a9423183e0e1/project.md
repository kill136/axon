# Project Notebook

## 2026-03-20

- `ConversationManager` startup stack overflow root cause: `getRuntimeProvider()` and `getRuntimeCustomModelName()` called each other while the constructor normalized the default model, so Web startup could fail before any session was created.
- Fix rule: runtime provider/model resolution must flow one way from `runtimeBackend + stored backend model + codex/custom fallback`, and must never infer provider by calling a custom-model getter that can call provider again.
- Regression coverage lives in `tests/web/server/runtime-selection.test.ts` and `tests/web/server/conversation.test.ts`.
- Frontend pitfall: assistant messages created locally in `useMessageHandler` must carry `runtimeBackend`, not just `model`; otherwise Axon Cloud sessions using GPT models render as `CODEX` because the UI falls back to model-based provider inference.
- Frontend pitfall: `useWebSocket` auto-restore stale session IDs from `localStorage` can legitimately fail after session deletion/cleanup; this must be handled inside the hook before broadcasting to app-level message handlers, otherwise startup shows a fake chat error even though the hook already self-healed by requesting a fresh session.
- 会话恢复坑：`handleSessionSwitch()` 会先把新 ws 挂到运行中的会话，再补发 pending 弹窗；如果 `AskUserQuestion` 恰好在这个窗口内已经实时发到新 ws，恢复逻辑就会重复补发一次。修复规则：pending user question 必须记录“是否已送达当前 ws”，恢复时只补发当前连接未收到的那批。
- Proxy privacy rule: OAuth proxy forwarding must strip client-origin IP headers such as `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `forwarded`, and `true-client-ip`; otherwise a reverse proxy in front of Axon can leak downstream client IPs to Anthropic.
- Regression coverage for this lives in `tests/proxy/ip-header-sanitization.test.ts`.
- Codex 本机登录坑：`~/.codex/auth.json` 不只会存 ChatGPT OAuth token，也可能只有 `OPENAI_API_KEY`。导入逻辑必须同时支持这两种结构，否则“导入本机登录”会误报 `No usable Codex credentials found in auth.json`。
- Codex 运行时规则：ChatGPT OAuth 继续走 `https://chatgpt.com/backend-api/codex`；如果是 `OPENAI_API_KEY` 这类 Codex API key 登录，默认应走 `https://api.openai.com/v1`，且允许显式 `/v1` 覆盖地址。相关回归测试在 `tests/web/server/codex-auth-manager.test.ts` 和 `tests/web/server/web-auth.test.ts`。
- Codex 本机配置导入规则：`~/.codex/auth.json` 只负责凭证，`~/.codex/config.toml` 负责模型和 provider/base_url；Web UI 的“导入本机登录”必须同时导入两者，并把 `model` 同步到 `defaultModelByBackend['codex-subscription']`，否则自定义 provider 会变成“凭证导进来了，但请求还在用旧地址/旧模型”。
- Codex Responses 流式坑：`response.output_item.added` / `response.function_call_arguments.done` 已经把工具调用流给前端后，`response.completed` 里的同一份 `function_call` 不能再完整重放，否则会在聊天转录里生成第二张一模一样的工具卡片；正确策略是 `response.completed` 只补发流里缺失的部分（如漏掉的 `tool_use_complete`）并负责 `usage/stop` 收尾。回归测试在 `tests/web/server/codex-client.test.ts`。
