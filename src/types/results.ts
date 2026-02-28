/**
 * Tool Output Type Definitions
 * Complete type definitions for all Axon tool results
 *
 * This file provides TypeScript type definitions for the output/result
 * types of all tools in the Axon CLI toolkit.
 */

// ============================================================================
// Base Result Types
// ============================================================================

/**
 * Base tool result interface
 * All tool results extend from this base type
 */
export interface ToolResult {
  /** Whether the tool execution was successful */
  success: boolean;
  /** Output message or data from the tool */
  output?: string;
  /** Error message if the tool execution failed */
  error?: string;
  /** Error code for tool failures (tool-specific error codes) */
  errorCode?: number;
  /** Additional structured data from the tool */
  data?: any;
  /**
   * Optional additional messages to send to the model
   * Used for sending media content (images, PDFs, etc.) that should be visible to Claude
   * Each message contains content blocks (text, image, document, etc.)
   */
  newMessages?: Array<{
    role: 'user';
    content: Array<{
      type: 'text' | 'image' | 'document';
      text?: string;
      source?: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';
        data: string;
      };
    }>;
    /** 标记此消息为元消息，不算作用户实际输入（对齐官方 isMeta） */
    isMeta?: boolean;
  }>;
  /**
   * 工具返回的图片，会作为 ImageBlockParam 嵌入 tool_result content
   * 用于 Browser screenshot 等需要返回图片的工具，避免 base64 作为文本计入 token
   */
  images?: Array<{
    type: 'image';
    source: {
      type: 'base64';
      media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      data: string;
    };
  }>;
  /** Skill 命令名称（由 Skill 工具设置） */
  commandName?: string;
  /** Skill 声明的允许工具列表 */
  allowedTools?: string[];
  /** Skill 声明的模型覆盖 */
  model?: string;
}

/**
 * Successful tool execution result
 * Used when a tool completes successfully
 */
export interface ToolSuccess extends ToolResult {
  success: true;
  output: string;
  error?: never;
}

/**
 * Failed tool execution result
 * Used when a tool encounters an error
 */
export interface ToolError extends ToolResult {
  success: false;
  output?: never;
  error: string;
}

/**
 * Generic tool output container
 * Can represent either success or failure
 */
export type ToolOutput = ToolSuccess | ToolError;

// ============================================================================
// Bash Tool Results
// ============================================================================

/**
 * Bash command execution result
 * Returned by the Bash tool after executing shell commands
 */
export interface BashToolResult extends ToolResult {
  /** Exit code of the command (0 = success) */
  exitCode?: number;
  /** Standard output from the command */
  stdout?: string;
  /** Standard error output from the command */
  stderr?: string;
  /** Task ID (official field name, UUID format) */
  task_id?: string;
  /** ID of the background shell (official field name, alias for task_id) */
  shell_id?: string;
  /** ID of the background shell (legacy field, backward compatibility) */
  bash_id?: string;
  /** Command execution duration in milliseconds */
  duration?: number;
  /** Whether the command was sandboxed */
  sandboxed?: boolean;
  /** Working directory where command was executed */
  cwd?: string;
  /** Whether the command was blocked due to security reasons */
  blocked?: boolean;
  /** v2.1.23: Elapsed time in seconds for display */
  elapsedTimeSeconds?: number;
  /** v2.1.23: Timeout in milliseconds for display */
  timeoutMs?: number;
  /** Background task ID when command was automatically moved to background after timeout */
  backgroundTaskId?: string;
  /** True if the user manually backgrounded the command (e.g. Ctrl+B) */
  backgroundedByUser?: boolean;
}

/**
 * Bash output retrieval result
 * Returned by BashOutput tool when retrieving output from background shells
 */
export interface BashOutputResult extends BashToolResult {
  /** Whether the background task is still running */
  running?: boolean;
  /** Status of the background shell */
  status?: 'running' | 'completed' | 'failed';
  /** Timestamp when the shell started */
  startTime?: number;
  /** Total output size in bytes */
  outputSize?: number;
}

/**
 * Kill shell result
 * Returned by KillShell tool when terminating background shells
 */
export interface KillShellResult extends ToolResult {
  /** ID of the killed shell */
  shell_id?: string;
  /** Signal used to terminate the process */
  signal?: string;
}

// ============================================================================
// File Operation Results
// ============================================================================

/**
 * File read result
 * Returned by the Read tool after reading file contents
 */
export interface ReadToolResult extends ToolResult {
  /** File content (for text files) */
  content?: string;
  /** Total number of lines in the file */
  lineCount?: number;
  /** File size in bytes */
  fileSize?: number;
  /** File type/extension */
  fileType?: string;
  /** Whether the file was truncated due to size limits */
  truncated?: boolean;
  /** Line offset where reading started */
  offset?: number;
  /** Number of lines read */
  limit?: number;
}

