/**
 * Axon Tool Input Type Definitions
 * Based on official SDK types from docs/official-sdk-tools.d.ts
 *
 * This file contains TypeScript type definitions for all tool inputs
 * used in the Axon CLI application.
 */

// ============================================================================
// Agent Tool
// ============================================================================

/**
 * Input parameters for the Agent tool
 *
 * The Agent tool allows spawning specialized sub-agents to perform specific tasks
 * in parallel or with different models/capabilities.
 */
export interface AgentInput {
  /**
   * A short (3-5 word) description of the task
   * @example "Search codebase for bugs"
   */
  description: string;

  /**
   * The task for the agent to perform
   * @example "Find all TODO comments in the src/ directory and create a summary"
   */
  prompt: string;

  /**
   * The type of specialized agent to use for this task
   * @example "code-search", "file-analyzer", "test-generator"
   */
  subagent_type: string;

  /**
   * Optional model to use for this agent. If not specified, inherits from parent.
   * Prefer haiku for quick, straightforward tasks to minimize cost and latency.
   */
  model?: "sonnet" | "opus" | "haiku";

  /**
   * Optional agent ID to resume from. If provided, the agent will continue from
   * the previous execution transcript.
   */
  resume?: string;

  /**
   * Set to true to run this agent in the background. Use TaskOutput to read
   * the output later.
   */
  run_in_background?: boolean;

  /**
   * Maximum number of agentic turns (API round-trips) before stopping.
   */
  max_turns?: number;

  /**
   * v2.1.32: Agent name (for Agent Teams)
   * Names the spawned agent for identification within a team.
   */
  name?: string;

  /**
   * v2.1.32: Team name (for Agent Teams)
   * Uses current team context if omitted.
   * Requires AXON_EXPERIMENTAL_AGENT_TEAMS=1
   */
  team_name?: string;

  /**
   * v2.1.32: Permission mode for the agent (for Agent Teams)
   */
  mode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'delegate' | 'dontAsk' | 'plan';
}

// ============================================================================
// Bash Tool
// ============================================================================

/**
 * Input parameters for the Bash tool
 *
 * Executes shell commands in a sandboxed environment with timeout support.
 */
export interface BashInput {
  /**
   * The command to execute
   * @example "git status"
   * @example "npm install"
   */
  command: string;

  /**
   * Optional timeout in milliseconds (max 600000)
   * @default 120000
   */
  timeout?: number;

  /**
   * Clear, concise description of what this command does in 5-10 words, in active voice.
   *
   * Examples:
   * - Input: ls → Output: List files in current directory
   * - Input: git status → Output: Show working tree status
   * - Input: npm install → Output: Install package dependencies
   * - Input: mkdir foo → Output: Create directory 'foo'
   */
  description?: string;

  /**
   * Set to true to run this command in the background. Use TaskOutput to read
   * the output later.
   */
  run_in_background?: boolean;

  /**
   * Set this to true to dangerously override sandbox mode and run commands
   * without sandboxing.
   */
  dangerouslyDisableSandbox?: boolean;

  /**
   * Set to true to echo output to terminal in real-time.
   * Only applies when run_in_background is true.
   * Output will be streamed to stdout/stderr as the command runs.
   */
  echoOutput?: boolean;

  /**
   * Internal: tool_use ID injected by the loop for streaming output correlation.
   * Not part of the public API schema.
   */
  _toolUseId?: string;
}

/**
 * Input parameters for getting bash output from a background task
 */
export interface BashOutputInput {
  /**
   * The bash task ID to get output from
   */
  bash_id: string;

  /**
   * Optional filter to apply to the output
   */
  filter?: string;
}

/**
 * Input parameters for the TaskOutput tool
 *
 * Retrieves output from background tasks (bash commands or agents).
 */
export interface TaskOutputInput {
  /**
   * The task ID to get output from
   */
  task_id: string;

  /**
   * Whether to wait for completion
   * @default false
   */
  block?: boolean;

