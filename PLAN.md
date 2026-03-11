# 实施计划：让用户不需要学会提问

## 核心理念

**不是教用户怎么用工具，而是让工具不需要教。**

三个方向并行：意图增强层、事件驱动 Agent、一句话到完成。

---

## 一、意图增强层（Intent Enrichment Layer）

### 目标
用户输入模糊消息（如"这代码有问题"），系统自动补充上下文，让 Claude 拿到足够信息直接行动。用户完全无感。

### 架构设计

```
用户输入
  ↓
IntentEnricher.enrich(userInput, projectContext)
  ↓
  ├── 1. 意图分类（模糊/明确/指令型）
  ├── 2. 上下文采集（git diff、最近错误、打开的文件、项目结构）
  ├── 3. 上下文注入（以 <intent-context> 标签附加到用户消息末尾）
  ↓
enrichedInput → Claude API
```

### 关键设计决策

**分类策略（不用 AI，用规则）：**
- **明确意图** — 包含文件路径、函数名、具体技术术语 → 不增强
- **模糊意图** — "有问题"、"帮我看看"、"不对"、"报错了" → 增强
- **指令型** — "创建 X"、"做一个 Y"、"实现 Z 功能" → 轻度增强（项目结构）

**上下文采集（按成本递增）：**
1. **零成本**：当前工作目录、是否 git 仓库、平台信息（已有）
2. **低成本**（<50ms）：`git status`、`git diff --stat`、最近 3 条 commit
3. **中成本**（<200ms）：`git diff`（具体改动）、项目文件结构摘要
4. **高成本**（跳过）：全量代码分析、AST 解析 — 不做，这是 Claude 该干的事

**注入格式：**
```xml
<intent-context>
## 项目状态
- 工作目录: /path/to/project
- 最近改动: src/auth.ts (+15 -3), src/db.ts (+8 -2)
- 最近 commit: "fix: 修复登录逻辑" (2 minutes ago)
- git status: 2 文件未暂存

## 终端最近输出
TypeError: Cannot read property 'id' of undefined
    at AuthService.login (src/auth.ts:42)
</intent-context>
```

### 文件改动

**新建文件：**
- `src/context/intent-enricher.ts` — 意图增强核心逻辑

**修改文件：**
- `src/web/server/conversation.ts` — 在 `chat()` 方法中，构建 `userMessage` 之前调用 `IntentEnricher.enrich()`
- `src/core/loop.ts` — 在 `preprocessUserInput()` 中调用（CLI 路径）
- `src/config/index.ts` — 添加 `intentEnrichment` 配置项（开关 + 级别）

### 切入点

**Web 端**：`conversation.ts:1397` — `const userMessage` 之前插入增强逻辑
**CLI 端**：`loop.ts:3180` — `preprocessUserInput()` 中，URL 提取之后

---

## 二、事件驱动 Agent（Event-Driven Agent）

### 目标
不需要用户主动提问。git commit 后自动 review，测试失败自动分析，IM 消息自动路由到编程 Agent。

### 架构设计

```
事件源                    事件总线                    响应器
─────────────           ──────────            ─────────────
Git Hooks ──→          EventBus            ──→ AutoReview
File Watcher ──→    (publish/subscribe)    ──→ ErrorAnalyzer  
IM Channel ──→                             ──→ TaskRouter
Terminal Output ──→                        ──→ ProactiveSuggestion
```

### 实现方案

**Phase 1：基于现有 daemon watch 机制**

现有的 `src/daemon/watcher.ts` + `FileWatcher` 已经能监听文件变化并触发 AI 任务。只需要：

1. **预置有用的 watch 规则** — 不让用户手动配置，而是项目初始化时自动注册
2. **Git hook 集成** — 在项目的 `.git/hooks/post-commit` 安装钩子，触发 daemon 任务
3. **终端输出监控** — 监听 Bash 工具的输出，检测错误模式

**Phase 2：Web 端内置事件总线**

新增 `src/web/server/event-bus.ts`：
- 在 Web server 进程内运行，不依赖 daemon
- 工具执行结果通过事件总线广播
- 注册响应器：如 Bash 输出含 error → 自动分析

### 具体事件 → 响应映射

| 事件 | 触发条件 | 自动响应 |
|------|---------|---------|
| `git:post-commit` | 用户提交代码 | 自动 review 这次 commit 的改动，发现问题主动提醒 |
| `test:fail` | 测试运行失败 | 自动分析失败原因，给出修复建议 |
| `build:error` | 构建失败 | 自动分析编译错误 |
| `file:created` | 新文件创建 | 分析是否需要对应的测试文件、类型声明等 |
| `im:message` | IM 收到消息 | 意图识别：编程相关 → 启动 Agent；闲聊 → 直接回复 |

