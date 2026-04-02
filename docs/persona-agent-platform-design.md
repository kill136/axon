# Persona-Agent 智能平台 — 技术方案

---

## 1. 方案概述

### 1.1 产品定位

面向小白用户的通用 AI 助手平台。用户通过一个聊天入口与 AI 交互，系统在后台自动识别意图、调度专属 Agent、生成动态应用、沉淀记忆和数据。用户无需理解任何技术概念，只需要感受到"这个 AI 越用越懂我，能帮我做越来越多的事"。

### 1.2 核心理念

- **一个入口，无限能力**：用户只面对一个聊天框，所有复杂度藏在后端。
- **Agent 即 Persona**：每个 Agent 拥有独立的技能、记忆和人格，但共享底层数据层和记忆层。不做 Persona/Agent 的双层抽象——对小白用户没有意义。
- **数据是资产，不是附属品**：应用是数据的视图，数据按实体统一存储，天然跨应用打通。
- **自主进化**：Agent 自动创建、自动完善，用户不需要管理和配置任何东西。

### 1.3 与现有产品的差异

| 维度 | ChatGPT / Claude | bolt.new / v0 | 本方案 |
|------|------------------|---------------|--------|
| 核心输出 | 文本对话 | 生成代码/应用 | 对话 + 动态应用 + 持久化数据 |
| 数据模型 | 会话级，无持久化 | 项目级，应用隔离 | **用户级，跨应用共享** |
| 记忆能力 | 浅层 Memory | 无 | **深度记忆，驱动所有 Agent** |
| 应用生命周期 | 一次性 Artifact | 导出后自维护 | **平台内持久运行，可迭代** |
| 应用间协同 | 无 | 无 | **数据层统一，应用天然互通** |

### 1.4 杀手级体验示例

用户使用三个月后说："帮我规划五一出行"

系统能做到：
- 从**记账数据**知道用户月预算还剩 4800 元
- 从**日程数据**知道 5 月 1-5 日有空，5 月 3 日下午有一个不可移动的视频会议
- 从**记忆层**知道用户上次聊天提过想去海边、不喜欢赶行程
- 从**习惯数据**知道用户晚睡晚起，不要排早班飞机
- 生成的旅行规划应用中，预算模块直接读取记账数据，行程自动避开已有日程，消费自动写回记账

**单个 App 永远做不到这种体验。这就是数据飞轮。**

---

## 2. 核心目标

### 2.1 产品目标

| 目标 | 量化标准 | 优先级 |
|------|---------|--------|
| 零门槛使用 | 用户不需要理解 Agent/Persona/MCP 任何概念即可上手 | P0 |
| 越用越聪明 | 使用 30 天后，Agent 响应准确率提升 40%+ | P0 |
| 跨应用数据飞轮 | 用户创建第 3 个应用时，数据复用率 > 60% | P0 |
| 动态应用可用性 | 模板应用满意度 > 85%，生成应用满意度 > 65% | P1 |
| 自主 Agent 管理 | 90% 的 Agent 创建/更新由系统自动完成，用户无感 | P1 |

### 2.2 技术目标

| 目标 | 量化标准 |
|------|---------|
| 意图识别准确率 | 首次识别准确率 > 90%，含纠错后 > 98% |
| 响应延迟 | 纯对话 < 2s，调用应用 < 5s，生成新应用 < 15s |
| 数据一致性 | 跨应用数据读写强一致，无脏读 |
| Agent 冷启动 | 新 Agent 从创建到可用 < 3s |
| 可用性 | 系统 SLA 99.9%，数据零丢失 |

### 2.3 非目标（明确不做的事）

- **不做开发者工具**：不暴露代码、不提供 API 控制台、不支持自定义编程。
- **不做社交平台**：不做 Agent 市场、不做用户间分享（Phase 1）。
- **不做通用云存储**：数据层为 Agent 应用服务，不是网盘。
- **不做实时协作**：Phase 1 只支持单用户。

---

## 3. 整体架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户交互层                             │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────┐     │
│  │  聊天界面   │  │ 应用容器   │  │  应用管理/收藏夹  │     │
│  └───────────┘  └───────────┘  └──────────────────┘     │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                    智能调度层                             │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────┐     │
│  │  意图识别引擎  │  │ Agent 路由  │  │  会话管理器   │     │
│  └──────────────┘  └────────────┘  └──────────────┘     │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                    Agent 执行层                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ 默认Agent │  │ 记账Agent │  │ 旅行Agent │  ...         │
│  │ (兜底)    │  │ (自动生成) │  │ (自动生成) │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       │             │             │                      │
│  ┌────┴─────────────┴─────────────┴────┐                 │
│  │         Agent 运行时 (Runtime)       │                 │
│  │  工具调用 / LLM推理 / 应用生成       │                 │
│  └─────────────────────────────────────┘                 │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                    能力层 (MCP + 内置)                     │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐     │
│  │ 日历   ││ 搜索   ││ 天气   ││ 外卖   ││ 自定义  │     │
│  └────────┘└────────┘└────────┘└────────┘└────────┘     │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│                    数据基座层                             │
│  ┌───────────────────┐  ┌───────────────────┐           │
│  │     数据层          │  │     记忆层          │          │
│  │  结构化实体存储      │  │  非结构化语义存储    │          │
│  │  (PostgreSQL)      │  │  (向量DB + KV)     │          │
│  │                    │  │                    │          │
│  │  - transactions    │  │  - 用户偏好         │          │
│  │  - events          │  │  - 交互摘要         │          │
│  │  - goals           │  │  - 行为模式         │          │
│  │  - contacts        │  │  - 情感倾向         │          │
│  │  - documents       │  │  - 跨应用关联       │          │
│  │  - media           │  │                    │          │
│  └───────────────────┘  └───────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

