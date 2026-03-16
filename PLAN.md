# Agent Network 聊天系统改造 — 从伪 IM 到真 IM

## 核心问题

当前 Agent Network 的聊天功能和微信/飞书有根本性差异：

### 问题 1：群聊是假的
- 群消息 = 对每个成员发 N 条独立 1:1 消息 + `_groupId` 标记
- 接收方 Agent **不知道自己在群里**，收到的就是普通私聊消息
- 成员 A 的回复，成员 B 看不到（除非发起方转发）
- 群聊没有共享上下文，每个成员的 AI 独立回复

### 问题 2：前端消息靠审计日志
- 聊天记录 = `network_audit` 表，本质是操作日志
- 缺少 `conversationId`、`threadId`、`groupId` 等聊天元数据
- 群聊消息的分组靠解析 `payload` JSON 中的 `_groupId`——脆弱且 hacky
- 前端每 5 秒全量拉 500 条审计日志来构建对话列表

### 问题 3：AI 回复的上下文
- **私聊上下文实际上是有的**：`chat:received` 事件创建独立 session（`chatSessions` Map），`conversationManager.chat()` 会维护完整对话历史
- **但群聊 AI 回复没有群上下文**：AI 收到的是 1:1 消息，不知道群里其他人说了什么

## 改动概览

共涉及 **7 个文件**的改动（+ 2 个新测试文件）：

| # | 文件 | 改动 |
|---|------|------|
| 1 | `src/network/types.ts` | 新增 `ChatMessage` 类型 + `AgentMessage` 扩展 `_groupId` |
| 2 | `src/network/audit-log.ts` | 新增 `chat_messages` 表 + 群消息一等公民存储 |
| 3 | `src/network/index.ts` | 群聊协议改造：群消息携带 `groupId` + 广播转发 |
| 4 | `src/web/server/routes/network-api.ts` | 群聊 API 改造 + 新增消息查询 API |
| 5 | `src/web/server/index.ts` | 群聊 session 管理：共享群上下文 |
| 6 | `src/web/client/src/pages/CustomizePage/NetworkPanel.tsx` | 前端改用消息 API + 群聊正确展示 |
| 7 | `src/web/client/src/pages/CustomizePage/NetworkPanel.module.css` | 群聊消息样式（多头像） |
| 8 | `tests/network/chat-messages.test.ts` | 新增：消息存储测试 |
| 9 | `tests/web/agent-group-chat.test.ts` | 新增：群聊集成测试 |

## 详细设计

### 1. 数据模型 — 独立的聊天消息表

**`src/network/types.ts` 新增：**

```typescript
/** 聊天消息（独立于审计日志） */
export interface ChatMessage {
  id: string;
  /** 会话标识：私聊用 `dm:{agentId}`, 群聊用 `group:{groupId}` */
  conversationId: string;
  /** 发送方 agentId（本机消息 = 自己的 agentId） */
  fromAgentId: string;
  fromName: string;
  /** 消息文本 */
  text: string;
  /** 回复引用 */
  replyTo?: { id: string; text: string };
  /** 时间戳 */
  timestamp: number;
  /** 发送状态 */
  status: 'sending' | 'sent' | 'delivered' | 'failed';
}
```

**设计决策：为什么不复用 `network_audit`？**
- 审计日志面向运维（谁在什么时间做了什么操作），聊天消息面向用户（对话流）
- 审计日志缺少 `conversationId`，前端只能按 agentId 分组 → 群聊无法正确分组
- 审计日志的 `payload` 是 JSON 字符串，需要 parse 才能提取 `_groupId` → 性能差
- 保留审计日志不动，新增 `chat_messages` 表专门存聊天

### 2. 存储层 — `audit-log.ts` 扩展

