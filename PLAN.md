# Axon UX 改造计划：从"功能堆砌"到"Mission Control"

## 背景

你朋友的核心判断：**功能差异化已经有了，但 UX 没跟上，导致能力感知不到、用起来费劲。**

当前问题：
1. **7 个顶栏 Tab 平铺**（Chat/Code/Blueprint/Swarm/Customize/Apps/Activity）——新用户看不懂，老用户找不到重点
2. **差异化能力分散隐藏**——GoalManage 无 UI、SelfEvolve 无 UI、autoRecall 无 UI、学习过程不可见
3. **Customize 页面 11 个子面板**——配置项堆砌，没有引导，像系统管理后台
4. **WelcomeScreen 是模板快捷入口**——没有展示 Axon 的独特能力，和任何 ChatGPT 克隆一样
5. **SwarmConsole 只有蓝图执行时才有内容**——平时空白，浪费了最有价值的页面

## 设计理念

### 核心定位重塑

**从**: "一个有很多功能的 AI 编程助手"
**到**: "一个会学习、会成长、可编排的 AI 工作伙伴"

### 三个感知锚点

用户应该在使用 Axon 的前 30 秒内感知到这三件事：

1. **"它认识我"** — Notebook 记忆 + autoRecall，上来就知道我是谁、我的项目是什么
2. **"它在成长"** — 学习进度可视化，每次使用都在积累经验
3. **"它能并行工作"** — 多 Agent 编排不是隐藏功能，是核心体验

---

## 改造方案

### Phase 1：信息架构重组（导航简化）

**目标**：从 7 个平铺 Tab 减少到 3+1 的清晰层级

#### 新导航结构

```
┌──────────────────────────────────────────────────────┐
│  [项目选择器]    Chat  │  Workspace  │  Settings   🔍 │
└──────────────────────────────────────────────────────┘
```

| 新 Tab | 包含的旧页面 | 说明 |
|--------|-------------|------|
| **Chat** | Chat + Code | 核心对话界面，Code Browser 作为 Chat 的子模式（按钮切换） |
| **Workspace** | 新建 Dashboard + Swarm + Blueprint + Apps + Activity | 工作空间总览，包含所有"管理和监控"功能 |
| **Settings** | Customize 的所有子面板 | 配置中心，低频操作 |

#### Workspace 内部结构

Workspace 不再是空白页，而是一个始终有内容的 **Mission Control Dashboard**：

```
┌─────────────────────────────────────────────────────────────┐
│  Workspace                                                   │
│  ┌──────────┬──────────┬───────────┬──────────┐             │
│  │ Overview │ Agents   │ Blueprint │ Activity │   (子 Tab)  │
│  └──────────┴──────────┴───────────┴──────────┘             │
│                                                              │
│  [根据子 Tab 显示不同内容]                                    │
└─────────────────────────────────────────────────────────────┘
```

**涉及文件**：
- `src/web/client/src/Root.tsx` — Page 类型从 7 减到 3，新增 Workspace 子路由
- `src/web/client/src/components/swarm/TopNavBar/index.tsx` — 导航栏简化
- `src/web/client/src/i18n/locales/{en,zh}/nav.ts` — 导航文案更新

---

### Phase 2：Dashboard 首页（Workspace Overview）

**目标**：让用户一眼看到 Axon 的全局状态和独特能力

#### Dashboard 布局