### 3.2 核心模块说明

#### 3.2.1 用户交互层

| 模块 | 职责 | 技术选型 |
|------|------|---------|
| 聊天界面 | 用户输入、对话展示、流式回复 | React + WebSocket |
| 应用容器 | iframe 沙箱运行动态应用，与主框架隔离 | iframe + postMessage API |
| 应用管理 | 展示用户的所有应用，收藏、删除、重新打开 | React 列表组件 |

应用容器是关键组件，设计原则：
- 每个动态应用运行在独立 iframe 中，安全隔离
- 通过 postMessage 桥接与主框架通信
- 应用通过统一 SDK 读写数据层（SDK 注入到 iframe 中）

```typescript
// 注入到动态应用 iframe 中的 SDK
interface AppSDK {
  // 数据层操作
  data: {
    query(entity: string, filter: Filter): Promise<Record[]>;
    create(entity: string, data: Record): Promise<string>;
    update(entity: string, id: string, data: Partial<Record>): Promise<void>;
    delete(entity: string, id: string): Promise<void>;
    subscribe(entity: string, filter: Filter, callback: (changes: Change[]) => void): Unsubscribe;
  };
  // 记忆层操作（只读）
  memory: {
    recall(query: string): Promise<MemoryItem[]>;
  };
  // 与主框架通信
  host: {
    navigate(target: string): void;        // 打开另一个应用
    toast(message: string): void;           // 显示提示
    requestPermission(scope: string): Promise<boolean>;  // 请求数据权限
  };
}
```

#### 3.2.2 智能调度层

核心组件，详见第 4 节（意图识别设计）。

#### 3.2.3 Agent 执行层

核心组件，详见第 5 节（Agent 动态生成机制）。

#### 3.2.4 能力层

通过 MCP（Model Context Protocol）统一接入外部能力，但对用户完全透明：

```
用户视角：                        系统视角：
"明天天气怎么样"                   意图识别 → 天气查询
                                  → 路由到默认 Agent
                                  → Agent 调用天气 MCP
                                  → 返回天气卡片
用户完全不知道 MCP 的存在
```

能力注册表：
```typescript
interface Capability {
  id: string;                    // "weather", "calendar", "search"
  name: string;                  // 展示名（用户看不到，Agent 用）
  protocol: "mcp" | "builtin";  // 接入方式
  endpoint?: string;             // MCP server 地址
  permissions: string[];         // 需要的数据实体权限
  triggers: string[];            // 触发关键词/意图（辅助路由）
}
```

#### 3.2.5 数据基座层

**数据层 — 结构化实体存储**

```sql
-- 核心：所有数据按实体类型存储，不按应用存储

-- 统一实体表（PostgreSQL + JSONB 实现灵活 schema）
CREATE TABLE entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  type        VARCHAR(50) NOT NULL,     -- 'transaction', 'event', 'goal', 'contact', 'document'
  data        JSONB NOT NULL,            -- 实体数据
  tags        TEXT[] DEFAULT '{}',       -- 标签（跨应用分类）
  source_app  VARCHAR(100),              -- 创建来源应用
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ               -- 软删除
);

CREATE INDEX idx_entities_user_type ON entities(user_id, type);
CREATE INDEX idx_entities_data ON entities USING GIN(data);
CREATE INDEX idx_entities_tags ON entities USING GIN(tags);

-- 实体关联表（记账记录 ↔ 旅行行程 ↔ 日程事件）
CREATE TABLE entity_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  from_id     UUID NOT NULL REFERENCES entities(id),
  to_id       UUID NOT NULL REFERENCES entities(id),
  relation    VARCHAR(50) NOT NULL,     -- 'belongs_to', 'caused_by', 'related_to'
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 应用数据权限表
CREATE TABLE app_data_permissions (
  app_id      VARCHAR(100) NOT NULL,
  user_id     UUID NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  permission  VARCHAR(10) NOT NULL,     -- 'read', 'write', 'admin'
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, entity_type)
);
```

预定义实体类型及其 schema：

```typescript
// 实体类型定义
const EntitySchemas = {
  transaction: {
    amount: number,
    currency: string,          // 默认 "CNY"
    category: string,          // "餐饮", "交通", "娱乐", ...
    direction: "income" | "expense",
    description: string,
    occurred_at: datetime,
    payment_method?: string,
  },
  
  event: {
    title: string,
    start_time: datetime,
    end_time?: datetime,
    location?: string,
    is_all_day: boolean,
    recurrence?: RecurrenceRule,
    reminders?: Reminder[],
    status: "tentative" | "confirmed" | "cancelled",
  },
  
  goal: {
    title: string,
    description?: string,
    category: string,          // "健康", "学习", "财务", ...
    target_value?: number,
    current_value?: number,
    unit?: string,
    deadline?: datetime,
    status: "active" | "completed" | "abandoned",
    check_ins: CheckIn[],      // 打卡记录
  },
  
  contact: {
    name: string,
    relationship?: string,     // "家人", "朋友", "同事"
    phone?: string,
    email?: string,
    birthday?: date,
    notes?: string,
  },
  
  document: {
    title: string,
    content: string,           // Markdown
    category?: string,
    attachments?: Attachment[],
  },

  media: {
    url: string,
    type: "image" | "video" | "audio",
    description?: string,
    size: number,
  },

  // 扩展：Agent 可动态注册新实体类型
  // 系统会验证 schema 合法性后注册
};
```