**新增 `chat_messages` 表：**

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,  -- dm:{agentId} 或 group:{groupId}
  from_agent_id TEXT NOT NULL,
  from_name TEXT NOT NULL,
  text TEXT NOT NULL,
  reply_to TEXT,                  -- JSON: { id, text }
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent'
);
CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id, timestamp);
```

**新增方法：**
- `saveMessage(msg: ChatMessage): void` — 保存消息
- `getMessages(conversationId: string, limit?: number, before?: number): ChatMessage[]` — 分页查询
- `getConversations(): { id: string; lastMessage: ChatMessage; unreadCount: number }[]` — 会话列表

**审计日志继续记录**，但前端聊天展示改读 `chat_messages`。

### 3. 群聊协议改造 — `index.ts`

**当前群聊流程（有问题的）：**
```
用户发消息到群 →
POST /api/network/group-send →
for each member: sendRequest(memberId, method, { ...params, _groupId }) →
每个成员独立收到 1:1 消息 → 独立回复 → 回复只发回给发起方
```

**改为：**
```
用户发消息到群 →
POST /api/network/group-send →
for each member: sendRequest(memberId, method, { ...params, _groupId, _groupName, _groupMembers }) →
收到群消息后，存到 chat_messages(conversationId=group:xxx) →
AI 回复时，检测 _groupId → 回复也广播给所有群成员（而不是只回复发起方）
```

**关键改动：**

a) `sendRequest` 群消息时携带完整群信息：
```typescript
const taggedParams = {
  ...params,
  _groupId: groupId,
  _groupName: group.name,
  _groupMembers: group.members,  // 让接收方知道群成员
};
```

b) `handleInboundMessage` 中检测 `_groupId`：
```typescript
case AgentMethod.Chat: {
  const groupId = chatParams?._groupId;
  if (groupId) {
    // 群消息：存到 group:{groupId} 会话
    this.auditLog.saveMessage({
      conversationId: `group:${groupId}`,
      fromAgentId: conn.agentId,
      fromName: conn.identity?.name || '',
      text: chatMessage,
      timestamp: Date.now(),
      status: 'delivered',
    });
    // emit 带 groupId 的事件，让上层创建群 session
    this.emit('chat:received', {
      fromAgentId: conn.agentId,
      fromName: conn.identity?.name || '',
      message: chatMessage,
      groupId,
      groupName: chatParams?._groupName,
      groupMembers: chatParams?._groupMembers,
    });
  } else {
    // 私聊：保持原逻辑
  }
}
```

c) `sendChatReply` 增加群回复模式：
```typescript
async sendChatReply(agentId: string, reply: string, groupId?: string): Promise<void> {
  if (groupId) {
    // 群回复：发送给所有群成员（除了自己和原始发送方）
    const group = this.auditLog.getGroups().find(g => g.id === groupId);
    if (group) {
      for (const memberId of group.members) {
        if (memberId === this.identityManager.agentId) continue;
        await this.sendRequest(memberId, AgentMethod.Chat, {
          message: reply,
          isReply: true,
          _groupId: groupId,
        });
      }
    }
    // 保存自己的回复到群聊记录
    this.auditLog.saveMessage({
      conversationId: `group:${groupId}`,
      fromAgentId: this.identityManager.agentId,
      fromName: this.identityManager.identity.name,
      text: reply,
      timestamp: Date.now(),
      status: 'sent',
    });
  } else {
    // 私聊回复：保持原逻辑
  }
}
```

### 4. 群聊 AI 上下文 — `index.ts` (chat:received 处理)

**当前：** 每个 agentId 一个独立 session
**改为：** 群聊共享一个 session（groupId → sessionId）

```typescript
// 原有
const chatSessions = new Map<string, string>(); // agentId → sessionId

// 改为
const chatSessions = new Map<string, string>(); // agentId|group:{groupId} → sessionId