  /**
   * Max wait time in ms
   */
  timeout?: number;
}

/**
 * Input parameters for killing a background shell
 */
export interface KillShellInput {
  /**
   * The ID of the background shell to kill
   */
  shell_id: string;
}

// ============================================================================
// File Tools
// ============================================================================

/**
 * Input parameters for the Read tool
 *
 * Reads file contents with optional offset and limit for large files.
 */
export interface FileReadInput {
  /**
   * The absolute path to the file to read
   * @example "/home/user/project/src/index.ts"
   */
  file_path: string;

  /**
   * The line number to start reading from. Only provide if the file is too
   * large to read at once
   */
  offset?: number;

  /**
   * The number of lines to read. Only provide if the file is too large to
   * read at once.
   */
  limit?: number;

  /**
   * Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files.
   * Maximum 20 pages per request.
   */
  pages?: string;
}

/**
 * Input parameters for the Write tool
 *
 * Writes content to a file, overwriting existing content.
 */
export interface FileWriteInput {
  /**
   * The absolute path to the file to write (must be absolute, not relative)
   * @example "/home/user/project/src/index.ts"
   */
  file_path: string;

  /**
   * The content to write to the file
   */
  content: string;
}

/**
 * Input parameters for the Edit tool
 *
 * Performs exact string replacements in files.
 */
export interface FileEditInput {
  /**
   * The absolute path to the file to modify
   * @example "/home/user/project/src/index.ts"
   */
  file_path: string;

  /**
   * The text to replace
   */
  old_string: string;

  /**
   * The text to replace it with (must be different from old_string)
   */
  new_string: string;

  /**
   * Replace all occurences of old_string (default false)
   * @default false
   */
  replace_all?: boolean;
}

// ============================================================================
// Search Tools
// ============================================================================

/**
 * Input parameters for the Glob tool
 *
 * Fast file pattern matching using glob patterns.
 */
export interface GlobInput {
  /**
   * The glob pattern to match files against
   * @example "**\/*.ts"
   * @example "src/**\/*.{js,jsx}"
   */
  pattern: string;

  /**
   * The directory to search in. If not specified, the current working directory
   * will be used. IMPORTANT: Omit this field to use the default directory.
   * DO NOT enter "undefined" or "null" - simply omit it for the default behavior.
   * Must be a valid directory path if provided.
   */
  path?: string;
}

/**
 * Input parameters for the Grep tool
 *
 * Powerful search tool built on ripgrep with regex support.
 */
export interface GrepInput {
  /**
   * The regular expression pattern to search for in file contents
   * @example "function\\s+\\w+"
   * @example "TODO:.*"
   */
  pattern: string;

  /**
   * File or directory to search in (rg PATH). Defaults to current working directory.
   */
  path?: string;

  /**
   * Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob
   * @example "*.js"
   * @example "**\/*.{ts,tsx}"
   */
  glob?: string;

  /**
   * Output mode: "content" shows matching lines (supports -A/-B/-C context,
   * -n line numbers, head_limit), "files_with_matches" shows file paths
   * (supports head_limit), "count" shows match counts (supports head_limit).
   * Defaults to "files_with_matches".
   * @default "files_with_matches"
   */
  output_mode?: "content" | "files_with_matches" | "count";

  /**
   * Number of lines to show before each match (rg -B). Requires output_mode: "content",
   * ignored otherwise.
   */
  "-B"?: number;

  /**
   * Number of lines to show after each match (rg -A). Requires output_mode: "content",
   * ignored otherwise.
   */
  "-A"?: number;

  /**
   * Number of lines to show before and after each match (rg -C). Requires
   * output_mode: "content", ignored otherwise.
   */
  "-C"?: number;

  /**
   * Show line numbers in output (rg -n). Requires output_mode: "content",
   * ignored otherwise. Defaults to true.
   * @default true
   */
  "-n"?: boolean;

  /**
   * Case insensitive search (rg -i)
   */
  "-i"?: boolean;

