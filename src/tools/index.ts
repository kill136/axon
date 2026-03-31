/**
 * 工具注册表
 * 导出所有工具
 *
 * 工具分为两类：
 * 1. 核心工具 (registerCoreTools) - 对齐官方 Axon v2.1.34，CLI/Web 都加载
 * 2. 蓝图工具 (registerBlueprintTools) - Web 模式按需加载（GenerateBlueprint + LeadAgent 等）
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
export * from './custom-tool-loader.js';
export * from './eye.js';
export * from './ear.js';
export * from './goal.js';
export * from './network-agent.js';

// 蓝图工具不通过此处 re-export
// 蓝图模块直接 import 各自需要的工具文件 (如 ../tools/dispatch-worker.js)

import { toolRegistry, PluginToolWrapper } from './base.js';

// ============ 核心工具 imports ============
import { BashTool, cleanupStaleTasks } from './bash.js';
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
import { loadCustomTools } from './custom-tool-loader.js';
import { DatabaseTool } from './database.js';
import { EyeTool } from './eye.js';
import { EarTool } from './ear.js';
// McpManageTool removed: merged into MCPSearchTool (Mcp) via action parameter
import { GoalManageTool } from './goal.js';
import { NetworkTool } from './network-agent.js';

// ============ 蓝图工具 imports (lazy) ============
import { GenerateBlueprintTool } from './generate-blueprint.js';
import { StartLeadAgentTool } from './start-lead-agent.js';
import { UpdateTaskPlanTool } from './update-task-plan.js';
import { DispatchWorkerTool } from './dispatch-worker.js';
import { ImageGenTool } from './generate-design.js';
import { TriggerE2ETestTool } from './trigger-e2e-test.js';

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

  // 1. Bash 工具 (1个) - KillShell(TaskStop) 已合并到 TaskOutput action=stop
  toolRegistry.register(new BashTool());

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

  // Task v2 系统 — 仅在 Agent Teams 场景注册
  // 普通对话用 TodoWrite 足矣；Task v2 的 owner/blocks/blockedBy 是多 agent 协作专用
  if (isTasksEnabled() && process.env.AXON_EXPERIMENTAL_AGENT_TEAMS === '1') {
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

  // 10. MCP 工具 (2个) - MCPSearch (含 server management) + McpResource
  toolRegistry.register(new MCPSearchTool());
  toolRegistry.register(new McpResourceTool());

  // 11. NotebookWrite
  // 用户画像/偏好/显式“记住这件事”必须能落盘，否则 profile notebook 只是摆设。
  toolRegistry.register(new NotebookWriteTool());

  // 12. Daemon 定时任务工具
  toolRegistry.register(new ScheduleTaskTool());

  // 13. Self-Evolve 自我进化工具（需要 AXON_EVOLVE_ENABLED=1）
  toolRegistry.register(new SelfEvolveTool());

  // 14. Browser 浏览器控制工具
  toolRegistry.register(new BrowserTool());

  // 16. MemorySearch 长期记忆搜索工具
  toolRegistry.register(new MemorySearchTool());

  // 17. CreateTool 自定义 Skill 创建（写入 ~/.axon/skills/，利用 Skill 系统）
  toolRegistry.register(new CreateToolTool());

  // 20. Database 开发工具
  toolRegistry.register(new DatabaseTool());

  // 21. Eye 视觉工具（感知 daemon）
  toolRegistry.register(new EyeTool());

  // 22. Ear 听觉工具（浏览器 Web Speech API → 内存缓冲区）
  toolRegistry.register(new EarTool());

  // 23. GoalManage 持久目标管理工具
  toolRegistry.register(new GoalManageTool());

  // 24. AgentNetwork Agent 间通信协作工具
  toolRegistry.register(new NetworkTool());

  // 25. 加载外挂自定义工具 (~/.axon/custom-tools/*.js)
  loadCustomTools().catch(err => {
    console.warn('[Tools] Failed to load custom tools:', err);
  });
}

/**
 * 注册蓝图工具 - Blueprint 多 Agent 系统专用
 * 仅在 Web 模式下由 ConversationManager.initialize() 调用
 *
 * 各 Agent 类型使用的蓝图工具：
 * - Chat Tab Agent: GenerateBlueprintTool, StartLeadAgentTool, ImageGenTool
 */
