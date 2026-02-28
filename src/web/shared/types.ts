/**
 * WebUI 共享类型定义
 * 前后端通用的类型
 */

// ============ 日志相关类型 ============

/**
 * 日志级别
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * 日志条目
 */
export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  stack?: string;
  data?: unknown;
}

// ============ WebSocket 消息类型 ============

/**
 * WebSocket 消息基础接口
 */
export interface WSMessage {
  type: string;
  payload?: unknown;
}

/**
 * 附件类型枚举
 */
export type AttachmentType = 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'file';

/**
 * 附件类型
 */
export interface Attachment {
  name: string;
  type: AttachmentType;
  mimeType: string;
  data: string; // base64 for images and files, text content for legacy text type
}

// ============ 认证相关类型 ============

/**
 * 认证状态
 */
export interface AuthStatus {
  /** 是否已认证 */
  authenticated: boolean;
  /** 认证类型 */
  type: 'api_key' | 'oauth' | 'none';
  /** Provider 类型 */
  provider: string;
  /** 用户名（OAuth时） */
  username?: string;
  /** 过期时间（OAuth时） */
  expiresAt?: string;
}

/**
 * 设置API密钥请求负载
 */
export interface AuthSetKeyPayload {
  /** API密钥 */
  apiKey: string;
}

/**
 * 认证状态响应负载
 */
export interface AuthStatusPayload {
  /** 认证状态 */
  status: AuthStatus;
}

/**
 * 客户端发送的消息类型
 */
export type ClientMessage =
  | { type: 'chat'; payload: { content: string; images?: string[]; attachments?: Attachment[]; projectPath?: string | null } }
  | { type: 'cancel' }
  | { type: 'ping' }
  | { type: 'get_history' }
  | { type: 'clear_history' }
  | { type: 'set_model'; payload: { model: string } }
  | { type: 'set_language'; payload: { language: string } }
  | { type: 'slash_command'; payload: { command: string } }
  | { type: 'permission_response'; payload: PermissionResponsePayload }
  | { type: 'permission_config'; payload: PermissionConfigPayload }
  | { type: 'user_answer'; payload: UserAnswerPayload }
  | { type: 'session_list'; payload?: SessionListRequestPayload }
  | { type: 'session_create'; payload: SessionCreatePayload }
  | { type: 'session_new'; payload: { model?: string; projectPath?: string | null } }  // 官方规范：创建临时会话
  | { type: 'session_switch'; payload: { sessionId: string } }
  | { type: 'session_delete'; payload: { sessionId: string } }
  | { type: 'session_rename'; payload: { sessionId: string; name: string } }
  | { type: 'session_export'; payload: { sessionId: string; format?: 'json' | 'md' } }
  | { type: 'session_import'; payload: { content: string; format?: 'json' | 'md'; model?: string } }
  | { type: 'session_resume'; payload: { sessionId: string } }
  | { type: 'tool_filter_update'; payload: ToolFilterUpdatePayload }
  | { type: 'tool_list_get' }
  | { type: 'system_prompt_update'; payload: SystemPromptUpdatePayload }
  | { type: 'system_prompt_get' }
  // 提示词片段管理
  | { type: 'prompt_snippets_list' }
  | { type: 'prompt_snippets_create'; payload: { name: string; content: string; description?: string; position?: 'prepend' | 'append'; tags?: string[]; enabled?: boolean; priority?: number } }
  | { type: 'prompt_snippets_update'; payload: { id: string; name?: string; content?: string; description?: string; position?: 'prepend' | 'append'; tags?: string[]; enabled?: boolean; priority?: number } }
  | { type: 'prompt_snippets_delete'; payload: { id: string } }
  | { type: 'prompt_snippets_toggle'; payload: { id: string } }
  | { type: 'prompt_snippets_reorder'; payload: { orders: Array<{ id: string; priority: number }> } }
  | { type: 'task_list'; payload?: TaskListRequestPayload }
  | { type: 'task_cancel'; payload: { taskId: string } }
  | { type: 'task_output'; payload: { taskId: string } }
  | { type: 'mcp_list' }
  | { type: 'mcp_add'; payload: McpAddPayload }
  | { type: 'mcp_remove'; payload: McpRemovePayload }
  | { type: 'mcp_toggle'; payload: McpTogglePayload }
  | { type: 'api_status' }
  | { type: 'api_test' }
  | { type: 'api_models' }
  | { type: 'api_provider' }
  | { type: 'api_token_status' }
  | { type: 'checkpoint_create'; payload: CheckpointCreatePayload }
  | { type: 'checkpoint_list'; payload?: CheckpointListRequestPayload }
  | { type: 'checkpoint_restore'; payload: { checkpointId: string; dryRun?: boolean } }
  | { type: 'checkpoint_delete'; payload: { checkpointId: string } }
  | { type: 'checkpoint_diff'; payload: { checkpointId: string } }
  | { type: 'checkpoint_clear' }
  | { type: 'doctor_run'; payload?: DoctorRunPayload }
  | { type: 'plugin_list' }
  | { type: 'plugin_discover' }
  | { type: 'plugin_info'; payload: { name: string } }
  | { type: 'plugin_enable'; payload: { name: string } }
  | { type: 'plugin_disable'; payload: { name: string } }
  | { type: 'plugin_install'; payload: { pluginId?: string; pluginPath?: string } }
  | { type: 'plugin_uninstall'; payload: { name: string } }
  | { type: 'skill_list' }
  | { type: 'skill_view'; payload: { name: string } }
  | { type: 'skill_delete'; payload: { name: string; source: string } }
  | { type: 'skill_toggle'; payload: { name: string; enabled: boolean } }
  | { type: 'auth_status' }
  | { type: 'auth_set_key'; payload: AuthSetKeyPayload }
  | { type: 'auth_clear' }
  | { type: 'auth_validate'; payload: AuthSetKeyPayload }
  // OAuth 相关消息
  | { type: 'oauth_login'; payload: OAuthLoginPayload }
  | { type: 'oauth_refresh'; payload?: OAuthRefreshPayload }
  | { type: 'oauth_status' }
  | { type: 'oauth_logout' }
  | { type: 'oauth_get_auth_url'; payload: { redirectUri: string; state?: string } }
  // 蜂群相关消息
  | { type: 'swarm:subscribe'; payload: { blueprintId: string } }
  | { type: 'swarm:unsubscribe'; payload: { blueprintId: string } }
  | { type: 'swarm:pause'; payload: { blueprintId: string } }
  | { type: 'swarm:resume'; payload: { blueprintId: string } }
  | { type: 'swarm:stop'; payload: { blueprintId: string } }
  | { type: 'worker:pause'; payload: { workerId: string } }
  | { type: 'worker:resume'; payload: { workerId: string } }
  | { type: 'worker:terminate'; payload: { workerId: string } }
  // v2.1: 任务重试
  | { type: 'task:retry'; payload: { blueprintId: string; taskId: string } }
  // v3.8: 任务跳过
  | { type: 'task:skip'; payload: { blueprintId: string; taskId: string } }
  // v3.8: 取消执行
  | { type: 'swarm:cancel'; payload: { blueprintId: string } }
  // v4.2: AskUserQuestion 响应
  | { type: 'swarm:ask_response'; payload: { blueprintId: string; requestId: string; answers: Record<string, string>; cancelled?: boolean } }
  // v4.5: 用户插嘴
  | { type: 'task:interject'; payload: { blueprintId: string; taskId: string; message: string } }
  // v9.2: LeadAgent 插嘴
  | { type: 'lead:interject'; payload: { blueprintId: string; message: string } }
  // v9.3: LeadAgent 恢复执行（任务卡死时手动触发）
  | { type: 'swarm:resume_lead'; payload: { blueprintId: string } }
  // 持续开发消息
  | { type: 'continuous_dev:start'; payload: { requirement: string } }
  | { type: 'continuous_dev:status' }
  | { type: 'continuous_dev:pause' }
  | { type: 'continuous_dev:resume' }
  | { type: 'continuous_dev:rollback'; payload: { checkpointId?: string } }
  | { type: 'continuous_dev:approve' }
  // 探针调试消息
  | { type: 'debug_get_messages' }
  // Agent 探针调试消息（蜂群模式）
  | { type: 'swarm:debug_agent'; payload: { blueprintId: string; agentType: 'lead' | 'worker' | 'e2e'; workerId?: string } }
  | { type: 'swarm:debug_agent_list'; payload: { blueprintId: string } }
  // 终端消息
  | { type: 'terminal:create'; payload: { cwd?: string; cols?: number; rows?: number } }
  | { type: 'terminal:input'; payload: { terminalId: string; data: string } }
  | { type: 'terminal:resize'; payload: { terminalId: string; cols: number; rows: number } }
  | { type: 'terminal:destroy'; payload: { terminalId: string } }
  // 日志消息
  | { type: 'logs:read'; payload?: { count?: number; level?: string } }
  | { type: 'logs:subscribe' }
  | { type: 'logs:unsubscribe' }
  // Rewind 消息
  | { type: 'rewind_preview'; payload: { messageId: string; option: 'code' | 'conversation' | 'both' } }
  | { type: 'rewind_execute'; payload: { messageId: string; option: 'code' | 'conversation' | 'both' } }
  // Git 消息
  | { type: 'git:get_status' }
  | { type: 'git:get_log'; payload?: { limit?: number } }
  | { type: 'git:get_branches' }
  | { type: 'git:get_stashes' }
  | { type: 'git:stage'; payload: { files: string[] } }
  | { type: 'git:unstage'; payload: { files: string[] } }
  | { type: 'git:commit'; payload: { message: string; autoStage?: boolean } }
  | { type: 'git:push' }
  | { type: 'git:pull' }
  | { type: 'git:checkout'; payload: { branch: string } }
  | { type: 'git:create_branch'; payload: { name: string } }
  | { type: 'git:delete_branch'; payload: { name: string } }
  | { type: 'git:stash_save'; payload: { message?: string } }
  | { type: 'git:stash_pop'; payload: { index?: number } }
  | { type: 'git:stash_drop'; payload: { index: number } }
  | { type: 'git:stash_apply'; payload: { index: number } }
  | { type: 'git:get_diff'; payload?: { file?: string } }
  | { type: 'git:smart_commit' }
  | { type: 'git:smart_review' }
  | { type: 'git:explain_commit'; payload: { hash: string } }
  | { type: 'git:get_commit_detail'; payload: { hash: string } }
  | { type: 'git:get_commit_file_diff'; payload: { projectPath?: string; hash: string; file: string } }
  // Git Enhanced Features
  | { type: 'git:merge'; payload: { branch: string; strategy?: GitMergeStrategy } }
  | { type: 'git:rebase'; payload: { branch: string; onto?: string } }
  | { type: 'git:merge_abort' }
  | { type: 'git:rebase_abort' }
  | { type: 'git:rebase_continue' }
  | { type: 'git:reset'; payload: { commit: string; mode: GitResetMode } }
  | { type: 'git:discard_file'; payload: { file: string } }
  | { type: 'git:stage_all' }
  | { type: 'git:unstage_all' }
  | { type: 'git:discard_all' }
  | { type: 'git:amend_commit'; payload: { message: string } }
  | { type: 'git:revert_commit'; payload: { hash: string } }
  | { type: 'git:cherry_pick'; payload: { hash: string } }
  | { type: 'git:get_tags' }
  | { type: 'git:create_tag'; payload: { name: string; message?: string; type: GitTagType } }
  | { type: 'git:delete_tag'; payload: { name: string } }
  | { type: 'git:push_tags' }
  | { type: 'git:get_remotes' }
  | { type: 'git:add_remote'; payload: { name: string; url: string } }
  | { type: 'git:remove_remote'; payload: { name: string } }
  | { type: 'git:fetch'; payload?: { remote?: string } }
  | { type: 'git:search_commits'; payload: GitCommitSearchFilter }
  | { type: 'git:get_file_history'; payload: { file: string; limit?: number } }
  | { type: 'git:get_blame'; payload: { file: string } }
  | { type: 'git:compare_branches'; payload: { base: string; target: string } }
  | { type: 'git:get_merge_status' }
  | { type: 'git:get_conflicts'; payload: { file: string } };