**记忆层 — 非结构化语义存储**

```typescript
interface MemoryStore {
  // 存储结构
  memories: {
    id: string;
    user_id: string;
    type: "preference" | "behavior" | "summary" | "association";
    content: string;              // 自然语言描述
    embedding: Float32Array;      // 向量表示
    confidence: number;           // 置信度 0-1
    source: {                     // 记忆来源
      agent_id: string;
      conversation_id: string;
      timestamp: datetime;
    };
    reinforcement_count: number;  // 被多次验证的次数
    last_accessed: datetime;
    decay_factor: number;         // 衰减因子，久未验证的记忆降权
  }[];

  // 写入：Agent 交互后自动总结
  write(memory: NewMemory): Promise<void>;

  // 读取：语义检索
  recall(query: string, options?: {
    type?: MemoryType;
    min_confidence?: number;
    limit?: number;
  }): Promise<Memory[]>;

  // 强化：被验证的记忆提升置信度
  reinforce(id: string): Promise<void>;

  // 衰减：定时任务，降低久未访问的记忆权重
  decay(): Promise<void>;

  // 合并：检测并合并冲突或重复的记忆
  consolidate(): Promise<void>;
}
```

记忆示例：
```json
[
  {
    "type": "preference",
    "content": "用户对咖啡过敏，只喝茶饮",
    "confidence": 0.95,
    "reinforcement_count": 3
  },
  {
    "type": "behavior",
    "content": "用户通常在晚上 10-11 点记账，周末容易忘记",
    "confidence": 0.7,
    "reinforcement_count": 8
  },
  {
    "type": "association",
    "content": "用户的'省钱'目标和'旅行基金'记账分类高度关联，每次提到省钱都在攒旅行基金",
    "confidence": 0.85,
    "reinforcement_count": 2
  },
  {
    "type": "summary",
    "content": "用户是一位在杭州工作的设计师，养了一只猫叫橘子，周末喜欢逛展览",
    "confidence": 0.9,
    "reinforcement_count": 5
  }
]
```

### 3.3 数据流全景

```
用户输入 "这个月花了多少钱"
         │
         ▼
┌─────────────────┐
│   意图识别引擎    │ → 识别为：查询消费 / 记账领域
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Agent 路由     │ → 匹配到：记账 Agent（已存在）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   记账 Agent     │
│                  │ 1. 查记忆层 → 用户习惯按自然月统计
│                  │ 2. 查数据层 → SELECT SUM(amount) FROM entities 
│                  │              WHERE type='transaction' 
│                  │              AND data->>'direction'='expense'
│                  │              AND occurred_at >= '2026-04-01'
│                  │ 3. 生成回复 → 文本 + 消费图表卡片
└────────┬────────┘
         │
         ▼
用户看到："这个月花了 3,247 元" + 分类饼图卡片
```

```
用户输入 "帮我做个背单词的应用"
         │
         ▼
┌─────────────────┐
│   意图识别引擎    │ → 识别为：创建应用 / 学习领域
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Agent 路由     │ → 无匹配 Agent → 触发 Agent 动态生成
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│   Agent 工厂             │
│   1. 创建"学习Agent"      │
│   2. 定义技能：单词管理、  │
│      复习算法、进度追踪    │
│   3. 注册数据权限：        │
│      read/write [goal]   │
│      create [document]   │ → 新实体类型 "vocabulary"
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│   学习 Agent             │
│   1. 生成背单词应用代码    │
│   2. 应用内嵌 AppSDK     │
│   3. 单词数据存入数据层    │
│   4. 学习进度关联 goal    │
└────────┬────────────────┘
         │
         ▼
用户看到：一个可交互的背单词应用，嵌在聊天流中
         可以收藏到应用列表，随时打开
```

---

## 4. 意图识别设计

### 4.1 输入数据

意图识别引擎的输入不只是用户当前这句话，而是一个丰富的上下文包：

```typescript
interface IntentInput {
  // ① 当前输入
  message: {
    text: string;                    // 用户输入的文本
    attachments?: Attachment[];       // 图片、文件等附件
    reply_to?: MessageId;            // 如果是回复某条消息
  };

  // ② 会话上下文（短期）
  conversation: {
    recent_messages: Message[];      // 最近 10 轮对话
    current_agent_id?: string;       // 当前正在交互的 Agent
    active_app_id?: string;          // 当前打开的应用（如果有）
  };

  // ③ 用户上下文（长期）
  user_context: {
    active_agents: AgentSummary[];   // 用户的所有 Agent 概要
    recent_apps: AppSummary[];       // 最近使用的应用
    time_context: {                  // 时间上下文
      local_time: datetime;
      day_of_week: string;
      is_holiday: boolean;
    };
  };

  // ④ 记忆上下文（按需加载）
  memory_hints: MemoryItem[];        // 与输入语义相关的记忆（预检索 top-5）
}
```

### 4.2 识别流程