### 文件改动

**新建文件：**
- `src/web/server/event-bus.ts` — 事件总线（EventEmitter 封装）
- `src/web/server/event-responders/` — 响应器目录
  - `auto-review.ts` — git commit 自动 review
  - `error-analyzer.ts` — 错误自动分析
  - `proactive-suggestion.ts` — 主动建议

**修改文件：**
- `src/tools/bash.ts` — 工具执行完成后发布事件（检测输出中的错误模式）
- `src/web/server/conversation.ts` — 初始化事件总线，注册响应器
- `src/daemon/config.ts` — 添加预置规则 schema

### 用户体验

事件驱动的响应以 **非侵入式通知** 形式出现在 Web UI 中：
- 右上角小气泡："检测到你最近的 commit 有个潜在问题，要看看吗？"
- 用户点击 → 打开包含分析结果的新对话
- 用户忽略 → 自动消失

---

## 三、一句话到完成（One-Line to Done）

### 目标
用户说"做一个用户登录功能"，系统自动规划 → 生成蓝图 → 多智能体执行 → 交付结果。用户不需要知道蓝图系统的存在。

### 架构设计

```
用户: "做一个用户登录功能"
  ↓
ComplexityDetector — 判断是简单任务还是复杂项目
  ↓
  ├── 简单（改个bug、加个字段）→ 直接让 Claude 处理（现有流程）
  └── 复杂（新功能、新模块、多文件改动）→ 自动走蓝图路径
      ↓
      Claude 被要求调用 GenerateBlueprint → 自动生成蓝图
      ↓
      蓝图生成后，Claude 被要求调用 StartLeadAgent → 多智能体执行
      ↓
      执行完成 → 结果汇总给用户
```

### 关键设计决策

**不改 Claude 的决策权** — 不在代码中硬编码"什么时候该用蓝图"。而是通过系统提示词引导：

在系统提示词中增加决策指南：
```
当用户请求涉及以下场景时，你应该主动使用 GenerateBlueprint + StartLeadAgent：
- 创建新项目或新功能模块
- 涉及 3 个以上文件的改动
- 需要前后端协调的任务
- 用户用一句话描述了一个复杂需求

不要问用户"要不要用蓝图系统"——直接用。就像你不会问"要不要用 Read 工具读文件"一样。
```

这比在代码中写 `if (isComplex) useBlueprintFlow()` 更好，因为：
1. Claude 本身就擅长判断任务复杂度
2. 不需要额外维护分类规则
3. 灵活性更高

### 文件改动

**修改文件：**
- `src/prompt/templates.ts` 或 `src/prompt/builder.ts` — 在系统提示词中添加蓝图决策指南
- `src/web/client/src/components/WelcomeScreen.tsx` — 添加"描述你想做什么"引导文案，降低输入门槛

### WelcomeScreen 改进

当前 Welcome 页面给了模板按钮，但用户仍然面对空白输入框。改进方向：

1. **输入框占位文字** — 不是"Type a message..."，而是"告诉我你想做什么，比如：做一个用户登录功能"
2. **场景卡片更新** — 从技术操作（"分析代码"、"修复 Bug"）改为目标导向（"我想做一个..."、"帮我把这个项目..."）
3. **首次引导** — 新用户第一次打开时，显示 3 个真实的 demo 场景，点击可直接体验

---

## 实施顺序

### Step 1: 意图增强层
- 新建 `src/context/intent-enricher.ts`
- 修改 `conversation.ts` 和 `loop.ts` 注入增强逻辑
- 添加配置开关
- **验证**: 用户输入"这有问题" → Claude 收到的是带上下文的富消息

### Step 2: 一句话到完成
- 修改系统提示词，添加蓝图决策指南
- 改进 WelcomeScreen
- **验证**: 用户说"做一个 XX" → Claude 自动走蓝图 → 多智能体执行

### Step 3: 事件驱动 Agent
- 新建事件总线和响应器
- 集成 git hook + Bash 输出监控
- Web UI 添加通知气泡
- **验证**: git commit 后 → 自动收到 review 通知

---

## 风险和约束

1. **意图增强不能太慢** — 必须 <200ms，否则影响用户感知的响应速度。git 命令要用 `execSync` 带超时
2. **事件驱动不能太吵** — 如果每次 commit 都弹通知，用户会关掉。需要智能过滤：只有发现真正问题时才提醒
3. **蓝图自动触发不能出错** — 简单任务走蓝图是浪费。提示词引导要精准，需要测试边界 case
4. **token 成本** — 意图增强注入的上下文会消耗 token。控制在 200-500 tokens 以内
5. **配置** — 所有新功能默认开启，但提供关闭开关