  /**
   * File type to search (rg --type). Common types: js, py, rust, go, java, etc.
   * More efficient than include for standard file types.
   * @example "js"
   * @example "py"
   */
  type?: string;

  /**
   * Limit output to first N lines/entries, equivalent to "| head -N". Works
   * across all output modes: content (limits output lines), files_with_matches
   * (limits file paths), count (limits count entries). Defaults to 0 (unlimited).
   * @default 0
   */
  head_limit?: number;

  /**
   * Skip first N lines/entries before applying head_limit, equivalent to
   * "| tail -n +N | head -N". Works across all output modes. Defaults to 0.
   * @default 0
   */
  offset?: number;

  /**
   * Enable multiline mode where . matches newlines and patterns can span lines
   * (rg -U --multiline-dotall). Default: false.
   * @default false
   */
  multiline?: boolean;
}

// ============================================================================
// Web Tools
// ============================================================================

/**
 * Input parameters for the WebFetch tool
 *
 * Fetches web content and processes it with an AI prompt.
 */
export interface WebFetchInput {
  /**
   * The URL to fetch content from
   * @example "https://docs.example.com/api"
   */
  url: string;

  /**
   * The prompt to run on the fetched content
   * @example "Summarize the main API endpoints"
   */
  prompt: string;
}

// WebSearchInput 已移除 - WebSearch 现在使用 Anthropic API Server Tool (web_search_20250305)
// Server Tool 由 Anthropic 服务器执行，客户端不需要处理输入参数

// ============================================================================
// Todo Tool (v1 - Legacy)
// ============================================================================

/**
 * A single todo item (v1 - Legacy)
 */
export interface TodoItem {
  /**
   * The imperative form describing what needs to be done
   * @example "Run tests"
   * @example "Build the project"
   */
  content: string;

  /**
   * Current status of the todo item
   */
  status: "pending" | "in_progress" | "completed";

  /**
   * The present continuous form shown during execution
   * @example "Running tests"
   * @example "Building the project"
   */
  activeForm: string;
}

/**
 * Input parameters for the TodoWrite tool (v1 - Legacy)
 *
 * Manages a structured task list for tracking progress.
 */
export interface TodoWriteInput {
  /**
   * The updated todo list
   */
  todos: TodoItem[];
}

// ============================================================================
// Task v2 System (2.1.16+)
// Supports dependency tracking with blocks/blockedBy
// ============================================================================

/**
 * Task v2 status
 */
export type TaskV2Status = "pending" | "in_progress" | "completed";

/**
 * Task v2 data structure
 * New task management system with dependency tracking
 */
export interface TaskV2Item {
  /** Unique identifier */
  id: string;
  /** Brief task title */
  subject: string;
  /** Detailed description */
  description: string;
  /** Text shown in spinner when in_progress */
  activeForm?: string;
  /** Owner (for multi-agent scenarios) */
  owner?: string;
  /** Task status */
  status: TaskV2Status;
  /** IDs of tasks this task blocks */
  blocks: string[];
  /** IDs of tasks blocking this task */
  blockedBy: string[];
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Input for TaskCreate tool
 */
export interface TaskCreateInput {
  /** Brief task title */
  subject: string;
  /** Detailed description */
  description: string;
  /** Text shown in spinner when in_progress */
  activeForm?: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Input for TaskGet tool
 */
export interface TaskGetInput {
  /** Task ID to retrieve */
  taskId: string;
}

/**
 * Input for TaskUpdate tool
 */
export interface TaskUpdateInput {
  /** Task ID to update */
  taskId: string;
  /** New title */
  subject?: string;
  /** New description */
  description?: string;
  /** New spinner text */
  activeForm?: string;
  /** New status */
  status?: TaskV2Status;
  /** Task IDs that this task blocks */
  addBlocks?: string[];
  /** Task IDs that block this task */
  addBlockedBy?: string[];
  /** New owner */
  owner?: string;
  /** Metadata to merge (set key to null to delete) */
  metadata?: Record<string, unknown>;
}

/**
 * Input for TaskList tool (no parameters)
 */
export interface TaskListInput {
  // No parameters required
}

// ============================================================================
// Notebook Tool
// ============================================================================

/**
 * Input parameters for the NotebookEdit tool
 *
 * Edits Jupyter notebook cells with support for insert, replace, and delete operations.
 */
export interface NotebookEditInput {
  /**
   * The absolute path to the Jupyter notebook file to edit (must be absolute,
   * not relative)
   * @example "/home/user/project/analysis.ipynb"
   */
  notebook_path: string;

