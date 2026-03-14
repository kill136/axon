# AI 自动化新境界：Axon 定时任务守护进程

## 🤖 让 AI 成为你的 7×24 自动化助手

想象一下：
- 每天早上 9 点，AI 自动审查你的代码提交
- 文件一修改，AI 立即生成测试用例
- 每周五下午，AI 自动生成项目进度报告
- 监控日志文件，异常时立即通过飞书通知你

这不是科幻，这是 Axon 最新推出的**定时任务守护进程**能为你做的事情！

## 🎯 核心能力：三大任务类型

### 1️⃣ 基于时间的任务（Time-based Tasks）

使用自然语言描述时间，AI 会自动理解并执行：

```bash
# 一次性任务
"明天下午3点，分析这个项目的性能瓶颈"
"2小时后，检查服务器日志是否有异常"
"下周一早上9点，生成本周代码统计报告"

# 循环任务
"每天早上8点，检查 GitHub issues 并总结"
"每周五下午5点，生成周报"
"每小时，检查 API 响应时间"
```

**支持的时间表达式：**
- **相对时间**："2小时后"、"30分钟后"、"明天"、"下周"
- **绝对时间**："2025-02-14 15:00"、"明天下午3点"
- **循环表达式**："每天早上9点"、"每周一"、"每小时"

### 2️⃣ 文件监控任务（File Watching）

监控文件变化，自动触发 AI 任务：

```bash
# 监控单个文件
"监控 server.log，出现 ERROR 时分析原因并通知我"

# 监控整个目录
"监控 src/ 目录，代码修改时自动生成单元测试"

# 监控特定类型文件
"监控 *.ts 文件，修改时检查 TypeScript 类型错误"
```

**支持的监控事件：**
- `change` - 文件内容修改
- `add` - 新文件创建
- `unlink` - 文件删除
- `addDir` - 新目录创建
- `unlinkDir` - 目录删除

### 3️⃣ 间隔任务（Interval Tasks）

按固定时间间隔执行：

```bash
"每隔5分钟，检查服务器CPU使用率"
"每隔1小时，备份数据库"
"每隔30分钟，拉取最新代码并运行测试"
```

## 🏗️ 架构设计：工业级可靠性

### 核心组件

```
┌─────────────────────────────────────────┐
│         Daemon Manager                  │
│  (守护进程管理器)                       │
└───────────┬─────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
┌───▼───┐     ┌────▼────┐
│ Config│     │  Store  │
│(配置) │     │(SQLite) │
└───┬───┘     └────┬────┘
    │              │
    └──────┬───────┘
           │
    ┌──────┴──────┐
    │             │
┌───▼────┐  ┌────▼─────┐  ┌──────────┐
│Scheduler│  │ Executor │  │  Watcher │
│(调度器) │  │ (执行器) │  │(文件监控)│
└────┬────┘  └────┬─────┘  └────┬─────┘
     │            │              │
     └────────┬───┴──────────────┘
              │
         ┌────▼────┐
         │Notifier │
         │(通知器) │
         └─────────┘
           │    │
    ┌──────┘    └──────┐
    │                  │
┌───▼───┐         ┌────▼────┐
│Desktop│         │ Feishu  │
│ Toast │         │  Bot    │
└───────┘         └─────────┘
```

### 持久化存储（SQLite）

任务数据保存在 `~/.claude/scheduled_tasks.db`，包含：

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'once' | 'interval' | 'watch'
  triggerAt INTEGER,   -- Unix timestamp
  intervalMs INTEGER,
  watchPaths TEXT,     -- JSON array
  watchEvents TEXT,    -- JSON array
  prompt TEXT NOT NULL,
  notify TEXT,         -- JSON array: ['desktop', 'feishu']
  model TEXT,          -- 'opus' | 'sonnet' | 'haiku'
  createdAt INTEGER,
  lastRun INTEGER,
  nextRun INTEGER,
  status TEXT          -- 'active' | 'paused' | 'completed'
);
```

**为什么选择 SQLite？**
- ✅ 零配置，无需单独数据库服务
- ✅ ACID 事务，数据可靠性保证
- ✅ 支持并发读，适合守护进程
- ✅ 文件级备份，迁移方便

### 智能时间解析

我们实现了一个强大的自然语言时间解析器：

```typescript
parseTimeExpression("明天下午3点")
// → Date: 2025-02-14 15:00:00

parseTimeExpression("2小时后")
// → Date: 2025-02-13 12:30:00 (当前时间+2h)

parseTimeExpression("每天早上9点")
// → Cron: "0 9 * * *"

