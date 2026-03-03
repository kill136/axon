# IM 通道整合方案：让人类在 IM 中主动指挥 AI 干活

## 问题定义

我们的连接器体系是 **AI→外部服务** 的方向（GitHub/Slack/Google MCP 工具），缺少 **人→AI** 的反向通道——让用户在微信、Telegram、飞书等已有 IM 中直接给 AI 下任务。

OpenClaw（F:\moltbot）是一个成熟的多通道 AI 网关，支持 20+ IM 平台。问题是：**整合什么、不整合什么**。

---

## 核心决策：不整合什么

经过对两边源码的详细核实，以下模块**明确不整合**：

### 1. ❌ Pi-Agent 运行时
- OpenClaw 强绑定 `@mariozechner/pi-coding-agent` 作为 AI 运行时
- 我们有自己的 `ConversationManager.chat()` + `conversationLoop()`，功能完备
- 引入 Pi-Agent = 引入一个完整的竞争运行时，维护成本极高

### 2. ❌ OpenClaw 的配置系统 (OpenClawConfig)
- 7.7万行配置代码，Zod Schema 极其复杂
- 我们有 `configManager` + `settings.json`，体系完全不同
- 硬整合 = 两套配置系统共存，是灾难

### 3. ❌ OpenClaw 的 Gateway WebSocket 协议
- OpenClaw 有完整的 Gateway RPC 协议（端口 18789）
- 我们已有 WebSocket 服务器（端口 3456），消息类型完全不同
- 不需要第二个 Gateway

### 4. ❌ OpenClaw 的路由系统 (resolve-route)
- 多 Agent 路由、per-peer 绑定、Guild/Team 匹配
- 我们是单用户/单 Agent 架构，不需要这么复杂的路由
- 每个 IM 通道直接连到当前活跃会话即可

### 5. ❌ OpenClaw 的 ACP 会话管理器
- 与 Pi-Agent 深度绑定
- 我们用 `WebSessionManager` 管理会话

### 6. ❌ OpenClaw 的记忆系统
- 虽然向量+FTS 混合搜索很好，但引入 sqlite-vec 等重依赖不值得
- 我们有 Notebook + MemorySearch，够用

### 7. ❌ OpenClaw 的插件系统
- 40 个 extensions，插件加载器复杂
- 我们只需要几个核心通道，不需要通用插件框架

---

## 核心决策：整合什么

### 整合原则
**不搬运 OpenClaw 的代码，而是从 OpenClaw 学习接口设计，用我们自己的架构重新实现精简版。**

理由：
1. OpenClaw 代码量 54 万行，我们只需要其中 <1% 的能力
2. 两个项目的架构风格完全不同（OpenClaw 的分层 vs 我们的扁平结构）
3. 直接 copy 代码会引入大量死代码和未使用的依赖

### 整合目标
构建一个轻量的 **IM Channel Gateway** 模块，功能明确：

```
用户在 IM 发消息 → Channel Adapter 接收 → 转为 chat() 调用 
    → ConversationManager 处理 → 回复通过 Channel Adapter 发回 IM
```

---

## 实现方案

### 架构设计

```
src/web/server/channels/
├── index.ts              # ChannelManager：通道生命周期管理
├── types.ts              # 通道接口定义（借鉴 OpenClaw 但大幅精简）
├── adapters/
│   ├── telegram.ts       # Telegram Bot 适配器（grammY）
│   ├── feishu.ts         # 飞书机器人适配器
│   └── slack-bot.ts      # Slack Bot 适配器（区别于现有的 MCP connector）
└── bridge.ts             # IM↔ConversationManager 桥接层
```

### 核心接口设计