  /**
   * The ID of the cell to edit. When inserting a new cell, the new cell will
   * be inserted after the cell with this ID, or at the beginning if not specified.
   */
  cell_id?: string;

  /**
   * The new source for the cell
   */
  new_source: string;

  /**
   * The type of the cell (code or markdown). If not specified, it defaults to
   * the current cell type. If using edit_mode=insert, this is required.
   */
  cell_type?: "code" | "markdown";

  /**
   * The type of edit to make (replace, insert, delete). Defaults to replace.
   * @default "replace"
   */
  edit_mode?: "replace" | "insert" | "delete";
}

// ============================================================================
// MCP (Model Context Protocol) Tools
// ============================================================================

/**
 * Input parameters for MCP tool calls
 *
 * Generic interface for MCP server tool invocations.
 */
export interface McpInput {
  [k: string]: unknown;
}

/**
 * Input parameters for listing MCP resources
 */
export interface ListMcpResourcesInput {
  /**
   * Optional server name to filter resources by
   */
  server?: string;

  /**
   * Whether to refresh the resource list from the server
   */
  refresh?: boolean;
}

/**
 * Input parameters for reading MCP resources
 */
export interface ReadMcpResourceInput {
  /**
   * The MCP server name
   */
  server: string;

  /**
   * The resource URI to read
   * @example "file://path/to/resource"
   * @example "git://repo/commit/abc123"
   */
  uri: string;
}

/**
 * Input parameters for McpResource tool (merged List + Read)
 */
export interface McpResourceInput {
  /**
   * Action to perform: 'list' or 'read'
   */
  action: 'list' | 'read';

  /**
   * The MCP server name (optional for list, required for read)
   */
  server?: string;

  /**
   * The resource URI to read (required for action='read')
   */
  uri?: string;

  /**
   * Whether to refresh the resource list from the server (for action='list')
   */
  refresh?: boolean;
}

/**
 * Input parameters for searching MCP tools
 */
export interface MCPSearchInput {
  /**
   * Search query for MCP tools
   * - Keywords: "filesystem" or "list directory" - fuzzy search
   * - Direct selection: "select:mcp__filesystem__list_directory" - load specific tool
   */
  query: string;

  /**
   * Maximum number of results to return (default: 5)
   */
  max_results?: number;
}

// ============================================================================
// AskUserQuestion Tool
// ============================================================================

/**
 * A single option in a question
 */
export interface AskUserQuestionOption {
  /**
   * The display text for this option that the user will see and select.
   * Should be concise (1-5 words) and clearly describe the choice.
   * @example "Express.js"
   * @example "FastAPI"
   */
  label: string;

  /**
   * Explanation of what this option means or what will happen if chosen.
   * Useful for providing context about trade-offs or implications.
   * @example "Minimalist web framework for Node.js with middleware support"
   */
  description: string;
}

/**
 * A single question with multiple choice options
 */
export interface AskUserQuestion {
  /**
   * The complete question to ask the user. Should be clear, specific, and end
   * with a question mark. Example: "Which library should we use for date formatting?"
   * If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"
   * @example "Which web framework should we use?"
   */
  question: string;

  /**
   * Very short label displayed as a chip/tag (max 12 chars).
   * Examples: "Auth method", "Library", "Approach".
   * @example "Framework"
   * @example "Auth method"
   */
  header: string;

