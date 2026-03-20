# Project Notebook

## 2026-03-20

- `ConversationManager` startup stack overflow root cause: `getRuntimeProvider()` and `getRuntimeCustomModelName()` called each other while the constructor normalized the default model, so Web startup could fail before any session was created.
- Fix rule: runtime provider/model resolution must flow one way from `runtimeBackend + stored backend model + codex/custom fallback`, and must never infer provider by calling a custom-model getter that can call provider again.
- Regression coverage lives in `tests/web/server/runtime-selection.test.ts` and `tests/web/server/conversation.test.ts`.
- Frontend pitfall: assistant messages created locally in `useMessageHandler` must carry `runtimeBackend`, not just `model`; otherwise Axon Cloud sessions using GPT models render as `CODEX` because the UI falls back to model-based provider inference.
- Proxy privacy rule: OAuth proxy forwarding must strip client-origin IP headers such as `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `forwarded`, and `true-client-ip`; otherwise a reverse proxy in front of Axon can leak downstream client IPs to Anthropic.
- Regression coverage for this lives in `tests/proxy/ip-header-sanitization.test.ts`.