```
用户输入
   │
   ▼
┌──────────────────────────────────────────┐
│  Stage 1: 快速分类 (< 100ms)             │
│                                          │
│  轻量分类器（fine-tuned 小模型 或 规则）    │
│  输出：粗粒度意图类别                      │
│  ┌──────────────────────────────────┐    │
│  │ ① 闲聊 (chitchat)               │    │
│  │ ② 知识问答 (qa)                  │    │
│  │ ③ 任务执行 (task)                │    │
│  │ ④ 应用操作 (app_action)          │    │
│  │ ⑤ 应用创建 (app_create)          │    │
│  │ ⑥ 系统指令 (system)              │    │
│  └──────────────────────────────────┘    │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Stage 2: 精细路由 (< 500ms)             │
│                                          │
│  根据粗分类走不同路径：                     │
│                                          │
│  ① 闲聊 → 默认 Agent 直接回复，不路由      │
│                                          │
│  ② 知识问答 → 默认 Agent + 搜索能力       │
│                                          │
│  ③ 任务执行 → Agent 匹配器                │
│     输入：意图 + 所有 Agent 的能力描述      │
│     算法：语义相似度 + 历史命中率加权        │
│     输出：最佳匹配 Agent + 置信度           │
│     ┌──────────────────────────────┐     │
│     │ 置信度 > 0.8 → 直接路由       │     │
│     │ 置信度 0.5-0.8 → 路由但标记   │     │
│     │ 置信度 < 0.5 → 进入 Stage 3  │     │
│     └──────────────────────────────┘     │
│                                          │
│  ④ 应用操作 → 匹配已有应用，路由到对应Agent │
│                                          │
│  ⑤ 应用创建 → 进入 Agent 动态生成流程      │
│                                          │
│  ⑥ 系统指令 → 系统层直接处理               │
└──────────────┬───────────────────────────┘
               │ (置信度不足时)
               ▼
┌──────────────────────────────────────────┐
│  Stage 3: 歧义消解 (需要用户交互)          │
│                                          │
│  策略 A：隐式消解                          │
│  "你是想记一笔账，还是想看看这个月的消费？"  │
│  → 用户回复后重新识别                      │
│                                          │
│  策略 B：试探执行                          │
│  置信度最高的 Agent 先执行                  │
│  同时告知用户"我理解的是...如果不对请告诉我" │
│  → 用户不纠正 = 确认                      │
└──────────────────────────────────────────┘
```

### 4.3 输出结果

```typescript
interface IntentResult {
  // 意图分类
  category: "chitchat" | "qa" | "task" | "app_action" | "app_create" | "system";
  
  // 路由目标
  routing: {
    agent_id: string;                // 目标 Agent ID（"default" 为默认 Agent）
    confidence: number;              // 路由置信度 0-1
    fallback_agent_id?: string;      // 备选 Agent
  };

  // 结构化意图参数（提取的实体和槽位）
  slots: {
    action?: string;                 // "create", "query", "update", "delete"
    entity_type?: string;            // "transaction", "event", "goal"
    time_range?: TimeRange;          // 时间范围
    filters?: Record<string, any>;   // 过滤条件
    raw_entities?: string[];         // 原始提取的实体
  };

  // 上下文增强
  enrichment: {
    memories_used: string[];         // 本次识别用到的记忆 ID
    disambiguation_needed: boolean;  // 是否需要歧义消解
    disambiguation_options?: string[]; // 歧义选项
  };
}
```

### 4.4 识别策略

#### 4.4.1 上下文连续性策略

用户连续对话时，系统倾向于路由到当前 Agent：

```
用户: "帮我记一笔，午饭花了 35"       → 路由到记账 Agent
用户: "再加一笔，打车 15 块"           → 上下文连续，仍路由到记账 Agent
用户: "对了，明天下午有个会"            → 话题切换，路由到日程 Agent
用户: "几点的？"                       → 歧义！上下文是日程，路由到日程 Agent
```

实现：
```typescript
// 上下文连续性评分
function contextContinuityScore(input: IntentInput, agent: Agent): number {
  let score = 0;
  
  // 当前正在交互的 Agent 加权
  if (input.conversation.current_agent_id === agent.id) {
    score += 0.3;
  }
  
  // 最近 3 轮对话涉及同一 Agent
  const recentAgentCount = input.conversation.recent_messages
    .slice(-3)
    .filter(m => m.agent_id === agent.id).length;
  score += recentAgentCount * 0.1;
  
  // 时间衰减：超过 5 分钟未交互的 Agent 降权
  if (agent.last_interaction) {
    const minutesAgo = (Date.now() - agent.last_interaction) / 60000;
    if (minutesAgo > 5) score -= 0.2;
    if (minutesAgo > 30) score -= 0.3;
  }
  
  return Math.max(0, Math.min(1, score));
}
```

#### 4.4.2 时间感知策略

利用时间上下文提升识别准确率：

```
早上 8 点用户说 "提醒我" → 大概率是今天的事
晚上 10 点用户说 "记一下" → 大概率是记账（用户习惯晚上记账，来自记忆层）
周五下午用户说 "安排一下" → 大概率是周末计划
```

#### 4.4.3 频率学习策略

统计用户的意图分布，优化路由优先级：

```typescript
interface UserIntentProfile {
  // 用户的意图频率分布
  intent_distribution: {
    [agent_id: string]: {
      total_count: number;
      recent_7d_count: number;
      typical_times: TimeSlot[];   // 常用时段
      common_triggers: string[];   // 常用触发词
    };
  };
}

// 高频 Agent 在路由时获得 bonus
function frequencyBonus(agent: Agent, profile: UserIntentProfile): number {
  const stats = profile.intent_distribution[agent.id];
  if (!stats) return 0;
  
  // 最近 7 天使用频率
  const recencyWeight = Math.min(stats.recent_7d_count / 10, 0.2);
  
  // 当前时段匹配
  const timeMatch = stats.typical_times.some(t => isCurrentTimeInSlot(t)) ? 0.1 : 0;
  
  return recencyWeight + timeMatch;
}
```