export function registerBlueprintTools(): void {
  if (blueprintToolsRegistered) return;
  blueprintToolsRegistered = true;

  // Chat Tab Agent 专用 (3个)
  toolRegistry.register(new GenerateBlueprintTool());
  toolRegistry.register(new StartLeadAgentTool());
  toolRegistry.register(new ImageGenTool());

  // LeadAgent 专用 (3个) - 任务计划管理、Worker 派发、E2E 测试触发
  toolRegistry.register(new UpdateTaskPlanTool());
  toolRegistry.register(new DispatchWorkerTool());
  toolRegistry.register(new TriggerE2ETestTool());
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

// ============ 插件工具同步到 toolRegistry ============
// 监听 PluginManager 的工具注册/注销事件，将插件工具桥接为 BaseTool 注册到全局 toolRegistry
// 这样 ConversationLoop 通过 toolRegistry.getDefinitions() 就能拿到插件工具定义，模型 API 可以调用

let pluginToolSyncInitialized = false;

/**
 * 初始化插件工具同步 — 将 PluginManager 中注册的工具同步到 toolRegistry
 * 
 * 需要在 PluginManager discover/load 之后调用一次。
 * 已有幂等保护，多次调用无副作用。
 */
export function initPluginToolSync(): void {
  if (pluginToolSyncInitialized) return;
  pluginToolSyncInitialized = true;

  // 延迟 import 避免循环依赖
  import('../plugins/index.js').then(({ pluginManager, pluginToolExecutor }) => {
    // 1. 同步已有的插件工具（可能在此函数调用前已经加载了）
    const existingTools = pluginManager.getTools();
    for (const toolDef of existingTools) {
      if (toolRegistry.get(toolDef.name)) {
        // 与内置工具重名，跳过避免覆盖
        console.warn(`[PluginToolSync] Plugin tool "${toolDef.name}" conflicts with built-in tool, skipped`);
        continue;
      }
      const executor = (input: unknown) => pluginToolExecutor.execute(toolDef.name, input);
      // 找到工具所属的插件名
      const pluginName = findPluginForTool(pluginManager, toolDef.name);
      const wrapper = new PluginToolWrapper(toolDef, executor, pluginName);
      toolRegistry.register(wrapper);
      console.log(`[PluginToolSync] Registered plugin tool: ${toolDef.name} (from ${pluginName})`);
    }

    // 2. 监听后续的工具注册事件
    pluginManager.on('tool:registered', (pluginName: string, toolDef: import('../types/index.js').ToolDefinition) => {
      if (toolRegistry.get(toolDef.name)) {
        console.warn(`[PluginToolSync] Plugin tool "${toolDef.name}" conflicts with existing tool, skipped`);
        return;
      }
      const executor = (input: unknown) => pluginToolExecutor.execute(toolDef.name, input);
      const wrapper = new PluginToolWrapper(toolDef, executor, pluginName);
      toolRegistry.register(wrapper);
      console.log(`[PluginToolSync] Registered plugin tool: ${toolDef.name} (from ${pluginName})`);
    });

    // 3. 监听工具注销事件
    pluginManager.on('tool:unregistered', (_pluginName: string, toolName: string) => {
      const existing = toolRegistry.get(toolName);
      // 只删除插件工具，不误删内置工具
      if (existing instanceof PluginToolWrapper) {
        toolRegistry.unregister(toolName);
        console.log(`[PluginToolSync] Unregistered plugin tool: ${toolName}`);
      }
    });
  }).catch(err => {
    console.warn('[PluginToolSync] Failed to initialize plugin tool sync:', err);
  });
}

/** 根据工具名反查所属插件名 */
function findPluginForTool(pluginManager: any, toolName: string): string {
  const states = pluginManager.getPluginStates();
  for (const state of states) {
    const tools = pluginManager.getPluginTools(state.metadata.name);
    if (tools.some((t: any) => t.name === toolName)) {
      return state.metadata.name;
    }
  }
  return 'unknown-plugin';
}

export { toolRegistry };