/**
 * 服务端发送的消息类型
 */
export type ServerMessage =
  | { type: 'connected'; payload: { sessionId: string; model: string } }
  | { type: 'pong' }
  | { type: 'history'; payload: { messages: ChatMessage[]; sessionId?: string } }
  | { type: 'message_start'; payload: { messageId: string; sessionId?: string } }
  | { type: 'text_delta'; payload: { messageId: string; text: string; sessionId?: string } }
  | { type: 'tool_use_start'; payload: ToolUseStartPayload }
  | { type: 'tool_use_delta'; payload: { toolUseId: string; partialJson: string; sessionId?: string } }
  | { type: 'tool_result'; payload: ToolResultPayload }
  | { type: 'message_complete'; payload: MessageCompletePayload }
  | { type: 'context_update'; payload: ContextUpdatePayload }
  | { type: 'rate_limit_update'; payload: RateLimitUpdatePayload }
  | { type: 'context_compact'; payload: ContextCompactPayload }
  | { type: 'error'; payload: { message: string; code?: string; sessionId?: string; source?: string } }
  | { type: 'thinking_start'; payload: { messageId: string; sessionId?: string } }
  | { type: 'thinking_delta'; payload: { messageId: string; text: string; sessionId?: string } }
  | { type: 'thinking_complete'; payload: { messageId: string; sessionId?: string } }
  | { type: 'permission_request'; payload: PermissionRequestPayload }
  | { type: 'status'; payload: StatusPayload }
  | { type: 'user_question'; payload: UserQuestionPayload }
  | { type: 'slash_command_result'; payload: SlashCommandResultPayload }
  | { type: 'session_list_response'; payload: SessionListResponsePayload }
  | { type: 'session_created'; payload: SessionCreatedPayload }
  | { type: 'session_new_ready'; payload: { sessionId: string; model: string; projectPath?: string | null } }  // 官方规范：临时会话已就绪
  | { type: 'session_switched'; payload: { sessionId: string; projectPath?: string | null } }
  | { type: 'session_deleted'; payload: { sessionId: string; success: boolean } }
  | { type: 'session_renamed'; payload: { sessionId: string; name: string; success: boolean } }
  | { type: 'session_exported'; payload: { sessionId: string; content: string; format: 'json' | 'md' } }
  | { type: 'session_imported'; payload: { sessionId: string; name: string; success: boolean } }
  | { type: 'tool_list_response'; payload: ToolListPayload }
  | { type: 'tool_filter_updated'; payload: { success: boolean; config: ToolFilterConfig } }
  | { type: 'system_prompt_response'; payload: SystemPromptGetPayload }
  | { type: 'prompt_snippets_response'; payload: { snippets: any[]; created?: any; updated?: any; toggled?: any; deleted?: string } }
  | { type: 'task_list_response'; payload: TaskListPayload }
  | { type: 'task_status'; payload: TaskStatusPayload }
  | { type: 'task_cancelled'; payload: { taskId: string; success: boolean } }
  | { type: 'schedule_countdown'; payload: ScheduleCountdownPayload }
  | { type: 'schedule_alarm'; payload: ScheduleAlarmPayload }
  | { type: 'task_output_response'; payload: TaskOutputPayload }
  | { type: 'mcp_list_response'; payload: McpListPayload }
  | { type: 'mcp_server_added'; payload: { success: boolean; name: string; server?: McpServerConfig } }
  | { type: 'mcp_server_removed'; payload: { success: boolean; name: string } }
  | { type: 'mcp_server_toggled'; payload: { success: boolean; name: string; enabled: boolean } }
  | { type: 'api_status_response'; payload: ApiStatusPayload }
  | { type: 'api_test_response'; payload: ApiTestResult }
  | { type: 'api_models_response'; payload: { models: string[] } }
  | { type: 'api_provider_response'; payload: ProviderInfo }
  | { type: 'api_token_status_response'; payload: ApiStatusPayload['tokenStatus'] }
  | { type: 'checkpoint_created'; payload: CheckpointCreatedPayload }
  | { type: 'checkpoint_list_response'; payload: CheckpointListResponsePayload }
  | { type: 'checkpoint_restored'; payload: CheckpointRestoredPayload }
  | { type: 'checkpoint_deleted'; payload: { checkpointId: string; success: boolean } }
  | { type: 'checkpoint_diff_response'; payload: CheckpointDiffPayload }
  | { type: 'checkpoint_cleared'; payload: { count: number } }
  | { type: 'doctor_result'; payload: DoctorResultPayload }
  | { type: 'plugin_list_response'; payload: PluginListPayload }
  | { type: 'plugin_discover_response'; payload: PluginDiscoverPayload }
  | { type: 'plugin_list'; payload: { plugins: any[] } }
  | { type: 'plugin_info_response'; payload: { plugin: PluginInfo | null } }
  | { type: 'plugin_enabled'; payload: { name: string; success: boolean } }
  | { type: 'plugin_disabled'; payload: { name: string; success: boolean } }
  | { type: 'plugin_installed'; payload: { success: boolean; plugin?: any; error?: string } }
  | { type: 'plugin_progress'; payload: { pluginId: string; step: number; totalSteps: number; message: string } }
  | { type: 'plugin_uninstalled'; payload: { name: string; success: boolean } }
  | { type: 'skill_list_response'; payload: { skills: SkillInfo[] } }
  | { type: 'skill_view_response'; payload: { name: string; content: string } }
  | { type: 'skill_deleted'; payload: { name: string; success: boolean } }
  | { type: 'skill_toggled'; payload: { name: string; enabled: boolean; success: boolean } }
  | { type: 'auth_status_response'; payload: AuthStatusPayload }
  | { type: 'auth_key_set'; payload: { success: boolean; message?: string } }
  | { type: 'auth_cleared'; payload: { success: boolean } }
  | { type: 'auth_validated'; payload: { valid: boolean; message?: string } }
  | { type: 'oauth_login_response'; payload: { success: boolean; token?: OAuthTokenResponse; message?: string } }
  | { type: 'oauth_refresh_response'; payload: { success: boolean; token?: OAuthTokenResponse; message?: string } }
  | { type: 'oauth_status_response'; payload: OAuthStatusPayload }
  | { type: 'oauth_logout_response'; payload: { success: boolean } }
  | { type: 'oauth_auth_url_response'; payload: { url: string } }
  // Git 响应消息
  | { type: 'git:status_response'; payload: GitStatusResponsePayload }
  | { type: 'git:log_response'; payload: GitLogResponsePayload }
  | { type: 'git:branches_response'; payload: GitBranchesResponsePayload }
  | { type: 'git:stashes_response'; payload: GitStashesResponsePayload }
  | { type: 'git:operation_result'; payload: GitOperationResultPayload }
  | { type: 'git:diff_response'; payload: GitDiffResponsePayload }
  | { type: 'git:smart_commit_response'; payload: GitSmartCommitResponsePayload }
  | { type: 'git:smart_review_response'; payload: GitSmartReviewResponsePayload }
  | { type: 'git:explain_commit_response'; payload: GitExplainCommitResponsePayload }
  | { type: 'git:commit_detail_response'; payload: { success: boolean; data?: { hash: string; shortHash: string; author: string; date: string; message: string; diff: string; files: { status: string; file: string }[] }; error?: string } }
  // Git Enhanced Features Responses
  | { type: 'git:tags_response'; payload: { success: boolean; data?: GitTag[]; error?: string } }
  | { type: 'git:remotes_response'; payload: { success: boolean; data?: GitRemote[]; error?: string } }
  | { type: 'git:file_history_response'; payload: { success: boolean; data?: GitFileHistoryCommit[]; error?: string } }
  | { type: 'git:blame_response'; payload: { success: boolean; data?: GitBlameLine[]; error?: string } }
  | { type: 'git:compare_branches_response'; payload: { success: boolean; data?: GitCompareBranches; error?: string } }
  | { type: 'git:merge_status_response'; payload: { success: boolean; data?: GitMergeStatus; error?: string } }
  | { type: 'git:conflicts_response'; payload: { success: boolean; data?: GitConflict; error?: string } }
  // 蜂群相关消息
  | { type: 'swarm:state'; payload: any }
  | { type: 'swarm:task_update'; payload: any }
  | { type: 'swarm:worker_update'; payload: any }
  | { type: 'swarm:queen_update'; payload: any }
  | { type: 'swarm:timeline_event'; payload: any }
  | { type: 'swarm:completed'; payload: any }
  | { type: 'swarm:error'; payload: { blueprintId: string; error: string; timestamp: string } }
  | { type: 'swarm:paused'; payload: { blueprintId: string; success: boolean; message?: string; timestamp: string } }
  | { type: 'swarm:resumed'; payload: { blueprintId: string; success: boolean; message?: string; timestamp: string } }
  | { type: 'swarm:stopped'; payload: { blueprintId: string; success: boolean; message?: string; timestamp: string } }
  | { type: 'worker:paused'; payload: { workerId: string; success: boolean; message?: string; timestamp: string } }
  | { type: 'worker:resumed'; payload: { workerId: string; success: boolean; message?: string; timestamp: string } }
  | { type: 'worker:terminated'; payload: { workerId: string; success: boolean; message?: string; timestamp: string } }
  | { type: 'worker:removed'; payload: { workerId: string; blueprintId: string; reason: string; timestamp: string } }
  | { type: 'swarm:stats_update'; payload: { blueprintId: string; stats: any } }
  // v2.1: 任务重试响应
  | { type: 'task:retry_success'; payload: { blueprintId: string; taskId: string; success: true; timestamp: string } }
  | { type: 'task:retry_failed'; payload: { blueprintId: string; taskId: string; success: false; error: string; timestamp: string } }
  // v3.8: 任务跳过响应
  | { type: 'task:skip_success'; payload: { blueprintId: string; taskId: string; success: true; timestamp: string } }
  | { type: 'task:skip_failed'; payload: { blueprintId: string; taskId: string; success: false; error: string; timestamp: string } }
  // v4.5: 用户插嘴响应
  | { type: 'task:interject_success'; payload: { blueprintId: string; taskId: string; success: true; message: string; timestamp: string } }
  | { type: 'task:interject_failed'; payload: { blueprintId: string; taskId: string; success: false; error: string; timestamp: string } }
  // v9.2: LeadAgent 插嘴响应
  | { type: 'lead:interject_success'; payload: { blueprintId: string; success: true; message: string; timestamp: string } }
  | { type: 'lead:interject_failed'; payload: { blueprintId: string; success: false; error: string; timestamp: string } }
  // v3.8: 取消执行响应
  | { type: 'swarm:cancelled'; payload: { blueprintId: string; success: boolean; timestamp: string } }
  // v4.2: AskUserQuestion 相关消息
  | { type: 'swarm:ask_user'; payload: { requestId: string; questions: any[]; e2eTaskId?: string } }
  | { type: 'swarm:ask_response_ack'; payload: { requestId: string; success: boolean } }
  // 持续开发消息
  | { type: 'continuous_dev:ack'; payload: { message: string } }
  | { type: 'continuous_dev:status_update'; payload: any }
  | { type: 'continuous_dev:progress_update'; payload: any }
  | { type: 'continuous_dev:paused'; payload: { success: boolean } }
  | { type: 'continuous_dev:resumed'; payload: { success: boolean } }
  | { type: 'continuous_dev:approved'; payload: { success: boolean } }
  | { type: 'continuous_dev:flow_started'; payload: any }
  | { type: 'continuous_dev:phase_changed'; payload: any }
  | { type: 'continuous_dev:phase_started'; payload: any }
  | { type: 'continuous_dev:phase_completed'; payload: any }
  | { type: 'continuous_dev:approval_required'; payload: any }
  | { type: 'continuous_dev:task_completed'; payload: any }
  | { type: 'continuous_dev:task_failed'; payload: any }
  | { type: 'continuous_dev:regression_passed'; payload: any }
  | { type: 'continuous_dev:regression_failed'; payload: any }
  | { type: 'continuous_dev:cycle_reset'; payload: any }
  | { type: 'continuous_dev:cycle_review_started'; payload: any }
  | { type: 'continuous_dev:cycle_review_completed'; payload: any }
  | { type: 'continuous_dev:flow_failed'; payload: any }
  | { type: 'continuous_dev:flow_stopped'; payload?: any }
  | { type: 'continuous_dev:flow_paused'; payload?: any }
  | { type: 'continuous_dev:flow_resumed'; payload?: any }
  // 权限模式同步
  | { type: 'permission_config_update'; payload: { mode: PermissionMode; bypassTools?: string[]; alwaysAllow?: string[]; alwaysDeny?: string[] } }
  // 探针调试消息
  | { type: 'debug_messages_response'; payload: DebugMessagesPayload }
  // Agent 探针调试响应（蜂群模式）
  | { type: 'swarm:debug_agent_response'; payload: AgentDebugPayload }
  | { type: 'swarm:debug_agent_list_response'; payload: { blueprintId: string; agents: Array<{ agentType: string; id: string; label: string; taskId?: string }> } }
  // 终端消息
  | { type: 'terminal:created'; payload: { terminalId: string } }
  | { type: 'terminal:output'; payload: { terminalId: string; data: string } }
  | { type: 'terminal:exit'; payload: { terminalId: string; exitCode: number } }
  // 日志消息
  | { type: 'logs:data'; payload: { entries: LogEntry[] } }
  | { type: 'logs:tail'; payload: { entries: LogEntry[] } }
  // Rewind 消息
  | { type: 'rewind_preview'; payload: { success: boolean; preview?: any } }
  | { type: 'rewind_success'; payload: { success: boolean; result?: any; messages?: any[] } };