parseTimeExpression("每周一早上10点")
// → Cron: "0 10 * * 1"
```

**支持的中文时间词：**
- 明天、后天、下周、下个月
- 早上、中午、下午、晚上、凌晨
- 小时、分钟、天、周、月
- 工作日、周末

## 🔔 多渠道通知系统

### 桌面通知（Desktop Notification）

使用 `node-notifier` 库，支持：
- **Windows**：原生 Toast 通知
- **macOS**：通知中心集成
- **Linux**：libnotify (notify-send)

```javascript
{
  title: '📋 定时任务执行完成',
  message: '代码审查报告已生成',
  sound: true,
  wait: true,  // 等待用户点击
  appID: 'Axon'
}
```

### 飞书机器人（Feishu Bot）

企业级通知，支持富文本消息：

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "content": "🤖 AI 任务执行报告" }
    },
    "elements": [
      {
        "tag": "div",
        "text": { "content": "**任务名称**: 代码审查\n**执行时间**: 2025-02-13 09:00\n**模型**: Claude Opus 4.6" }
      },
      {
        "tag": "markdown",
        "content": "发现 3 个潜在问题：\n1. 未处理的 Promise rejection\n2. 内存泄漏风险\n3. SQL 注入漏洞"
      }
    ]
  }
}
```

**配置飞书通知：**

```json
// ~/.claude/settings.json
{
  "feishu": {
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
    "defaultChatId": "oc_xxxxxxxxxxxx"
  }
}
```

## 💻 实战案例

### 案例 1：自动化代码审查

**场景**：每天早上 9 点，审查昨天的所有代码提交

```bash
claude daemon start

# 在对话中说：
"创建一个定时任务，每天早上9点，使用 git log 查看昨天的提交，
分析代码质量，检查潜在问题，并通过飞书通知我审查结果。
使用 Opus 模型以确保分析质量。"
```

守护进程会自动：
1. 每天 9:00 准时启动
2. 执行 `git log --since="1 day ago"`
3. Claude Opus 分析所有 diff
4. 生成详细审查报告
5. 通过飞书发送带格式的消息

### 案例 2：实时错误监控

**场景**：监控日志文件，出现 ERROR 立即分析

```bash
"监控 /var/log/app.log 文件，每次出现 'ERROR' 关键词时，
分析错误原因和堆栈跟踪，提供修复建议，
并通过桌面通知和飞书双通道提醒我。"
```

守护进程会：
1. 使用 `chokidar` 监控文件变化
2. 实时解析新增日志行
3. 检测到 ERROR 后提取上下文
4. Claude 分析根本原因
5. 双渠道通知，确保不错过

### 案例 3：定期备份提醒

**场景**：每周五下午 5 点，检查是否完成备份

```bash
"每周五下午5点，检查 /backup 目录是否有今天的备份文件，
如果没有，提醒我执行备份，并生成备份脚本。"
```

守护进程会：
1. 每周五 17:00 触发
2. 列出 `/backup` 目录文件
3. Claude 判断是否有当天备份
4. 未备份则生成通知和脚本
5. 桌面弹窗提醒

### 案例 4：API 健康监控

**场景**：每 5 分钟检查 API 可用性

```bash
"每隔5分钟，使用 curl 测试 https://api.example.com/health，
如果响应时间超过2秒或返回错误，分析原因并通知我。"
```

守护进程会：
1. 设置 5 分钟间隔 timer
2. 执行 `curl` 健康检查
3. 解析响应时间和状态码
4. 异常时 Claude 分析原因
5. 飞书发送告警消息

## 🛠️ 使用指南

### 启动守护进程

```bash
# 启动（后台运行）
claude daemon start

# 查看状态
claude daemon status
# Output:
# ✓ Daemon is running (PID: 12345)
# Active tasks: 5
# Next execution: 2025-02-13 15:00:00

# 停止
claude daemon stop

# 重启
claude daemon restart
```

### 通过对话创建任务

最简单的方式是直接告诉 Claude：

```
User: 每天早上8点，检查 GitHub issues 并总结

Claude: 我将为你创建一个定时任务：
- 任务名称: "每日 GitHub Issues 总结"
- 类型: 间隔任务
- 触发时间: 每天 08:00
- 通知方式: 桌面通知
- 使用模型: Sonnet (快速响应)

是否确认创建？

User: 确认

Claude: ✓ 任务已创建 (ID: task_abc123)
守护进程将在明天早上 8:00 首次执行。
```

### 使用 ScheduleTask 工具

高级用户可以直接使用工具：

```json
{
  "tool": "ScheduleTask",
  "input": {
    "action": "create",
    "name": "代码审查任务",
    "type": "interval",
    "triggerAt": "every day at 9am",
    "prompt": "分析昨天的 git 提交，检查代码质量",
    "notify": ["desktop", "feishu"],
    "model": "opus"
  }
}
```

### 管理任务

```bash
# 列出所有任务
{
  "tool": "ScheduleTask",
  "input": { "action": "list" }
}

# 取消任务
{
  "tool": "ScheduleTask",
  "input": {
    "action": "cancel",
    "taskId": "task_abc123"
  }
}
```

## 🔒 安全性考虑

### 权限隔离

- 守护进程以用户权限运行，不需要 root
- 文件监控限制在用户目录内
- 防止路径遍历攻击

### 资源限制