```typescript
// types.ts - 精简的通道接口（从 OpenClaw 的 ChannelPlugin 大幅裁剪）

/** 通道适配器：只关心收发消息 */
interface ChannelAdapter {
  id: string;                    // 'telegram' | 'feishu' | 'slack-bot'
  name: string;                  // 显示名
  
  /** 启动通道（连接 IM 平台） */
  start(config: ChannelConfig): Promise<void>;
  
  /** 停止通道 */
  stop(): Promise<void>;
  
  /** 发送文本消息到 IM */
  sendText(target: string, text: string, options?: SendOptions): Promise<void>;
  
  /** 发送图片到 IM */
  sendImage?(target: string, imageData: Buffer, mimeType: string): Promise<void>;
  
  /** 当前状态 */
  getStatus(): ChannelStatus;
}

/** 通道配置 */
interface ChannelConfig {
  /** Telegram: Bot Token; 飞书: App ID + Secret; Slack: Bot Token */
  credentials: Record<string, string>;
  /** 白名单：允许哪些用户/群组发消息给 AI */
  allowList?: string[];
  /** 是否允许群组消息（默认只允许私聊） */
  allowGroups?: boolean;
}

/** 入站消息（从 IM 到 AI） */
interface InboundMessage {
  channel: string;               // 来源通道
  senderId: string;              // 发送者 ID
  senderName: string;            // 发送者昵称
  chatId: string;                // 聊天 ID（私聊=senderId，群=群ID）
  text: string;                  // 消息文本
  isGroup: boolean;              // 是否群组消息
  replyToMessageId?: string;     // 回复的消息 ID
  images?: Buffer[];             // 图片附件
  timestamp: number;
}

type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
```

### 桥接层设计（核心）

```typescript
// bridge.ts - IM 消息 ↔ ConversationManager 桥接

class IMBridge {
  constructor(
    private conversationManager: ConversationManager,
    private broadcastToWebUI: (msg: ServerMessage) => void
  ) {}

  /** 处理来自 IM 的消息 */
  async handleInboundMessage(msg: InboundMessage): Promise<void> {
    // 1. 权限检查（白名单）
    
    // 2. 获取或创建该 IM 用户的专属会话
    //    会话 ID 格式：im:{channel}:{chatId}
    //    例如：im:telegram:123456789
    const sessionId = `im:${msg.channel}:${msg.chatId}`;
    
    // 3. 构建 StreamCallbacks —— 关键：回复发到 IM 而不是 WebSocket
    const callbacks: StreamCallbacks = {
      onTextDelta: (text) => {
        // 累积文本，不每个 delta 都发（IM 有速率限制）
        this.accumulateText(sessionId, text);
      },
      onComplete: async (stopReason, usage) => {
        // 对话完成，将累积的文本一次性发送到 IM
        const fullText = this.flushText(sessionId);
        if (fullText) {
          await channel.sendText(msg.chatId, fullText);
        }
      },
      onToolUseStart: (id, name, input) => {
        // 可选：通知 IM 用户"正在执行工具 xxx"
      },
      onError: async (error) => {
        await channel.sendText(msg.chatId, `Error: ${error.message}`);
      },
    };
    
    // 4. 调用 ConversationManager.chat()
    //    复用完整的 AI 能力（工具调用、上下文管理、权限等）
    await this.conversationManager.chat(
      sessionId,
      msg.text,
      undefined,  // mediaAttachments
      model,
      callbacks,
      projectPath
    );
  }
}
```

### 通道实现（以 Telegram 为例）

```typescript
// adapters/telegram.ts

import { Bot } from 'grammy';  // 直接用 grammY（OpenClaw 也用的这个库）

class TelegramAdapter implements ChannelAdapter {
  id = 'telegram';
  name = 'Telegram';
  private bot?: Bot;
  private onMessage?: (msg: InboundMessage) => void;
  
  async start(config: ChannelConfig): Promise<void> {
    this.bot = new Bot(config.credentials.botToken);
    
    // 监听文本消息
    this.bot.on('message:text', (ctx) => {
      // 白名单检查
      if (!this.isAllowed(ctx.from.id, config)) return;
      
      this.onMessage?.({
        channel: 'telegram',
        senderId: String(ctx.from.id),
        senderName: ctx.from.first_name,
        chatId: String(ctx.chat.id),
        text: ctx.message.text,
        isGroup: ctx.chat.type !== 'private',
        timestamp: ctx.message.date * 1000,
      });
    });
    
    // 启动轮询
    this.bot.start();
  }
  
  async sendText(target: string, text: string): Promise<void> {
    // Telegram 消息长度限制 4096 字符，超出需要分块
    const chunks = splitMessage(text, 4096);
    for (const chunk of chunks) {
      await this.bot!.api.sendMessage(Number(target), chunk, {
        parse_mode: 'Markdown',
      });
    }
  }
  
  async stop(): Promise<void> {
    this.bot?.stop();
  }
}
```

### 配置方式

