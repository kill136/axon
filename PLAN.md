# Agent Network IM 化改造计划

## 问题分析

当前 NetworkPanel 本质是一个**协议调试器**：
- 左栏：身份卡片 + Agent 列表（纯技术信息：endpoint、agentId）
- 右栏：审计日志表格（时间 | 方向 | Agent | method | summary）
- 发送区域：手动输入 JSON-RPC method + params

**和微信 IM 的差距：**
1. **没有"聊天"概念** — 只有审计日志的平铺列表，没有按 Agent 分组的对话
2. **没有好友管理** — Agent 发现后直接出现在列表里，没有"加好友"、分组、备注
3. **消息展示是表格行** — 不是聊天气泡，无法直观看到对话上下文
4. **发送体验是开发者工具** — 需要手动选 method、填 JSON params
5. **没有未读消息提示** — 新消息来了没有任何视觉反馈
6. **没有 Agent 头像** — 全是文字，无法快速区分

## 设计目标

把 NetworkPanel 改造成**微信风格的 AI Agent IM**，但保留 Agent 特有的能力（工具调用、任务委派）。

## 架构设计

### 三栏布局（微信经典）

```
┌──────────────┬─────────────────────────┬──────────────┐
│  好友/联系人   │      聊天窗口            │  Agent 详情   │
│  (280px)     │      (flex: 1)          │  (300px)     │
│              │                         │  可折叠       │
│ [搜索框]      │ ┌─────────────────────┐ │              │
│              │ │ 聊天头 (Agent名+状态) │ │ 身份信息      │
│ ● Agent-A    │ ├─────────────────────┤ │ 信任等级      │
│   last msg.. │ │                     │ │ 项目列表      │
│   2min ago   │ │  消息气泡区域        │ │ 工具列表      │
│              │ │  (按时间排列)        │ │ 操作按钮      │
│ ● Agent-B    │ │                     │ │  - 信任/拉黑  │
│   Task done  │ │  ← 收到的消息       │ │  - 踢出       │
│   5min ago   │ │     发出的消息 →     │ │  - 调用工具   │
│              │ │                     │ │  - 委派任务   │
│ ○ Agent-C    │ ├─────────────────────┤ │              │
│   offline    │ │ 输入区域             │ │              │
│              │ │ [消息输入] [发送]    │ │              │
│              │ │ 快捷: Ping|工具|任务 │ │              │
└──────────────┴─────────────────────────┴──────────────┘
```

### 状态管理

#### 1. 从"审计日志"到"对话消息"

当前 `AuditLogEntry` 是按时间平铺的，需要按 Agent 分组成"对话"：

```typescript
// 新增：按 Agent 分组的对话视图
interface AgentConversation {
  agentId: string;
  agent: DiscoveredAgent;
  messages: AuditLogEntry[];     // 该 Agent 的所有消息
  unreadCount: number;           // 未读消息数
  lastMessage?: AuditLogEntry;   // 最后一条消息（用于列表预览）
  lastActivity: number;          // 最后活跃时间（用于排序）
}
```

**前端逻辑**：从 `auditLog[]` 数组中，按 `fromAgentId` / `toAgentId` 分组，生成 `Map<agentId, AgentConversation>`。

#### 2. 好友管理

不新增后端 API，纯前端改造：
- **已发现的 Agent** = 联系人列表（自动添加）
- **信任等级** = 好友关系（unknown=陌生人, known=好友, same-owner=家人）
- **备注名** — 暂不实现，后续可加
- **分组** — 按信任等级自动分组（同主人 / 已信任 / 未知）

#### 3. Agent 头像

用 agentId 的前几个字符生成**彩色字母头像**：
- 背景色：从 agentId hash 映射到预定义的 8 种颜色
- 文字：Agent name 的首字母（大写）
- 在线状态：右下角绿色/灰色圆点

### 消息气泡设计

```
┌─ 收到的消息（左对齐）──────────────────────┐
│ [头像]  Agent-A                    14:23  │
│         ┌──────────────────────┐          │
│         │ agent.ping           │  ← 方法  │
│         │ Response: pong       │  ← 结果  │
│         └──────────────────────┘          │
└───────────────────────────────────────────┘

┌─ 发出的消息（右对齐）──────────────────────┐
│                               14:25  Me  │
│         ┌──────────────────────┐          │
│         │ agent.callTool       │  ← 方法  │
│         │ toolName: "Read"     │  ← 参数  │
│         │ ✓ Success            │  ← 状态  │
│         └──────────────────────┘          │
└───────────────────────────────────────────┘

┌─ 任务委派（特殊卡片）─────────────────────┐
│         ┌──────────────────────────┐      │
│         │ 📋 Task Delegated        │      │
│         │ "Run tests for module X" │      │
│         │ ████████░░ 80%           │      │
│         │ Status: running          │      │
│         └──────────────────────────┘      │
└───────────────────────────────────────────┘
```