#### 4.4.4 多意图处理策略

一句话可能包含多个意图：

```
用户: "记一下今天午饭花了 40，然后看看这周一共花了多少"
→ 意图 1：创建消费记录（写操作）
→ 意图 2：查询本周消费（读操作）
→ 两个意图都属于记账 Agent，串行执行
```

```
用户: "取消明天的会议，然后帮我定个下周三的提醒"
→ 意图 1：取消日程（日程 Agent）
→ 意图 2：创建提醒（日程 Agent）
→ 同一 Agent，串行执行
```

```
用户: "记一笔晚饭 50 块，明天提醒我买菜"
→ 意图 1：记账（记账 Agent）
→ 意图 2：提醒（日程 Agent）
→ 不同 Agent，并行执行，合并结果
```

```typescript
interface MultiIntentResult {
  intents: IntentResult[];
  execution_strategy: "sequential" | "parallel" | "pipeline";
  merge_strategy: "concatenate" | "aggregate";
}
```

### 4.5 异常处理

#### 4.5.1 识别失败

```
触发条件：Stage 1 和 Stage 2 都无法给出 > 0.3 置信度的结果

处理流程：
1. 不暴露"我不理解"这种尴尬回复
2. 路由到默认 Agent
3. 默认 Agent 用通用 LLM 能力回复
4. 同时记录该输入到"未识别日志"用于后续优化

用户感知：AI 正常回复了，只是可能没有调用特定能力
```

#### 4.5.2 Agent 执行失败

```
触发条件：Agent 调用工具/API 失败

处理流程：
1. Agent 自行重试 1 次（不同策略）
2. 仍失败 → 降级到纯文本回复
   例：天气 API 挂了 → "抱歉，暂时查不到天气，你可以试试直接搜索'杭州天气'"
3. 记录失败日志，触发告警

绝不掩盖错误，但要用用户能理解的语言表达
```

#### 4.5.3 用户纠正

```
触发条件：用户明确表示"不是这个意思" / "我要的是..." / 切换话题

处理流程：
1. 立即停止当前 Agent 执行
2. 将用户纠正作为强信号重新识别
3. 更新意图识别模型的反馈（负样本）
4. 记忆层记录："用户说'记一下'在 XX 上下文中指的是 YY，不是 ZZ"
```

#### 4.5.4 恶意/超范围输入

```
触发条件：注入攻击、违规内容、超出系统能力范围

处理流程：
1. 安全层前置拦截（不进入意图识别）
2. 超范围请求：诚实告知 + 建议替代方案
   例："我暂时不能帮你订外卖，但可以帮你记录想吃什么，下次出门参考"
3. 不过度解释系统限制，避免暴露架构细节
```

### 4.6 兜底方案

```
兜底层级（从高到低）：

Level 1: 精确匹配
  → 意图识别成功，路由到专属 Agent

Level 2: 模糊匹配 + 确认
  → 识别不确定，路由到最可能的 Agent + 告知用户

Level 3: 默认 Agent
  → 无法匹配任何专属 Agent，用通用 LLM 能力回复
  → 默认 Agent 能力：闲聊、问答、简单任务、搜索

Level 4: 坦诚降级
  → 默认 Agent 也处理不了（如需要未接入的外部服务）
  → 坦诚告知 + 提供替代建议

原则：永远有回复，永远不白屏，永远不说"我不理解"
```

---

## 5. Agent 动态生成机制设计

### 5.1 Agent 生命周期

```
         创建                活跃                 休眠              归档/销毁
          │                   │                   │                  │
 ┌────────┴──────┐   ┌───────┴───────┐   ┌──────┴──────┐   ┌──────┴──────┐
 │  自动/手动创建  │→ │ 执行任务       │→ │ 30天未使用   │→ │ 90天未使用    │
 │  初始化技能     │  │ 积累记忆       │  │ 降低优先级   │  │ 数据保留      │
 │  注册数据权限   │  │ 自我完善       │  │ 不参与路由   │  │ Agent 释放    │
 │  分配资源      │  │ 生成/管理应用   │  │ 可随时唤醒   │  │ 可手动恢复    │
 └───────────────┘  └───────────────┘  └─────────────┘  └─────────────┘
```

### 5.2 Agent 数据模型

```typescript
interface Agent {
  // === 身份 ===
  id: string;                          // 唯一标识
  user_id: string;                     // 所属用户
  name: string;                        // 显示名称，例："记账助手"
  avatar: string;                      // 头像（自动生成）
  description: string;                 // 一句话描述
  
  // === 能力定义 ===
  system_prompt: string;               // Agent 的核心指令（LLM system prompt）
  skills: Skill[];                     // 技能列表
  capabilities: string[];             // 绑定的 MCP 能力 ID
  data_permissions: DataPermission[];  // 数据层读写权限
  
  // === 应用管理 ===
  apps: App[];                         // 该 Agent 创建/管理的动态应用
  
  // === 记忆 ===
  agent_memory: {                      // Agent 私有记忆（共享记忆在全局记忆层）
    learnings: string[];               // 从交互中学到的领域知识
    user_preferences: string[];        // 该领域内用户的特定偏好
    error_log: ErrorRecord[];          // 历史错误，避免重犯
  };
  
  // === 状态 ===
  status: "active" | "dormant" | "archived";
  created_at: datetime;
  last_active_at: datetime;
  interaction_count: number;
  satisfaction_score: number;          // 用户满意度（隐式收集）
  
  // === 自我进化 ===
  evolution: {
    version: number;                   // 迭代版本
    changelog: EvolutionRecord[];      // 进化记录
    pending_improvements: string[];    // 待优化项
  };
}

interface Skill {
  name: string;                        // "记账", "统计分析", "预算规划"
  description: string;
  trigger_patterns: string[];          // 触发该技能的意图模式
  tool_chain: ToolStep[];              // 执行链：调用哪些工具，什么顺序
}

interface App {
  id: string;
  name: string;
  description: string;
  code: string;                        // 应用前端代码（React/Vue 单文件）
  data_schema: EntitySchema[];         // 使用的数据实体
  version: number;
  created_at: datetime;
  last_opened_at: datetime;
  pinned: boolean;                     // 用户是否收藏
}
```