```
┌─────────────────────────────────────────────────────────────┐
│                    Workspace Overview                        │
│                                                              │
│  ┌─── AI Status Card ───────────────────────────────────┐   │
│  │  🧠 Axon  ·  已学习 142 条经验  ·  记住 3 个项目     │   │
│  │  本次会话：已完成 12 次工具调用  ·  修改 5 个文件      │   │
│  │  [Memory: ████████░░ 78%]  [Project KB: ██░░░░ 24%]  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── Active Goals ──────┐  ┌─── Running Agents ────────┐  │
│  │  📎 Axon 变现 $1000   │  │  ⬡ LeadAgent: idle       │  │
│  │  [$0/$1000] ░░░░░░░░  │  │  ⬡ Workers: 0 active     │  │
│  │  Stars: 154/500 ███░  │  │  ⬡ Scheduled: 3 tasks    │  │
│  │  Posts: 7/50 █░░░░░░  │  │                           │  │
│  │  [+ New Goal]         │  │  [View Swarm Console →]   │  │
│  └───────────────────────┘  └───────────────────────────┘  │
│                                                              │
│  ┌─── Recent Activity ──────────────────────────────────┐   │
│  │  14:32  ✏️ Modified auth.ts (+12 -3)                  │   │
│  │  14:28  🧠 Learned: "ESM mock 用 vi.mock 替代"       │   │
│  │  14:15  ✅ Goal metric updated: Stars 154→156        │   │
│  │  13:50  📋 Blueprint "API重构" created                │   │
│  │  [View All Activity →]                                │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── Quick Actions ────────────────────────────────────┐   │
│  │  [📋 Create Blueprint]  [🎯 Set Goal]  [📡 Network]  │   │
│  │  [⏰ Schedule Task]  [🔧 Install Skill]              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Dashboard 数据来源

| 卡片 | API | 已有/新建 |
|------|-----|----------|
| AI Status | `GET /api/notebook/list` (token usage) + 新 `GET /api/stats/session` | 部分已有 |
| Active Goals | `GET /api/goals` (需新建路由，复用 GoalStore) | **新建 API** |
| Running Agents | 复用 SwarmConsole 的 WebSocket 状态 | 已有 |
| Recent Activity | `GET /api/activity` | 已有 |
| Quick Actions | 前端路由跳转，无 API | 前端 |

**涉及新建文件**：
- `src/web/client/src/pages/WorkspacePage/index.tsx` — Workspace 容器
- `src/web/client/src/pages/WorkspacePage/DashboardPanel.tsx` — Dashboard Overview
- `src/web/client/src/pages/WorkspacePage/WorkspacePage.module.css`
- `src/web/server/routes/goals-api.ts` — Goals REST API（暴露 GoalStore 数据）
- `src/web/server/routes/stats-api.ts` — 统计 API

---

### Phase 3：学习可视化（"它在成长"）

**目标**：让用户**看到** Axon 在变聪明

#### 3a. AI Status Card（Dashboard 上的核心卡片）

展示内容：
- **经验数量**：Notebook 的 token 使用率，按类型分（profile/experience/project）
- **学习事件流**：最近的 Notebook 写入事件（"学到了什么"）
- **能力统计**：已安装 Skills 数、MCP 工具数、自定义工具数
- **自我进化次数**：从 `~/.axon/evolve-log.jsonl` 读取

#### 3b. 学习事件流（融入 Activity Feed）

当前 ActivityPage 只记录文件修改。扩展为统一的事件流：

| 事件类型 | 来源 | 图标 |
|---------|------|------|
| 文件修改 | 已有 activity API | ✏️ |
| 经验学习 | Notebook 写入（新增 hook） | 🧠 |
| 目标进度 | GoalStore 更新 | 🎯 |
| 技能安装 | Skills 变更 | 🔧 |
| 自我进化 | evolve-log.jsonl | ⚡ |
| Agent 通信 | Network audit-log | 📡 |

**涉及修改**：
- `src/web/server/routes/activity-api.ts` — 扩展事件类型
- `src/memory/notebook.ts` — 写入时 emit 事件

---

### Phase 4：Goal 管理界面

**目标**：GoalManage 从"纯 CLI 工具"升级为可视化管理

#### Goal Panel（集成到 Workspace > Overview）

```
┌─── Goal: Axon 项目变现 $1000 ───────────────────────┐
│  Status: Active  ·  Created: 2026-03-08              │
│                                                       │
│  Metrics:                                             │
│  ├─ 累计收入    [$0 / $1000]  ░░░░░░░░░░░░  0%      │
│  ├─ GitHub Stars [154 / 500]  ██████░░░░░░  31%     │
│  ├─ 帖子数      [7 / 50]     ██░░░░░░░░░░  14%     │
│  └─ PH 上线     [0 / 1]      ░░░░░░░░░░░░  0%      │
│                                                       │
│  Strategies (4):                                      │
│  ├─ ✅ GitHub Sponsors 配置                           │
│  ├─ 🔄 社交媒体内容生产 (3/10 steps)                 │
│  ├─ ⏸️ Product Hunt 准备                             │
│  └─ 📋 视频/博客内容 (planned)                        │
│                                                       │
│  [View Details]  [Pause]  [+ Add Strategy]            │
└──────────────────────────────────────────────────────┘
```

**涉及文件**：
- `src/web/client/src/pages/WorkspacePage/GoalCard.tsx` — Goal 卡片组件
- `src/web/client/src/pages/WorkspacePage/GoalDetailPanel.tsx` — Goal 详情面板（策略、步骤、日志）
- `src/web/server/routes/goals-api.ts` — REST API

---

### Phase 5：Chat 页面优化

**目标**：Chat 页面本身也要体现"它认识我"

#### 5a. 改造 WelcomeScreen

**当前问题**：模板快捷入口（写周报/写论文）和任何 ChatGPT 克隆一样，没有差异化。

**新设计**：

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│              ✦ Axon                                      │
│                                                          │
│   你好，冰洁。我记得你正在做 Axon 的 UX 改造。           │
│   上次我们讨论了导航简化方案。                            │
│                                                          │
│   ┌─── 继续上次的工作 ────────────────────────────────┐  │
│   │  📋 UX 改造计划 — 还需要实现 Phase 2 的 Dashboard │  │
│   │  🎯 变现目标 — Stars 增长到 156，差 344            │  │
│   └───────────────────────────────────────────────────┘  │
│                                                          │
│   ┌─── 快速开始 ──────────────────────────────────────┐  │
│   │  [📋 创建蓝图]  [📝 代码审查]  [🔍 分析项目]     │  │
│   │  [📊 生成报告]  [🧪 写测试]   [🐛 修复 Bug]      │  │
│   └───────────────────────────────────────────────────┘  │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │  在这里输入任务...                     [发送]    │   │
│   └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

关键改变：
1. **个性化问候**：从 Notebook profile 读取用户名
2. **上下文续接**：从 project notebook + goals 读取最近工作
3. **快捷入口精简**：从 21 个模板 → 6 个高频操作
4. **去掉 Tab 分栏**（office/student/developer）：用 AI 根据项目类型自动推荐

**涉及修改**：
- `src/web/client/src/components/WelcomeScreen.tsx` — 全面重写
- 新建 `GET /api/welcome-context` API — 聚合 notebook/goals/recent activity

---

### Phase 6：Settings 页面精简

**目标**：Customize 从 11 个面板精简为更清晰的分组

#### 新分组

```
Settings
├── General          (原来没有，新增：语言、主题、快捷键)
├── AI Profile       (原 DocsPanel：Notebook 编辑)
├── Capabilities     (合并：原 Capabilities + Skills + MCP)
├── Connections      (合并：原 Connectors + Channels + Network + Tunnel)
├── Automation       (合并：原 Schedule + Proxy)
└── Perception       (原 Perception)
```

从 11 个面板 → **6 个分组**，每组内部用折叠面板展示子项。

**涉及修改**：
- `src/web/client/src/pages/CustomizePage/index.tsx` — 重组分组

---

## 实施优先级

| Phase | 内容 | 价值 | 工作量 | 优先级 |
|-------|------|------|--------|--------|
| **Phase 1** | 导航简化 (7 Tab → 3) | 高 - 第一印象 | 中 | **P0** |
| **Phase 2** | Dashboard 首页 | 高 - 核心差异化展示 | 大 | **P0** |
| **Phase 5a** | WelcomeScreen 个性化 | 高 - "它认识我" | 小 | **P0** |
| **Phase 3** | 学习可视化 | 中 - "它在成长" | 中 | **P1** |
| **Phase 4** | Goal 管理 UI | 中 - 目标可视化 | 中 | **P1** |
| **Phase 6** | Settings 精简 | 低 - 减少认知负荷 | 小 | **P2** |

**建议执行顺序**：Phase 1 + 2 + 5a 一起做（它们互相依赖），然后 Phase 3 + 4，最后 Phase 6。

---

## 技术要点

### 后端新增 API

1. **`GET /api/goals`** — 返回所有 Goal 列表（name, metrics, status）
2. **`GET /api/goals/:id`** — 返回 Goal 详情（strategies, steps, logs）
3. **`POST /api/goals/:id/pause`** / **`/resume`** — 目标控制
4. **`GET /api/stats/session`** — 当前会话统计（工具调用次数、文件修改数等）
5. **`GET /api/stats/learning`** — 学习统计（经验数、进化次数、notebook token 使用）
6. **`GET /api/welcome-context`** — 欢迎页上下文（用户名、最近工作、目标摘要）

### 前端新建组件

1. `pages/WorkspacePage/` — Workspace 容器 + Dashboard + Goal UI
2. 改造 `WelcomeScreen.tsx` — 个性化欢迎
3. 改造 `TopNavBar/index.tsx` — 导航简化
4. 改造 `Root.tsx` — 路由重组

### 不变的部分

- SwarmConsole 内部结构不变（移入 Workspace 子 Tab）
- BlueprintPage 内部结构不变（移入 Workspace 子 Tab）
- ActivityPage 内部结构不变（移入 Workspace 子 Tab）
- AppsPage 内部结构不变（移入 Workspace 子 Tab）
- CustomizePage 内部各面板不变（只改分组逻辑）
- 所有后端功能不变，只新增 API 暴露已有数据

---

## 预期效果

### Before（现在）
- 新用户：打开 → 看到 7 个 Tab → 不知道点哪个 → 只用 Chat → 感觉"就是个 ChatGPT"
- 老用户：知道有 GoalManage/SelfEvolve/Network → 但只能用 CLI 调用 → 感觉"功能多但散"

### After（改造后）
- 新用户：打开 → 看到个性化问候 + 上次工作续接 → "它认识我" → 点 Workspace → 看到 Dashboard → "它在做这么多事" → 觉得不一样
- 老用户：Dashboard 一页看全局 → Goal 进度一目了然 → 学习事件流感受成长 → "这是我的 AI 伙伴"

### 核心指标
- **首屏感知时间**：从"需要探索 5 分钟"→"30 秒内感知三大差异化"
- **Tab 数量**：从 7 → 3（认知负荷 -60%）
- **差异化功能可见性**：GoalManage/Learning/Network 从"隐藏"→"Dashboard 首屏可见"