/**
 * File write result
 * Returned by the Write tool after writing to a file
 */
export interface WriteToolResult extends ToolResult {
  /** Path to the file that was written */
  filePath?: string;
  /** Number of bytes written */
  bytesWritten?: number;
  /** Whether the file was created (vs overwritten) */
  created?: boolean;
  /** Previous file size (if file existed) */
  previousSize?: number;
}

/**
 * File edit result
 * Returned by the Edit tool after modifying file contents
 */
export interface EditToolResult extends ToolResult {
  /** Path to the file that was edited */
  filePath?: string;
  /** Number of replacements made */
  replacements?: number;
  /** Lines that were modified */
  modifiedLines?: number[];
  /** Diff preview of the changes */
  diff?: string;
  /** Number of additions */
  additions?: number;
  /** Number of deletions */
  deletions?: number;
  /** Whether replace_all was used */
  replaceAll?: boolean;
  /** File content after edit */
  content?: string;
  /** Error code for edit failures (matches official CLI error codes: 8=STRING_NOT_FOUND, 9=MULTIPLE_MATCHES, 10=FILE_NOT_READ, 11=INVALID_PATH) */
  errorCode?: number;
}

// ============================================================================
// Search Tool Results
// ============================================================================

/**
 * Glob pattern matching result
 * Returned by the Glob tool after finding files by pattern
 */
export interface GlobToolResult extends ToolResult {
  /** List of matching file paths */
  files?: string[];
  /** Number of files found */
  count?: number;
  /** Pattern that was searched */
  pattern?: string;
  /** Directory that was searched */
  searchPath?: string;
}

/**
 * Grep search result
 * Returned by the Grep tool after searching file contents
 */
export interface GrepToolResult extends ToolResult {
  /** List of matches (structure depends on output_mode) */
  matches?: Array<{
    /** File path */
    file: string;
    /** Line number (if available) */
    line?: number;
    /** Matching line content (if output_mode is 'content') */
    content?: string;
    /** Match count (if output_mode is 'count') */
    count?: number;
  }>;
  /** Total number of matches */
  totalMatches?: number;
  /** Number of files with matches */
  filesWithMatches?: number;
  /** Output mode used */
  outputMode?: 'content' | 'files_with_matches' | 'count';
  /** Pattern that was searched */
  pattern?: string;
}

// ============================================================================
// Web Tool Results
// ============================================================================

/**
 * Web fetch result
 * Returned by the WebFetch tool after fetching and analyzing web content
 */
export interface WebFetchToolResult extends ToolResult {
  /** URL that was fetched */
  url?: string;
  /** Analyzed content from the AI model */
  analysis?: string;
  /** HTTP status code */
  statusCode?: number;
  /** Content type of the response */
  contentType?: string;
  /** Whether the URL redirected */
  redirected?: boolean;
  /** Final URL after redirects */
  finalUrl?: string;
}

/**
 * Web search result
 * Returned by the WebSearch tool after searching the web
 */
export interface WebSearchToolResult extends ToolResult {
  /** Search query that was used */
  query?: string;
  /** List of search results */
  results?: Array<{
    /** Page title */
    title: string;
    /** URL of the result */
    url: string;
    /** Snippet/description */
    snippet: string;
    /** Domain name */
    domain?: string;
  }>;
  /** Number of results returned */
  resultCount?: number;
  /** Domains that were allowed */
  allowedDomains?: string[];
  /** Domains that were blocked */
  blockedDomains?: string[];
}

// ============================================================================
// Task/Agent Results
// ============================================================================

/**
 * Agent execution result
 * Returned by the Agent (Task) tool after running a sub-agent
 */
export interface AgentToolResult extends ToolResult {
  /** Agent/task ID */
  agentId?: string;
  /** Task ID (alias for agentId) */
  task_id?: string;
  /** Agent type used */
  agentType?: string;
  /** Whether the agent is running in background */
  background?: boolean;
  /** Agent execution status */
  status?: 'running' | 'completed' | 'failed' | 'paused';
  /** Final result from the agent */
  result?: string;
  /** Model used by the agent */
  model?: string;
  /** Execution start time */
  startTime?: number;
  /** Execution end time */
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
}

/**
 * Task output retrieval result
 * Returned by TaskOutput tool when checking on background agents
 */