### 5.3 自动创建触发条件

Agent 不是用户手动创建的，系统根据以下信号自动判断是否需要创建新 Agent：

```typescript
interface CreationTrigger {
  // 触发器类型
  type: "explicit_request" | "repeated_pattern" | "complex_need" | "app_creation";
  
  // 判断逻辑
  conditions: {
    // ① 用户显式请求
    // "帮我做个记账的" / "我需要一个追踪习惯的工具"
    explicit_request: {
      keywords: ["帮我做", "我需要", "给我弄个", "有没有"];
      confidence_threshold: 0.8;
    };
    
    // ② 重复模式检测
    // 用户连续 3 天在默认 Agent 里做类似的事
    repeated_pattern: {
      same_intent_count: 3;           // 同类意图出现次数
      time_window_days: 7;            // 时间窗口
      min_complexity: "medium";       // 排除过于简单的意图（如查天气）
    };
    
    // ③ 复杂需求
    // 单次对话中涉及多步操作 + 数据持久化需求
    complex_need: {
      steps_count: 3;                 // 多步操作
      needs_persistence: true;        // 需要保存数据
      needs_periodic: false;          // 是否需要定期执行（可选触发条件）
    };
    
    // ④ 应用创建请求
    // 用户要求创建动态应用，必然需要一个 Agent 管理它
    app_creation: {
      always_trigger: true;           // 只要创建应用就创建 Agent
    };
  };
}
```

**不创建 Agent 的情况：**
- 一次性问答（"Python 怎么读文件"）→ 默认 Agent
- 极简任务（"明天天气"）→ 默认 Agent + 天气能力
- 已有 Agent 能覆盖的需求 → 路由到现有 Agent

### 5.4 创建流程

```
触发条件命中
     │
     ▼
┌────────────────────────────────────────────┐
│  Step 1: 需求分析 (LLM)                    │
│                                            │
│  输入：                                     │
│  - 触发意图和上下文                          │
│  - 用户历史行为                              │
│  - 已有 Agent 列表（避免重复）               │
│                                            │
│  输出：                                     │
│  - Agent 名称和描述                         │
│  - 核心技能定义                              │
│  - 需要的数据实体类型                        │
│  - 需要的 MCP 能力                          │
│  - 初始 system prompt                      │
│                                            │
│  关键判断：是否和已有 Agent 合并？            │
│  → "背单词"需求如果已有"学习Agent"就合并      │
│  → 而不是创建新的                            │
└──────────────┬─────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────┐
│  Step 2: Agent 实例化                       │
│                                            │
│  1. 创建 Agent 记录                         │
│  2. 注册数据权限                             │
│  3. 绑定 MCP 能力                           │
│  4. 如需要，创建新实体类型                    │
│  5. 生成头像（可选，调用图片生成）             │
│                                            │
│  耗时 < 3s，不阻塞用户                      │
└──────────────┬─────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────┐
│  Step 3: 首次任务执行                       │
│                                            │
│  Agent 创建后立即执行用户的原始请求           │
│  用户无感知 Agent 创建过程                   │
│                                            │
│  如果请求包含创建应用：                      │
│  → 进入应用生成流程（见 5.5）               │
│                                            │
│  如果是纯任务：                             │
│  → 直接执行并返回结果                       │
└──────────────┬─────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────┐
│  Step 4: 反馈收集（隐式）                   │
│                                            │
│  - 用户是否继续交互？（正向信号）             │
│  - 用户是否纠正？（需调整 Agent 定义）        │
│  - 用户是否直接离开？（可能不需要这个 Agent）  │
│                                            │
│  首次创建的 Agent 进入 30 天观察期            │
│  观察期内无交互 → 自动归档                   │
└────────────────────────────────────────────┘
```

### 5.5 动态应用生成

Agent 生成动态应用的流程：

