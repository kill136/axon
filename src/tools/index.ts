/**
 * 工具注册表
 * 导出所有工具
 *
 * 工具分为两类：
 * 1. 核心工具 (registerCoreTools) - 对齐官方 Axon v2.1.34，CLI/Web 都加载
 * 2. 蓝图工具 (registerBlueprintTools) - Blueprint 多 Agent 系统专用，仅 Web 模式按需加载
 */

// 核心工具类型导出
export * from './base.js';
export * from './bash.js';
export * from './file.js';
export * from './search.js';
export * from './web.js';
export * from './todo.js';
export * from './agent.js';
export * from './notebook.js';
export * from './planmode.js';
export * from './mcp.js';
export * from './ask.js';
export * from './sandbox.js';
export * from './skill.js';
export * from './task-storage.js';
export * from './task-v2.js';
export * from './notebook-write.js';
export * from './schedule.js';
export * from './self-evolve.js';
export * from './browser.js';
export * from './create-tool.js';
export * from './mcp-manage.js';

// 蓝图工具不通过此处 re-export
// 蓝图模块直接 import 各自需要的工具文件 (如 ../tools/dispatch-worker.js)

import { toolRegistry } from './base.js';

// ============ 核心工具 imports ============
import { BashTool, KillShellTool, cleanupStaleTasks } from './bash.js';
import { ReadTool, WriteTool, EditTool } from './file.js';
import { GlobTool, GrepTool } from './search.js';
import { WebFetchTool } from './web.js';
import { TodoWriteTool } from './todo.js';
import { TaskTool, TaskOutputTool } from './agent.js';
import { TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool } from './task-v2.js';
import { isTasksEnabled } from './task-storage.js';
import { NotebookEditTool } from './notebook.js';
import { EnterPlanModeTool, ExitPlanModeTool } from './planmode.js';
import { MCPSearchTool, McpResourceTool } from './mcp.js';
import { AskUserQuestionTool } from './ask.js';
import { SkillTool } from './skill.js';
import { NotebookWriteTool } from './notebook-write.js';
import { ScheduleTaskTool } from './schedule.js';
import { SelfEvolveTool } from './self-evolve.js';
import { BrowserTool } from './browser.js';
import { MemorySearchTool } from './memory-search.js';
import { CreateToolTool } from './create-tool.js';
import { DatabaseTool } from './database.js';
import { McpManageTool } from './mcp-manage.js';

// ============ 蓝图工具 imports (lazy) ============
import { BlueprintTool } from './blueprint.js';
import { GenerateBlueprintTool } from './generate-blueprint.js';
import { StartLeadAgentTool } from './start-lead-agent.js';
import { UpdateTaskPlanTool } from './update-task-plan.js';
import { DispatchWorkerTool } from './dispatch-worker.js';
import { GenerateImageTool } from './generate-design.js';

// ============ 幂等保护标志 ============
let coreToolsRegistered = false;
let blueprintToolsRegistered = false;

/**
 * 注册核心工具 - 对齐官方 Axon v2.1.34
 * CLI 和 Web 模式都会加载，模块导入时自动调用
 */