export interface TaskOutputToolResult extends ToolResult {
  /** Task ID */
  task_id: string;
  /** Current status */
  status: 'running' | 'completed' | 'failed' | 'paused';
  /** Whether the task has completed */
  completed?: boolean;
  /** Task result (if completed) */
  result?: string;
  /** Current progress information */
  progress?: string;
  /** Execution history entries */
  history?: Array<{
    timestamp: string;
    type: string;
    message: string;
  }>;
  /** Intermediate results */
  intermediateResults?: any[];
  /** Current step number */
  currentStep?: number;
  /** Total number of steps */
  totalSteps?: number;
}

/**
 * List agents result
 * Returned by ListAgents tool when listing all agents
 */
export interface ListAgentsToolResult extends ToolResult {
  /** List of agents */
  agents?: Array<{
    id: string;
    agentType: string;
    description: string;
    status: string;
    startTime: string;
    endTime?: string;
  }>;
  /** Number of agents */
  count?: number;
  /** Filter applied */
  statusFilter?: string;
}

// ============================================================================
// Todo Management Results
// ============================================================================

/**
 * Todo write result
 * Returned by the TodoWrite tool after updating the todo list
 */
export interface TodoWriteToolResult extends ToolResult {
  /** Updated todo list */
  todos?: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  /** Number of todos */
  totalTodos?: number;
  /** Number of pending todos */
  pendingCount?: number;
  /** Number of in-progress todos */
  inProgressCount?: number;
  /** Number of completed todos */
  completedCount?: number;
}

// ============================================================================
// Notebook Results
// ============================================================================

/**
 * Notebook edit result
 * Returned by the NotebookEdit tool after editing Jupyter notebooks
 */
export interface NotebookEditToolResult extends ToolResult {
  /** Path to the notebook file */
  notebookPath?: string;
  /** ID of the cell that was edited */
  cellId?: string;
  /** Type of cell */
  cellType?: 'code' | 'markdown';
  /** Edit mode used */
  editMode?: 'replace' | 'insert' | 'delete';
  /** Index of the edited cell */
  cellIndex?: number;
  /** Total number of cells in the notebook */
  totalCells?: number;
}

// ============================================================================
// MCP (Model Context Protocol) Results
// ============================================================================

/**
 * MCP resource list result
 * Returned by ListMcpResources tool
 */
export interface ListMcpResourcesToolResult extends ToolResult {
  /** List of available resources */
  resources?: Array<{
    /** Resource URI */
    uri: string;
    /** Resource name */
    name: string;
    /** Resource description */
    description?: string;
    /** MIME type */
    mimeType?: string;
    /** Server that provides this resource */
    server: string;
  }>;
  /** Number of resources */
  count?: number;
  /** Server filter applied */
  server?: string;
}

/**
 * MCP resource read result
 * Returned by ReadMcpResource tool
 */
export interface ReadMcpResourceToolResult extends ToolResult {
  /** Resource URI */
  uri?: string;
  /** Server name */
  server?: string;
  /** Resource content */
  content?: string;
  /** MIME type of the content */
  mimeType?: string;
  /** Resource metadata */
  metadata?: Record<string, any>;
}

/**
 * MCP tool execution result
 * Returned by MCP tool when calling MCP server tools
 */
export interface McpToolResult extends ToolResult {
  /** MCP server name */
  server?: string;
  /** Tool name that was called */
  toolName?: string;
  /** Tool result data */
  toolResult?: any;
  /** Content blocks from tool execution */
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
}

/**
 * MCP Search result
 * Returned by MCPSearch tool when searching for MCP tools
 */
export interface MCPSearchToolResult extends ToolResult {
  /** Matched tool names */
  matches?: string[];
  /** Original search query */
  query?: string;
  /** Total number of MCP tools available */
  total_mcp_tools?: number;
}

// ============================================================================
// User Interaction Results
// ============================================================================

/**
 * Ask user question result
 * Returned by AskUserQuestion tool after prompting the user
 */
export interface AskUserQuestionToolResult extends ToolResult {
  /** User's answers to the questions */
  answers?: Record<string, string | string[]>;
  /** Questions that were asked */
  questions?: Array<{
    question: string;
    header: string;
    answer: string | string[];
  }>;
  /** Number of questions asked */
  questionCount?: number;
}

// ============================================================================
// Skill Results
// ============================================================================

/**
 * Skill execution result
 * Returned by Skill tool after executing a skill
 */
export interface SkillToolResult extends ToolResult {
  /** Skill name that was executed */
  skillName?: string;
  /** Skill type (local or user) */
  skillType?: 'local' | 'user';
  /** Arguments passed to the skill */
  args?: string;
  /** Skill execution output */
  skillOutput?: string;
  /** Exit code from skill execution */
  exitCode?: number;
}

// ============================================================================
// Plan Mode Results
// ============================================================================

/**
 * Enter plan mode result
 * Returned when entering plan mode
 */