```
Agent 收到"创建应用"指令
         │
         ▼
┌─────────────────────────────────────┐
│  Phase 1: 应用设计 (LLM)            │
│                                     │
│  输入：用户需求 + 可用数据实体        │
│  输出：                             │
│  - 应用名称和描述                    │
│  - 页面/视图列表                    │
│  - 数据模型（映射到已有实体或新建）   │
│  - 交互流程                         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Phase 2: 模板匹配                  │
│                                     │
│  检查模板库是否有相似应用：           │
│  ┌─────────────────────────────┐    │
│  │ 匹配度 > 80%: 用模板 + 定制  │    │
│  │ 匹配度 40-80%: 模板为骨架    │    │
│  │           + LLM 补充差异部分  │    │
│  │ 匹配度 < 40%: 完全生成      │    │
│  └─────────────────────────────┘    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Phase 3: 代码生成 (LLM)            │
│                                     │
│  生成单文件 React 应用               │
│  - 内置 AppSDK 调用                 │
│  - 响应式布局                       │
│  - 符合设计规范的 UI                │
│  - 必要的状态管理                   │
│                                     │
│  代码审查（自动）：                  │
│  - 安全检查：无外部请求、无 eval    │
│  - 性能检查：无死循环、合理渲染     │
│  - SDK 调用检查：权限范围内         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Phase 4: 沙箱部署                  │
│                                     │
│  1. 代码注入到 iframe 沙箱          │
│  2. AppSDK 桥接初始化              │
│  3. 渲染并展示给用户                │
│  4. 持久化应用代码和配置            │
└─────────────────────────────────────┘
```

应用代码示例（记账应用）：

```tsx
// 生成的单文件应用，运行在 iframe 沙箱中
// AppSDK 由宿主注入，全局可用

function AccountingApp() {
  const [transactions, setTransactions] = useState([]);
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState('餐饮');

  useEffect(() => {
    // 通过 AppSDK 读取数据层中的消费记录
    sdk.data.query('transaction', {
      filter: { direction: 'expense' },
      sort: { occurred_at: 'desc' },
      limit: 50
    }).then(setTransactions);

    // 订阅实时更新（其他应用/Agent 创建的记录也会出现）
    const unsub = sdk.data.subscribe('transaction', {}, (changes) => {
      setTransactions(prev => applyChanges(prev, changes));
    });
    return unsub;
  }, []);

  const addTransaction = async () => {
    await sdk.data.create('transaction', {
      amount: parseFloat(newAmount),
      category: newCategory,
      direction: 'expense',
      currency: 'CNY',
      description: '',
      occurred_at: new Date().toISOString(),
    });
    setNewAmount('');
  };

  const total = transactions.reduce((sum, t) => sum + t.data.amount, 0);

  return (
    <div className="app">
      <h2>本月支出 ¥{total.toFixed(2)}</h2>
      {/* ... UI 省略 ... */}
    </div>
  );
}
```

### 5.6 Agent 自我进化机制

Agent 创建后不是静态的，会根据交互持续优化：

```typescript
// 每次交互后的进化评估
async function evaluateAndEvolve(agent: Agent, interaction: Interaction) {
  
  // === 1. 记忆沉淀 ===
  // Agent 从交互中提取可复用的信息
  const newLearnings = await extractLearnings(interaction);
  // 例：用户总是把交通费归类为"通勤"而不是"交通"
  agent.agent_memory.learnings.push(...newLearnings);

  // === 2. 技能扩展判断 ===
  // 如果用户反复要求 Agent 做一个它不擅长但相关的事
  const skillGaps = detectSkillGaps(agent, interaction);
  if (skillGaps.length > 0) {
    // 例：记账 Agent 被反复要求做预算规划
    // → 自动添加"预算规划"技能
    for (const gap of skillGaps) {
      if (gap.frequency > 3 && gap.relevance > 0.7) {
        await addSkill(agent, gap);
      }
    }
  }

  // === 3. System Prompt 优化 ===
  // 每 50 次交互，用 LLM 审视并优化 system prompt
  if (agent.interaction_count % 50 === 0) {
    const optimizedPrompt = await optimizeSystemPrompt(agent, {
      recent_interactions: getRecentInteractions(agent, 50),
      error_log: agent.agent_memory.error_log,
      user_corrections: getUserCorrections(agent),
    });
    
    agent.system_prompt = optimizedPrompt;
    agent.evolution.version += 1;
    agent.evolution.changelog.push({
      version: agent.evolution.version,
      timestamp: new Date(),
      changes: "system prompt 优化",
      reason: "基于最近 50 次交互的反馈",
    });
  }

  // === 4. 应用迭代 ===
  // 如果用户对应用提出改进意见
  const appFeedback = extractAppFeedback(interaction);
  if (appFeedback) {
    // "这个记账应用能不能加个分类统计？"
    // → Agent 修改应用代码，增量更新
    await iterateApp(agent, appFeedback.app_id, appFeedback.request);
  }

  // === 5. 满意度评估（隐式）===
  agent.satisfaction_score = calculateSatisfaction({
    task_completion_rate: getCompletionRate(agent),
    correction_frequency: getCorrectionRate(agent),
    return_rate: getReturnRate(agent),           // 用户回来继续用的比例
    session_duration: getAvgSessionDuration(agent),
  });
}
```

### 5.7 Agent 合并与拆分

随着使用演进，可能需要合并或拆分 Agent：

```
合并场景：
用户有"记账 Agent" 和 "预算 Agent"，功能高度重叠
→ 系统建议合并："我发现你的记账和预算功能经常一起用，要不要合并成一个理财助手？"
→ 用户确认后合并，数据和记忆归并

拆分场景：
"学习 Agent" 同时管理英语学习和编程学习，两个领域差异大
→ 系统建议拆分："你的学习内容好像分两个方向，分成英语助手和编程助手会不会更好用？"
→ 用户确认后拆分，各自继承相关数据和记忆
```