// ============ 消息负载类型 ============

export interface ToolUseStartPayload {
  messageId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
  toolCategory?: string;
  sessionId?: string;
}

export interface ToolResultPayload {
  toolUseId: string;
  success: boolean;
  output?: string;
  error?: string;
  /** 工具特定的结构化数据 */
  data?: ToolResultData;
  /** 结果是否应该默认折叠 */
  defaultCollapsed?: boolean;
  sessionId?: string;
}

export interface MessageCompletePayload {
  messageId: string;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  sessionId?: string;
}

/** 上下文使用量更新负载 */
export interface ContextUpdatePayload {
  /** 已使用的 tokens */
  usedTokens: number;
  /** 模型上下文窗口大小 */
  maxTokens: number;
  /** 使用百分比 (0-100) */
  percentage: number;
  /** 当前模型 */
  model: string;
  sessionId?: string;
}

/**
 * API 速率限制更新负载
 */
export interface RateLimitUpdatePayload {
  status: string;
  utilization5h?: number;
  utilization7d?: number;
  resetsAt?: number;
  rateLimitType?: string;
  sessionId?: string;
}

/** 上下文压缩事件负载 */
export interface ContextCompactPayload {
  /** 压缩阶段 */
  phase: 'start' | 'end' | 'error';
  /** 压缩阈值 */
  threshold?: number;
  /** 节省的 tokens 数 */
  savedTokens?: number;
  /** 压缩前的 tokens 估算 */
  estimatedTokens?: number;
  /** 错误消息 */
  message?: string;
  /** 压缩摘要文本 */
  summaryText?: string;
  /** 触发原因 */
  reason?: string;
  sessionId?: string;
}

export interface StatusPayload {
  status: 'idle' | 'thinking' | 'tool_executing' | 'streaming';
  message?: string;
  sessionId?: string;
}

/**
 * 权限请求负载（服务端发送给前端）
 */
export interface PermissionRequestPayload {
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
  sessionId?: string;
}

/**
 * 权限响应负载（前端发送给服务端）
 */
export interface PermissionResponsePayload {
  requestId: string;
  approved: boolean;
  remember?: boolean;
  scope?: 'once' | 'session' | 'always';
  destination?: 'project' | 'global' | 'team' | 'session';
}

/**
 * 权限配置负载（前端发送给服务端）
 */
export interface PermissionConfigPayload {
  mode?: 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan' | 'dontAsk';
  timeout?: number;
  bypassTools?: string[];
  alwaysAllow?: string[];
  alwaysDeny?: string[];
}

/**
 * 用户问题负载（服务端发送给前端）
 */
export interface UserQuestionPayload {
  requestId: string;
  question: string;
  header: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  timeout?: number;
}

export interface QuestionOption {
  label: string;
  description: string;
}

/**
 * 用户回答负载（前端发送给服务端）
 */
export interface UserAnswerPayload {
  requestId: string;
  answer: string;
}

/**
 * 斜杠命令结果负载（服务端发送给前端）
 */
export interface SlashCommandResultPayload {
  command: string;
  success: boolean;
  message?: string;
  data?: any;
  action?: 'clear' | 'reload' | 'none';
  dialogType?: 'text' | 'session-list' | 'compact-result';
}

// ============ 聊天消息类型 ============

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  content: ChatContent[];
  /** 仅助手消息有 */
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** 对齐官方 compact_boundary：标记此消息为压缩边界（UI 渲染分隔线） */
  isCompactBoundary?: boolean;
  /** 对齐官方 isCompactSummary：标记此消息为压缩摘要内容 */
  isCompactSummary?: boolean;
  /** 对齐官方 isVisibleInTranscriptOnly：仅在 transcript 模式下可见 */
  isVisibleInTranscriptOnly?: boolean;
  /** 附件信息（仅用户消息） */
  attachments?: Array<{ name: string; type: string }>;
  /** 创建此条目时 state.messages 的长度，用于 rewind 时同步截断 messages */
  _messagesLen?: number;
}

/**
 * 聊天内容块
 */
export type ChatContent =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  fileName?: string;
  url?: string;
}

export interface ThinkingContent {
  type: 'thinking';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
  /** 执行状态 */
  status: 'pending' | 'running' | 'completed' | 'error';
  /** 关联的结果 */
  result?: ToolResultContent;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  success: boolean;
  output?: string;
  error?: string;
  /** 结构化数据用于特殊渲染 */
  data?: ToolResultData;
}

// ============ 工具结果数据类型 ============

/**
 * 工具特定的结构化结果数据
 * 用于前端特殊渲染
 */
export type ToolResultData =
  | BashResultData
  | ReadResultData
  | WriteResultData
  | EditResultData
  | GlobResultData
  | GrepResultData
  | WebFetchResultData
  | WebSearchResultData
  | TodoResultData
  | DiffResultData
  | TaskResultData
  | ScheduleTaskResultData
  | NotebookResultData;

export interface BashResultData {
  tool: 'Bash';
  command: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  duration?: number;
}

export interface ReadResultData {
  tool: 'Read';
  filePath: string;
  content: string;
  lineCount: number;
  language?: string;
}

export interface WriteResultData {
  tool: 'Write';
  filePath: string;
  bytesWritten: number;
}