  /**
   * The available choices for this question. Must have 2-4 options. Each option
   * should be a distinct, mutually exclusive choice (unless multiSelect is enabled).
   * There should be no 'Other' option, that will be provided automatically.
   */
  options: AskUserQuestionOption[];

  /**
   * Set to true to allow the user to select multiple options instead of just one.
   * Use when choices are not mutually exclusive.
   * @default false
   */
  multiSelect: boolean;
}

/**
 * Input parameters for the AskUserQuestion tool
 *
 * Prompts the user with 1-4 multiple choice questions.
 */
export interface AskUserQuestionInput {
  /**
   * Questions to ask the user (1-4 questions)
   */
  questions: AskUserQuestion[];

  /**
   * User answers collected by the permission component
   */
  answers?: {
    [k: string]: string;
  };
}

// ============================================================================
// Plan Mode Tool
// ============================================================================

/**
 * Input parameters for exiting plan mode
 */
export interface ExitPlanModeInput {
  [k: string]: unknown;
}

// ============================================================================
// Skill Tool
// ============================================================================

/**
 * Input parameters for the Skill tool
 *
 * Invokes custom skills/commands defined in .axon/commands/
 */
export interface SkillInput {
  /**
   * The skill name to invoke
   * @example "commit"
   * @example "review-pr"
   */
  skill: string;

  /**
   * Optional arguments to pass to the skill
   * @example "-m 'Fix bug'"
   * @example "123"
   */
  args?: string;
}

// ============================================================================
// LSP (Language Server Protocol) Tool
// ============================================================================

/**
 * Input parameters for LSP operations
 */
export interface LSPInput {
  /**
   * The LSP operation to perform
   */
  operation:
    | "goToDefinition"
    | "findReferences"
    | "hover"
    | "documentSymbol"
    | "workspaceSymbol"
    | "goToImplementation"
    | "prepareCallHierarchy"
    | "incomingCalls"
    | "outgoingCalls";

  /**
   * The absolute or relative path to the file
   */
  filePath: string;

  /**
   * The line number (1-based, as shown in editors)
   */
  line: number;

  /**
   * The character offset (1-based, as shown in editors)
   */
  character: number;

  /**
   * Query string for workspaceSymbol operation
   */
  query?: string;
}

// ============================================================================
// MultiEdit Tool
// ============================================================================

/**
 * A single file edit operation
 */
export interface FileEdit {
  /**
   * The absolute path to the file
   */
  file_path: string;

  /**
   * The text to find and replace
   */
  old_string: string;

  /**
   * The replacement text
   */
  new_string: string;

  /**
   * Replace all occurrences
   */
  replace_all?: boolean;
}

// ============================================================================
// Sandbox Tool
// ============================================================================

/**
 * Input parameters for sandbox operations
 */
export interface SandboxInput {
  /**
   * The sandbox operation to perform
   */
  operation: "create" | "destroy" | "status" | "execute";

  /**
   * Sandbox identifier
   */
  sandbox_id?: string;

  /**
   * Command to execute in sandbox
   */
  command?: string;

  /**
   * Working directory for the sandbox
   */
  cwd?: string;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union type of all tool input schemas
 *
 * This can be used for type-safe tool input validation.
 */
export type ToolInputSchemas =
  | AgentInput
  | BashInput
  | BashOutputInput
  | TaskOutputInput
  | KillShellInput
  | FileReadInput
  | FileWriteInput
  | FileEditInput
  | GlobInput
  | GrepInput
  | WebFetchInput
  // WebSearchInput 已移除 - 使用 Server Tool
  | TodoWriteInput
  // Task v2 (2.1.16+)
  | TaskCreateInput
  | TaskGetInput
  | TaskUpdateInput
  | TaskListInput
  | NotebookEditInput
  | McpInput
  | ListMcpResourcesInput
  | ReadMcpResourceInput
  | McpResourceInput
  | MCPSearchInput
  | AskUserQuestionInput
  | SkillInput
  | ExitPlanModeInput
  | LSPInput
  | SandboxInput;
