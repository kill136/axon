# 定时任务管理 UI 实现计划

## 目标
为 Web UI 添加一个独立的"定时任务"管理页面，让用户可以集中查看、管理所有定时任务及其执行历史。

## 现状分析
- **后端**：TaskStore（daemon/store.ts）+ WebScheduler（web-scheduler.ts）已完整
- **后端 API**：**完全缺失** — 没有任何 `/api/schedule/*` 路由
- **前端**：只有 `useScheduleArtifacts` hook 在对话消息中提取 ScheduleTask 工具调用的产物展示，没有独立管理页面
- **导航**：Root.tsx 当前支持 `chat | swarm | blueprint` 三个页面

## 实现方案

### 1. 后端 API — `src/web/server/routes/schedule-api.ts`（新建）

Express Router，挂载到 `/api/schedule`：

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/schedule/tasks` | GET | 列出所有任务（从 TaskStore 读取） |
| `/api/schedule/tasks/:id` | GET | 获取单个任务详情 |
| `/api/schedule/tasks/:id` | DELETE | 取消（删除）任务 |
| `/api/schedule/tasks/:id/toggle` | POST | 启用/禁用任务 |
| `/api/schedule/tasks/:id/history` | GET | 获取任务执行历史（从 run-log 读取）|

TaskStore 实例直接 `new TaskStore()` 即可（它读同一份 daemon-tasks.json）。执行日志通过 `readRunLogEntries()` 读取。

### 2. 路由注册 — `src/web/server/index.ts`（修改）

在现有路由注册区域添加：
```typescript
const scheduleRouter = await import('./routes/schedule-api.js');
app.use('/api/schedule', scheduleRouter.default);
```

### 3. 前端页面 — `src/web/client/src/pages/SchedulePage/index.tsx`（新建）

页面布局（参考 BlueprintPage 的模式）：

```
┌─────────────────────────────────────────────────┐
│  SchedulePage                                    │
│  ┌──────────────────┬──────────────────────────┐│
│  │  任务列表（左侧）  │  任务详情/历史（右侧）    ││
│  │                  │                          ││
│  │  [once] 任务A    │  名称: 任务A              ││
│  │  [interval] 任务B│  类型: interval           ││
│  │  [watch] 任务C   │  状态: enabled ✅         ││
│  │                  │  下次执行: 2min 30s       ││
│  │                  │  Prompt: ...              ││
│  │                  │  ────────────────          ││
│  │                  │  执行历史                  ││
│  │                  │  #1 成功 3s               ││
│  │                  │  #2 失败 timeout          ││
│  └──────────────────┴──────────────────────────┘│
└─────────────────────────────────────────────────┘
```

关键交互：
- 任务列表：类型标签 + 名称 + 状态指示器（启用/禁用/正在执行）
- 倒计时：对 `nextRunAtMs` 做实时倒计时显示（`setInterval` 每秒更新）
- 操作按钮：启用/禁用切换、删除
- 详情面板：显示任务完整信息 + 执行历史列表
- 空状态：无任务时显示引导文字

### 4. 页面样式 — `src/web/client/src/pages/SchedulePage/SchedulePage.module.css`（新建）

遵循项目现有的 CSS Module + CSS 变量风格（参考 BlueprintPage.module.css）。

### 5. 路由集成 — 修改 `Root.tsx` 和 `TopNavBar`

- `Root.tsx`：Page 类型扩展为 `'chat' | 'swarm' | 'blueprint' | 'schedule'`，添加 SchedulePage 挂载
- `TopNavBar/index.tsx`：props 类型扩展，添加 Schedule Tab（时钟图标）
- `TopNavBar/TopNavBar.module.css`：无需修改（Tab 样式已通用化）

### 6. i18n — 修改 `src/web/client/src/i18n/locales.ts`

添加 en/zh 翻译键：
```
nav.schedule: 'Schedule' / '定时任务'
schedule.title: 'Scheduled Tasks' / '定时任务'
schedule.empty: 'No scheduled tasks' / '暂无定时任务'
schedule.type.once: 'Once' / '一次性'
schedule.type.interval: 'Interval' / '周期性'  
schedule.type.watch: 'Watch' / '文件监控'
schedule.status.enabled: 'Enabled' / '已启用'
schedule.status.disabled: 'Disabled' / '已禁用'
schedule.status.running: 'Running' / '执行中'
schedule.nextRun: 'Next run' / '下次执行'
schedule.lastRun: 'Last run' / '上次执行'
schedule.history: 'Execution History' / '执行历史'
schedule.delete: 'Delete' / '删除'
schedule.toggle: 'Toggle' / '切换'
schedule.prompt: 'Prompt' / '提示词'
schedule.runCount: 'Run count' / '执行次数'
schedule.consecutiveErrors: 'Consecutive errors' / '连续错误'
schedule.noHistory: 'No execution history' / '暂无执行记录'
schedule.detail: 'Task Detail' / '任务详情'
schedule.confirmDelete: 'Confirm delete?' / '确认删除？'
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/web/server/routes/schedule-api.ts` | 新建 | 后端 REST API |
| `src/web/server/index.ts` | 修改 | 注册 schedule 路由 |
| `src/web/client/src/pages/SchedulePage/index.tsx` | 新建 | 前端页面组件 |
| `src/web/client/src/pages/SchedulePage/SchedulePage.module.css` | 新建 | 页面样式 |
| `src/web/client/src/Root.tsx` | 修改 | 添加页面路由 |
| `src/web/client/src/components/swarm/TopNavBar/index.tsx` | 修改 | 添加导航 Tab |
| `src/web/client/src/i18n/locales.ts` | 修改 | 添加 i18n 键 |

共 **4 个新文件 + 4 个修改文件**。