复用现有的 `settings.json` 结构，在 `channels` 字段下配置：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "credentials": {
        "botToken": "123456:ABC-DEF"
      },
      "allowList": ["user_id_1", "user_id_2"],
      "allowGroups": false,
      "model": "sonnet"
    },
    "feishu": {
      "enabled": true,
      "credentials": {
        "appId": "cli_xxx",
        "appSecret": "xxx"
      },
      "allowList": ["*"],
      "allowGroups": true
    }
  }
}
```

### Web UI 管理界面

在现有的 Connectors 页面旁边新增 "Channels" Tab：
- 显示各通道的连接状态（connected/disconnected/error）
- 配置凭据（Bot Token 等）
- 白名单管理
- 启用/停用开关
- 查看最近的 IM 消息日志

### 与现有功能的关系

| 现有功能 | IM 通道整合 | 关系 |
|---------|------------|------|
| Connectors (GitHub/Slack MCP) | Channels (Telegram/飞书 Bot) | **并行共存**，互不影响 |
| ConversationManager.chat() | IMBridge.handleInboundMessage() | **复用** chat() 作为入口 |
| WebSocket 消息流 | IM 消息流 | **并行**：Web UI 用 WS，IM 用各自 SDK |
| Session 管理 | IM 会话 | **复用** WebSessionManager，会话 ID 加 `im:` 前缀 |
| 工具系统 | IM 中的工具调用 | **完全复用**，无区别 |
| 权限系统 | IM 权限 | **复用** + 白名单额外过滤 |

---

## 实现优先级

### Phase 1：Telegram（最简单，验证架构）
- grammY 库，API 简单，文档完善
- OpenClaw 中最成熟的通道
- 全球用户量大

### Phase 2：飞书
- 中国用户刚需
- OpenClaw 有完整的飞书插件实现可参考
- WebSocket 长连接模式，无需公网

### Phase 3：Slack Bot（区别于现有 Slack MCP Connector）
- 现有的 `connector-slack` 是 MCP 工具（AI 主动操作 Slack）
- 新增的是 Slack Bot（人在 Slack 里给 AI 下命令）
- 两者共存，互补

### 暂不实现
- **微信**：只有社区第三方协议（WeChatPadPro），有封号风险，不稳定
- **钉钉**：OpenClaw 也不支持，API 生态较差
- **企业微信**：同上
- **Discord/WhatsApp**：国内用户少，优先级低

---

## 依赖变更

```json
{
  "dependencies": {
    "grammy": "^1.39.0"        // Telegram Bot SDK（Phase 1）
  },
  "optionalDependencies": {
    // 飞书 SDK（Phase 2，按需安装）
  }
}
```

**注意**：只增加 grammy 一个必须依赖。飞书等后续通道作为可选依赖。

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| IM SDK 依赖体积 | 增加包大小 | grammy 很轻量（<1MB） |
| 会话隔离不彻底 | IM 用户看到其他人的上下文 | 严格的 sessionId 隔离（`im:channel:chatId`） |
| IM 速率限制 | 回复被截断或延迟 | 消息累积 + 分块发送 |
| 工具执行安全性 | IM 用户执行危险操作 | 白名单 + 现有权限系统 |
| 现有功能回归 | 新代码影响 WebSocket 消息流 | 完全独立的模块，不修改现有代码 |

---

## 文件变更清单

### 新增文件
```
src/web/server/channels/
├── index.ts              # ChannelManager 类
├── types.ts              # 接口定义
├── bridge.ts             # IMBridge 桥接层
└── adapters/
    └── telegram.ts       # Telegram 适配器

src/web/client/src/components/ChannelsPanel/
├── index.tsx             # 通道管理面板
└── ChannelCard.tsx       # 单个通道卡片
```

### 修改文件
```
src/web/server/index.ts            # 初始化 ChannelManager
src/web/server/websocket.ts        # 添加 channel:* 消息类型
src/web/shared/types.ts            # 添加通道相关类型
src/web/server/conversation.ts     # 可能需要暴露 chat() 的更多参数
src/config/index.ts                # 添加 channels 配置字段
package.json                       # 添加 grammy 依赖
```

### 不修改的文件
- 核心引擎（src/core/）
- 工具系统（src/tools/）
- 权限系统（src/permissions/）
- 现有连接器（src/web/server/connectors/）
- CLI 模式（src/cli.ts）
