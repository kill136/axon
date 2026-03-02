#!/usr/bin/env python3
"""
Batch translate Chinese console.log/error/warn messages to English in web server modules
"""
import re
import sys
from pathlib import Path

# Translation dictionary
TRANSLATIONS = {
    # api-manager.ts
    "未配置认证，请在设置页面配置 API Key 或登录 OAuth": "No authentication configured, please configure API Key or login with OAuth in settings",
    "初始化客户端失败": "Failed to initialize client",
    "获取模型列表失败": "Failed to get model list",
    "获取API状态失败": "Failed to get API status",
    "获取Provider信息失败": "Failed to get provider info",
    
    # checkpoint-manager.ts
    "加载检查点 .* 失败": "Failed to load checkpoint",
    "已加载 .* 个检查点": "Loaded {count} checkpoints",
    "加载检查点目录失败": "Failed to load checkpoints directory",
    "文件不存在": "File does not exist",
    "读取文件 .* 失败": "Failed to read file",
    "创建检查点": "Created checkpoint",
    "个文件": "files",
    "恢复文件": "Restoring file",
    "恢复文件 .* 失败": "Failed to restore file",
    "删除检查点": "Deleted checkpoint",
    "清除所有检查点": "Cleared all checkpoints",
    "个": "",
    "比较文件 .* 失败": "Failed to compare file",
    
    # conversation.ts
    "插件市场管理器已初始化": "Plugin marketplace manager initialized",
    "认证类型": "Auth type",
    "未配置认证，等待用户在设置页面配置 API Key 或登录 OAuth": "No authentication configured, waiting for user to configure API Key or login with OAuth in settings",
    "Chrome MCP 服务器 .* 已禁用，跳过工具加载": "Chrome MCP server {name} disabled, skipping tool loading",
    "Chrome MCP 工具已加载": "Chrome MCP tools loaded",
    "Chrome 集成加载失败": "Failed to load Chrome integration",
    "MCP 服务器初始化失败": "Failed to initialize MCP server",
    "初始化 MemorySearchManager": "Initializing MemorySearchManager",
    "初始化 MemorySearchManager 失败": "Failed to initialize MemorySearchManager",
    "已注册 .* 个工具": "Registered {count} tools",
    "检测到认证凭据变更，重建客户端": "Detected auth credentials change, rebuilding client",
    "OAuth token 缺少 user:inference scope，尝试自动创建 API Key...": "OAuth token missing user:inference scope, attempting to auto-create API Key...",
    "OAuth API Key 已自动创建，重新构建客户端": "OAuth API Key auto-created, rebuilding client",
    "createOAuthApiKey 返回 null，推理可能失败": "createOAuthApiKey returned null, inference may fail",
    "自动创建 API Key 失败": "Failed to auto-create API Key",
    "客户端已使用刷新后的 OAuth 凭证": "Client now using refreshed OAuth credentials",
    "更新会话 .* 工作目录": "Updated session {id} working directory",
    "创建新会话": "Creating new session",
    "workingDir": "workingDir",
    "permissionMode": "permissionMode",
    "初始化 session memory": "Initializing session memory",
    "初始化 session memory 失败": "Failed to initialize session memory",
    "初始化 NotebookManager": "Initializing NotebookManager",
    "初始化 NotebookManager 失败": "Failed to initialize NotebookManager",
    "会话 .* 正在处理中，WebSocket 被新连接替换（可能是页面刷新或多标签页）": "Session {id} is processing, WebSocket replaced by new connection (possibly page refresh or multiple tabs)",
    "会话 .* 处理中 ws 被替换，标记完成后重发 history": "Session {id} processing, ws replaced, will resend history after completion",
    "权限配置已更新": "Permission config updated",
    "权限配置更新失败: 会话 .* 不存在": "Failed to update permission config: session {id} not found",
    "插话取消超时，强制重置 isProcessing": "Interject cancellation timeout, forcing isProcessing reset",
    "对话结束，自动禁用临时 MCP 服务器": "Conversation ended, auto-disabling temporary MCP server",
    "自动禁用 MCP 服务器 .* 失败": "Failed to auto-disable MCP server {name}",
    "OAuth token 刷新失败": "OAuth token refresh failed",
    "触发压缩": "Triggered compaction",
    "lastActualTokens": "lastActualTokens",
    "threshold": "threshold",
    "检测到孤立 tool_result，扩展 messagesToKeep 从索引": "Detected orphaned tool_result, extending messagesToKeep from index",
    "上下文已压缩": "Context compacted",
    "记忆整理失败": "Memory consolidation failed",
    
    # Common translations
    "服务器启动": "Server started",
    "监听端口": "listening on port",
    "客户端连接": "Client connected",
    "客户端断开": "Client disconnected",
    "原因": "reason",
    "错误": "Error",
    "消息解析失败": "Message parsing failed",
    "忽略无效初始化消息": "Ignoring invalid initialization message",
    "初始化对话": "Initializing conversation",
    "模型": "model",
    "用户请求清空对话历史": "User requested to clear conversation history",
    "初始化对话失败": "Failed to initialize conversation",
    "忽略未初始化的消息": "Ignoring message from uninitialized client",
    "用户消息": "User message",
    "对话处理失败": "Conversation handling failed",
    "切换语言": "Switching locale",
    "切换语言失败": "Failed to switch locale",
    "获取技能列表失败": "Failed to get skills list",
    "获取技能详情失败": "Failed to get skill details",
    "添加技能失败": "Failed to add skill",
    "删除技能失败": "Failed to delete skill",
    "更新技能失败": "Failed to update skill",
    "发送消息到客户端失败": "Failed to send message to client",
    "未找到会话信息": "Session not found",
    "恢复会话成功": "Session resumed successfully",
    "恢复会话失败": "Failed to resume session",
    "获取会话列表失败": "Failed to get sessions list",
    "删除会话失败": "Failed to delete session",
    "导出会话失败": "Failed to export session",
    "导入会话失败": "Failed to import session",
    "OAuth 登录已启动": "OAuth login initiated",
    "OAuth 登录失败": "OAuth login failed",
    "轮询授权码成功": "Authorization code polling succeeded",
    "轮询授权码失败": "Authorization code polling failed",
    "OAuth 登出成功": "OAuth logout succeeded",
    "OAuth 登出失败": "OAuth logout failed",
    "Token 已刷新": "Token refreshed",
    "刷新 Token 失败": "Failed to refresh token",
    "获取认证状态失败": "Failed to get auth status",
    "清除认证失败": "Failed to clear auth",
    "获取用户角色失败": "Failed to get user roles",
    "创建检查点失败": "Failed to create checkpoint",
    "获取检查点列表失败": "Failed to get checkpoints list",
    "获取检查点失败": "Failed to get checkpoint",
    "恢复检查点失败": "Failed to restore checkpoint",
    "删除检查点失败": "Failed to delete checkpoint",
    "对比检查点失败": "Failed to compare checkpoint",
    "获取检查点统计失败": "Failed to get checkpoint stats",
    "清理检查点数": "Cleaned checkpoints count",
    "清理检查点失败": "Failed to cleanup checkpoints",
    "创建终端会话": "Creating terminal session",
    "创建终端失败": "Failed to create terminal",
    "终端会话已销毁": "Terminal session destroyed",
    "销毁终端失败": "Failed to destroy terminal",
    "蓝图不存在": "Blueprint not found",
    "客户端已订阅蓝图": "Client subscribed to blueprint",
    "取消订阅失败": "Failed to unsubscribe",
    "客户端取消订阅": "Client unsubscribed",
    "停止蓝图执行": "Stopping blueprint execution",
    "停止蓝图失败": "Failed to stop blueprint",
    "重试任务": "Retrying task",
    "重试任务失败": "Failed to retry task",
    "跳过任务": "Skipping task",
    "跳过任务失败": "Failed to skip task",
    "用户插嘴": "User interjection",
    "用户插嘴失败": "Failed to interject",
    "未知消息类型": "Unknown message type",
    "处理消息失败": "Failed to handle message",
    
    # terminal-manager.ts
    "node-pty 不可用，将使用 child_process 回退方案": "node-pty unavailable, using child_process fallback",
    "创建终端会话": "Creating terminal session",
    "使用回退方案": "Using fallback",
    "写入失败": "Write failed",
    "调整大小失败": "Resize failed",
    "会话已销毁": "Session destroyed",
    
    # task-manager.ts
    "自动清理 .* 个过期任务": "Auto-cleaned {count} expired tasks",
    "发送任务状态失败": "Failed to send task status",
    "发送子 agent 工具开始事件失败": "Failed to send subagent tool start event",
    "发送子 agent 工具结束事件失败": "Failed to send subagent tool end event",
    "启动任务": "Starting task",
    "Prompt": "Prompt",
    "Tool #": "Tool #",
    "Input": "Input",
    "Tool": "Tool",
    "Error": "Error",
    "Result": "Result",
    "任务完成": "Task completed",
    "耗时": "Duration",
    "工具调用": "Tool calls",
    "次": "times",
    "结果": "Result",
    "任务失败": "Task failed",
    
    # project-map-generator.ts
    "懒加载文件符号": "Lazy loading file symbols",
    "加载了 .* 个符号": "Loaded {count} symbols",
    
    # web-auth.ts
    "OAuth token 即将过期，自动刷新...": "OAuth token expiring soon, auto-refreshing...",
    "OAuth token 刷新成功": "OAuth token refreshed successfully",
    "OAuth token 刷新失败": "OAuth token refresh failed",
    "设置 API Key 失败": "Failed to set API Key",
    "清除 API Key 失败": "Failed to clear API Key",
    
    # oauth-manager.ts
    "OAuth 配置已保存": "OAuth config saved",
    "保存 OAuth 配置失败": "Failed to save OAuth config",
    "OAuth 配置已清除": "OAuth config cleared",
    "清除 OAuth 配置失败": "Failed to clear OAuth config",
    "用户已登出": "User logged out",
    
    # index.ts
    "启动 Web 服务器": "Starting web server",
    "SSL 证书已加载": "SSL certificate loaded",
    "无法加载 SSL 证书": "Failed to load SSL certificate",
    "将使用 HTTP": "Using HTTP",
    "Web 服务器启动在": "Web server started on",
    "警告: 前端未构建，请先运行": "Warning: Frontend not built, please run",
    "前端未构建": "Frontend not built",
    
    # config-api.ts
    "成功获取所有配置": "Successfully retrieved all config",
    "获取所有配置失败": "Failed to get all config",
    "成功获取配置键": "Successfully retrieved config key",
    "获取配置键失败": "Failed to get config key",
    "缺少配置键": "Missing config key",
    "成功更新配置": "Successfully updated config",
    "更新配置失败": "Failed to update config",
    "缺少更新数据": "Missing update data",
    "成功重置配置": "Successfully reset config",
    "重置配置失败": "Failed to reset config",
    "成功获取配置验证结果": "Successfully retrieved config validation results",
    "获取配置验证结果失败": "Failed to get config validation results",
    "成功获取配置来源": "Successfully retrieved config source",
    "获取配置来源失败": "Failed to get config source",
    "成功获取所有配置来源": "Successfully retrieved all config sources",
    "获取所有配置来源失败": "Failed to get all config sources",
    "成功获取备份列表": "Successfully retrieved backup list",
    "获取备份列表失败": "Failed to get backup list",
    "缺少备份 ID": "Missing backup ID",
    "需要确认恢复操作": "Restore operation requires confirmation",
    "成功从备份 .* 恢复配置": "Successfully restored config from backup {id}",
    "恢复配置失败": "Failed to restore config",
    "配置 API 路由已设置": "Config API routes configured",
    
    # file-api.ts
    "文件不存在": "File does not exist",
    "目录不存在": "Directory does not exist",
    "下载文件流错误": "File download stream error",
    "下载文件失败": "Failed to download file",
    "读取文件失败": "Failed to read file",
    
    # config-service.ts
    "保存用户配置失败": "Failed to save user config",
    "保存项目配置失败": "Failed to save project config",
    "保存本地配置失败": "Failed to save local config",
    
    # api.ts
    "无效的API密钥格式": "Invalid API key format",
    "API密钥有效": "API key valid",
    "API密钥无效": "API key invalid",
    "验证API密钥失败": "Failed to validate API key",
    "未知错误": "Unknown error",
    
    # ai-editor.ts
    "缓存未命中，调用 Claude API": "Cache miss, calling Claude API",
    "缓存命中": "Cache hit",
    "代码导游分析失败": "Code tour analysis failed",
    "编辑器内容为空": "Editor content empty",
    "选中代码提问失败": "Code selection inquiry failed",
    "代码复杂度分析失败": "Code complexity analysis failed",
    "重构建议失败": "Refactoring suggestions failed",
    "AI 气泡注释失败": "AI bubble comment failed",
    "Git 信息分析失败": "Git info analysis failed",
    
    # blueprint-api.ts
    "创建蓝图失败": "Failed to create blueprint",
    "获取蓝图失败": "Failed to get blueprint",
    "更新蓝图失败": "Failed to update blueprint",
    "删除蓝图失败": "Failed to delete blueprint",
    "启动执行失败": "Failed to start execution",
    "停止执行失败": "Failed to stop execution",
    "恢复执行失败": "Failed to resume execution",
    "获取执行状态失败": "Failed to get execution status",
    "获取任务详情失败": "Failed to get task details",
    "重试任务失败": "Failed to retry task",
    "跳过任务失败": "Failed to skip task",
    "用户插嘴失败": "Failed to send user interjection",
    "生成分析失败": "Failed to generate analysis",
    "LeadAgent 已在运行": "LeadAgent already running",
    "LeadAgent 执行失败": "LeadAgent execution failed",
    "恢复 LeadAgent 执行": "Resuming LeadAgent execution",
    
    # permission-handler.ts
    "权限检查": "Permission check",
    "工具": "tool",
    "路径": "path",
    "结果": "result",
    
    # user-interaction.ts
    "用户交互请求超时": "User interaction request timeout",
    "用户交互失败": "User interaction failed",
    
    # swarm-logs.ts
    "Swarm 日志数据库初始化失败": "Failed to initialize swarm logs database",
    "Swarm 日志数据库已初始化": "Swarm logs database initialized",
    "保存日志失败": "Failed to save log",
    "查询日志失败": "Failed to query logs",
    "清理日志失败": "Failed to cleanup logs",
    
    # coordinator.ts (trpc)
    "LeadAgent 正在运行": "LeadAgent is running",
    "LeadAgent 未运行": "LeadAgent not running",
    "停止 LeadAgent": "Stopping LeadAgent",
    "恢复 LeadAgent": "Resuming LeadAgent",
    
    # autocomplete-api.ts
    "自动补全失败": "Autocomplete failed",
    "缓存命中": "Cache hit",
    "缓存未命中": "Cache miss",
    
    # ai-hover.ts
    "Hover 提示失败": "Hover hint failed",
    
    # lsp-analyzer.ts
    "LSP 分析失败": "LSP analysis failed",
    
    # session-manager.ts
    "会话管理器初始化": "Session manager initialized",
    
    # gemini-image-service.ts
    "Gemini 图片服务未配置": "Gemini image service not configured",
    "Gemini 图片分析失败": "Gemini image analysis failed",
    "图片分析成功": "Image analysis successful",
    "使用缓存的分析结果": "Using cached analysis result",
    "保存分析结果到缓存": "Saving analysis result to cache",
    "图片文件不存在": "Image file does not exist",
    "不支持的图片格式": "Unsupported image format",
    "图片文件过大": "Image file too large",
    "读取图片文件失败": "Failed to read image file",
}