export interface EnterPlanModeToolResult extends ToolResult {
  /** Whether plan mode was activated */
  planModeActive?: boolean;
  /** Plan mode instructions */
  instructions?: string;
}

/**
 * Exit plan mode result
 * Returned when exiting plan mode
 */
export interface ExitPlanModeToolResult extends ToolResult {
  /** Whether plan mode was deactivated */
  planModeActive?: boolean;
  /** Summary of actions taken in plan mode */
  summary?: string;
}

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/**
 * @deprecated Use BashToolResult instead
 */
export type BashResult = BashToolResult;

/**
 * @deprecated Use ReadToolResult, WriteToolResult, or EditToolResult instead
 */
export type FileResult = ReadToolResult;

/**
 * @deprecated Use GrepToolResult instead
 */
export type GrepResult = GrepToolResult;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Union type of all tool result types
 * Useful for generic tool handling
 */
export type AnyToolResult =
  | ToolResult
  | BashToolResult
  | BashOutputResult
  | KillShellResult
  | ReadToolResult
  | WriteToolResult
  | EditToolResult
  | GlobToolResult
  | GrepToolResult
  | WebFetchToolResult
  | WebSearchToolResult
  | AgentToolResult
  | TaskOutputToolResult
  | ListAgentsToolResult
  | TodoWriteToolResult
  | NotebookEditToolResult
  | ListMcpResourcesToolResult
  | ReadMcpResourceToolResult
  | McpToolResult
  | MCPSearchToolResult
  | AskUserQuestionToolResult
  | SkillToolResult
  | EnterPlanModeToolResult
  | ExitPlanModeToolResult;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if result is successful
 */
export function isToolSuccess(result: ToolResult): result is ToolSuccess {
  return result.success === true && result.output !== undefined;
}

/**
 * Type guard to check if result is an error
 */
export function isToolError(result: ToolResult): result is ToolError {
  return result.success === false && result.error !== undefined;
}

/**
 * Type guard to check if result is a Bash result
 */
export function isBashResult(result: ToolResult): result is BashToolResult {
  // exitCode 是 Bash 独有的，stdout+stderr 组合也是
  return 'exitCode' in result || ('stdout' in result && 'stderr' in result);
}

/**
 * Type guard to check if result is a File result
 */
export function isFileResult(result: ToolResult): result is ReadToolResult | WriteToolResult | EditToolResult {
  // bytesWritten 是 Write 独有的，lineCount 是 Read 独有的，diff 是 Edit 独有的
  return 'bytesWritten' in result || 'lineCount' in result || 'diff' in result;
}

/**
 * Type guard to check if result is a Grep result
 */
export function isGrepResult(result: ToolResult): result is GrepToolResult {
  // totalMatches 是 Grep 独有的
  return 'totalMatches' in result;
}

/**
 * Type guard to check if result is an Agent/Task result
 */
export function isAgentResult(result: ToolResult): result is AgentToolResult | TaskOutputToolResult {
  // agentId + agentType 组合是 Agent 独有的
  return ('agentId' in result || 'task_id' in result) && 'agentType' in result;
}

/**
 * Type guard to check if result is a Web result
 */
export function isWebResult(result: ToolResult): result is WebFetchToolResult | WebSearchToolResult {
  // url + (analysis | statusCode) 是 WebFetch 独有的，query + results 是 WebSearch 独有的
  return ('url' in result && ('analysis' in result || 'statusCode' in result)) ||
         ('query' in result && 'results' in result);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper function to create a successful tool result
 */
export function createToolSuccess(output: string, additionalProps?: Partial<ToolResult>): ToolSuccess {
  return {
    success: true as const,
    output,
    ...additionalProps,
  } as ToolSuccess;
}

/**
 * Helper function to create a failed tool result
 */
export function createToolError(error: string, additionalProps?: Partial<ToolResult>): ToolError {
  return {
    success: false as const,
    error,
    ...additionalProps,
  } as ToolError;
}

/**
 * Helper function to format tool result for display
 */
export function formatToolResult(result: ToolResult): string {
  if (result.success) {
    return result.output || 'Success (no output)';
  } else {
    return `Error: ${result.error || 'Unknown error'}`;
  }
}

/**
 * Helper function to extract error message from result
 */
export function getErrorMessage(result: ToolResult): string | undefined {
  return result.error;
}

/**
 * Helper function to extract output from result
 */
export function getOutput(result: ToolResult): string | undefined {
  return result.output;
}

/**
 * Helper function to check if result has specific property
 */
export function hasProperty<K extends string>(
  result: ToolResult,
  property: K
): result is ToolResult & Record<K, any> {
  return property in result;
}
