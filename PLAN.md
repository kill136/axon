# 后台 Bash 命令 → 新终端 Tab 显示

## 问题
`run_in_background` 的后台命令（如 `npm run dev`）输出混在聊天消息中，很难看到完整实时输出。

## 方案
当后台命令启动时，自动在新终端 tab/窗口中显示该命令的实时输出。

### 核心设计
- 进程管理不变：仍由 BashTool spawn 进程，输出写文件 `~/.claude/tasks/{taskId}.log`
- 新增：启动后额外打开一个终端 tab，用 `tail -f` / `Get-Content -Wait` 跟踪输出文件
- 新终端只是"输出查看器"，关闭不影响后台进程

### 跨平台终端启动策略
| 环境 | 检测方式 | 打开新 tab 命令 |
|------|----------|----------------|
| Windows Terminal | `where wt.exe` 存在 | `wt.exe -w 0 nt --title "BG: {cmd}" powershell -Command "Get-Content -Path {logFile} -Wait -Tail 50"` |
| macOS Terminal.app | `TERM_PROGRAM=Apple_Terminal` | `osascript -e 'tell app "Terminal" to do script "tail -f {logFile}"'` |
| macOS iTerm2 | `TERM_PROGRAM=iTerm.app` | `osascript` + iTerm2 AppleScript API |
| tmux | `TMUX` 环境变量 | `tmux new-window -n "BG: {cmd}" "tail -f {logFile}"` |
| 其他 | fallback | 不打开新终端，保持现有行为（echoOutput 或 TaskOutput 查询） |

### 修改文件
1. **`src/tools/bash.ts`** — `executeBackground()` 方法末尾，spawn 进程后调用 `openTerminalForTask()`
2. **新增 `src/utils/terminal-tab.ts`** — 跨平台终端 tab 打开工具函数

### `src/utils/terminal-tab.ts` 接口
```typescript
interface TerminalTabOptions {
  taskId: string;
  command: string;       // 原始命令（用于标题）
  logFile: string;       // 输出文件路径
}

/**
 * 在新终端 tab 中打开后台任务的输出查看器
 * 返回 true 表示成功打开，false 表示无法打开（fallback 到旧行为）
 */
export function openTerminalForTask(options: TerminalTabOptions): boolean;
```

### `executeBackground()` 修改
在现有 `backgroundTasks.set(taskId, taskState)` 之后，加一行：
```typescript
// 尝试在新终端 tab 中打开输出查看器
openTerminalForTask({ taskId, command, logFile: outputFile });
```

### 执行优先级
1. 检测 Windows Terminal → `wt.exe` 新 tab
2. 检测 tmux → `tmux new-window`
3. 检测 macOS Terminal/iTerm → `osascript`
4. 都不满足 → 跳过（不打开新终端）

### 不做的事
- 不改变现有进程管理逻辑
- 不改变 TaskOutput 工具行为
- 不强制要求新终端（检测失败就 fallback）
- 不增加新的 CLI 参数（自动检测）