判断规则：
```typescript
// 合并信号
function shouldMerge(agentA: Agent, agentB: Agent): boolean {
  return (
    dataOverlapRatio(agentA, agentB) > 0.6 &&          // 数据重叠度 > 60%
    coUsageFrequency(agentA, agentB) > 0.5 &&          // 经常在同一会话中使用
    skillSimilarity(agentA, agentB) > 0.7               // 技能相似度 > 70%
  );
}

// 拆分信号
function shouldSplit(agent: Agent): boolean {
  const clusters = clusterInteractions(agent);          // 对交互聚类
  return (
    clusters.length >= 2 &&                             // 至少 2 个明显聚类
    clusterSeparation(clusters) > 0.7 &&                // 聚类间距离大
    agent.interaction_count > 100                        // 足够的交互数据
  );
}
```

### 5.8 默认 Agent

系统预置一个**默认 Agent**，不可删除，作为兜底和通用能力承载：

```typescript
const DefaultAgent: Agent = {
  id: "default",
  name: "小助手",              // 可被用户改名
  description: "你的通用 AI 助手",
  
  system_prompt: `你是用户的私人 AI 助手。
    你负责处理用户的日常对话、简单问答和一次性任务。
    当你发现用户有重复性或复杂需求时，你会建议创建专属助手。
    你可以访问用户的所有数据和记忆（在权限范围内）。`,
  
  skills: [
    { name: "闲聊", ... },
    { name: "知识问答", ... },
    { name: "简单任务", ... },
    { name: "网络搜索", ... },
  ],
  
  // 默认 Agent 有最广泛的数据读权限，但写权限有限
  data_permissions: [
    { entity_type: "*", permission: "read" },
    { entity_type: "document", permission: "write" },
  ],
  
  status: "active",  // 永远 active
};
```

### 5.9 完整交互示例

```
Day 1:
用户: "帮我记一下今天午饭花了 35"
系统: (意图识别 → 记账类 → 无专属 Agent → 默认 Agent 处理)
默认 Agent: "好的，已记录。午饭 ¥35。"
         (数据写入 entities: type=transaction)

Day 3:
用户: "再记一笔，打车 15"
用户: "这周花了多少了"
系统: (检测到重复模式：3 天内 3 次记账意图)
系统: (触发 Agent 创建：repeated_pattern)
→ 自动创建"记账助手" Agent
→ 迁移之前的记账数据到该 Agent 管辖
记账助手: "这周一共花了 128 元。我帮你整理了个消费记录，以后记账的事交给我。"

Day 10:
用户: "帮我做个记账的应用，能看每天花了多少"
系统: (意图识别 → 创建应用 → 路由到记账助手)
记账助手: (生成动态应用 → 日消费图表 + 快速记账入口)
记账助手: "做好了！左滑可以看每日消费趋势，点加号可以快速记账。"
         (应用嵌在聊天流中，用户可收藏到应用列表)

Day 25:
用户: "这个记账能加个每月预算提醒吗"
系统: (路由到记账助手 → 应用迭代请求)
记账助手: (修改应用代码，增加预算设置和提醒功能)
记账助手: "加好了。你先设个月预算吧，超支的时候我会提醒你。"
         (Agent 技能列表自动增加"预算管理")

Day 40:
用户: "帮我规划五一出去玩"
系统: (意图识别 → 旅行规划 → 无专属 Agent → 创建旅行助手)
旅行助手: (查记忆层 → 用户喜欢海边，不喜欢赶路)
          (查数据层 → 通过记账 Agent 的数据知道预算)
          (查数据层 → 5月1-5日无其他日程)
旅行助手: "根据你的预算和时间，推荐去舟山，3天2晚..."
         (生成旅行规划应用 → 行程时间线 + 预算追踪 + 打包清单)
         (预算模块直接读取记账数据)
```

---

## 附录 A: 技术选型建议

| 模块 | 推荐技术 | 理由 |
|------|---------|------|
| 后端框架 | Node.js + Express/Fastify | 团队技术栈，与 Axon 经验一致 |
| 数据库 | PostgreSQL + JSONB | 灵活 schema + 强一致性 |
| 向量存储 | pgvector（PostgreSQL 扩展） | 减少运维组件，一个库搞定 |
| 缓存 | Redis | 会话状态、Agent 路由缓存 |
| 应用沙箱 | iframe + Web Worker | 浏览器原生隔离，无需额外基础设施 |
| 前端 | React + TailwindCSS | 动态应用生成最成熟的生态 |
| LLM | Claude API | 代码生成质量最好 |
| 实时通信 | WebSocket | 流式回复、应用数据同步 |
| MCP | 标准 MCP 协议 | 开放生态，第三方接入 |

## 附录 B: 分阶段交付计划

```
Phase 1 (MVP, 8周):
  ✅ 聊天 + 默认 Agent
  ✅ 数据层（统一实体存储）
  ✅ 记忆层（基础版）
  ✅ 意图识别（Stage 1 + 2）
  ✅ 模板应用（预制 10 个）
  ✅ 应用容器（iframe 沙箱）

Phase 2 (增强, 6周):
  ✅ Agent 自动创建
  ✅ 动态应用生成（LLM 生成）
  ✅ 应用迭代（对话修改应用）
  ✅ 跨应用数据共享
  ✅ MCP 能力接入（3-5 个）

Phase 3 (进化, 6周):
  ✅ Agent 自我进化
  ✅ Agent 合并/拆分
  ✅ 意图识别 Stage 3（歧义消解）
  ✅ 多意图处理
  ✅ 记忆层增强（衰减、合并、强化）

Phase 4 (生态, 持续):
  ✅ MCP 能力市场
  ✅ 应用模板社区
  ✅ 多端同步
  ✅ 团队/家庭共享
```