agentNetwork.on('chat:received', async (chatData) => {
  const sessionKey = chatData.groupId
    ? `group:${chatData.groupId}`
    : chatData.fromAgentId;

  let sessionId = chatSessions.get(sessionKey);
  // ...创建 session 逻辑...

  // 群消息附带群上下文
  let messageContent = chatData.message;
  if (isNewSession && chatData.groupId) {
    messageContent = `<system-reminder>This is a group chat "${chatData.groupName}" with ${chatData.groupMembers?.length || 0} members. The message below is from "${chatData.fromName}". Respond to the group.</system-reminder>\n\n[${chatData.fromName}]: ${chatData.message}`;
  } else if (chatData.groupId) {
    // 非首条消息也标注发言者
    messageContent = `[${chatData.fromName}]: ${chatData.message}`;
  }

  // 回复时传入 groupId
  const callbacks = buildAgentChatCallbacks(
    broadcastFn, cm, sessionId, messageId,
    agentNetwork, chatData.fromAgentId, chatLog, chatErr,
    chatData.groupId,  // 新增参数
  );
});
```

### 5. API 改造 — `network-api.ts`

**新增消息查询 API：**

```typescript
/** GET /api/network/messages?conversationId=dm:xxx&limit=50&before=timestamp */
router.get('/messages', (req, res) => {
  const { conversationId, limit, before } = req.query;
  const messages = network.getMessages(conversationId, limit, before);
  res.json(messages);
});

/** GET /api/network/conversations — 获取所有会话列表（带最后消息） */
router.get('/conversations', (req, res) => {
  res.json(network.getConversations());
});
```

**改造 group-send：**
- 发送消息后同时 `saveMessage` 到 `chat_messages`
- 返回 `messageId` 给前端

### 6. 前端改造 — `NetworkPanel.tsx`

**数据源切换：**

```typescript
// 原来：全量拉审计日志 → 在前端分组
const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
// fetch('/api/network/audit?limit=500')

// 改为：拉会话列表 + 按需拉消息
const [conversations, setConversations] = useState<Conversation[]>([]);
const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());
// fetch('/api/network/conversations')  → 左侧列表
// fetch('/api/network/messages?conversationId=dm:xxx')  → 选中后拉消息
```

**群聊消息展示：**
- 私聊：只显示消息内容 + 时间（和现在一样）
- 群聊：每条消息前显示发送者头像 + 名字（微信群聊风格）

**WebSocket 实时推送改造：**
```typescript
// 新增消息类型
case 'network:chat_message': {
  const msg: ChatMessage = payload;
  setMessages(prev => {
    const conv = prev.get(msg.conversationId) || [];
    return new Map(prev).set(msg.conversationId, [...conv, msg]);
  });
  break;
}
```

### 7. 私聊消息也存 `chat_messages`

保持一致性：
- `sendRequest` 中检测到 chat 类消息时，同时 `saveMessage` 到 `chat_messages`
- 收到 chat 消息时，也 `saveMessage`
- 前端统一从 `chat_messages` 读取

## 实现顺序

1. **types.ts** — 新增 ChatMessage 类型
2. **audit-log.ts** — 新增 chat_messages 表 + 存取方法
3. **index.ts** — 群聊协议改造 + sendChatReply 群回复 + 消息存储
4. **network-api.ts** — 新增消息/会话 API
5. **index.ts (server)** — 群聊 session 共享上下文 + buildAgentChatCallbacks 支持 groupId
6. **NetworkPanel.tsx** — 前端改用消息 API + 群聊正确展示
7. **测试** — chat-messages.test.ts + agent-group-chat.test.ts

## 不做的事

- **不删除审计日志** — 审计日志继续存在，用于运维和调试，和 chat_messages 并行
- **不改 mDNS 发现** — 群组信息只在本地管理，不通过 mDNS 广播
- **不做端对端加密** — Phase 3 的事
- **不做消息撤回** — 复杂度过高，后续再做
- **不做群成员动态变更通知** — 先做静态群组

## 风险

1. **消息双写**：chat_messages 和 network_audit 都存消息 → 数据冗余
   - 可接受：两者用途不同，audit 是日志，chat 是用户数据
2. **群消息广播风暴**：N 个成员的群，AI 回复要发 N-1 条消息
   - 缓解：先限制群最大 10 人；后续可改为 pub/sub 模型
3. **群 session 上下文膨胀**：所有人的消息都进同一个 session
   - 缓解：依赖 conversationManager 的自动 compact 机制