export function registerCoreTools(): void {
  if (coreToolsRegistered) return;
  coreToolsRegistered = true;

  // 启动时清理僵尸任务文件（空 log、status=running 的 orphan meta）
  try {
    const { cleaned, errors } = cleanupStaleTasks();
    if (cleaned > 0) {
      console.log(`[Tools] Cleaned up ${cleaned} stale task files${errors > 0 ? ` (${errors} errors)` : ''}`);
    }
  } catch {
    // 清理失败不影响启动
  }

  // 1. Bash 工具 (2个) - Bash + KillShell(对标官方 TaskStop)
  toolRegistry.register(new BashTool());
  toolRegistry.register(new KillShellTool());

  // 2. 文件工具 (3个)
  toolRegistry.register(new ReadTool());
  toolRegistry.register(new WriteTool());
  toolRegistry.register(new EditTool());

  // 3. 搜索工具 (2个)
  toolRegistry.register(new GlobTool());
  toolRegistry.register(new GrepTool());

  // 4. Web 工具 (1个客户端 + Server Tool)
  // WebFetch: 客户端工具，用于获取网页内容
  toolRegistry.register(new WebFetchTool());
  // WebSearch: 使用 Anthropic API Server Tool (web_search_20250305)
  // 在 client.ts 的 buildApiTools 中自动添加，无需注册客户端工具

  // 5. 任务管理 (3个)
  toolRegistry.register(new TodoWriteTool());
  toolRegistry.register(new TaskTool());
  toolRegistry.register(new TaskOutputTool());

  // Task v2 系统 (条件注册，需 AXON_ENABLE_TASKS=true)
  if (isTasksEnabled()) {
    toolRegistry.register(new TaskCreateTool());
    toolRegistry.register(new TaskGetTool());
    toolRegistry.register(new TaskUpdateTool());
    toolRegistry.register(new TaskListTool());
  }

  // 6. Notebook 编辑 (1个)
  toolRegistry.register(new NotebookEditTool());

  // 7. 计划模式 (2个)
  toolRegistry.register(new EnterPlanModeTool());
  toolRegistry.register(new ExitPlanModeTool());

  // 8. 用户交互 (1个)
  toolRegistry.register(new AskUserQuestionTool());

  // 9. Skill 系统 (1个)
  toolRegistry.register(new SkillTool());

  // 10. MCP 工具 (3个) - MCPSearch + McpResource + McpManage
  toolRegistry.register(new MCPSearchTool());
  toolRegistry.register(new McpResourceTool());
  toolRegistry.register(new McpManageTool());

  // 12. 项目扩展工具 (非官方，但 CLI 模式也用)
  toolRegistry.register(new NotebookWriteTool());

  // 13. Daemon 定时任务工具
  toolRegistry.register(new ScheduleTaskTool());

  // 14. Self-Evolve 自我进化工具（需要 AXON_EVOLVE_ENABLED=1）
  toolRegistry.register(new SelfEvolveTool());

  // 15. Browser 浏览器控制工具
  toolRegistry.register(new BrowserTool());

  // 16. MemorySearch 长期记忆搜索工具
  toolRegistry.register(new MemorySearchTool());

  // 17. CreateTool 自定义 Skill 创建（写入 ~/.axon/skills/，利用 Skill 系统）
  toolRegistry.register(new CreateToolTool());

  // 20. Database 开发工具
  toolRegistry.register(new DatabaseTool());
}

/**
 * 注册蓝图工具 - Blueprint 多 Agent 系统专用
 * 仅在 Web 模式下由 ConversationManager.initialize() 调用
 *
 * 各 Agent 类型使用的蓝图工具：
 * - Chat Tab Agent: BlueprintTool, GenerateBlueprintTool, StartLeadAgentTool, GenerateImageTool
 */
export function registerBlueprintTools(): void {
  if (blueprintToolsRegistered) return;
  blueprintToolsRegistered = true;

  // Chat Tab Agent 专用 (4个)
  toolRegistry.register(new BlueprintTool());
  toolRegistry.register(new GenerateBlueprintTool());
  toolRegistry.register(new StartLeadAgentTool());
  toolRegistry.register(new GenerateImageTool());

  // LeadAgent 专用 (2个) - 任务计划管理、Worker 派发
  toolRegistry.register(new UpdateTaskPlanTool());
  toolRegistry.register(new DispatchWorkerTool());
}

/**
 * 注册所有工具 - 向后兼容入口
 * 同时注册核心工具和蓝图工具
 */
export function registerAllTools(): void {
  registerCoreTools();
  registerBlueprintTools();
}

// 模块加载时自动注册核心工具
// 蓝图工具由 Web 服务器按需注册 (见 src/web/server/conversation.ts)
registerCoreTools();

export { toolRegistry };