export interface EditResultData {
  tool: 'Edit';
  filePath: string;
  diff: DiffHunk[];
  linesAdded: number;
  linesRemoved: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface GlobResultData {
  tool: 'Glob';
  pattern: string;
  files: string[];
  totalCount: number;
}

export interface GrepResultData {
  tool: 'Grep';
  pattern: string;
  matches: GrepMatch[];
  totalCount: number;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
  context?: {
    before: string[];
    after: string[];
  };
}

export interface WebFetchResultData {
  tool: 'WebFetch';
  url: string;
  title?: string;
  contentPreview?: string;
}

export interface WebSearchResultData {
  tool: 'WebSearch';
  query: string;
  results: SearchResult[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface TodoResultData {
  tool: 'TodoWrite';
  todos: TodoItem[];
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface DiffResultData {
  tool: 'Diff';
  hunks: DiffHunk[];
}

export interface TaskResultData {
  tool: 'Task';
  agentType: string;
  description: string;
  status: 'running' | 'completed' | 'error';
  output?: string;
}

export interface ScheduleTaskResultData {
  tool: 'ScheduleTask';
  description: string;
  status: 'running' | 'completed' | 'error';
  output?: string;
}

// ============ Jupyter Notebook 相关类型 ============

/**
 * Notebook 读取结果数据
 * 用于 WebUI 中渲染 Jupyter notebook 内容
 */
export interface NotebookResultData {
  tool: 'NotebookRead';
  filePath: string;
  cells: NotebookCell[];
  metadata: NotebookMetadata;
}

/**
 * Notebook 单元格
 */
export interface NotebookCell {
  /** 单元格索引 */
  index: number;
  /** 单元格类型 */
  cellType: 'code' | 'markdown' | 'raw';
  /** 源代码内容 */
  source: string;
  /** 执行计数（仅 code 类型） */
  executionCount?: number | null;
  /** 单元格输出列表（仅 code 类型） */
  outputs?: NotebookOutput[];
}

/**
 * Notebook 单元格输出
 * 支持 MIME bundle 格式
 */
export interface NotebookOutput {
  /** 输出类型 */
  outputType: 'execute_result' | 'display_data' | 'stream' | 'error';
  /** 执行计数（仅 execute_result） */
  executionCount?: number;
  /** MIME bundle 数据 */
  data?: NotebookMimeBundle;
  /** 流输出名称（stdout/stderr） */
  streamName?: 'stdout' | 'stderr';
  /** 流输出文本 */
  text?: string;
  /** 错误名称（仅 error 类型） */
  ename?: string;
  /** 错误值（仅 error 类型） */
  evalue?: string;
  /** 错误回溯（仅 error 类型） */
  traceback?: string[];
}

/**
 * MIME Bundle 数据
 * 键为 MIME 类型，值为对应格式的数据
 */
export interface NotebookMimeBundle {
  /** 纯文本 */
  'text/plain'?: string;
  /** HTML 内容 */
  'text/html'?: string;
  /** Markdown 内容 */
  'text/markdown'?: string;
  /** LaTeX 内容 */
  'text/latex'?: string;
  /** PNG 图片（base64） */
  'image/png'?: string;
  /** JPEG 图片（base64） */
  'image/jpeg'?: string;
  /** GIF 图片（base64） */
  'image/gif'?: string;
  /** SVG 图片 */
  'image/svg+xml'?: string;
  /** JSON 数据 */
  'application/json'?: any;
  /** Plotly 图表 */
  'application/vnd.plotly.v1+json'?: any;
  /** Vega 可视化 */
  'application/vnd.vega.v5+json'?: any;
  /** Vega-Lite 可视化 */
  'application/vnd.vegalite.v4+json'?: any;
  /** 其他 MIME 类型 */
  [mimeType: string]: any;
}

/**
 * Notebook 元数据
 */
export interface NotebookMetadata {
  /** 内核信息 */
  kernelspec?: {
    name: string;
    displayName: string;
    language?: string;
  };
  /** 语言信息 */
  languageInfo?: {
    name: string;
    version?: string;
    mimeType?: string;
    fileExtension?: string;
  };
  /** 其他元数据 */
  [key: string]: any;
}

// ============ 会话信息 ============

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  model: string;
  messageCount: number;
  totalCost: number;
  cwd: string;
}

// ============ 会话相关 Payload ============

/**
 * 会话列表请求负载
 */
export interface SessionListRequestPayload {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'messageCount' | 'cost';
  sortOrder?: 'asc' | 'desc';
  /** 按项目路径过滤：undefined 表示不过滤，null 表示只获取全局会话 */
  projectPath?: string | null;
}

/**
 * 会话列表响应负载
 */
export interface SessionListResponsePayload {
  sessions: SessionSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/**
 * 会话摘要信息
 */
export interface SessionSummary {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  cost?: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  tags?: string[];
  workingDirectory: string;
  /** 项目路径，用于按项目过滤会话，null/undefined 表示全局会话 */
  projectPath?: string | null;
}

/**
 * 创建会话请求负载
 */
export interface SessionCreatePayload {
  name?: string;
  model: string;
  tags?: string[];
  /** 项目路径，用于按项目过滤会话，null 表示全局会话 */
  projectPath?: string | null;
}

/**
 * 会话创建响应负载
 */
export interface SessionCreatedPayload {
  sessionId: string;
  name?: string;
  model: string;
  createdAt: number;
  /** 项目路径，用于按项目过滤会话，null/undefined 表示全局会话 */
  projectPath?: string | null;
}

// ============ 任务相关 Payload ============

/**
 * 任务列表请求负载
 */
export interface TaskListRequestPayload {
  statusFilter?: 'running' | 'completed' | 'failed' | 'cancelled';
  includeCompleted?: boolean;
}

/**
 * 任务列表响应负载
 */
export interface TaskListPayload {
  tasks: TaskSummary[];
}

/**
 * 任务摘要信息
 */
export interface TaskSummary {
  id: string;
  description: string;
  agentType: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
}

/**
 * 定时任务倒计时负载
 */
export interface ScheduleCountdownPayload {
  taskId: string;
  taskName: string;
  triggerAt: number;
  remainingMs: number;
  phase: 'countdown' | 'executing' | 'done';
}

/**
 * 定时任务闹钟提醒负载
 */
export interface ScheduleAlarmPayload {
  taskId: string;
  taskName: string;
  sessionId: string;
  prompt: string;
  triggeredAt: number;
  /** 是否在新会话中执行（原会话已关闭） */
  isNewSession?: boolean;
}

/**
 * 任务状态更新负载
 */
export interface TaskStatusPayload {
  taskId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
}

/**
 * 任务输出响应负载
 */
export interface TaskOutputPayload {
  taskId: string;
  output?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

// ============ 工具名称映射 ============

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Bash: '终端命令',
  BashOutput: '终端输出',
  KillShell: '终止进程',
  Read: '读取文件',
  Write: '写入文件',
  Edit: '编辑文件',
  MultiEdit: '批量编辑',
  Glob: '文件搜索',
  Grep: '内容搜索',
  WebFetch: '网页获取',
  WebSearch: '网页搜索',
  TodoWrite: '任务管理',
  Task: '子任务',
  TaskOutput: '任务输出',
  ListAgents: '代理列表',
  NotebookEdit: '笔记本编辑',
  EnterPlanMode: '进入计划模式',
  ExitPlanMode: '退出计划模式',
  ListMcpResources: 'MCP资源列表',
  ReadMcpResource: '读取MCP资源',
  McpResource: 'MCP资源',
  MCPSearch: 'MCP搜索',
  AskUserQuestion: '询问用户',
  Tmux: '终端复用',
  Skill: '技能',
  SlashCommand: '斜杠命令',
  LSP: '语言服务',
  Chrome: 'Chrome调试',
};

// ============ 工具图标映射 ============

export const TOOL_ICONS: Record<string, string> = {
  Bash: '💻',
  BashOutput: '📤',
  KillShell: '🛑',
  Read: '📖',
  Write: '✏️',
  Edit: '🔧',
  MultiEdit: '📝',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
  WebSearch: '🔍',
  TodoWrite: '✅',
  Task: '🤖',
  TaskOutput: '📋',
  ListAgents: '👥',
  NotebookEdit: '📓',
  EnterPlanMode: '📋',
  ExitPlanMode: '✅',
  ListMcpResources: '📦',
  ReadMcpResource: '📄',
  McpResource: '📦',
  MCPSearch: '🔍',
  AskUserQuestion: '❓',
  Tmux: '🖥️',
  Skill: '⚡',
  SlashCommand: '/',
  LSP: '🔤',
  Chrome: '🌐',
};

// ============ 工具过滤配置 ============

/**
 * 工具过滤配置
 */
export interface ToolFilterConfig {
  /** 允许的工具列表（白名单） */
  allowedTools?: string[];
  /** 禁止的工具列表（黑名单） */
  disallowedTools?: string[];
  /** 过滤模式 */
  mode: 'whitelist' | 'blacklist' | 'all';
}

/**
 * 工具过滤更新负载
 */
export interface ToolFilterUpdatePayload {
  config: ToolFilterConfig;
}

/**
 * 工具列表负载
 */
export interface ToolListPayload {
  tools: ToolInfo[];
  config: ToolFilterConfig;
}

/**
 * 工具信息
 */
export interface ToolInfo {
  name: string;
  description: string;
  enabled: boolean;
  category: string;
}

// ============ 系统提示配置 ============

/**
 * 系统提示配置
 */
export interface SystemPromptConfig {
  /** 自定义系统提示（完全替换默认提示） */
  customPrompt?: string;
  /** 追加到默认提示后的内容 */
  appendPrompt?: string;
  /** 是否使用默认提示 */
  useDefault: boolean;
}

/**
 * 更新系统提示请求负载
 */
export interface SystemPromptUpdatePayload {
  config: SystemPromptConfig;
}

/**
 * 获取系统提示响应负载
 */
export interface SystemPromptGetPayload {
  /** 当前完整的系统提示 */
  current: string;
  /** 当前配置 */
  config: SystemPromptConfig;
}

/**
 * Agent 调试信息负载（蜂群探针功能）
 */
export interface AgentDebugPayload {
  /** Agent 类型 */
  agentType: 'lead' | 'worker' | 'e2e';
  /** Worker ID（仅 worker 类型） */
  workerId?: string;
  /** 当前任务 ID（仅 worker 类型） */
  taskId?: string | null;
  /** 当前系统提示词 */
  systemPrompt: string;
  /** 发送给 API 的原始消息体 */
  messages: unknown[];
  /** 当前使用的工具定义列表 */
  tools: unknown[];
  /** 当前模型 */
  model: string;
  /** 消息总数 */
  messageCount: number;
}

/**
 * 调试消息响应负载（探针功能）
 */
export interface DebugMessagesPayload {
  /** 当前系统提示词 */
  systemPrompt: string;
  /** 发送给 API 的原始消息体 */
  messages: unknown[];
  /** 当前使用的工具定义列表 */
  tools: unknown[];
  /** 当前模型 */
  model: string;
  /** 消息总数 */
  messageCount: number;
}

// ============ API 管理相关 ============

/**
 * API 连接状态
 */
export interface ApiStatusPayload {
  /** 是否已连接 */
  connected: boolean;
  /** Provider 类型 */
  provider: 'anthropic' | 'bedrock' | 'vertex';
  /** API Base URL */
  baseUrl: string;
  /** 可用模型列表 */
  models: string[];
  /** Token 状态 */
  tokenStatus: {
    type: 'api_key' | 'oauth' | 'none';
    valid: boolean;
    expiresAt?: number;
    scope?: string[];
  };
}

/**
 * API 测试结果
 */
export interface ApiTestResult {
  /** 测试是否成功 */
  success: boolean;
  /** 响应延迟（毫秒） */
  latency: number;
  /** 测试使用的模型 */
  model: string;
  /** 错误信息（如果失败） */
  error?: string;
  /** 测试时间戳 */
  timestamp: number;
}

/**
 * Provider 信息
 */
export interface ProviderInfo {
  /** Provider 类型 */
  type: 'anthropic' | 'bedrock' | 'vertex';
  /** Provider 名称 */
  name: string;
  /** 区域（Bedrock/Vertex） */
  region?: string;
  /** 项目 ID（Vertex） */
  projectId?: string;
  /** 端点 URL */
  endpoint: string;
  /** 是否可用 */
  available: boolean;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ============ MCP 服务器管理 ============

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  /** 服务器名称 */
  name: string;
  /** 服务器类型 */
  type: 'stdio' | 'sse' | 'http';
  /** 命令路径 (stdio) */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 服务器 URL (sse/http) */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, string>;
  /** 是否启用 */
  enabled: boolean;
  /** 超时时间(ms) */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
}

/**
 * MCP 列表响应负载
 */
export interface McpListPayload {
  /** MCP 服务器列表 */
  servers: McpServerConfig[];
  /** 总数 */
  total: number;
}

/**
 * MCP 添加请求负载
 */
export interface McpAddPayload {
  /** 服务器配置 */
  server: Omit<McpServerConfig, 'name'> & { name: string };
}

/**
 * MCP 删除请求负载
 */
export interface McpRemovePayload {
  /** 服务器名称 */
  name: string;
}

/**
 * MCP 切换请求负载
 */
export interface McpTogglePayload {
  /** 服务器名称 */
  name: string;
  /** 是否启用 */
  enabled?: boolean;
}

// ============ 检查点相关 Payload ============

/**
 * 检查点文件信息
 */
export interface CheckpointFileInfo {
  /** 文件路径 */
  path: string;
  /** 文件哈希值 */
  hash: string;
  /** 文件大小（字节） */
  size: number;
}

/**
 * 检查点摘要信息
 */
export interface CheckpointSummary {
  /** 检查点 ID */
  id: string;
  /** 创建时间戳 */
  timestamp: number;
  /** 检查点描述 */
  description: string;
  /** 文件数量 */
  fileCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 工作目录 */
  workingDirectory: string;
  /** 标签 */
  tags?: string[];
}

/**
 * 创建检查点请求负载
 */
export interface CheckpointCreatePayload {
  /** 检查点描述 */
  description: string;
  /** 要包含的文件路径列表 */
  filePaths: string[];
  /** 工作目录（可选） */
  workingDirectory?: string;
  /** 标签（可选） */
  tags?: string[];
}

/**
 * 检查点创建响应负载
 */
export interface CheckpointCreatedPayload {
  /** 检查点 ID */
  checkpointId: string;
  /** 创建时间戳 */
  timestamp: number;
  /** 检查点描述 */
  description: string;
  /** 文件数量 */
  fileCount: number;
  /** 总大小 */
  totalSize: number;
}

/**
 * 检查点列表请求负载
 */
export interface CheckpointListRequestPayload {
  /** 限制数量 */
  limit?: number;
  /** 排序字段 */
  sortBy?: 'timestamp' | 'description';
  /** 排序方式 */
  sortOrder?: 'asc' | 'desc';
}

/**
 * 检查点列表响应负载
 */
export interface CheckpointListResponsePayload {
  /** 检查点列表 */
  checkpoints: CheckpointSummary[];
  /** 总数 */
  total: number;
  /** 统计信息 */
  stats: {
    totalFiles: number;
    totalSize: number;
    oldest?: number;
    newest?: number;
  };
}

/**
 * 检查点恢复响应负载
 */
export interface CheckpointRestoredPayload {
  /** 检查点 ID */
  checkpointId: string;
  /** 是否成功 */
  success: boolean;
  /** 恢复的文件列表 */
  restored: string[];
  /** 失败的文件列表 */
  failed: string[];
  /** 错误信息 */
  errors?: Array<{ path: string; error: string }>;
}

/**
 * 文件差异类型
 */
export type FileDiffType = 'added' | 'removed' | 'modified' | 'unchanged';

/**
 * 文件差异信息
 */
export interface FileDiff {
  /** 文件路径 */
  path: string;
  /** 差异类型 */
  type: FileDiffType;
  /** 检查点中的内容 */
  checkpointContent?: string;
  /** 当前内容 */
  currentContent?: string;
  /** 差异文本 */
  diff?: string;
}

/**
 * 检查点差异响应负载
 */
export interface CheckpointDiffPayload {
  /** 检查点 ID */
  checkpointId: string;
  /** 文件差异列表 */
  diffs: FileDiff[];
  /** 统计信息 */
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

// ============ Doctor 诊断相关 ============

/**
 * 单个诊断检查结果
 */
export interface DiagnosticResult {
  category: string;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
  fix?: string;
}

/**
 * 完整诊断报告
 */
export interface DoctorReport {
  timestamp: number;
  results: DiagnosticResult[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
  };
  systemInfo?: {
    version: string;
    platform: string;
    nodeVersion: string;
    memory: {
      total: string;
      free: string;
      used: string;
      percentUsed: number;
    };
    cpu: {
      model: string;
      cores: number;
      loadAverage: number[];
    };
  };
}

/**
 * Doctor 运行请求负载
 */
export interface DoctorRunPayload {
  verbose?: boolean;
  includeSystemInfo?: boolean;
}

/**
 * Doctor 结果响应负载
 */
export interface DoctorResultPayload {
  report: DoctorReport;
  formattedText: string;
}

// ============ 插件相关 Payload ============

/**
 * 插件信息
 */
export interface PluginInfo {
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 插件作者 */
  author?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 是否已加载 */
  loaded: boolean;
  /** 插件路径 */
  path: string;
  /** 提供的命令列表 */
  commands?: string[];
  /** 提供的技能列表 */
  skills?: string[];
  /** 提供的钩子列表 */
  hooks?: string[];
  /** 提供的工具列表 */
  tools?: string[];
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * Skill 信息
 */
export interface SkillInfo {
  /** skill 名称（完整名称，如 plugin:skillname） */
  name: string;
  /** 显示名称（去掉 prefix） */
  displayName: string;
  /** skill 描述 */
  description: string;
  /** 来源类型 */
  source: 'plugin' | 'smithery' | 'manual';
  /** 来源插件名（plugin 类型时） */
  sourceName?: string;
  /** 文件路径 */
  path: string;
  /** 是否启用 */
  enabled: boolean;
  /** 是否可被用户调用 */
  userInvocable: boolean;
  /** 指定的模型 */
  model?: string;
  /** 允许的工具列表 */
  allowedTools?: string[];
  /** 参数提示 */
  argumentHint?: string;
  /** 版本号 */
  version?: string;
  /** 作者 */
  author?: string;
}

/**
 * 插件列表响应负载
 */
export interface PluginListPayload {
  /** 插件列表 */
  plugins: PluginInfo[];
  /** 总数 */
  total: number;
}

/**
 * Marketplace 插件信息（可发现的插件）
 */
export interface MarketplacePluginItem {
  pluginId: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  marketplaceName: string;
  installCount?: number;
  tags?: string[];
}

/**
 * Marketplace 信息
 */
export interface MarketplaceItem {
  name: string;
  source: string;
  pluginCount: number;
  autoUpdate?: boolean;
  lastUpdated?: string;
}

/**
 * 插件发现响应负载
 */
export interface PluginDiscoverPayload {
  marketplaces: MarketplaceItem[];
  availablePlugins: MarketplacePluginItem[];
}

// ============ OAuth 相关类型 ============

/**
 * OAuth 配置
 */
export interface OAuthConfig {
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 过期时间（Unix 时间戳） */
  expiresAt: number;
  /** 授权范围 */
  scopes: string[];
  /** 订阅类型 */
  subscriptionType?: string;
  /** 速率限制层级 */
  rateLimitTier?: string;
  /** 组织角色 */
  organizationRole?: string;
  /** 工作区角色 */
  workspaceRole?: string;
  /** 组织名称 */
  organizationName?: string;
  /** 显示名称 */
  displayName?: string;
  /** 是否启用额外用量 */
  hasExtraUsageEnabled?: boolean;
  /** 通过 org:create_api_key 换取的临时 API Key（供无 user:inference scope 的订阅用户推理用） */
  oauthApiKey?: string;
}

/**
 * OAuth Token 响应
 */
export interface OAuthTokenResponse {
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 过期时间（Unix 时间戳） */
  expiresAt: number;
  /** 授权范围 */
  scopes: string[];
  /** 订阅类型 */
  subscriptionType?: string;
  /** 速率限制层级 */
  rateLimitTier?: string;
}

/**
 * 用户角色信息
 */
export interface UserRoles {
  /** 组织角色 */
  organizationRole?: string;
  /** 工作区角色 */
  workspaceRole?: string;
  /** 组织名称 */
  organizationName?: string;
}

/**
 * 订阅信息
 */
export interface SubscriptionInfo {
  /** 订阅类型 */
  subscriptionType: string;
  /** 速率限制层级 */
  rateLimitTier: string;
  /** 组织角色 */
  organizationRole?: string;
  /** 工作区角色 */
  workspaceRole?: string;
  /** 组织名称 */
  organizationName?: string;
  /** 显示名称 */
  displayName?: string;
  /** 是否启用额外用量 */
  hasExtraUsageEnabled?: boolean;
}

/**
 * OAuth 登录请求负载
 */
export interface OAuthLoginPayload {
  /** 授权码 */
  code: string;
  /** 回调 URI */
  redirectUri: string;
}

/**
 * OAuth 刷新请求负载
 */
export interface OAuthRefreshPayload {
  /** 刷新令牌（可选，不提供则从配置读取） */
  refreshToken?: string;
}

/**
 * OAuth 状态响应负载
 */
export interface OAuthStatusPayload {
  /** 是否已认证 */
  authenticated: boolean;
  /** 是否过期 */
  expired: boolean;
  /** 过期时间 */
  expiresAt?: number;
  /** 授权范围 */
  scopes?: string[];
  /** 订阅信息 */
  subscriptionInfo?: SubscriptionInfo;
}

// ============================================================================
// 完整配置管理类型（与 CLI 保持一致）
// 以下类型定义参考 src/types/config.ts，确保前后端配置兼容性
// ============================================================================

// ============ 模型类型 ============

/**
 * 支持的 Claude 模型标识符
 */
export type ModelName =
  | 'claude-opus-4-6'
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929'
  | 'claude-haiku-4-5-20251001'
  | 'opus'
  | 'sonnet'
  | 'haiku';

/**
 * 模型显示名称
 */
export type ModelDisplayName =
  | 'Claude Opus 4.6'
  | 'Claude Opus 4.5'
  | 'Claude Sonnet 4.5'
  | 'Claude Haiku 4.5';

// ============ API 后端类型 ============

/**
 * API 后端提供商类型
 */
export type APIBackend = 'anthropic' | 'bedrock' | 'vertex';

/**
 * API 配置
 */
export interface APIConfig {
  /** Anthropic API 密钥 */
  apiKey?: string;

  /** OAuth Token 用于认证会话 */
  oauthToken?: string;

  /** 使用 AWS Bedrock 后端 */
  useBedrock?: boolean;

  /** 使用 Google Cloud Vertex AI 后端 */
  useVertex?: boolean;

  /** API 调用的最大重试次数 */
  maxRetries?: number;

  /** 请求超时时间（毫秒） */
  requestTimeout?: number;

  /** API 请求的 Base URL（用于自定义端点） */
  baseURL?: string;

  /** API 请求中包含的额外请求头 */
  headers?: Record<string, string>;
}

// ============ 模型配置 ============

/**
 * 模型生成参数
 */
export interface ModelConfig {
  /** 模型标识符 */
  model?: ModelName;

  /** 生成响应的最大 Token 数 */
  maxTokens?: number;

  /** 响应生成的温度参数 (0-1) */
  temperature?: number;

  /** Top-p 采样参数 */
  topP?: number;

  /** Top-k 采样参数 */
  topK?: number;

  /** 自定义系统提示覆盖 */
  systemPrompt?: string;

  /** 停止序列 */
  stopSequences?: string[];
}

// ============ 权限设置 ============

/**
 * 工具执行的权限模式
 */
export type PermissionMode =
  | 'acceptEdits'        // 自动接受文件编辑
  | 'bypassPermissions'  // 绕过所有权限检查
  | 'default'            // 每次都询问权限
  | 'delegate'           // 委托给外部系统
  | 'dontAsk'            // 不询问，使用规则
  | 'plan';              // 计划模式（不执行）

/**
 * 权限动作类型
 */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * 权限作用域
 */
export type PermissionScope = 'once' | 'session' | 'always';

/**
 * 工具级别权限设置
 */
export interface ToolPermissionSettings {
  /** 允许的工具名称列表 */
  allow?: string[];

  /** 拒绝的工具名称列表 */
  deny?: string[];
}

/**
 * 路径级别权限设置（支持 glob 模式）
 */
export interface PathPermissionSettings {
  /** 允许的路径模式列表 */
  allow?: string[];

  /** 拒绝的路径模式列表 */
  deny?: string[];
}

/**
 * Bash 工具的命令级别权限设置
 */
export interface CommandPermissionSettings {
  /** 允许的命令模式列表 */
  allow?: string[];

  /** 拒绝的命令模式列表 */
  deny?: string[];
}

/**
 * 网络权限设置
 */
export interface NetworkPermissionSettings {
  /** 允许的域名/URL 模式列表 */
  allow?: string[];

  /** 拒绝的域名/URL 模式列表 */
  deny?: string[];
}

/**
 * 审计日志配置
 */
export interface AuditSettings {
  /** 启用审计日志 */
  enabled?: boolean;

  /** 审计日志文件路径 */
  logFile?: string;

  /** 最大日志文件大小（字节） */
  maxSize?: number;

  /** 日志轮转数量 */
  rotationCount?: number;

  /** 在日志中包含敏感数据 */
  includeSensitiveData?: boolean;
}

/**
 * 完整权限配置
 */
export interface PermissionSettings {
  /** 默认权限模式 */
  mode?: PermissionMode;

  /** 工具级别权限 */
  tools?: ToolPermissionSettings;

  /** 路径级别权限 */
  paths?: PathPermissionSettings;

  /** 命令级别权限 */
  commands?: CommandPermissionSettings;

  /** 网络权限 */
  network?: NetworkPermissionSettings;

  /** 审计日志设置 */
  audit?: AuditSettings;

  /** 记住权限决策 */
  rememberDecisions?: boolean;

  /** 记住决策的默认作用域 */
  defaultScope?: PermissionScope;
}

// ============ Hook 设置 ============

/**
 * Hook 事件类型（12 个官方事件）
 */
export type HookEvent =
  | 'PreToolUse'           // 工具执行前
  | 'PostToolUse'          // 工具执行成功后
  | 'PostToolUseFailure'   // 工具执行失败后
  | 'Notification'         // 通知事件
  | 'UserPromptSubmit'     // 用户提交提示
  | 'SessionStart'         // 会话开始
  | 'SessionEnd'           // 会话结束
  | 'Stop'                 // 停止/中断事件
  | 'SubagentStart'        // 子代理启动
  | 'SubagentStop'         // 子代理停止
  | 'PreCompact'           // 上下文压缩前
  | 'PermissionRequest';   // 权限请求

/**
 * Hook 类型
 */
export type HookType = 'command' | 'url';

/**
 * 命令 Hook 配置
 */
export interface CommandHookConfig {
  /** Hook 类型 */
  type: 'command';

  /** 要执行的命令（支持环境变量替换，如 $TOOL_NAME） */
  command: string;

  /** 命令参数 */
  args?: string[];

  /** 环境变量 */
  env?: Record<string, string>;

  /** 超时时间（毫秒，默认：30000） */
  timeout?: number;

  /** 阻塞模式 - 等待完成（默认：true） */
  blocking?: boolean;

  /** 过滤事件的匹配器（工具名称或正则表达式） */
  matcher?: string;

  /** 命令执行的工作目录 */
  cwd?: string;
}

/**
 * URL Hook 配置
 */
export interface UrlHookConfig {
  /** Hook 类型 */
  type: 'url';

  /** 回调 URL */
  url: string;

  /** HTTP 方法（默认：POST） */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /** 请求头 */
  headers?: Record<string, string>;

  /** 超时时间（毫秒，默认：10000） */
  timeout?: number;

  /** 阻塞模式 - 等待响应（默认：false） */
  blocking?: boolean;

  /** 过滤事件的匹配器 */
  matcher?: string;

  /** 重试配置 */
  retry?: {
    attempts?: number;
    backoff?: number;
  };
}

/**
 * Hook 配置（联合类型）
 */
export type HookConfig = CommandHookConfig | UrlHookConfig;

/**
 * Hook 设置 - 事件到 Hook 配置的映射
 */
export interface HookSettings {
  /** Hook 事件到配置的映射 */
  [event: string]: HookConfig | HookConfig[] | boolean | number | undefined;

  /** 启用/禁用所有 Hooks */
  enabled?: boolean;

  /** 所有 Hooks 的全局超时 */
  globalTimeout?: number;

  /** 最大并发 Hook 执行数 */
  maxConcurrent?: number;
}

// ============ MCP (Model Context Protocol) 设置 ============

/**
 * MCP 服务器传输类型
 */
export type MCPTransportType = 'stdio' | 'sse' | 'http';

/**
 * MCP 服务器配置（扩展版）
 */
export interface MCPServerConfigExtended {
  /** 传输类型 */
  type: MCPTransportType;

  /** 要执行的命令（stdio 传输） */
  command?: string;

  /** 命令参数 */
  args?: string[];

  /** 环境变量 */
  env?: Record<string, string>;

  /** 服务器 URL（http/sse 传输） */
  url?: string;

  /** HTTP 请求头（http/sse 传输） */
  headers?: Record<string, string>;

  /** 服务器初始化超时（毫秒） */
  timeout?: number;

  /** 启用/禁用此服务器 */
  enabled?: boolean;

  /** 失败时自动重启 */
  autoRestart?: boolean;

  /** 最大重启次数 */
  maxRestarts?: number;
}

/**
 * MCP 设置
 */
export interface MCPSettings {
  /** 服务器名称到配置的映射 */
  servers?: Record<string, MCPServerConfigExtended>;

  /** 启用/禁用 MCP 系统 */
  enabled?: boolean;

  /** 自动发现 MCP 服务器 */
  autoDiscover?: boolean;

  /** 自动发现的搜索路径 */
  discoveryPaths?: string[];

  /** MCP 操作的全局超时（毫秒） */
  globalTimeout?: number;

  /** 最大并发 MCP 请求数 */
  maxConcurrentRequests?: number;
}

// ============ 插件设置 ============

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version: string;

  /** 插件描述 */
  description?: string;

  /** 插件作者 */
  author?: string;

  /** 插件主页 */
  homepage?: string;

  /** 插件许可证 */
  license?: string;

  /** 主入口点 */
  main?: string;

  /** 引擎要求 */
  engines?: {
    node?: string;
    'claude-code'?: string;
  };

  /** 插件依赖 */
  dependencies?: Record<string, string>;
}

/**
 * 插件配置
 */
export interface PluginConfig {
  /** 启用/禁用此插件 */
  enabled?: boolean;

  /** 插件特定设置 */
  settings?: Record<string, unknown>;

  /** 插件优先级（数值越小优先级越高） */
  priority?: number;

  /** 启动时自动加载 */
  autoLoad?: boolean;
}

/**
 * 插件设置
 */
export interface PluginSettings {
  /** 插件名称到配置的映射 */
  plugins?: Record<string, PluginConfig>;

  /** 启用/禁用插件系统 */
  enabled?: boolean;

  /** 插件搜索路径 */
  searchPaths?: string[];

  /** 从搜索路径自动加载插件 */
  autoLoad?: boolean;

  /** 沙箱插件（限制能力） */
  sandboxed?: boolean;

  /** 每个插件的最大内存（字节） */
  maxMemoryPerPlugin?: number;

  /** 插件超时（毫秒） */
  timeout?: number;
}

// ============ UI 设置 ============

/**
 * 主题类型
 */
export type ThemeType = 'dark' | 'light' | 'auto';

/**
 * 色彩方案
 */
export interface ColorScheme {
  /** 主色 */
  primary?: string;

  /** 副色 */
  secondary?: string;

  /** 成功色 */
  success?: string;

  /** 警告色 */
  warning?: string;

  /** 错误色 */
  error?: string;

  /** 信息色 */
  info?: string;

  /** 背景色 */
  background?: string;

  /** 前景/文本色 */
  foreground?: string;

  /** 边框色 */
  border?: string;
}

/**
 * UI 组件可见性设置
 */
export interface UIComponentSettings {
  /** 显示头部 */
  showHeader?: boolean;

  /** 显示状态栏 */
  showStatusBar?: boolean;

  /** 显示待办列表 */
  showTodoList?: boolean;

  /** 显示加载动画 */
  showSpinner?: boolean;

  /** 显示文件编辑的差异视图 */
  showDiffView?: boolean;

  /** 显示进度条 */
  showProgressBar?: boolean;
}

/**
 * UI 格式化设置
 */
export interface UIFormattingSettings {
  /** 启用语法高亮 */
  syntaxHighlighting?: boolean;

  /** 启用 Markdown 渲染 */
  markdownRendering?: boolean;

  /** 代码块主题 */
  codeBlockTheme?: string;

  /** 行换行 */
  lineWrapping?: boolean;

  /** 换行前的最大行长度 */
  maxLineLength?: number;

  /** 在代码块中显示行号 */
  showLineNumbers?: boolean;
}

/**
 * UI 设置
 */
export interface UISettings {
  /** 主题偏好 */
  theme?: ThemeType;

  /** 自定义色彩方案 */
  colors?: ColorScheme;

  /** 组件可见性 */
  components?: UIComponentSettings;

  /** 格式化偏好 */
  formatting?: UIFormattingSettings;

  /** 详细输出 */
  verbose?: boolean;

  /** 紧凑模式（最小 UI） */
  compact?: boolean;

  /** 动画设置 */
  animations?: {
    enabled?: boolean;
    speed?: 'slow' | 'normal' | 'fast';
  };

  /** 终端宽度覆盖 */
  terminalWidth?: number;

  /** 启用 Unicode 符号 */
  useUnicode?: boolean;
}

// ============ 遥测设置 ============

/**
 * 遥测级别
 */
export type TelemetryLevel = 'off' | 'error' | 'minimal' | 'full';

/**
 * 遥测设置
 */
export interface TelemetrySettings {
  /** 启用遥测 */
  enabled?: boolean;

  /** 遥测级别 */
  level?: TelemetryLevel;

  /** 匿名化用户数据 */
  anonymize?: boolean;

  /** 包含性能指标 */
  includePerformance?: boolean;

  /** 包含错误报告 */
  includeErrors?: boolean;

  /** 包含使用统计 */
  includeUsage?: boolean;

  /** 自定义遥测端点 */
  endpoint?: string;

  /** 遥测批次大小 */
  batchSize?: number;

  /** 遥测刷新间隔（毫秒） */
  flushInterval?: number;
}

// ============ 上下文管理设置 ============

/**
 * 上下文压缩策略
 */
export type CompressionStrategy =
  | 'summarize'        // 总结旧消息
  | 'truncate'         // 删除最旧消息
  | 'selective'        // 选择性删除不重要的内容
  | 'hybrid';          // 组合策略

/**
 * 上下文设置
 */
export interface ContextSettings {
  /** 最大上下文大小（Token） */
  maxTokens?: number;

  /** 上下文压缩阈值（百分比） */
  compressionThreshold?: number;

  /** 压缩策略 */
  compressionStrategy?: CompressionStrategy;

  /** 压缩时保留重要消息 */
  preserveImportant?: boolean;

  /** 在上下文中包含系统信息 */
  includeSystemInfo?: boolean;

  /** 在上下文中包含文件树 */
  includeFileTree?: boolean;

  /** 最大文件树深度 */
  fileTreeDepth?: number;

  /** 自动总结 */
  autoSummarize?: boolean;

  /** 总结模型 */
  summarizationModel?: ModelName;
}

// ============ 沙箱设置 ============

/**
 * 沙箱类型
 */
export type SandboxType = 'none' | 'bubblewrap' | 'docker' | 'vm';

/**
 * 沙箱设置
 */
export interface SandboxSettings {
  /** 沙箱类型 */
  type?: SandboxType;

  /** 启用沙箱 */
  enabled?: boolean;

  /** 允许的目录（绑定挂载） */
  allowedPaths?: string[];

  /** 沙箱中的网络访问 */
  allowNetwork?: boolean;

  /** 沙箱超时（毫秒） */
  timeout?: number;

  /** 资源限制 */
  limits?: {
    /** 最大 CPU 使用（核心数） */
    cpu?: number;

    /** 最大内存（字节） */
    memory?: number;

    /** 最大磁盘使用（字节） */
    disk?: number;

    /** 最大进程数 */
    processes?: number;
  };

  /** Docker 特定设置 */
  docker?: {
    /** Docker 镜像 */
    image?: string;

    /** 容器名称前缀 */
    containerPrefix?: string;

    /** 执行后删除容器 */
    autoRemove?: boolean;
  };
}

// ============ 会话设置 ============

/**
 * 会话设置
 */
export interface SessionSettings {
  /** 自动保存会话 */
  autoSave?: boolean;

  /** 保存间隔（毫秒） */
  saveInterval?: number;

  /** 会话过期时间（毫秒） */
  expirationTime?: number;

  /** 最大会话数 */
  maxSessions?: number;

  /** 会话目录 */
  sessionDir?: string;

  /** 压缩旧会话 */
  compressOld?: boolean;

  /** 在会话中包含环境 */
  includeEnvironment?: boolean;

  /** 敏感数据加密 */
  encryption?: {
    enabled?: boolean;
    algorithm?: string;
  };
}

// ============ 检查点设置 ============

/**
 * 检查点设置
 */
export interface CheckpointSettings {
  /** 启用文件检查点 */
  enabled?: boolean;

  /** 检查点目录 */
  checkpointDir?: string;

  /** 每个文件的最大检查点数 */
  maxCheckpointsPerFile?: number;

  /** 检查点保留期（毫秒） */
  retentionPeriod?: number;

  /** 自动清理旧检查点 */
  autoCleanup?: boolean;

  /** 检查点压缩 */
  compression?: boolean;
}

// ============ 工具设置 ============

/**
 * 工具特定设置
 */
export interface ToolSettings {
  /** 允许的工具列表（白名单） */
  allowedTools?: string[];

  /** 禁止的工具列表（黑名单） */
  disallowedTools?: string[];

  /** 最大并发工具执行数 */
  maxConcurrentTasks?: number;

  /** 默认工具超时（毫秒） */
  defaultTimeout?: number;

  /** 工具特定配置 */
  toolConfig?: {
    /** Bash 工具设置 */
    bash?: {
      /** 默认 Shell */
      shell?: string;

      /** Shell 参数 */
      shellArgs?: string[];

      /** 默认超时 */
      timeout?: number;

      /** 启用后台执行 */
      allowBackground?: boolean;
    };

    /** Grep 工具设置 */
    grep?: {
      /** 默认上下文行数 */
      contextLines?: number;

      /** 默认区分大小写 */
      caseSensitive?: boolean;

      /** 最大结果数 */
      maxResults?: number;
    };

    /** WebFetch 工具设置 */
    webFetch?: {
      /** User Agent */
      userAgent?: string;

      /** 跟随重定向 */
      followRedirects?: boolean;

      /** 最大重定向次数 */
      maxRedirects?: number;

      /** 超时 */
      timeout?: number;
    };

    /** WebSearch 工具设置 */
    webSearch?: {
      /** 默认搜索引擎 */
      engine?: string;

      /** 每页结果数 */
      resultsPerPage?: number;

      /** 安全搜索 */
      safeSearch?: boolean;
    };
  };
}

// ============ 通知设置 ============

/**
 * 通知设置
 */
export interface NotificationSettings {
  /** 启用通知 */
  enabled?: boolean;

  /** 要启用的通知类型 */
  types?: {
    /** 会话事件 */
    session?: boolean;

    /** 工具执行 */
    tools?: boolean;

    /** 错误 */
    errors?: boolean;

    /** 警告 */
    warnings?: boolean;

    /** 完成 */
    completion?: boolean;
  };

  /** 桌面通知 */
  desktop?: boolean;

  /** 声音通知 */
  sound?: boolean;

  /** 通知 Webhook */
  webhook?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
}

// ============ 更新设置 ============

/**
 * 更新设置
 */
export interface UpdateSettings {
  /** 启用自动更新检查 */
  autoCheck?: boolean;

  /** 检查间隔（毫秒） */
  checkInterval?: number;

  /** 自动安装更新 */
  autoInstall?: boolean;

  /** 更新渠道 */
  channel?: 'stable' | 'beta' | 'canary';

  /** 更新通知 */
  notify?: boolean;

  /** 自定义更新服务器 */
  updateServer?: string;
}

// ============ 归属设置 ============

/**
 * Git 提交和 PR 的归属设置
 */
export interface AttributionSettings {
  /**
   * Git 提交的归属文本，包括任何 trailers。
   * 空字符串隐藏归属。
   * 默认包含带有模型名称的 Co-Authored-By trailer。
   */
  commit?: string;

  /**
   * Pull Request 描述的归属文本。
   * 空字符串隐藏归属。
   * 默认包含 Axon 链接。
   */
  pr?: string;
}

// ============ 高级设置 ============

/**
 * 高级/实验性设置
 */
export interface AdvancedSettings {
  /** 默认工作目录 */
  defaultWorkingDir?: string;

  /** 调试日志目录 */
  debugLogsDir?: string;

  /** 启用实验性功能 */
  experimentalFeatures?: boolean;

  /** 功能标志 */
  features?: Record<string, boolean>;

  /** 自定义 API 端点 */
  customEndpoint?: string;

  /** 代理配置 */
  proxy?: {
    http?: string;
    https?: string;
    no?: string[];
  };

  /** 证书设置 */
  certificates?: {
    ca?: string[];
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
  };

  /** 速率限制 */
  rateLimit?: {
    enabled?: boolean;
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
}

// ============ 主配置类型 ============

/**
 * 完整的 Axon 配置
 *
 * 这是组合所有设置的主配置对象。
 * 可以从 settings.json 文件和环境变量加载。
 */
export interface ClaudeConfig {
  /** 配置版本 */
  version?: string;

  // 核心 API 设置
  /** API 密钥 */
  apiKey?: string;

  /** OAuth Token */
  oauthToken?: string;

  /** 模型选择 */
  model?: ModelName;

  /** 生成的最大 Token 数 */
  maxTokens?: number;

  /** 温度 (0-1) */
  temperature?: number;

  /** Top-p 采样 */
  topP?: number;

  /** Top-k 采样 */
  topK?: number;

  // 后端选择
  /** 使用 AWS Bedrock */
  useBedrock?: boolean;

  /** 使用 Google Vertex AI */
  useVertex?: boolean;

  // 功能开关
  /** 启用遥测 */
  enableTelemetry?: boolean;

  /** 禁用文件检查点 */
  disableFileCheckpointing?: boolean;

  /** 启用自动保存 */
  enableAutoSave?: boolean;

  // 性能设置
  /** 最大重试次数 */
  maxRetries?: number;

  /** 请求超时（毫秒） */
  requestTimeout?: number;

  /** 最大并发任务数 */
  maxConcurrentTasks?: number;

  // UI 偏好
  /** UI 主题 */
  theme?: ThemeType;

  /** 详细输出 */
  verbose?: boolean;

  // 工具过滤
  /** 允许的工具 */
  allowedTools?: string[];

  /** 禁止的工具 */
  disallowedTools?: string[];

  // 系统设置
  /** 自定义系统提示 */
  systemPrompt?: string;

  /** 默认工作目录 */
  defaultWorkingDir?: string;

  /** 调试日志目录 */
  debugLogsDir?: string;

  // ===== 嵌套配置对象 =====

  /** API 配置 */
  api?: APIConfig;

  /** 模型配置 */
  modelConfig?: ModelConfig;

  /** 权限设置 */
  permissions?: PermissionSettings;

  /** Hook 设置 */
  hooks?: HookSettings;

  /** MCP 服务器设置 */
  mcpServers?: Record<string, MCPServerConfigExtended>;

  /** MCP 全局设置 */
  mcp?: MCPSettings;

  /** 插件设置 */
  plugins?: PluginSettings;

  /** UI 设置 */
  ui?: UISettings;

  /** 遥测设置 */
  telemetry?: TelemetrySettings;

  /** 上下文管理设置 */
  context?: ContextSettings;

  /** 沙箱设置 */
  sandbox?: SandboxSettings;

  /** 会话设置 */
  session?: SessionSettings;

  /** 检查点设置 */
  checkpoint?: CheckpointSettings;

  /** 工具设置 */
  tools?: ToolSettings;

  /** 通知设置 */
  notifications?: NotificationSettings;

  /** 更新设置 */
  updates?: UpdateSettings;

  /** 高级设置 */
  advanced?: AdvancedSettings;

  /**
   * Git 提交和 Pull Request 的归属设置
   * @since 2.1.4
   */
  attribution?: AttributionSettings;

  /**
   * 已弃用：请使用 attribution。
   * 是否在提交和 PR 中包含 Claude 的 Co-authored by 归属。
   * 默认为 true。
   * @deprecated 请使用 attribution.commit 和 attribution.pr
   */
  includeCoAuthoredBy?: boolean;
}

/**
 * 用户配置（ClaudeConfig 的别名）
 *
 * 这是存储在 ~/.axon/settings.json 中的配置格式
 */
export type UserConfig = ClaudeConfig;

/**
 * 设置（ClaudeConfig 的别名）
 *
 * 配置对象的替代名称
 */
export type Settings = ClaudeConfig;

// ============ 向后兼容导出 ============

/**
 * 旧版 Config 接口（向后兼容）
 */
export interface Config {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * 会话状态
 */
export interface SessionState {
  sessionId: string;
  cwd: string;
  originalCwd?: string; // T153: 原始工作目录
  startTime: number;
  totalCostUSD: number;
  totalAPIDuration: number;
  totalAPIDurationWithoutRetries?: number; // T143: 不含重试的 API 时间
  totalToolDuration?: number; // T143: 工具执行总时间
  totalLinesAdded?: number; // 代码修改统计：添加的行数
  totalLinesRemoved?: number; // 代码修改统计：删除的行数
  modelUsage: Record<string, ModelUsageStats>; // T151: 扩展为详细统计
  alwaysAllowedTools?: string[]; // 会话级权限：总是允许的工具列表
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
}

/**
 * T151/T152: 详细的模型使用统计
 */
export interface ModelUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  thinkingTokens?: number; // 思考 Token 数（Extended Thinking）
  webSearchRequests?: number;
  requests?: number; // API 请求次数
  costUSD: number;
  contextWindow: number;
}

/**
 * 输出格式
 */
export type OutputFormat = 'text' | 'json' | 'stream-json';

/**
 * 输入格式
 */
export type InputFormat = 'text' | 'stream-json';

// ============ 环境配置 ============

/**
 * 环境变量配置
 *
 * 将环境变量映射到配置选项
 */
export interface EnvironmentConfig {
  /** ANTHROPIC_API_KEY 或 AXON_API_KEY */
  ANTHROPIC_API_KEY?: string;
  AXON_API_KEY?: string;

  /** AXON_OAUTH_TOKEN */
  AXON_OAUTH_TOKEN?: string;

  /** AXON_USE_BEDROCK */
  AXON_USE_BEDROCK?: string;

  /** AXON_USE_VERTEX */
  AXON_USE_VERTEX?: string;

  /** AXON_MAX_OUTPUT_TOKENS */
  AXON_MAX_OUTPUT_TOKENS?: string;

  /** AXON_MAX_RETRIES */
  AXON_MAX_RETRIES?: string;

  /** AXON_DEBUG_LOGS_DIR */
  AXON_DEBUG_LOGS_DIR?: string;

  /** AXON_ENABLE_TELEMETRY */
  AXON_ENABLE_TELEMETRY?: string;

  /** AXON_DISABLE_FILE_CHECKPOINTING */
  AXON_DISABLE_FILE_CHECKPOINTING?: string;

  /** AXON_CONFIG_DIR */
  AXON_CONFIG_DIR?: string;

  /** HTTP_PROXY */
  HTTP_PROXY?: string;

  /** HTTPS_PROXY */
  HTTPS_PROXY?: string;

  /** NO_PROXY */
  NO_PROXY?: string;
}

// ============ 运行时配置 ============

/**
 * 运行时配置（CLI 参数 + 环境 + 配置文件）
 *
 * 表示运行时的最终合并配置
 */
export interface RuntimeConfig extends ClaudeConfig {
  /** 当前工作目录 */
  cwd: string;

  /** 会话 ID（如果恢复） */
  sessionId?: string;

  /** 初始提示 */
  initialPrompt?: string;

  /** 打印模式（非交互式） */
  printMode?: boolean;

  /** 恢复上一个会话 */
  resume?: boolean;

  /** 自动接受所有编辑 */
  acceptEdits?: boolean;

  /** 绕过所有权限 */
  bypassPermissions?: boolean;

  /** 计划模式（不执行） */
  planMode?: boolean;

  /** 输入格式 */
  inputFormat?: 'text' | 'stream-json';

  /** 输出格式 */
  outputFormat?: 'text' | 'json' | 'stream-json';

  /** 计算开始时间 */
  startTime?: number;
}

// ============ 配置验证 ============

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  /** 验证成功 */
  valid: boolean;

  /** 验证错误 */
  errors?: Array<{
    path: string;
    message: string;
    value?: unknown;
  }>;

  /** 验证警告 */
  warnings?: Array<{
    path: string;
    message: string;
    value?: unknown;
  }>;
}

// ============ 配置迁移 ============

/**
 * 配置迁移
 */
export interface ConfigMigration {
  /** 源版本 */
  fromVersion: string;

  /** 目标版本 */
  toVersion: string;

  /** 迁移函数 */
  migrate: (config: Partial<ClaudeConfig>) => Partial<ClaudeConfig>;

  /** 迁移描述 */
  description?: string;
}

// ============ 导出常量 ============

/**
 * 默认配置值
 */
export const DEFAULT_CONFIG: Partial<ClaudeConfig> = {
  version: '2.1.33',
  model: 'opus',
  maxTokens: 32000,
  temperature: 1,
  maxRetries: 3,
  requestTimeout: 300000,
  theme: 'auto',
  verbose: false,
  enableTelemetry: false,
  disableFileCheckpointing: false,
  enableAutoSave: true,
  maxConcurrentTasks: 10,
  useBedrock: false,
  useVertex: false,
};

/**
 * 环境变量名称
 */
export const ENV_VAR_NAMES = {
  API_KEY: ['ANTHROPIC_API_KEY', 'AXON_API_KEY'],
  OAUTH_TOKEN: 'AXON_OAUTH_TOKEN',
  USE_BEDROCK: 'AXON_USE_BEDROCK',
  USE_VERTEX: 'AXON_USE_VERTEX',
  MAX_TOKENS: 'AXON_MAX_OUTPUT_TOKENS',
  MAX_RETRIES: 'AXON_MAX_RETRIES',
  DEBUG_LOGS_DIR: 'AXON_DEBUG_LOGS_DIR',
  ENABLE_TELEMETRY: 'AXON_ENABLE_TELEMETRY',
  DISABLE_CHECKPOINTING: 'AXON_DISABLE_FILE_CHECKPOINTING',
  CONFIG_DIR: 'AXON_CONFIG_DIR',
} as const;

/**
 * 配置文件路径
 */
export const CONFIG_PATHS = {
  /** 全局配置目录 */
  GLOBAL_DIR: '~/.axon',

  /** 全局配置文件 */
  GLOBAL_FILE: '~/.axon/settings.json',

  /** 项目配置目录 */
  PROJECT_DIR: '.axon',

  /** 项目配置文件 */
  PROJECT_FILE: '.axon/settings.json',

  /** 会话目录 */
  SESSION_DIR: '~/.axon/sessions',

  /** 插件目录 */
  PLUGIN_DIR: '~/.axon/plugins',

  /** Hook 目录 */
  HOOK_DIR: '~/.axon/hooks',

  /** 技能目录 */
  SKILLS_DIR: '~/.axon/skills',
} as const;

// ============ Git ������� ============

/**
 * Git ״̬��Ӧ
 */
export interface GitStatusResponsePayload {
  success: boolean;
  data?: {
    branch: string;
    isClean: boolean;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    conflictFiles: string[];
    ahead: number;
    behind: number;
    recentCommits: Array<{
      hash: string;
      message: string;
      author: string;
      date: string;
    }>;
    stashCount: number;
    remoteStatus: {
      tracking: string | null;
      ahead: number;
      behind: number;
    };
    tags: string[];
  };
  error?: string;
}

/**
 * Git ��־��Ӧ
 */
export interface GitLogResponsePayload {
  success: boolean;
  data?: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
  error?: string;
}

/**
 * Git ��֧��Ӧ
 */
export interface GitBranchesResponsePayload {
  success: boolean;
  data?: {
    current: string;
    local: string[];
    remote: string[];
  };
  error?: string;
}

/**
 * Git Stash ��Ӧ
 */
export interface GitStashesResponsePayload {
  success: boolean;
  data?: Array<{
    index: number;
    message: string;
    branch: string;
    date: string;
  }>;
  error?: string;
}

/**
 * Git �������
 */
export interface GitOperationResultPayload {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Git Diff ��Ӧ
 */
export interface GitDiffResponsePayload {
  success: boolean;
  data?: {
    diff: string;
  };
  error?: string;
}

/**
 * Git Smart Commit ��Ӧ
 */
export interface GitSmartCommitResponsePayload {
  success: boolean;
  message?: string;
  needsStaging?: boolean;
  error?: string;
}

/**
 * Git Smart Review ��Ӧ
 */
export interface GitSmartReviewResponsePayload {
  success: boolean;
  data?: {
    review: string;
  };
  error?: string;
}

/**
 * Git Explain Commit ��Ӧ
 */
export interface GitExplainCommitResponsePayload {
  success: boolean;
  data?: {
    explanation: string;
  };
  error?: string;
}

// ============ Git Enhanced Features Types ============

/**
 * Git Reset Mode
 */
export type GitResetMode = 'soft' | 'mixed' | 'hard';

/**
 * Git Merge Strategy
 */
export type GitMergeStrategy = 'no-ff' | 'squash' | 'ff-only' | 'default';

/**
 * Git Tag Type
 */
export type GitTagType = 'lightweight' | 'annotated';

/**
 * Git Tag Info
 */
export interface GitTag {
  name: string;
  commit: string;
  message?: string;
  tagger?: string;
  date?: string;
  type: GitTagType;
}

/**
 * Git Remote Info
 */
export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/**
 * Git Blame Line
 */
export interface GitBlameLine {
  lineNumber: number;
  commit: string;
  author: string;
  date: string;
  content: string;
}

/**
 * Git File History Commit
 */
export interface GitFileHistoryCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  diff?: string;
}

/**
 * Git Conflict Info
 */
export interface GitConflict {
  file: string;
  ours: string;
  theirs: string;
  base?: string;
}

/**
 * Git Merge/Rebase Status
 */
export interface GitMergeStatus {
  inProgress: boolean;
  type: 'merge' | 'rebase' | 'cherry-pick' | null;
  conflicts: string[];
  currentBranch: string;
  targetBranch?: string;
}

/**
 * Git Compare Branches Result
 */
export interface GitCompareBranches {
  ahead: number;
  behind: number;
  files: Array<{
    file: string;
    status: string;
  }>;
}

/**
 * Git Commit Search Filter
 */
export interface GitCommitSearchFilter {
  query?: string;
  author?: string;
  since?: string;
  until?: string;
  limit?: number;
}