```typescript
// 配置文件
{
  "daemon": {
    "maxConcurrentTasks": 3,        // 最多同时执行3个任务
    "maxTaskDuration": 600000,      // 单任务最长10分钟
    "maxMemoryUsage": 512 * 1024,   // 最大512MB
    "cpuThrottle": 0.5              // CPU限制50%
  }
}
```

### API 密钥保护

- API Key 加密存储
- 环境变量优先级高于配置文件
- 支持密钥轮换机制

## 📊 监控与日志

### 执行日志

所有任务执行记录在 `~/.claude/daemon.log`：

```
[2025-02-13 09:00:00] [INFO] Task started: task_abc123 (代码审查任务)
[2025-02-13 09:00:01] [DEBUG] Executing prompt with model: opus
[2025-02-13 09:00:15] [INFO] Claude response received (tokens: 2450)
[2025-02-13 09:00:16] [INFO] Notification sent: feishu
[2025-02-13 09:00:16] [INFO] Task completed: task_abc123 (duration: 16s)
```

### 性能指标

```bash
claude daemon metrics

# Output:
┌─────────────────┬────────┐
│ Metric          │ Value  │
├─────────────────┼────────┤
│ Total tasks     │ 15     │
│ Active tasks    │ 8      │
│ Completed today │ 23     │
│ Avg duration    │ 12.3s  │
│ Success rate    │ 98.5%  │
│ Memory usage    │ 185MB  │
│ CPU usage       │ 3.2%   │
└─────────────────┴────────┘
```

## 🚀 性能优化

### 智能去重

```typescript
// 防止重复执行
if (isTaskRunning(taskId)) {
  logger.warn(`Task ${taskId} is already running, skipping`);
  return;
}
```

### 批量执行

```typescript
// 相同时间的任务批量处理
const tasksAtSameTime = getTasksAt(now);
await Promise.all(tasksAtSameTime.map(task => execute(task)));
```

### 懒加载模型

```typescript
// 按需加载 Claude 模型
let cachedClient = null;
function getClaudeClient(model) {
  if (!cachedClient || cachedClient.model !== model) {
    cachedClient = new ClaudeClient({ model });
  }
  return cachedClient;
}
```

## 🎁 高级特性

### 条件执行

```bash
"每天早上9点，检查 GitHub stars 数量，
如果超过 1000，发送祝贺通知"
```

### 任务链

```bash
"每周一早上9点，先拉取最新代码，
然后运行测试，测试通过后部署到测试环境"
```

### 动态 Prompt

```bash
"每小时，根据当前时间生成不同的问候语，
早上说早安，下午说下午好，晚上说晚安"
```

## 🌟 与其他工具对比

| 功能 | Axon Daemon | Cron | Jenkins | GitHub Actions |
|------|-------------------|------|---------|----------------|
| 自然语言配置 | ✅ | ❌ | ❌ | ❌ |
| AI 任务执行 | ✅ | ❌ | ❌ | ❌ |
| 文件监控 | ✅ | ❌ | 🟡 插件 | ❌ |
| 桌面通知 | ✅ | ❌ | ❌ | ❌ |
| 飞书集成 | ✅ | ❌ | 🟡 插件 | 🟡 插件 |
| 跨平台 | ✅ | 🟡 Linux/Mac | ✅ | ☁️ 云端 |
| 零配置 | ✅ | ❌ | ❌ | ❌ |
| 本地执行 | ✅ | ✅ | ✅ | ❌ |

## 📝 用户反馈

> "定时任务太香了！每天早上自动审查代码，喝咖啡的时候就能看到飞书通知，效率翻倍！" —— GitHub 用户 @coder2025

> "文件监控功能救了我的命，配置文件一改就自动检查语法错误，再也不用担心误操作了。" —— 运维工程师

> "自然语言配置太方便了，不用学 Cron 表达式，直接说'每天早上9点'就行！" —— 产品经理

## 🔮 未来规划

- [ ] Web UI 任务管理界面
- [ ] 任务执行历史可视化
- [ ] 更多通知渠道（钉钉、企业微信、Slack）
- [ ] 任务模板市场
- [ ] 分布式任务调度
- [ ] GPU 任务支持

## 🎯 立即开始

1. **安装 Axon**（如果还没有）

```bash
# Windows
irm https://www.chatbi.site/assets/scripts/install.ps1 | iex

# macOS/Linux
curl -fsSL https://www.chatbi.site/assets/scripts/install.sh | bash
```

2. **启动守护进程**

```bash
claude daemon start
```

3. **创建你的第一个定时任务**

```bash
claude

# 在对话中说：
"每天早上9点，检查 GitHub 仓库的新 issues，总结并通过飞书通知我"
```

4. **享受自动化带来的效率提升！**

---

**Axon** - AI 驱动的智能自动化平台

加入我们的社区：
- **Discord**：[https://discord.gg/bNyJKk6PVZ](https://discord.gg/bNyJKk6PVZ)
- **GitHub**：[https://github.com/kill136/claude-code-open](https://github.com/kill136/claude-code-open)
- **X (Twitter)**：[@wangbingjie1989](https://x.com/wangbingjie1989)

*本文发布于 2025 年 2 月 13 日*
