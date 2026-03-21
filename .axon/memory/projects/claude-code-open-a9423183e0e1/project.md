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

## 2026-03-21

- Web 会话切换性能坑：`useWebSocket` 之前会把所有带 `sessionId` 的流式消息先广播给所有前端 handlers，再由更上层的 `useMessageHandler` 晚过滤；当两个会话都在运行时，后台会话的 `text_delta/tool_use_*` 也会触发 App、TTS 等副作用，切换时主线程明显卡顿。
- 修复规则：会话隔离要前移到 WebSocket 分发入口，只把当前激活会话需要的高频流式消息分发给 handlers；跨会话仍需保留 `status / permission_request / user_question` 这类提醒信号。回归覆盖在 `tests/web/useWebSocket-recovery.test.tsx`。
- Web UI 思考配置规则：输入框里的“思考开关/强度”不能只停留在前端状态，必须跟随每条 `chat` 消息一路透传到 `websocket -> ConversationManager -> runtime client`，否则用户看到开关变化但实际请求仍会沿用默认思考参数。
- 排队消息坑：上下文压缩期间缓存的待发送消息也必须携带“排队当时”的 `thinkingConfig` 快照，不能等真正发送时再读最新 UI 状态，否则用户在等待期间切换强度会让发出去的请求配置漂移，形成难复现的错配。
- OpenAI 思考档位规则：Web UI 不能把所有模型都硬编码成同一组思考强度；`GPT-5.4` 这类支持 `xhigh` 的 Codex/GPT-5 模型要显示 `xhigh`，而不支持该档位的模型必须自动收敛到自己的最高可用档位，避免 UI 允许选择但 runtime 实际不接受。
- AutoCompact 前端悬挂坑：`performAutoCompact()` 在内部吞掉压缩失败并返回 `wasCompacted: false` 时，Web 端不一定能收到 `context_compact:end/error`；如果后续会话已经继续流式输出，前端必须把停留在 `compacting` 的旧状态自愈清掉，否则输入框会一直把后续消息当作“压缩排队”。
- Codex 自定义网关兼容规则：`GPT-5.4` 走自定义 `/v1/responses` 时，代理可能直接返回 Cloudflare 524 之类的 HTML 错页；runtime client 不能把整页 HTML 原样抛给日志/前端，应该提炼成短错误，并在自定义 Responses 端点场景优先回退到 `/v1/chat/completions`。回归覆盖在 `tests/web/server/codex-client.test.ts` 和 `tests/web/useMessageHandler-compact-recovery.test.tsx`。
- ImageGen 上传图引用坑：Web 输入框里的图片附件如果只作为视觉内容传给模型、却没有同时保存成稳定的临时文件映射，模型一旦在工具调用里填了 `image_path` 就很容易退化成“只有文件名的相对路径”，最终在工作区根目录 `stat` 失败。修复规则：上传图片要同时保留 `name -> temp file path` 映射，并在执行 `ImageGen` 前把无效的相对 `image_path` 回绑到最近上传图；回归覆盖在 `tests/web/server/image-attachments.test.ts`。
- ImageGen 参数校验规则：`generateImage()` 必须先校验 `image_path` 是否存在、以及 `image_path/image_base64` 是否互斥，再初始化 Gemini client；否则本地输入错误会被 `GEMINI_API_KEY` 缺失这种远端前置条件掩盖，用户看不到真正可操作的报错。回归覆盖在 `tests/web/server/gemini-image-service.test.ts`。
- npm 发包规则：生产态 Web Server 运行时会从包内读取 `src/web/client/dist`；因此 npm 包的 `files` 必须显式包含该目录，且 `prepublishOnly` 必须先构建前端再发布，否则 `axon-web` 安装后只会返回 “Frontend Not Built”。回归覆盖在 `tests/release/npm-package-manifest.test.ts`。
- 发版决策：`v2.4.0` 之后已经累计了运行时配置、Web 会话隔离、思考配置透传、ImageGen 附图映射等一组新能力，不适合继续走补丁号；后续若基于这批改动发版，默认从 `2.4.x` 升到 `2.5.0`，并同步 `package.json`、`package-lock.json`、`electron/package.json` 三处版本源。