### 输入区域设计

替代当前的"method + JSON params"表单：

```
┌───────────────────────────────────────────────┐
│ [Ping] [工具调用] [委派任务]    ← 快捷操作按钮  │
├───────────────────────────────────────────────┤
│ ┌─────────────────────────────────┐ [发送 ↑]  │
│ │ 输入消息...                      │          │
│ └─────────────────────────────────┘          │
│ 默认发 agent.notify, 快捷按钮切换模式          │
└───────────────────────────────────────────────┘
```

- **直接输入文本** → 发送 `agent.notify` 带文本内容
- **Ping 按钮** → 一键发送 `agent.ping`
- **工具调用按钮** → 弹出工具选择器（从对方 exposedTools 列表选）
- **委派任务按钮** → 弹出任务描述输入框

## 修改文件清单

### 1. `NetworkPanel.tsx` — 完整重写（核心）

从 800 行协议调试器 → IM 界面：

- **ContactList 组件**：左栏好友列表
  - Agent 头像（彩色字母 + 在线状态点）
  - Agent 名称 + 最后消息预览
  - 未读消息 badge
  - 按信任等级分组
  - 搜索过滤

- **ChatWindow 组件**：中栏聊天窗口
  - 聊天头部（Agent 名 + 在线状态 + 信任 badge）
  - 消息气泡列表（按时间排列，自动滚动到底部）
  - 输入区域（文本输入 + 快捷操作）
  - 空状态（"选择一个 Agent 开始对话"）

- **AgentProfile 组件**：右栏 Agent 详情
  - 大头像 + 名称 + 状态
  - 身份信息（agentId、endpoint、版本）
  - 项目列表
  - 工具列表（可折叠）
  - 操作按钮（信任/取消信任、踢出）
  - 可折叠（点击聊天头部的 Agent 名展开/收起）

- **工具调用对话框** — 选工具 + 填参数 + 发送
- **任务委派对话框** — 填描述 + context + 发送

### 2. `NetworkPanel.module.css` — 完整重写

- 三栏布局样式
- 消息气泡样式（左/右对齐、不同消息类型的卡片）
- Agent 头像样式（彩色圆形 + 状态点）
- 联系人列表样式（hover、active、未读 badge）
- 输入区域样式
- 响应式适配（小屏隐藏右栏）

### 3. `en/settings.ts` + `zh/settings.ts` — 新增 i18n keys

新增约 30 个 key：
```
network.contacts          → 联系人
network.chat              → 聊天
network.selectAgent       → 选择一个 Agent 开始对话
network.unread            → 条未读消息
network.messageInput      → 输入消息...
network.sendMessage       → 发送
network.callTool          → 调用工具
network.delegateTask      → 委派任务
network.agentProfile      → Agent 详情
network.projects          → 项目
network.tools             → 工具
network.capabilities      → 能力
network.online            → 在线
network.offline           → 离线
network.lastSeen          → 最后在线
network.trustGroup.family → 同主人
network.trustGroup.friends → 已信任
network.trustGroup.strangers → 陌生人
network.quickPing         → Ping
network.quickCallTool     → 调用工具
network.quickDelegate     → 委派任务
network.taskCard.delegated → 任务已委派
network.taskCard.progress  → 进度
network.taskCard.completed → 已完成
network.taskCard.failed    → 失败
network.toolDialog.title   → 选择工具
network.toolDialog.param   → 参数
network.delegateDialog.title → 委派任务
network.delegateDialog.desc  → 任务描述
network.delegateDialog.context → 上下文
```

### 4. 测试

- 无新增后端逻辑，不需要新后端测试
- 前端改动是纯 UI 重构，现有 95 个测试不受影响

## 不改动的部分

- **后端 API** (`network-api.ts`) — 不改，现有 REST API 已够用
- **核心模块** (`src/network/`) — 不改
- **WebSocket 事件** — 不改，已有的事件（agent_found, message 等）完全够用
- **类型定义** (`types.ts`) — 不改

## 实现优先级

1. **P0 - 三栏布局 + 联系人列表 + 聊天窗口** — 核心 IM 体验
2. **P0 - 消息气泡渲染** — 替代审计日志表格
3. **P0 - Agent 头像 + 在线状态** — 视觉识别
4. **P1 - 未读消息计数** — 消息通知
5. **P1 - 快捷操作（Ping、工具调用、任务委派）** — 保留 Agent 特有能力
6. **P1 - Agent 详情面板** — 右栏可折叠
7. **P2 - i18n** — 新增翻译 key

## 风险评估

- **数据源不变**：仍然使用 `AuditLogEntry[]`，只是前端展示方式变了（按 Agent 分组 + 气泡渲染）
- **API 不变**：仍然用 `POST /api/network/send` 发消息，不需要后端改动
- **向后兼容**：只改前端 UI，不影响协议层
