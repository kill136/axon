/**
 * Statusline Setup Agent
 * 配置 Axon 状态行设置
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VERSION } from '../version.js';

// ============ 类型定义 ============

/**
 * 状态行配置
 */
export interface StatuslineConfig {
  type: 'command' | 'template' | 'disabled';
  command?: string;
  template?: string;
  refreshInterval?: number;
  position?: 'top' | 'bottom';
  style?: StatuslineStyle;
}

/**
 * 状态行样式配置
 */
export interface StatuslineStyle {
  backgroundColor?: string;
  textColor?: string;
  dimmed?: boolean;
  bold?: boolean;
  separatorChar?: string;
}

/**
 * 状态行显示元素
 */
export interface StatuslineElement {
  type: 'model' | 'tokens' | 'cost' | 'duration' | 'tools' | 'cwd' |
        'session' | 'git' | 'custom' | 'context_percentage';
  format?: string;
  visible: boolean;
  label?: string;
}

/**
 * 会话上下文数据（由 statusLine 命令接收）
 */
export interface StatuslineContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  model: {
    id: string;
    display_name: string;
  };
  workspace: {
    current_dir: string;
    project_dir: string;
  };
  version: string;
  output_style: {
    name: string;
  };
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    } | null;
  };
}

/**
 * PS1 转义序列映射
 */
export const PS1_ESCAPE_MAPPINGS: Record<string, string> = {
  '\\u': '$(whoami)',
  '\\h': '$(hostname -s)',
  '\\H': '$(hostname)',
  '\\w': '$(pwd)',
  '\\W': '$(basename "$(pwd)")',
  '\\$': '$',
  '\\n': '\\n',
  '\\t': '$(date +%H:%M:%S)',
  '\\d': '$(date "+%a %b %d")',
  '\\@': '$(date +%I:%M%p)',
  '\\#': '#',
  '\\!': '!',
};

// ============ Statusline Agent 类 ============

/**
 * Statusline 代理
 * 负责配置和管理 Axon 的状态行设置
 */
export class StatuslineAgent {
  private configDir: string;
  private settingsFile: string;
  private scriptsDir: string;

  constructor() {
    // 初始化配置目录
    this.configDir = path.join(os.homedir(), '.axon');
    this.settingsFile = path.join(this.configDir, 'settings.json');
    this.scriptsDir = this.configDir;

    // 确保目录存在
    this.ensureDirectories();
  }

  /**
   * 确保必要的目录存在
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * 获取当前状态行配置
   */
  async getConfig(): Promise<StatuslineConfig | null> {
    try {
      const settings = this.readSettings();
      return settings?.statusLine || null;
    } catch (error) {
      console.error('Failed to read statusline config:', error);
      return null;
    }
  }

  /**
   * 配置状态行
   */
  async configure(config: Partial<StatuslineConfig>): Promise<void> {
    const settings = this.readSettings() || {};

    settings.statusLine = {
      ...settings.statusLine,
      ...config,
    };

    this.writeSettings(settings);
  }