def translate_line(line):
    """Translate a single line containing console log"""
    for cn, en in TRANSLATIONS.items():
        # Handle regex patterns in Chinese
        if '.*' in cn:
            pattern = cn.replace('.*', '(.*?)')
            match = re.search(pattern, line)
            if match:
                # Replace with English, preserving captured groups
                replacement = en
                for i, group in enumerate(match.groups(), 1):
                    replacement = replacement.replace(f'{{count}}', group).replace(f'{{id}}', group).replace(f'{{name}}', group)
                line = line.replace(match.group(0), replacement)
        else:
            line = line.replace(cn, en)
    return line

def process_file(file_path):
    """Process a single TypeScript file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        lines = content.split('\n')
        modified = False
        new_lines = []
        
        for line in lines:
            # Only process lines with console.log/error/warn and Chinese characters
            if re.search(r'console\.(log|error|warn)', line) and re.search(r'[\u4e00-\u9fa5]', line):
                new_line = translate_line(line)
                if new_line != line:
                    modified = True
                    print(f"  {file_path.name}: Translated line")
                new_lines.append(new_line)
            else:
                new_lines.append(line)
        
        if modified:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(new_lines))
            return True
        return False
    except Exception as e:
        print(f"Error processing {file_path}: {e}", file=sys.stderr)
        return False

def main():
    # Target files list
    target_files = [
        "websocket.ts",
        "conversation.ts",
        "routes/blueprint-api.ts",
        "routes/ai-editor.ts",
        "routes/api.ts",
        "routes/config-api.ts",
        "routes/file-api.ts",
        "services/config-service.ts",
        "index.ts",
        "oauth-manager.ts",
        "checkpoint-manager.ts",
        "terminal-manager.ts",
        "task-manager.ts",
        "routes/project-map-generator.ts",
        "web-auth.ts",
        "api-manager.ts",
        "database/swarm-logs.ts",
        "trpc/routers/coordinator.ts",
        "user-interaction.ts",
        "permission-handler.ts",
        "routes/autocomplete-api.ts",
        "routes/ai-hover.ts",
        "routes/lsp-analyzer.ts",
        "session-manager.ts",
        "services/gemini-image-service.ts",
        "handlers/types.ts",
    ]
    
    base_dir = Path("F:/claude-code-open/src/web/server")
    modified_count = 0
    
    for rel_path in target_files:
        file_path = base_dir / rel_path
        if file_path.exists():
            if process_file(file_path):
                modified_count += 1
                print(f"✓ Modified: {rel_path}")
        else:
            print(f"✗ Not found: {rel_path}", file=sys.stderr)
    
    print(f"\nTotal modified: {modified_count} files")

if __name__ == "__main__":
    main()