  /**
   * 从 PS1 环境变量导入配置
   */
  async importFromPS1(shellConfigPath?: string): Promise<{
    success: boolean;
    ps1?: string;
    command?: string;
    error?: string;
  }> {
    try {
      // 尝试从 shell 配置文件读取 PS1
      const shellFiles = shellConfigPath ? [shellConfigPath] : [
        path.join(os.homedir(), '.zshrc'),
        path.join(os.homedir(), '.bashrc'),
        path.join(os.homedir(), '.bash_profile'),
        path.join(os.homedir(), '.profile'),
      ];

      let ps1Value: string | null = null;
      let sourceFile: string | null = null;

      // 按优先级读取
      for (const file of shellFiles) {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf-8');
          const ps1Match = content.match(/(?:^|\n)\s*(?:export\s+)?PS1\s*=\s*["']([^"']+)["']/m);

          if (ps1Match) {
            ps1Value = ps1Match[1];
            sourceFile = file;
            break;
          }
        }
      }

      if (!ps1Value) {
        return {
          success: false,
          error: 'No PS1 configuration found in shell files. Please provide manual configuration.',
        };
      }

      // 转换 PS1 为 shell 命令
      const command = this.convertPS1ToCommand(ps1Value);

      return {
        success: true,
        ps1: ps1Value,
        command,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 转换 PS1 转义序列为 shell 命令
   */
  private convertPS1ToCommand(ps1: string): string {
    let command = ps1;

    // 替换所有 PS1 转义序列
    for (const [escape, replacement] of Object.entries(PS1_ESCAPE_MAPPINGS)) {
      command = command.replace(new RegExp(escape.replace(/\\/g, '\\\\'), 'g'), replacement);
    }

    // 移除尾部的 $ 或 > 提示符
    command = command.replace(/\s*[\$>]\s*$/, '');

    // 包装为 printf 以正确处理 ANSI 颜色代码
    if (command.includes('\\033') || command.includes('\\e[')) {
      command = `printf '${command}'`;
    }

    return command;
  }

  /**
   * 创建状态行脚本文件
   */
  async createScript(
    scriptName: string,
    scriptContent: string,
    makeExecutable: boolean = true
  ): Promise<string> {
    const scriptPath = path.join(this.scriptsDir, scriptName);

    // 写入脚本内容
    fs.writeFileSync(scriptPath, scriptContent, { mode: makeExecutable ? 0o755 : 0o644 });

    return scriptPath;
  }

  /**
   * 创建预置模板脚本
   */
  async createTemplateScript(template: StatuslineTemplate): Promise<string> {
    const scriptContent = this.getTemplateScript(template);
    const scriptName = `statusline-${template}.sh`;

    return this.createScript(scriptName, scriptContent, true);
  }

  /**
   * 获取模板脚本内容
   */
  private getTemplateScript(template: StatuslineTemplate): string {
    const templates: Record<StatuslineTemplate, string> = {
      minimal: `#!/bin/bash
# Minimal statusline - model and directory only
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name')
dir=$(echo "$input" | jq -r '.workspace.current_dir' | sed "s|$HOME|~|")
printf "%s in %s" "$model" "$dir"
`,
      standard: `#!/bin/bash
# Standard statusline - model, directory, and context usage
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name')
dir=$(echo "$input" | jq -r '.workspace.current_dir' | sed "s|$HOME|~|")
usage=$(echo "$input" | jq '.context_window.current_usage')

if [ "$usage" != "null" ]; then
  current=$(echo "$usage" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
  size=$(echo "$input" | jq '.context_window.context_window_size')
  pct=$((current * 100 / size))
  printf "%s in %s (%d%% context)" "$model" "$dir" "$pct"
else
  printf "%s in %s" "$model" "$dir"
fi
`,
      detailed: `#!/bin/bash
# Detailed statusline - full information with git branch
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name')
dir=$(echo "$input" | jq -r '.workspace.current_dir' | sed "s|$HOME|~|")
style=$(echo "$input" | jq -r '.output_style.name')
usage=$(echo "$input" | jq '.context_window.current_usage')

# Get git branch if in a git repo
git_branch=""
project_dir=$(echo "$input" | jq -r '.workspace.project_dir')
if [ -d "$project_dir/.git" ]; then
  git_branch=$(cd "$project_dir" && git branch --show-current 2>/dev/null)
  if [ -n "$git_branch" ]; then
    git_branch=" [$git_branch]"
  fi
fi

# Calculate context percentage
context_info=""
if [ "$usage" != "null" ]; then
  current=$(echo "$usage" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
  size=$(echo "$input" | jq '.context_window.context_window_size')
  pct=$((current * 100 / size))
  context_info=" | \${pct}% ctx"
fi

printf "%s in %s%s | %s%s" "$model" "$dir" "$git_branch" "$style" "$context_info"
`,
      custom: `#!/bin/bash
# Custom statusline template - modify as needed
input=$(cat)

# Extract available data
model=$(echo "$input" | jq -r '.model.display_name')
model_id=$(echo "$input" | jq -r '.model.id')
dir=$(echo "$input" | jq -r '.workspace.current_dir')
project=$(echo "$input" | jq -r '.workspace.project_dir')
session=$(echo "$input" | jq -r '.session_id')
version=$(echo "$input" | jq -r '.version')
style=$(echo "$input" | jq -r '.output_style.name')

# Context window data
total_in=$(echo "$input" | jq '.context_window.total_input_tokens')
total_out=$(echo "$input" | jq '.context_window.total_output_tokens')
window_size=$(echo "$input" | jq '.context_window.context_window_size')
current_usage=$(echo "$input" | jq '.context_window.current_usage')

# Build your custom statusline here
printf "Custom: %s in %s" "$model" "$dir"
`,
    };

    return templates[template];
  }

  /**
   * 重置为默认配置
   */
  async resetToDefault(): Promise<void> {
    const settings = this.readSettings() || {};
    delete settings.statusLine;
    this.writeSettings(settings);
  }

  /**
   * 预览状态行（使用模拟数据）
   */
  async preview(command?: string): Promise<string> {
    const config = await this.getConfig();
    const cmdToTest = command || config?.command;

    if (!cmdToTest) {
      return 'No statusline command configured';
    }

    // 创建模拟的上下文数据
    const mockContext: StatuslineContext = {
      session_id: 'preview-session',
      transcript_path: '/tmp/preview.json',
      cwd: process.cwd(),
      model: {
        id: 'claude-sonnet-4-5-20250929',
        display_name: 'Claude 3.5 Sonnet',
      },
      workspace: {
        current_dir: process.cwd(),
        project_dir: process.cwd(),
      },
      version: VERSION,
      output_style: {
        name: 'default',
      },
      context_window: {
        total_input_tokens: 15000,
        total_output_tokens: 5000,
        context_window_size: 200000,
        current_usage: {
          input_tokens: 12000,
          output_tokens: 3000,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 1000,
        },
      },
    };

    try {
      // 如果是脚本文件，执行它
      if (cmdToTest.startsWith('/') || cmdToTest.startsWith('~/')) {
        const { execSync } = await import('child_process');
        const result = execSync(cmdToTest, {
          input: JSON.stringify(mockContext),
          encoding: 'utf-8',
          timeout: 5000,
        });
        return result.trim();
      }

      // 否则作为内联命令执行
      const { execSync } = await import('child_process');
      const result = execSync(`echo '${JSON.stringify(mockContext)}' | ${cmdToTest}`, {
        encoding: 'utf-8',
        shell: '/bin/bash',
        timeout: 5000,
      });
      return result.trim();
    } catch (error) {
      return `Preview error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * 读取设置文件
   */
  private readSettings(): Record<string, any> | null {
    try {
      // 检查是否是符号链接
      let targetFile = this.settingsFile;
      if (fs.lstatSync(this.settingsFile).isSymbolicLink()) {
        targetFile = fs.readlinkSync(this.settingsFile);
        if (!path.isAbsolute(targetFile)) {
          targetFile = path.join(path.dirname(this.settingsFile), targetFile);
        }
      }

      if (!fs.existsSync(targetFile)) {
        return null;
      }

      const content = fs.readFileSync(targetFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to read settings:', error);
      return null;
    }
  }

  /**
   * 写入设置文件
   */
  private writeSettings(settings: Record<string, any>): void {
    try {
      // 检查是否是符号链接
      let targetFile = this.settingsFile;
      if (fs.existsSync(this.settingsFile) && fs.lstatSync(this.settingsFile).isSymbolicLink()) {
        targetFile = fs.readlinkSync(this.settingsFile);
        if (!path.isAbsolute(targetFile)) {
          targetFile = path.join(path.dirname(this.settingsFile), targetFile);
        }
      }

      // 确保目录存在
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(targetFile, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 验证命令是否安全
   */
  validateCommand(command: string): { valid: boolean; error?: string } {
    // 基本安全检查
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /:\(\)\{.*\};:/,  // Fork bomb
      /eval/,
      /\$\(.*rm.*\)/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          valid: false,
          error: 'Command contains potentially dangerous patterns',
        };
      }
    }

    return { valid: true };
  }
}

// ============ 预设模板类型 ============

export type StatuslineTemplate = 'minimal' | 'standard' | 'detailed' | 'custom';

// ============ Agent 系统提示词 ============

export const STATUSLINE_AGENT_SYSTEM_PROMPT = `You are a status line setup agent for Axon. Your job is to create or update the statusLine command in the user's Axon settings.

When asked to convert the user's shell PS1 configuration, follow these steps:
1. Read the user's shell configuration files in this order of preference:
   - ~/.zshrc
   - ~/.bashrc
   - ~/.bash_profile
   - ~/.profile

2. Extract the PS1 value using this regex pattern: /(?:^|\\n)\\s*(?:export\\s+)?PS1\\s*=\\s*["']([^"']+)["']/m

3. Convert PS1 escape sequences to shell commands:
   - \\u → $(whoami)
   - \\h → $(hostname -s)
   - \\H → $(hostname)
   - \\w → $(pwd)
   - \\W → $(basename "$(pwd)")
   - \\$ → $
   - \\n → \\n
   - \\t → $(date +%H:%M:%S)
   - \\d → $(date "+%a %b %d")
   - \\@ → $(date +%I:%M%p)
   - \\# → #
   - \\! → !

4. When using ANSI color codes, be sure to use \`printf\`. Do not remove colors. Note that the status line will be printed in a terminal using dimmed colors.

5. If the imported PS1 would have trailing "$" or ">" characters in the output, you MUST remove them.

6. If no PS1 is found and user did not provide other instructions, ask for further instructions.

How to use the statusLine command:
1. The statusLine command will receive the following JSON input via stdin:
   {
     "session_id": "string", // Unique session ID
     "transcript_path": "string", // Path to the conversation transcript
     "cwd": "string",         // Current working directory
     "model": {
       "id": "string",           // Model ID (e.g., "claude-3-5-sonnet-20241022")
       "display_name": "string"  // Display name (e.g., "Claude 3.5 Sonnet")
     },
     "workspace": {
       "current_dir": "string",  // Current working directory path
       "project_dir": "string"   // Project root directory path
     },
     "version": "string",        // Axon app version (e.g., "1.0.71")
     "output_style": {
       "name": "string",         // Output style name (e.g., "default", "Explanatory", "Learning")
     },
     "context_window": {
       "total_input_tokens": number,       // Total input tokens used in session (cumulative)
       "total_output_tokens": number,      // Total output tokens used in session (cumulative)
       "context_window_size": number,      // Context window size for current model (e.g., 200000)
       "current_usage": {                   // Token usage from last API call (null if no messages yet)
         "input_tokens": number,           // Input tokens for current context
         "output_tokens": number,          // Output tokens generated
         "cache_creation_input_tokens": number,  // Tokens written to cache
         "cache_read_input_tokens": number       // Tokens read from cache
       } | null
     }
   }

   You can use this JSON data in your command like:
   - $(cat | jq -r '.model.display_name')
   - $(cat | jq -r '.workspace.current_dir')
   - $(cat | jq -r '.output_style.name')

   Or store it in a variable first:
   - input=$(cat); echo "$(echo "$input" | jq -r '.model.display_name') in $(echo "$input" | jq -r '.workspace.current_dir')"

   To calculate context window percentage, use current_usage (current context) not the cumulative totals:
   - input=$(cat); usage=$(echo "$input" | jq '.context_window.current_usage'); if [ "$usage" != "null" ]; then current=$(echo "$usage" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens'); size=$(echo "$input" | jq '.context_window.context_window_size'); pct=$((current * 100 / size)); printf '%d%% context' "$pct"; fi

2. For longer commands, you can save a new file in the user's ~/.axon directory, e.g.:
   - ~/.axon/statusline-command.sh and reference that file in the settings.

3. Update the user's ~/.axon/settings.json with:
   {
     "statusLine": {
       "type": "command",
       "command": "your_command_here"
     }
   }

4. If ~/.axon/settings.json is a symlink, update the target file instead.

Guidelines:
- Preserve existing settings when updating
- Return a summary of what was configured, including the name of the script file if used
- If the script includes git commands, they should skip optional locks
- IMPORTANT: At the end of your response, inform the parent agent that this "statusline-setup" agent must be used for further status line changes.
  Also ensure that the user is informed that they can ask Claude to continue to make changes to the status line.
`;

// ============ Agent 配置 ============

export const STATUSLINE_AGENT_CONFIG = {
  agentType: 'statusline-setup',
  whenToUse: 'Use this agent to configure the user\'s Axon status line setting.',
  tools: ['Read', 'Edit'],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'sonnet',
  color: 'orange',
  systemPrompt: STATUSLINE_AGENT_SYSTEM_PROMPT,
};

// ============ 导出默认实例 ============

export const statuslineAgent = new StatuslineAgent();

// ============ 辅助函数 ============

/**
 * 创建简单的内联状态行命令
 */
export function createInlineCommand(elements: StatuslineElement[]): string {
  const parts: string[] = [];

  for (const element of elements) {
    if (!element.visible) continue;

    switch (element.type) {
      case 'model':
        parts.push('$(cat | jq -r \'.model.display_name\')');
        break;
      case 'cwd':
        parts.push('$(cat | jq -r \'.workspace.current_dir\' | sed "s|$HOME|~|")');
        break;
      case 'session':
        parts.push('$(cat | jq -r \'.session_id\' | cut -c1-8)');
        break;
      case 'context_percentage':
        parts.push('$(input=$(cat); usage=$(echo "$input" | jq \'.context_window.current_usage\'); if [ "$usage" != "null" ]; then current=$(echo "$usage" | jq \'.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens\'); size=$(echo "$input" | jq \'.context_window.context_window_size\'); pct=$((current * 100 / size)); printf \'%d%% ctx\' "$pct"; fi)');
        break;
      case 'custom':
        if (element.format) {
          parts.push(element.format);
        }
        break;
    }
  }

  return parts.join(' | ');
}

/**
 * 解析并验证 statusline 命令
 */
export function parseStatuslineCommand(command: string): {
  valid: boolean;
  uses_jq: boolean;
  uses_git: boolean;
  complexity: 'simple' | 'medium' | 'complex';
  warnings?: string[];
} {
  const warnings: string[] = [];

  const uses_jq = command.includes('jq');
  const uses_git = command.includes('git');

  // 检测复杂度
  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  const pipeCount = (command.match(/\|/g) || []).length;
  const commandSubstCount = (command.match(/\$\(/g) || []).length;

  if (pipeCount > 3 || commandSubstCount > 5) {
    complexity = 'complex';
    warnings.push('Complex command may have performance impact');
  } else if (pipeCount > 1 || commandSubstCount > 2) {
    complexity = 'medium';
  }

  // 检查 jq 依赖
  if (uses_jq) {
    warnings.push('Requires jq to be installed');
  }

  return {
    valid: true,
    uses_jq,
    uses_git,
    complexity,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
