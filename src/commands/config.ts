/**
 * 配置命令 - config, permissions, memory, hooks, model, init
 */

import type { SlashCommand, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 获取配置目录
const getConfigDir = () => path.join(os.homedir(), '.axon');
const getConfigFile = () => path.join(getConfigDir(), 'settings.json');

// 确保配置目录存在
const ensureConfigDir = () => {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// 读取配置
const readConfig = (): Record<string, any> => {
  const configFile = getConfigFile();
  if (fs.existsSync(configFile)) {
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
};

// 写入配置
const writeConfig = (config: Record<string, any>): boolean => {
  try {
    ensureConfigDir();
    fs.writeFileSync(getConfigFile(), JSON.stringify(config, null, 2));
    return true;
  } catch {
    return false;
  }
};

// 定义所有可配置项及其默认值和说明
interface ConfigItem {
  key: string;
  defaultValue: any;
  description: string;
  type: string;
  example?: string;
}

const CONFIG_ITEMS: ConfigItem[] = [
  {
    key: 'model',
    defaultValue: 'sonnet',
    description: 'Default AI model to use',
    type: 'string',
    example: 'sonnet, opus, haiku'
  },
  {
    key: 'theme',
    defaultValue: 'dark',
    description: 'Color theme for the interface',
    type: 'string',
    example: 'dark, light'
  },
  {
    key: 'verbose',
    defaultValue: false,
    description: 'Enable verbose logging',
    type: 'boolean',
    example: 'true, false'
  },
  {
    key: 'maxTokens',
    defaultValue: 32000,
    description: 'Maximum output tokens per request',
    type: 'number',
    example: '4096, 8192, 16384, 32000'
  },
  {
    key: 'autoCompact',
    defaultValue: true,
    description: 'Automatically compact context when needed',
    type: 'boolean',
    example: 'true, false'
  },
  {
    key: 'defaultPermissionMode',
    defaultValue: 'default',
    description: 'Default permission mode for tool execution',
    type: 'string',
    example: 'default, acceptEdits, bypassPermissions'
  },
  {
    key: 'outputStyle',
    defaultValue: 'default',
    description: 'AI output style preference',
    type: 'string',
    example: 'default, concise, detailed, code-first'
  },
  {
    key: 'mcpServers',
    defaultValue: {},
    description: 'MCP server configurations',
    type: 'object',
    example: '{"server1": {...}}'
  },
  {
    key: 'hooks',
    defaultValue: {},
    description: 'Hook configurations for automation',
    type: 'object',
    example: '{"PreToolUse": [...]}'
  },
  {
    key: 'allowedTools',
    defaultValue: [],
    description: 'List of explicitly allowed tools',
    type: 'array',
    example: '["Bash", "Read", "Write"]'
  },
  {
    key: 'disallowedTools',
    defaultValue: [],
    description: 'List of explicitly disallowed tools',
    type: 'array',
    example: '["WebSearch", "WebFetch"]'
  }
];

// /config - 配置管理 (官方风格 - 打开配置面板)
export const configCommand: SlashCommand = {
  name: 'config',
  aliases: ['settings'],
  description: 'Manage Axon configuration settings',
  usage: '/config [get <key>|set <key> <value>|reset [key]|list]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const configFile = getConfigFile();
    let config = readConfig();

    // 无参数时显示交互式配置面板信息
    if (args.length === 0) {
      const configInfo = `╭─ Configuration ─────────────────────────────────────╮
│                                                     │
│  Settings Location:                                 │
│    ~/.axon/settings.json                          │
│                                                     │
│  Current Settings:                                  │
│    model             ${(config.model || 'sonnet').toString().padEnd(28)} │
│    theme             ${(config.theme || 'dark').toString().padEnd(28)} │
│    verbose           ${(config.verbose ?? false).toString().padEnd(28)} │
│    maxTokens         ${(config.maxTokens || 32000).toString().padEnd(28)} │
│    autoCompact       ${(config.autoCompact ?? true).toString().padEnd(28)} │
│    defaultPermission ${(config.defaultPermissionMode || 'default').toString().padEnd(28)} │
│    outputStyle       ${(config.outputStyle || 'default').toString().padEnd(28)} │
│                                                     │
│  Commands:                                          │
│    /config                    Show this panel       │
│    /config list               List all settings    │
│    /config search <term>      Search settings      │
│    /config get <key>          View a setting        │
│    /config set <key> <value>  Set a value           │
│    /config reset              Reset all settings   │
│    /config reset <key>        Reset one setting    │
│                                                     │
│  Quick Settings:                                    │
│    /theme      Change color theme                   │
│    /model      Switch AI model                      │
│    /vim        Toggle Vim mode                      │
│                                                     │
│  Examples:                                          │
│    /config get model                                │
│    /config set maxTokens 16384                      │
│    /config set theme light                          │
│    /config reset model                              │
│                                                     │
╰─────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', configInfo);
      return { success: true };
    }

    const action = args[0].toLowerCase();

    // /config list - 列出所有可配置项
    if (action === 'list') {
      let listInfo = `╭─ Available Configuration Settings ─────────────────╮\n`;
      listInfo += `│                                                    │\n`;

      for (const item of CONFIG_ITEMS) {
        const currentValue = config[item.key] ?? item.defaultValue;
        const valueStr = typeof currentValue === 'object'
          ? JSON.stringify(currentValue).substring(0, 20) + '...'
          : currentValue.toString();

        listInfo += `│  ${item.key.padEnd(20)} │\n`;
        listInfo += `│    Type:    ${item.type.padEnd(36)} │\n`;
        listInfo += `│    Current: ${valueStr.padEnd(36)} │\n`;
        listInfo += `│    Default: ${item.defaultValue.toString().padEnd(36)} │\n`;
        listInfo += `│    ${item.description.padEnd(44)} │\n`;
        if (item.example) {
          listInfo += `│    Examples: ${item.example.substring(0, 34).padEnd(34)} │\n`;
        }
        if (item !== CONFIG_ITEMS[CONFIG_ITEMS.length - 1]) {
          listInfo += `│                                                    │\n`;
        }
      }

      listInfo += `│                                                    │\n`;
      listInfo += `│  Usage:                                            │\n`;
      listInfo += `│    /config get <key>          View a setting       │\n`;
      listInfo += `│    /config set <key> <value>  Set a value          │\n`;
      listInfo += `│    /config reset <key>        Reset to default     │\n`;
      listInfo += `│                                                    │\n`;
      listInfo += `╰────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', listInfo);
      return { success: true };
    }

    // /config search <term> - 搜索配置项 (v2.1.6+)
    if (action === 'search') {
      const searchTerm = args.slice(1).join(' ').toLowerCase().trim();

      if (!searchTerm) {
        ctx.ui.addMessage('assistant', `Usage: /config search <term>

Search through all configuration settings by key, description, or value.

Examples:
  /config search model
  /config search token
  /config search theme`);
        return { success: false };
      }

      // 搜索匹配的配置项
      const matchedItems = CONFIG_ITEMS.filter(item => {
        const currentValue = config[item.key] ?? item.defaultValue;
        const valueStr = typeof currentValue === 'object'
          ? JSON.stringify(currentValue)
          : String(currentValue);

        return (
          item.key.toLowerCase().includes(searchTerm) ||
          item.description.toLowerCase().includes(searchTerm) ||
          valueStr.toLowerCase().includes(searchTerm) ||
          (item.example && item.example.toLowerCase().includes(searchTerm))
        );
      });

      if (matchedItems.length === 0) {
        ctx.ui.addMessage('assistant', `No settings match "${searchTerm}"

Try a different search term, or use /config list to see all available settings.`);
        return { success: true };
      }

      let searchResult = `╭─ Search Results for "${searchTerm}" ─────────────────╮\n`;
      searchResult += `│  Found ${matchedItems.length} matching setting${matchedItems.length > 1 ? 's' : ''}                           │\n`;
      searchResult += `│                                                    │\n`;

      for (const item of matchedItems) {
        const currentValue = config[item.key] ?? item.defaultValue;
        const valueStr = typeof currentValue === 'object'
          ? JSON.stringify(currentValue).substring(0, 20) + '...'
          : currentValue.toString();

        // 高亮匹配的部分
        searchResult += `│  ${item.key.padEnd(20)} │\n`;
        searchResult += `│    Current: ${valueStr.padEnd(36)} │\n`;
        searchResult += `│    ${item.description.substring(0, 44).padEnd(44)} │\n`;
        if (item !== matchedItems[matchedItems.length - 1]) {
          searchResult += `│                                                    │\n`;
        }
      }

      searchResult += `│                                                    │\n`;
      searchResult += `│  Use /config get <key> to view full details       │\n`;
      searchResult += `╰────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', searchResult);
      return { success: true };
    }

    // /config get <key> - 获取特定配置
    if (action === 'get') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /config get <key>

Available keys:
${CONFIG_ITEMS.map(item => `  • ${item.key.padEnd(20)} - ${item.description}`).join('\n')}

Example: /config get model`);
        return { success: false };
      }

      const key = args[1];
      const configItem = CONFIG_ITEMS.find(item => item.key === key);
      const value = config[key];

      if (value !== undefined) {
        const formattedValue = typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : value;

        let info = `Configuration: ${key}\n\n`;
        info += `Current Value:\n${formattedValue}\n\n`;

        if (configItem) {
          info += `Type: ${configItem.type}\n`;
          info += `Default: ${configItem.defaultValue}\n`;
          info += `Description: ${configItem.description}\n`;
          if (configItem.example) {
            info += `\nExamples: ${configItem.example}`;
          }
        }

        ctx.ui.addMessage('assistant', info);
      } else {
        const defaultValue = configItem?.defaultValue;
        let info = `Setting '${key}' is not set.\n\n`;

        if (configItem) {
          info += `Default Value: ${defaultValue}\n`;
          info += `Type: ${configItem.type}\n`;
          info += `Description: ${configItem.description}\n`;
          if (configItem.example) {
            info += `\nExamples: ${configItem.example}\n`;
          }
          info += `\nTo set this value:\n  /config set ${key} <value>`;
        } else {
          info += `Available settings:\n${CONFIG_ITEMS.map(item => `  • ${item.key}`).join('\n')}`;
        }

        ctx.ui.addMessage('assistant', info);
      }
      return { success: true };
    }

    // /config set <key> <value> - 设置配置
    if (action === 'set') {
      if (args.length < 3) {
        ctx.ui.addMessage('assistant', `Usage: /config set <key> <value>

Available keys:
${CONFIG_ITEMS.map(item => `  • ${item.key.padEnd(20)} - ${item.description}`).join('\n')}

Examples:
  /config set model opus
  /config set maxTokens 16384
  /config set verbose true
  /config set theme light`);
        return { success: false };
      }

      const key = args[1];
      let value: any = args.slice(2).join(' ');

      // 查找配置项定义
      const configItem = CONFIG_ITEMS.find(item => item.key === key);

      // 尝试解析 JSON 值
      try {
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!isNaN(Number(value)) && configItem?.type === 'number') value = Number(value);
        else if (value.startsWith('{') || value.startsWith('[')) {
          value = JSON.parse(value);
        }
      } catch {
        // 保持为字符串
      }

      // 类型验证
      if (configItem) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (configItem.type === 'object' && actualType !== 'object') {
          ctx.ui.addMessage('assistant', `Error: '${key}' expects ${configItem.type}, got ${actualType}

Expected format: JSON object
Example: /config set ${key} '{"key": "value"}'`);
          return { success: false };
        }
      }

      config[key] = value;

      if (writeConfig(config)) {
        const formattedValue = typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : value;

        let successMsg = `✓ Configuration updated\n\n`;
        successMsg += `Setting: ${key}\n`;
        successMsg += `Value: ${formattedValue}\n\n`;

        if (configItem) {
          successMsg += `Type: ${configItem.type}\n`;
          successMsg += `Description: ${configItem.description}\n\n`;
        }

        successMsg += `Saved to: ${configFile}\n\n`;
        successMsg += `Note: Some settings may require restart to take effect.`;

        ctx.ui.addMessage('assistant', successMsg);
        ctx.ui.addActivity(`Updated config: ${key}`);
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', `Failed to save configuration.`);
        return { success: false };
      }
    }

    // /config reset [key] - 重置配置
    if (action === 'reset') {
      // 重置单个配置项
      if (args.length === 2) {
        const key = args[1];
        const configItem = CONFIG_ITEMS.find(item => item.key === key);

        if (!configItem) {
          ctx.ui.addMessage('assistant', `Unknown setting: ${key}

Available settings:
${CONFIG_ITEMS.map(item => `  • ${item.key}`).join('\n')}

Use '/config list' to see all settings.`);
          return { success: false };
        }

        // 删除配置项（恢复为默认值）
        if (config[key] !== undefined) {
          delete config[key];

          if (writeConfig(config)) {
            ctx.ui.addMessage('assistant', `✓ Reset '${key}' to default value

Setting: ${key}
Default Value: ${configItem.defaultValue}
Description: ${configItem.description}

Configuration saved to: ${configFile}
Restart Axon to apply changes.`);
            ctx.ui.addActivity(`Reset config: ${key}`);
            return { success: true };
          } else {
            ctx.ui.addMessage('assistant', `Failed to reset configuration.`);
            return { success: false };
          }
        } else {
          ctx.ui.addMessage('assistant', `Setting '${key}' is already at default value.

Current Value: ${configItem.defaultValue}`);
          return { success: true };
        }
      }

      // 重置所有配置
      if (writeConfig({})) {
        ctx.ui.addMessage('assistant', `✓ All configuration reset to defaults

All settings have been cleared and will use default values:
${CONFIG_ITEMS.map(item => `  • ${item.key.padEnd(20)} = ${item.defaultValue}`).join('\n')}

Settings file: ${configFile}

Restart Axon to apply all changes.`);
        ctx.ui.addActivity('Configuration reset');
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', 'Failed to reset configuration.');
        return { success: false };
      }
    }

    // 兼容旧的无 action 格式
    // /config <key> - 查看配置
    if (args.length === 1) {
      const key = args[0];
      const configItem = CONFIG_ITEMS.find(item => item.key === key);
      const value = config[key];

      if (value !== undefined) {
        const formattedValue = typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : value;

        let info = `Configuration: ${key}\n\n`;
        info += `Current Value:\n${formattedValue}\n\n`;

        if (configItem) {
          info += `Type: ${configItem.type}\n`;
          info += `Default: ${configItem.defaultValue}\n`;
          info += `Description: ${configItem.description}`;
        }

        ctx.ui.addMessage('assistant', info);
      } else {
        ctx.ui.addMessage('assistant', `Setting '${key}' is not set.

Available settings:
${CONFIG_ITEMS.map(item => `  • ${item.key.padEnd(20)} - ${item.description}`).join('\n')}

Use '/config get ${key}' to see details or '/config list' for all settings.`);
      }
      return { success: true };
    }

    // /config <key> <value> - 设置配置（兼容旧格式）
    if (args.length >= 2 && !['get', 'set', 'reset', 'list'].includes(action)) {
      const key = args[0];
      let value: any = args.slice(1).join(' ');

      // 查找配置项定义
      const configItem = CONFIG_ITEMS.find(item => item.key === key);

      // 尝试解析 JSON 值
      try {
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!isNaN(Number(value)) && configItem?.type === 'number') value = Number(value);
        else if (value.startsWith('{') || value.startsWith('[')) {
          value = JSON.parse(value);
        }
      } catch {
        // 保持为字符串
      }

      config[key] = value;

      if (writeConfig(config)) {
        ctx.ui.addMessage('assistant', `✓ Set ${key} = ${JSON.stringify(value)}

Configuration saved to: ${configFile}
Some settings may require restart to take effect.`);
        ctx.ui.addActivity(`Updated config: ${key}`);
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', `Failed to save configuration.`);
        return { success: false };
      }
    }

    // 未知操作
    ctx.ui.addMessage('assistant', `Unknown command format.

Usage:
  /config                    Show configuration panel
  /config list               List all available settings
  /config get <key>          View a specific setting
  /config set <key> <value>  Set a configuration value
  /config reset              Reset all settings to defaults
  /config reset <key>        Reset a specific setting to default

Examples:
  /config get model
  /config set maxTokens 16384
  /config reset theme

Use '/config list' to see all available settings.`);
    return { success: false };
  },
};

// /permissions - 权限管理（基于官方源码完善）
export const permissionsCommand: SlashCommand = {
  name: 'permissions',
  aliases: ['perms'],
  description: 'View or modify tool permissions',
  usage: '/permissions [mode <mode-name>|allow <tool>|deny <tool>|reset]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const config = readConfig();

    // 获取当前设置
    const currentMode = config.permissionMode || 'default';
    const allowedTools = config.allowedTools || [];
    const disallowedTools = config.disallowedTools || [];

    // 无参数时显示当前权限设置
    if (args.length === 0) {
      // 格式化工具列表
      const formatToolList = (tools: string[] | string): string => {
        if (!tools) return '(none)';
        if (typeof tools === 'string') {
          return tools.split(',').map(t => t.trim()).filter(Boolean).join(', ') || '(none)';
        }
        if (Array.isArray(tools)) {
          return tools.length > 0 ? tools.join(', ') : '(none)';
        }
        return '(none)';
      };

      const permissionsInfo = `╭─ Permission Settings ──────────────────────────────╮
│                                                     │
│  Current Mode: ${currentMode.padEnd(38)} │
│                                                     │
│  Permission Modes:                                  │
│    default           - Interactive (ask each time)  │
│    acceptEdits       - Auto-accept file edits       │
│    bypassPermissions - Skip all permission checks   │
│    plan              - Plan-only (no execution)     │
│    dontAsk           - Auto-accept all actions      │
│                                                     │
│  Allowed Tools:                                     │
│    ${formatToolList(allowedTools).padEnd(48)} │
│                                                     │
│  Disallowed Tools:                                  │
│    ${formatToolList(disallowedTools).padEnd(48)} │
│                                                     │
│  Commands:                                          │
│    /permissions mode <name>  - Set permission mode  │
│    /permissions allow <tool> - Allow a tool         │
│    /permissions deny <tool>  - Deny a tool          │
│    /permissions reset        - Reset to defaults    │
│                                                     │
│  Command Line Flags:                                │
│    --permission-mode <mode>                         │
│    --allowedTools "Tool1,Tool2"                     │
│    --disallowedTools "Tool1,Tool2"                  │
│    --dangerously-skip-permissions                   │
│                                                     │
╰─────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', permissionsInfo);
      return { success: true };
    }

    const action = args[0].toLowerCase();

    // 设置权限模式
    if (action === 'mode') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /permissions mode <mode-name>

Available modes:
  default           - Interactive mode (ask before each action)
  acceptEdits       - Auto-accept file edits (Write, Edit, MultiEdit)
  bypassPermissions - Bypass all permission checks (use with caution!)
  plan              - Plan-only mode (no tool execution)
  dontAsk           - Auto-accept all actions (same as bypassPermissions)

Current mode: ${currentMode}

Example: /permissions mode acceptEdits`);
        return { success: false };
      }

      const mode = args[1].toLowerCase();
      const validModes = ['default', 'acceptedits', 'bypasspermissions', 'plan', 'dontask'];

      if (!validModes.includes(mode)) {
        ctx.ui.addMessage('assistant', `Invalid permission mode: ${mode}

Valid modes: default, acceptEdits, bypassPermissions, plan, dontAsk`);
        return { success: false };
      }

      // 保存配置
      config.permissionMode = mode;
      if (writeConfig(config)) {
        ctx.ui.addMessage('assistant', `✓ Permission mode changed to: ${mode}

${mode === 'bypasspermissions' || mode === 'dontask' ? '⚠️  WARNING: This mode will execute all actions without asking!\nOnly use in trusted environments or sandboxes.\n\n' : ''}Settings saved to: ${getConfigFile()}
Restart Axon to apply the new permission mode.`);
        ctx.ui.addActivity(`Changed permission mode to: ${mode}`);
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', 'Failed to save permission mode configuration.');
        return { success: false };
      }
    }

    // 允许工具
    if (action === 'allow') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /permissions allow <tool-name>

Available tools:
  Bash, Read, Write, Edit, MultiEdit, Glob, Grep,
  WebFetch, WebSearch, TodoWrite, Task, NotebookEdit,
  MCP tools, etc.

You can also use patterns:
  Bash(git:*)  - Allow only git commands in Bash
  Bash(npm:*)  - Allow only npm commands in Bash

Example: /permissions allow Bash`);
        return { success: false };
      }

      const toolName = args.slice(1).join(' ');
      const currentAllowed = Array.isArray(config.allowedTools)
        ? config.allowedTools
        : (config.allowedTools ? String(config.allowedTools).split(',').map(t => t.trim()) : []);

      if (!currentAllowed.includes(toolName)) {
        currentAllowed.push(toolName);
        config.allowedTools = currentAllowed;

        if (writeConfig(config)) {
          ctx.ui.addMessage('assistant', `✓ Tool allowed: ${toolName}

Current allowed tools: ${currentAllowed.join(', ')}

Settings saved to: ${getConfigFile()}
Restart Axon to apply changes.`);
          ctx.ui.addActivity(`Allowed tool: ${toolName}`);
          return { success: true };
        } else {
          ctx.ui.addMessage('assistant', 'Failed to save configuration.');
          return { success: false };
        }
      } else {
        ctx.ui.addMessage('assistant', `Tool '${toolName}' is already in the allowed list.`);
        return { success: true };
      }
    }

    // 禁止工具
    if (action === 'deny') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /permissions deny <tool-name>

This will add the tool to the disallowed list.

Available tools:
  Bash, Read, Write, Edit, MultiEdit, Glob, Grep,
  WebFetch, WebSearch, TodoWrite, Task, NotebookEdit,
  MCP tools, etc.

Example: /permissions deny WebSearch`);
        return { success: false };
      }

      const toolName = args.slice(1).join(' ');
      const currentDisallowed = Array.isArray(config.disallowedTools)
        ? config.disallowedTools
        : (config.disallowedTools ? String(config.disallowedTools).split(',').map(t => t.trim()) : []);

      if (!currentDisallowed.includes(toolName)) {
        currentDisallowed.push(toolName);
        config.disallowedTools = currentDisallowed;

        if (writeConfig(config)) {
          ctx.ui.addMessage('assistant', `✓ Tool denied: ${toolName}

Current disallowed tools: ${currentDisallowed.join(', ')}

Settings saved to: ${getConfigFile()}
Restart Axon to apply changes.`);
          ctx.ui.addActivity(`Denied tool: ${toolName}`);
          return { success: true };
        } else {
          ctx.ui.addMessage('assistant', 'Failed to save configuration.');
          return { success: false };
        }
      } else {
        ctx.ui.addMessage('assistant', `Tool '${toolName}' is already in the disallowed list.`);
        return { success: true };
      }
    }

    // 重置权限设置
    if (action === 'reset') {
      delete config.permissionMode;
      delete config.allowedTools;
      delete config.disallowedTools;

      if (writeConfig(config)) {
        ctx.ui.addMessage('assistant', `✓ Permission settings reset to defaults

Permission mode: default (interactive)
Allowed tools: (all)
Disallowed tools: (none)

Settings saved to: ${getConfigFile()}
Restart Axon to apply changes.`);
        ctx.ui.addActivity('Reset permission settings');
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', 'Failed to reset permission settings.');
        return { success: false };
      }
    }

    // 未知操作
    ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available actions:
  /permissions           - Show current settings
  /permissions mode      - Set permission mode
  /permissions allow     - Allow a tool
  /permissions deny      - Deny a tool
  /permissions reset     - Reset to defaults

Use /permissions <action> for detailed help on each action.`);
    return { success: false };
  },
};

// /memory - Claude 长期记忆管理 (基于官方源码实现)
export const memoryCommand: SlashCommand = {
  name: 'memory',
  aliases: ['mem'],
  description: 'Manage Claude\'s long-term memory files',
  usage: '/memory [list|show <file>|edit|clear]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args, config } = ctx;

    // Memory 文件位置
    const sessionMemoryDir = path.join(os.homedir(), '.axon', 'session-memory');
    const claudeMdPath = path.join(config.cwd, 'AXON.md');
    const globalClaudeMd = path.join(os.homedir(), '.axon', 'AXON.md');

    const action = args[0] || 'list';

    switch (action) {
      case 'list': {
        // 列出所有 memory 文件
        const memoryFiles: string[] = [];

        // 检查 AXON.md 文件
        if (fs.existsSync(claudeMdPath)) {
          memoryFiles.push(`📄 Project AXON.md\n   ${claudeMdPath}`);
        }
        if (fs.existsSync(globalClaudeMd)) {
          memoryFiles.push(`📄 Global AXON.md\n   ${globalClaudeMd}`);
        }

        // 检查 session-memory 目录
        if (fs.existsSync(sessionMemoryDir)) {
          try {
            const files = fs.readdirSync(sessionMemoryDir)
              .filter(f => f.endsWith('.md'))
              .map(f => `📝 ${f}\n   ${path.join(sessionMemoryDir, f)}`);
            memoryFiles.push(...files);
          } catch {
            // 忽略读取错误
          }
        }

        if (memoryFiles.length === 0) {
          ctx.ui.addMessage('assistant', `No memory files found.

Memory files allow Claude to remember context across conversations.

Locations:
  • Project: ${claudeMdPath}
  • Global:  ${globalClaudeMd}
  • Session: ${sessionMemoryDir}/

Create a AXON.md file with /init to get started.

Learn more: https://code.claude.com/docs/en/memory`);
        } else {
          const listInfo = `Claude Memory Files:

${memoryFiles.join('\n\n')}

Commands:
  /memory list           - List all memory files
  /memory show <file>    - Show memory file contents
  /memory edit           - Open memory file in editor
  /memory clear          - Clear session memory
  /init                  - Create new AXON.md

Learn more: https://code.claude.com/docs/en/memory`;
          ctx.ui.addMessage('assistant', listInfo);
        }
        break;
      }

      case 'show': {
        const fileName = args[1];
        if (!fileName) {
          ctx.ui.addMessage('assistant', `Usage: /memory show <file>

Available files:
  • AXON.md (project)
  • AXON.md (global)
  • <session-id>.md (session memory)

Example: /memory show AXON.md`);
          return { success: false };
        }

        // 查找并显示文件内容
        let filePath: string | null = null;
        let content = '';

        if (fileName === 'AXON.md' || fileName === 'project') {
          if (fs.existsSync(claudeMdPath)) {
            filePath = claudeMdPath;
          }
        } else if (fileName === 'global') {
          if (fs.existsSync(globalClaudeMd)) {
            filePath = globalClaudeMd;
          }
        } else {
          // 尝试作为 session memory 文件
          const sessionFile = path.join(sessionMemoryDir, fileName.endsWith('.md') ? fileName : `${fileName}.md`);
          if (fs.existsSync(sessionFile)) {
            filePath = sessionFile;
          }
        }

        if (filePath) {
          try {
            content = fs.readFileSync(filePath, 'utf-8');
            const preview = content.length > 2000 ? content.slice(0, 2000) + '\n\n...(truncated)' : content;
            ctx.ui.addMessage('assistant', `Memory File: ${filePath}

${preview}

Full path: ${filePath}
Size: ${content.length} characters`);
          } catch (error) {
            ctx.ui.addMessage('assistant', `Error reading file: ${error}`);
            return { success: false };
          }
        } else {
          ctx.ui.addMessage('assistant', `Memory file not found: ${fileName}

Use /memory list to see available files.`);
          return { success: false };
        }
        break;
      }

      case 'edit': {
        // 提供编辑指引
        const editInfo = `Edit Memory Files:

To edit memory files, use your preferred text editor:

Project AXON.md:
  ${claudeMdPath}

Global AXON.md:
  ${globalClaudeMd}

Using $EDITOR environment variable:
  ${process.env.EDITOR || process.env.VISUAL || '(not set)'}

Commands:
  # Using default editor
  $EDITOR ${claudeMdPath}

  # Or use your preferred editor
  code ${claudeMdPath}      # VS Code
  vim ${claudeMdPath}       # Vim
  nano ${claudeMdPath}      # Nano

Tip: Set $EDITOR environment variable to use your preferred editor:
  export EDITOR=code        # For VS Code
  export EDITOR=vim         # For Vim

Learn more: https://code.claude.com/docs/en/memory`;

        ctx.ui.addMessage('assistant', editInfo);
        break;
      }

      case 'clear': {
        // 清除 session memory
        let cleared = 0;
        if (fs.existsSync(sessionMemoryDir)) {
          try {
            const files = fs.readdirSync(sessionMemoryDir);
            for (const file of files) {
              if (file.endsWith('.md')) {
                fs.unlinkSync(path.join(sessionMemoryDir, file));
                cleared++;
              }
            }
            ctx.ui.addMessage('assistant', `✓ Cleared ${cleared} session memory file(s)

Session memory has been reset.
Project and global AXON.md files are preserved.`);
            ctx.ui.addActivity(`Cleared ${cleared} session memory files`);
          } catch (error) {
            ctx.ui.addMessage('assistant', `Error clearing session memory: ${error}`);
            return { success: false };
          }
        } else {
          ctx.ui.addMessage('assistant', 'No session memory to clear.');
        }
        break;
      }

      default: {
        ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available actions:
  /memory list           - List all memory files
  /memory show <file>    - Show memory file contents
  /memory edit           - Open memory file in editor
  /memory clear          - Clear session memory

Use /memory <action> for detailed help on each action.`);
        return { success: false };
      }
    }

    return { success: true };
  },
};

// /hooks - Hook 管理（基于官方源码完善）
export const hooksCommand: SlashCommand = {
  name: 'hooks',
  description: 'View or manage hooks',
  usage: '/hooks [list|types|examples|disable|enable]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const config = readConfig();

    // 定义所有可用的钩子类型（从官方源码）
    const hookTypes = [
      {
        name: 'PreToolUse',
        description: 'Run before any tool execution',
        example: 'Validate inputs, check permissions, log actions'
      },
      {
        name: 'PostToolUse',
        description: 'Run after successful tool execution',
        example: 'Format output, run linters, update logs'
      },
      {
        name: 'PostToolUseFailure',
        description: 'Run when tool execution fails',
        example: 'Error recovery, notifications, cleanup'
      },
      {
        name: 'Notification',
        description: 'Handle system notifications',
        example: 'Send alerts, update dashboards'
      },
      {
        name: 'UserPromptSubmit',
        description: 'Run when user submits a prompt',
        example: 'Validate input, add context, log queries'
      },
      {
        name: 'SessionStart',
        description: 'Run when a new session starts',
        example: 'Initialize workspace, check dependencies'
      },
      {
        name: 'SessionEnd',
        description: 'Run when session ends',
        example: 'Cleanup, save state, generate reports'
      },
      {
        name: 'Stop',
        description: 'Run when operation is stopped',
        example: 'Graceful shutdown, save progress'
      },
      {
        name: 'SubagentStart',
        description: 'Run when subagent starts',
        example: 'Configure subagent environment'
      },
      {
        name: 'SubagentStop',
        description: 'Run when subagent stops',
        example: 'Collect subagent results'
      },
      {
        name: 'PreCompact',
        description: 'Run before context compaction',
        example: 'Save important context, prepare summary'
      },
      {
        name: 'PermissionRequest',
        description: 'Run when permission is requested',
        example: 'Custom authorization logic'
      }
    ];

    // 定义钩子实现类型
    const hookImplTypes = [
      {
        type: 'command',
        description: 'Execute a shell command',
        fields: 'command (required), timeout, statusMessage'
      },
      {
        type: 'prompt',
        description: 'Evaluate with LLM',
        fields: 'prompt (required), model, timeout, statusMessage'
      },
      {
        type: 'agent',
        description: 'Agentic verifier',
        fields: 'prompt (required), model, timeout, statusMessage'
      }
    ];

    const action = args[0]?.toLowerCase() || 'show';

    // 显示当前配置
    if (action === 'show' || action === 'list') {
      const currentHooks = config.hooks || {};
      const hasHooks = Object.keys(currentHooks).length > 0;
      const isDisabled = config.disableAllHooks === true;

      let hooksInfo = `╭─ Hooks Configuration ──────────────────────────────╮
│                                                     │
│  Status: ${(isDisabled ? 'Disabled' : hasHooks ? 'Configured' : 'Not configured').padEnd(42)} │
│  Location: ~/.axon/settings.json                 │
│                                                     │`;

      if (hasHooks) {
        hooksInfo += `\n│  Configured Hooks:                                  │\n│                                                     │\n`;

        for (const [hookType, matchers] of Object.entries(currentHooks)) {
          hooksInfo += `│  ${hookType.padEnd(50)} │\n`;
          if (Array.isArray(matchers)) {
            for (const matcher of matchers) {
              const matcherStr = (matcher as any).matcher || '(all)';
              const hooksCount = ((matcher as any).hooks || []).length;
              hooksInfo += `│    → ${matcherStr.padEnd(20)} (${hooksCount} hook${hooksCount !== 1 ? 's' : ''})${' '.repeat(Math.max(0, 20 - matcherStr.length))} │\n`;
            }
          }
        }
      } else {
        hooksInfo += `\n│  No hooks configured yet.                           │\n`;
      }

      hooksInfo += `│                                                     │
│  Commands:                                          │
│    /hooks types      - Show all available types     │
│    /hooks list       - Show configured hooks        │
│    /hooks examples   - Show configuration examples  │
│    /hooks ${isDisabled ? 'enable' : 'disable'}     - ${isDisabled ? 'Enable' : 'Disable'} all hooks${' '.repeat(isDisabled ? 5 : 8)} │
│                                                     │
│  Configuration:                                     │
│    Edit ~/.axon/settings.json manually            │
│    See /hooks examples for sample configs           │
│                                                     │
╰─────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', hooksInfo);
      return { success: true };
    }

    // 显示所有可用的钩子类型
    if (action === 'types') {
      let typesInfo = `╭─ Available Hook Types ─────────────────────────────╮
│                                                     │`;

      for (const hookType of hookTypes) {
        typesInfo += `\n│  ${hookType.name.padEnd(48)} │\n`;
        typesInfo += `│    ${hookType.description.padEnd(46)} │\n`;
        typesInfo += `│    Example: ${hookType.example.substring(0, 35).padEnd(35)} │`;
        if (hookType !== hookTypes[hookTypes.length - 1]) {
          typesInfo += `\n│                                                     │`;
        }
      }

      typesInfo += `\n│                                                     │
│  Hook Implementation Types:                         │\n│                                                     │`;

      for (const implType of hookImplTypes) {
        typesInfo += `\n│  ${implType.type.padEnd(48)} │\n`;
        typesInfo += `│    ${implType.description.padEnd(46)} │\n`;
        typesInfo += `│    Fields: ${implType.fields.substring(0, 39).padEnd(39)} │`;
        if (implType !== hookImplTypes[hookImplTypes.length - 1]) {
          typesInfo += `\n│                                                     │`;
        }
      }

      typesInfo += `\n│                                                     │
╰─────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', typesInfo);
      return { success: true };
    }

    // 显示配置示例
    if (action === 'examples') {
      const examplesInfo = `Hook Configuration Examples

1. Command Hook (Shell Command):
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'About to write file' | tee -a ~/claude.log",
            "timeout": 5,
            "statusMessage": "Logging write operation..."
          }
        ]
      }
    ]
  }
}

2. Prompt Hook (LLM Evaluation):
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check if the command output contains errors. Use $ARGUMENTS placeholder for hook input JSON.",
            "model": "claude-haiku-4-20250514",
            "timeout": 30,
            "statusMessage": "Analyzing command output..."
          }
        ]
      }
    ]
  }
}

3. Agent Hook (Agentic Verifier):
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify that unit tests ran and passed. Context: $ARGUMENTS",
            "model": "claude-haiku-4-20250514",
            "timeout": 60,
            "statusMessage": "Verifying test results..."
          }
        ]
      }
    ]
  }
}

4. SessionStart Hook (Initialize Workspace):
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "git status && npm install",
            "timeout": 120,
            "statusMessage": "Initializing workspace..."
          }
        ]
      }
    ]
  }
}

5. Multiple Matchers and Hooks:
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Write operation'"
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./run-linter.sh"
          },
          {
            "type": "prompt",
            "prompt": "Check code style"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Session started at' $(date)"
          }
        ]
      }
    ]
  }
}

Important Notes:
  • matcher is optional - omit for hooks that apply to all tools
  • $ARGUMENTS in prompts is replaced with hook input JSON
  • timeout is in seconds
  • Hooks receive JSON via stdin with context about the event
  • Multiple hooks run sequentially in array order

Configuration Location:
  ~/.axon/settings.json

To disable all hooks:
  /hooks disable

To disable hooks temporarily:
  Set "disableAllHooks": true in settings.json`;

      ctx.ui.addMessage('assistant', examplesInfo);
      return { success: true };
    }

    // 禁用所有钩子
    if (action === 'disable') {
      config.disableAllHooks = true;

      if (writeConfig(config)) {
        ctx.ui.addMessage('assistant', `✓ All hooks disabled

Configuration updated: ${getConfigFile()}

To re-enable hooks:
  1. Edit ~/.axon/settings.json
  2. Remove or set "disableAllHooks": false
  3. Restart Axon

Note: Hook configurations are preserved, just not executed.`);
        ctx.ui.addActivity('Disabled all hooks');
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', 'Failed to update configuration.');
        return { success: false };
      }
    }

    // 启用钩子
    if (action === 'enable') {
      if (config.disableAllHooks) {
        delete config.disableAllHooks;

        if (writeConfig(config)) {
          ctx.ui.addMessage('assistant', `✓ Hooks enabled

Configuration updated: ${getConfigFile()}
Restart Axon to apply changes.`);
          ctx.ui.addActivity('Enabled hooks');
          return { success: true };
        } else {
          ctx.ui.addMessage('assistant', 'Failed to update configuration.');
          return { success: false };
        }
      } else {
        ctx.ui.addMessage('assistant', 'Hooks are already enabled.');
        return { success: true };
      }
    }

    // 未知操作
    ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available commands:
  /hooks              - Show configured hooks
  /hooks list         - Same as /hooks
  /hooks types        - Show all available hook types
  /hooks examples     - Show configuration examples
  /hooks disable      - Disable all hooks
  /hooks enable       - Re-enable hooks

Note: Hooks must be configured manually in ~/.axon/settings.json
Use /hooks examples to see sample configurations.`);
    return { success: false };
  },
};

// /model - 模型管理 (基于官方实现)
export const modelCommand: SlashCommand = {
  name: 'model',
  aliases: ['m'],
  description: 'View or change the AI model',
  usage: '/model [model-name]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args, config } = ctx;

    // 定义可用模型（基于官方源码）
    const models = [
      {
        name: 'sonnet',
        display: 'Claude Sonnet 4.5',
        desc: 'Best for everyday tasks',
        cost: '$3 / $15 per MTok (in/out)',
        details: 'Balanced performance for most coding tasks'
      },
      {
        name: 'opus',
        display: 'Claude Opus 4.5',
        desc: 'Most capable for complex work',
        cost: '$15 / $75 per MTok (in/out)',
        details: 'Highest intelligence for complex reasoning'
      },
      {
        name: 'haiku',
        display: 'Claude Haiku 4.5',
        desc: 'Fastest for quick answers',
        cost: '$0.80 / $4 per MTok (in/out)',
        details: 'Lower cost and faster for simple tasks'
      },
    ];

    // 无参数时显示当前模型和可用选项
    if (args.length === 0) {
      const currentModel = config.model || 'sonnet';
      const currentModelObj = models.find(m => currentModel.toLowerCase().includes(m.name));

      let modelInfo = `╭─ Model Selection ──────────────────────────────────╮\n`;
      modelInfo += `│                                                    │\n`;
      modelInfo += `│  Current: ${(currentModelObj?.display || currentModel).padEnd(42)}│\n`;
      modelInfo += `│                                                    │\n`;
      modelInfo += `│  Available Models:                                 │\n`;
      modelInfo += `│                                                    │\n`;

      for (const model of models) {
        const isCurrent = currentModel.toLowerCase().includes(model.name);
        const marker = isCurrent ? '→' : ' ';
        const nameDisplay = `${marker} ${model.name}`;
        modelInfo += `│  ${nameDisplay.padEnd(10)} - ${model.display.padEnd(38)}│\n`;
        modelInfo += `│              ${model.desc.padEnd(36)}│\n`;
        modelInfo += `│              ${model.cost.padEnd(36)}│\n`;
        if (model !== models[models.length - 1]) {
          modelInfo += `│                                                    │\n`;
        }
      }

      modelInfo += `│                                                    │\n`;
      modelInfo += `│  Usage:                                            │\n`;
      modelInfo += `│    /model <name>     - Switch to a model           │\n`;
      modelInfo += `│    claude -m <name>  - Start with specific model   │\n`;
      modelInfo += `│                                                    │\n`;
      modelInfo += `│  Examples:                                         │\n`;
      modelInfo += `│    /model opus       - Switch to Opus              │\n`;
      modelInfo += `│    /model haiku      - Switch to Haiku             │\n`;
      modelInfo += `│                                                    │\n`;
      modelInfo += `╰────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', modelInfo);
      return { success: true };
    }

    // 带参数时显示特定模型的详细信息或切换提示
    const requestedModel = args[0].toLowerCase();
    const validModel = models.find(m => m.name === requestedModel);

    if (!validModel) {
      ctx.ui.addMessage('assistant', `Unknown model: ${requestedModel}\n\nAvailable models: ${models.map(m => m.name).join(', ')}\n\nUse '/model' to see all options.`);
      return { success: false };
    }

    // 如果请求的模型就是当前模型，显示详细信息
    const currentModel = config.model || 'sonnet';
    const isCurrentModel = currentModel.toLowerCase().includes(validModel.name);

    if (isCurrentModel) {
      let details = `${validModel.display} (current)\n\n`;
      details += `${validModel.desc}\n\n`;
      details += `Pricing: ${validModel.cost}\n`;
      details += `${validModel.details}\n\n`;
      details += `You are currently using this model.`;

      ctx.ui.addMessage('assistant', details);
      return { success: true };
    }

    // v2.1.30: 立即切换模型（不再需要重启）
    ctx.ui.addMessage('assistant', `Switched to ${validModel.display}\n\nThe next message will use this model.`);
    ctx.ui.addActivity(`Switched to ${validModel.display}`);
    return { success: true, action: 'switchModel', data: { model: validModel.name } };
  },
};

// /init - 初始化项目的 Claude 配置（基于官方源码）
export const initCommand: SlashCommand = {
  name: 'init',
  description: 'Initialize Axon configuration for this project',
  usage: '/init',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { config } = ctx;
    const claudeMdPath = path.join(config.cwd, 'AXON.md');
    const claudeDir = path.join(config.cwd, '.axon');
    const commandsDir = path.join(claudeDir, 'commands');
    const gitignorePath = path.join(config.cwd, '.gitignore');

    // 检查是否已初始化
    const alreadyInitialized = fs.existsSync(claudeMdPath) || fs.existsSync(claudeDir);

    if (alreadyInitialized) {
      // 如果已存在，发送改进提示
      const existingFiles: string[] = [];
      if (fs.existsSync(claudeMdPath)) existingFiles.push('AXON.md');
      if (fs.existsSync(claudeDir)) existingFiles.push('.axon/');

      const improvementPrompt = `Please analyze this codebase and suggest improvements to the existing Axon configuration.

Current configuration found:
${existingFiles.map(f => `- ${f}`).join('\n')}

Please review and suggest improvements for:
1. AXON.md - Is it comprehensive? Does it include key commands and architecture?
2. .axon/ directory - Are there useful custom commands or settings that should be added?
3. Any missing configuration that would help future Claude instances work more effectively in this codebase.

Focus on practical improvements based on the actual codebase structure and development workflow.`;

      ctx.ui.addMessage('assistant', `Axon is already initialized in this project.

Found existing configuration:
${existingFiles.map(f => `  • ${f}`).join('\n')}

I'll analyze your codebase and suggest improvements to your configuration.`);

      // 发送改进分析的提示
      ctx.ui.addMessage('user', improvementPrompt);

      return { success: true };
    }

    // 如果未初始化，发送完整的初始化提示（基于官方源码）
    const initPrompt = `Please analyze this codebase and create a AXON.md file, which will be given to future instances of Axon to operate in this repository.

IMPORTANT: The AXON.md file MUST use the built-in template as its foundation. Call the createClaudeMdTemplate function or use the following structure:
1. Start with the standard header "# AXON.md" and the intro line
2. Fill in the "## Project Overview" section with a concise description of the project
3. Keep the "## Iron Rules" section and "## Behavioral Red Lines" section EXACTLY as they are in the template — do NOT modify, remove, or reword any rules
4. Fill in the "## Development Commands" section with actual build/test/lint commands discovered from the project
5. Fill in the "## Architecture Overview" section with the high-level code structure

What to add in the project-specific sections:
1. Commands that will be commonly used, such as how to build, lint, and run tests. Include the necessary commands to develop in this codebase, such as how to run a single test.
2. High-level code architecture and structure so that future instances can be productive more quickly. Focus on the "big picture" architecture that requires reading multiple files to understand.

Usage notes:
- Do not repeat yourself and do not include obvious instructions like "Provide helpful error messages to users", "Write unit tests for all new utilities", "Never include sensitive information (API keys, tokens) in code or commits".
- Avoid listing every component or file structure that can be easily discovered.
- Don't include generic development practices — the Iron Rules already cover behavioral constraints.
- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include the important parts.
- If there is a README.md, make sure to include the important parts.
- Do not make up information such as "Common Development Tasks", "Tips for Development", "Support and Documentation" unless this is expressly included in other files that you read.

Additionally, please help set up the .axon/ directory structure:
1. Create .axon/commands/ for custom slash commands
2. Suggest adding .axon/ to .gitignore (but keep AXON.md tracked)
3. If there are common project-specific workflows, suggest creating custom commands for them

Please analyze the codebase now and create these files.`;

    ctx.ui.addMessage('assistant', `Initializing Axon configuration for this project...

I'll analyze your codebase and create:
  • AXON.md - Project documentation and guidance
  • .axon/ - Configuration directory
  • .axon/commands/ - Custom commands directory

This will help future Axon instances understand your project better.`);

    // 发送初始化提示
    ctx.ui.addMessage('user', initPrompt);

    ctx.ui.addActivity('Initialized Axon project configuration');
    return { success: true };
  },
};

// /privacy-settings - 隐私设置（基于官方源码完善）
export const privacySettingsCommand: SlashCommand = {
  name: 'privacy-settings',
  aliases: ['privacy'],
  description: 'View and manage privacy and data collection settings',
  usage: '/privacy-settings [show|telemetry <on|off>|clear-sessions]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const action = args[0]?.toLowerCase() || 'show';
    const config = readConfig();

    // 从 settings.json 读取遥测配置
    const telemetryEnabled = config.enableTelemetry === true;
    const otelTimeout = config.telemetry?.otelShutdownTimeoutMs?.toString() || '3000';

    // 显示隐私设置
    if (action === 'show') {
      // 确定当前遥测状态
      let telemetryStatus = 'Disabled (default for local installations)';
      if (telemetryEnabled) {
        telemetryStatus = 'Enabled (settings.json)';
      }

      const privacyInfo = `╭─ Privacy & Data Settings ──────────────────────────╮
│                                                     │
│  Data Collection:                                   │
│    OpenTelemetry:    ${telemetryStatus.substring(0, 28).padEnd(28)} │
│    Usage Analytics:  Disabled                       │
│    Crash Reports:    Configurable (opt-in)          │
│    Error Logging:    Local only                     │
│                                                     │
│  Data Storage Locations:                            │
│    Sessions:         ~/.axon/sessions/            │
│    Configuration:    ~/.axon/settings.json        │
│    Logs:             ~/.axon/logs/ (if enabled)   │
│    Memory Files:     ~/.axon/session-memory/      │
│    Plugins:          ~/.axon/plugins/             │
│                                                     │
│  Data Retention:                                    │
│    Sessions:         30 days (auto-cleanup)         │
│    Configuration:    Persisted indefinitely         │
│    Logs:             Rotated based on size          │
│    No data sent to external servers (local mode)    │
│                                                     │
│  Privacy Controls:                                  │
│    Telemetry:        Environment variable control   │
│    Sessions:         Manual deletion supported      │
│    API Key:          Stored locally only            │
│    Conversation:     All local, end-to-end          │
│                                                     │
│  Environment Variables:                             │
│    AXON_ENABLE_TELEMETRY=1                   │
│      Enable OpenTelemetry (disabled by default)     │
│                                                     │
│    AXON_DISABLE_TELEMETRY=1                  │
│      Explicitly disable all telemetry               │
│                                                     │
│    AXON_OTEL_SHUTDOWN_TIMEOUT_MS=${otelTimeout.padEnd(13)} │
│      OpenTelemetry shutdown timeout (milliseconds)  │
│                                                     │
│  Commands:                                          │
│    /privacy-settings show          - Show settings  │
│    /privacy-settings clear-sessions - Clear all     │
│                                                     │
│  Data Processing:                                   │
│    • All conversations are processed locally        │
│    • API calls go directly to Anthropic             │
│    • No intermediary data collection                │
│    • Sessions stored locally for resume             │
│                                                     │
│  For more information:                              │
│    Consumer Terms: https://www.anthropic.com/legal  │
│    Privacy Policy: https://platform.claude.com/   │
│                     settings/privacy                │
│    Documentation:  https://code.claude.com/privacy  │
│                                                     │
╰─────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', privacyInfo);
      return { success: true };
    }

    // 清除所有会话数据
    if (action === 'clear-sessions') {
      const sessionsDir = path.join(os.homedir(), '.axon', 'sessions');

      if (!fs.existsSync(sessionsDir)) {
        ctx.ui.addMessage('assistant', 'No sessions directory found. Nothing to clear.');
        return { success: true };
      }

      try {
        const files = fs.readdirSync(sessionsDir);
        let deletedCount = 0;

        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(sessionsDir, file));
            deletedCount++;
          }
        }

        ctx.ui.addMessage('assistant', `✓ Privacy: Cleared ${deletedCount} session file(s)

All conversation history has been deleted from:
  ${sessionsDir}

This action:
  • Removed all saved sessions
  • Cleared conversation history
  • Freed up disk space

Note: This does not affect:
  • Your configuration (~/.axon/settings.json)
  • Custom commands (.axon/commands/)
  • MCP server configurations

You can no longer resume any previous sessions.`);
        ctx.ui.addActivity(`Cleared ${deletedCount} session files`);
        return { success: true };
      } catch (error) {
        ctx.ui.addMessage('assistant', `Error clearing sessions: ${error}

Please check permissions for:
  ${sessionsDir}`);
        return { success: false };
      }
    }

    // 未知操作
    ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available commands:
  /privacy-settings               - Show privacy settings
  /privacy-settings show          - Same as above
  /privacy-settings clear-sessions - Delete all saved sessions

To control telemetry, set environment variables:
  export AXON_DISABLE_TELEMETRY=1    # Disable
  export AXON_ENABLE_TELEMETRY=1     # Enable

Note: Changes to environment variables require restart.`);
    return { success: false };
  },
};

// /vim - Vim 模式切换 (官方风格)
export const vimCommand: SlashCommand = {
  name: 'vim',
  description: 'Toggle between Vim and Normal editing modes',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    // 模拟 vim 模式切换
    const vimInfo = `Vim Mode Toggle

Current Mode: Normal (readline)

To toggle Vim mode:
  • This feature enables Vim-style keybindings
  • Use hjkl for navigation
  • Use i/a for insert mode
  • Use Esc to exit insert mode

Vim Mode Features:
  • Modal editing (normal/insert)
  • Vim motions (w, b, e, etc.)
  • Vim commands (:w, :q, etc.)

Note: Vim mode is applied to the input field.
Restart may be required for full effect.`;

    ctx.ui.addMessage('assistant', vimInfo);
    return { success: true };
  },
};

// /theme - 主题设置 (官方风格)
export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'Change the color theme',
  usage: '/theme [theme-name]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;

    const themes = [
      { name: 'dark', desc: 'Dark theme (default)' },
      { name: 'light', desc: 'Light theme' },
      { name: 'system', desc: 'Follow system preference' },
      { name: 'high-contrast', desc: 'High contrast for accessibility' },
    ];

    if (args.length === 0) {
      let themeInfo = `Color Theme\n\nCurrent: dark\n\nAvailable Themes:\n`;

      for (const theme of themes) {
        themeInfo += `  ${theme.name.padEnd(15)} - ${theme.desc}\n`;
      }

      themeInfo += `\nUsage: /theme <name>\nExample: /theme light`;

      ctx.ui.addMessage('assistant', themeInfo);
      return { success: true };
    }

    const requestedTheme = args[0].toLowerCase();
    const validTheme = themes.find(t => t.name === requestedTheme);

    if (!validTheme) {
      ctx.ui.addMessage('assistant', `Unknown theme: ${requestedTheme}\n\nAvailable: ${themes.map(t => t.name).join(', ')}`);
      return { success: false };
    }

    ctx.ui.addMessage('assistant', `Theme changed to: ${validTheme.name}\n\nNote: Some terminal emulators may require restart to fully apply.`);
    return { success: true };
  },
};

// /discover - 探索功能 (官方风格)
export const discoverCommand: SlashCommand = {
  name: 'discover',
  description: 'Explore Axon features and track your progress',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const discoverInfo = `Discover Axon

Quick Wins:
  ✓ /resume - Resume past conversations
  ○ /compact - Summarize and free context
  ○ Image paste (Ctrl+V)
  ○ Voice input

Power Features:
  ○ MCP servers
  ○ Custom hooks
  ○ GitHub integration
  ○ Vim mode

Tips:
  • Type / to see all commands
  • Press ? for keyboard shortcuts
  • Use /help <command> for details

Progress: 1/8 features explored

Try: /resume to continue a past conversation`;

    ctx.ui.addMessage('assistant', discoverInfo);
    return { success: true };
  },
};

// /output-style - 输出风格设置 (官方实现)
export const outputStyleCommand: SlashCommand = {
  name: 'output-style',
  aliases: ['style'],
  description: 'Configure AI output style (concise, detailed, code-first, etc.)',
  usage: '/output-style [style-name]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;

    // 定义可用的输出风格
    const outputStyles = [
      {
        name: 'default',
        display: 'Default',
        description: 'Balanced responses with explanations and code',
        prompt: 'Provide balanced responses that include both explanations and code when relevant. Be clear and helpful while remaining concise.'
      },
      {
        name: 'concise',
        display: 'Concise',
        description: 'Brief, to-the-point responses',
        prompt: 'Be extremely concise. Provide brief, direct answers with minimal explanation. Focus on essential information only. Use code blocks when they\'re more efficient than words.'
      },
      {
        name: 'detailed',
        display: 'Detailed',
        description: 'Comprehensive explanations with examples',
        prompt: 'Provide detailed, comprehensive responses. Include thorough explanations, examples, and context. Walk through your reasoning step by step. Educational content is encouraged.'
      },
      {
        name: 'code-first',
        display: 'Code First',
        description: 'Prioritize code solutions over explanations',
        prompt: 'Prioritize showing code solutions. Provide working code first, with minimal explanation. Comments in code are preferred over separate explanations. Be direct and action-oriented.'
      },
      {
        name: 'educational',
        display: 'Educational',
        description: 'Teaching-focused with insights and best practices',
        prompt: 'Focus on teaching and learning. Explain concepts thoroughly, include best practices, and provide insights. Help the user understand not just the "how" but the "why" behind solutions.'
      },
      {
        name: 'professional',
        display: 'Professional',
        description: 'Formal, enterprise-grade documentation style',
        prompt: 'Maintain a professional, formal tone. Provide well-structured responses suitable for enterprise environments. Include documentation, error handling, and production-ready considerations.'
      }
    ];

    // 无参数时显示当前风格和可用选项
    if (args.length === 0) {
      const config = readConfig();
      const currentStyle = config.outputStyle || 'default';
      const current = outputStyles.find(s => s.name === currentStyle);

      let styleInfo = `Output Style Configuration

Current Style: ${current?.display || 'Default'} (${currentStyle})
${current?.description || 'Standard balanced responses'}

Available Styles:
`;

      for (const style of outputStyles) {
        const isCurrent = style.name === currentStyle ? ' (current)' : '';
        styleInfo += `  ${style.name.padEnd(13)} - ${style.display}${isCurrent}\n`;
        styleInfo += `                  ${style.description}\n`;
      }

      styleInfo += `\nUsage:
  /output-style <name>    - Set output style
  /output-style default   - Reset to default style

Examples:
  /output-style concise   - Get brief, direct responses
  /output-style detailed  - Get comprehensive explanations`;

      ctx.ui.addMessage('assistant', styleInfo);
      return { success: true };
    }

    // 设置输出风格
    const styleName = args[0].toLowerCase();
    const selectedStyle = outputStyles.find(s => s.name === styleName);

    if (!selectedStyle) {
      ctx.ui.addMessage('assistant', `Unknown output style: ${styleName}\n\nAvailable styles: ${outputStyles.map(s => s.name).join(', ')}`);
      return { success: false };
    }

    // 保存到配置
    const config = readConfig();
    config.outputStyle = selectedStyle.name;
    config.outputStylePrompt = selectedStyle.prompt;

    if (writeConfig(config)) {
      ctx.ui.addMessage('assistant', `✓ Output style changed to: ${selectedStyle.display}

${selectedStyle.description}

This setting will affect how I respond to your queries going forward.
Note: Some changes may require restarting the conversation.`);
      ctx.ui.addActivity(`Changed output style to: ${selectedStyle.name}`);
      return { success: true };
    } else {
      ctx.ui.addMessage('assistant', 'Failed to save output style configuration.');
      return { success: false };
    }
  },
};

// /statusline - 配置状态栏 (官方实现)
export const statuslineCommand: SlashCommand = {
  name: 'statusline',
  aliases: ['status-line'],
  description: 'Set up Axon\'s status line UI',
  usage: '/statusline [custom-prompt]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const configFile = getConfigFile();
    let config = readConfig();

    // 获取当前 statusLine 配置
    const currentStatusLine = config.statusLine;

    // 如果无参数，显示当前配置和帮助信息
    if (args.length === 0) {
      let statusLineInfo = `Status Line Configuration\n\n`;

      if (currentStatusLine) {
        statusLineInfo += `Current Configuration:\n`;
        statusLineInfo += `  Type: ${currentStatusLine.type || 'command'}\n`;
        statusLineInfo += `  Command: ${currentStatusLine.command || '(not set)'}\n\n`;
      } else {
        statusLineInfo += `Status line is not configured.\n\n`;
      }

      statusLineInfo += `The status line displays contextual information beneath the input box.\n\n`;
      statusLineInfo += `Configuration:\n`;
      statusLineInfo += `  1. The statusLine receives JSON via stdin with:\n`;
      statusLineInfo += `     - session_id: Unique session ID\n`;
      statusLineInfo += `     - model: { id, display_name }\n`;
      statusLineInfo += `     - workspace: { current_dir }\n`;
      statusLineInfo += `     - cost: { input_tokens, output_tokens, ... }\n\n`;
      statusLineInfo += `  2. Example configuration in ${configFile}:\n`;
      statusLineInfo += `     {\n`;
      statusLineInfo += `       "statusLine": {\n`;
      statusLineInfo += `         "type": "command",\n`;
      statusLineInfo += `         "command": "jq -r '.model.display_name'"\n`;
      statusLineInfo += `       }\n`;
      statusLineInfo += `     }\n\n`;
      statusLineInfo += `  3. Example with shell script:\n`;
      statusLineInfo += `     Create ~/.axon/statusline-command.sh:\n`;
      statusLineInfo += `     #!/bin/bash\n`;
      statusLineInfo += `     input=$(cat)\n`;
      statusLineInfo += `     model=$(echo "$input" | jq -r '.model.display_name')\n`;
      statusLineInfo += `     cwd=$(echo "$input" | jq -r '.workspace.current_dir')\n`;
      statusLineInfo += `     echo "$model in $cwd"\n\n`;
      statusLineInfo += `     Then set command to: "~/.axon/statusline-command.sh"\n\n`;
      statusLineInfo += `Usage:\n`;
      statusLineInfo += `  /statusline              - Show this help\n`;
      statusLineInfo += `  /statusline setup        - Interactive setup (import from PS1)\n`;
      statusLineInfo += `  /statusline disable      - Disable status line\n`;
      statusLineInfo += `  /statusline test         - Test current configuration\n`;

      ctx.ui.addMessage('assistant', statusLineInfo);
      return { success: true };
    }

    const action = args[0].toLowerCase();

    // 禁用状态栏
    if (action === 'disable') {
      if (currentStatusLine) {
        delete config.statusLine;
        if (writeConfig(config)) {
          ctx.ui.addMessage('assistant', `Status line disabled.\n\nConfiguration updated: ${configFile}\nRestart Axon to apply changes.`);
          return { success: true };
        } else {
          ctx.ui.addMessage('assistant', 'Failed to update configuration.');
          return { success: false };
        }
      } else {
        ctx.ui.addMessage('assistant', 'Status line is already disabled.');
        return { success: true };
      }
    }

    // 交互式设置 (从 PS1 导入)
    if (action === 'setup') {
      const setupInfo = `Interactive Status Line Setup

This feature helps you configure a custom status line by importing your shell's PS1 configuration.

Steps:
  1. The setup will read your shell configuration (~/.zshrc, ~/.bashrc, etc.)
  2. Extract your PS1 (prompt) variable
  3. Convert it to a statusLine command
  4. Save to ${configFile}

Shell PS1 sequences that will be converted:
  \\u → $(whoami)           - Username
  \\h → $(hostname -s)       - Hostname (short)
  \\w → $(pwd)              - Working directory
  \\W → $(basename "$(pwd)")  - Current directory name
  \\$ → $(if [ $(id -u) -eq 0 ]; then echo '#'; else echo '$'; fi)
  \\d → $(date +%a\\ %b\\ %d)  - Date
  \\t → $(date +%H:%M:%S)   - Time (24-hour)
  \\@ → $(date +%I:%M%p)    - Time (12-hour)

Color codes will be preserved using printf.

To proceed with automatic setup:
  1. Ask Claude: "Configure my statusLine from my shell PS1"
  2. Or manually edit ${configFile}

Note: You can also create a custom script in ~/.axon/ for more control.`;

      ctx.ui.addMessage('assistant', setupInfo);
      ctx.ui.addActivity('Showed statusline setup info');
      return { success: true };
    }

    // 测试当前配置
    if (action === 'test') {
      if (!currentStatusLine || !currentStatusLine.command) {
        ctx.ui.addMessage('assistant', 'No statusLine command configured. Use /statusline setup to configure.');
        return { success: false };
      }

      const testInfo = `Testing Status Line Configuration

Current command: ${currentStatusLine.command}

Sample JSON input:
{
  "session_id": "test-session-123",
  "model": {
    "id": "claude-sonnet-4-20250514",
    "display_name": "Claude Sonnet 4"
  },
  "workspace": {
    "current_dir": "${ctx.config.cwd}"
  },
  "cost": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "total_cost": 0.0234
  }
}

To test manually, run:
echo '{"session_id":"test","model":{"display_name":"Sonnet"},"workspace":{"current_dir":"${ctx.config.cwd}"}}' | ${currentStatusLine.command}

Note: Testing requires the command and dependencies (like jq) to be installed.`;

      ctx.ui.addMessage('assistant', testInfo);
      return { success: true };
    }

    // 未知操作
    ctx.ui.addMessage('assistant', `Unknown action: ${action}\n\nAvailable actions:\n  /statusline         - Show help\n  /statusline setup   - Interactive setup\n  /statusline disable - Disable\n  /statusline test    - Test configuration`);
    return { success: false };
  },
};


// /remote-env - 远程环境配置 (基于官方源码实现)
export const remoteEnvCommand: SlashCommand = {
  name: 'remote-env',
  aliases: ['remote', 'env'],
  description: 'Configure the default remote environment for remote development sessions',
  usage: '/remote-env [list|set <env-id>|clear]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const action = args[0]?.toLowerCase() || 'show';
    const config = readConfig();

    // 获取当前远程环境配置
    const currentRemoteConfig = config.remote || {};
    const defaultEnvironmentId = currentRemoteConfig.defaultEnvironmentId;

    // 模拟的环境列表（在真实实现中，这些会从 API 获取）
    const mockEnvironments = [
      {
        environment_id: 'env-1',
        name: 'Development Container',
        type: 'docker',
        status: 'active'
      },
      {
        environment_id: 'env-2',
        name: 'SSH Server',
        type: 'ssh',
        status: 'active'
      },
      {
        environment_id: 'env-3',
        name: 'Remote Workspace',
        type: 'remote',
        status: 'inactive'
      }
    ];

    // 显示当前配置
    if (action === 'show' || action === 'status') {
      let remoteEnvInfo = `╭─ Remote Environment Configuration ────────────────╮\n`;
      remoteEnvInfo += `│                                                    │\n`;

      if (defaultEnvironmentId) {
        const currentEnv = mockEnvironments.find(e => e.environment_id === defaultEnvironmentId);
        if (currentEnv) {
          remoteEnvInfo += `│  Current Environment:                              │\n`;
          remoteEnvInfo += `│    Name:   ${currentEnv.name.padEnd(40)} │\n`;
          remoteEnvInfo += `│    ID:     ${currentEnv.environment_id.padEnd(40)} │\n`;
          remoteEnvInfo += `│    Type:   ${currentEnv.type.padEnd(40)} │\n`;
          remoteEnvInfo += `│    Status: ${currentEnv.status.padEnd(40)} │\n`;
        } else {
          remoteEnvInfo += `│  Current: ${defaultEnvironmentId.padEnd(42)} │\n`;
          remoteEnvInfo += `│  (Environment not found in available list)        │\n`;
        }
      } else {
        remoteEnvInfo += `│  No default remote environment configured          │\n`;
      }

      remoteEnvInfo += `│                                                    │\n`;
      remoteEnvInfo += `│  Commands:                                         │\n`;
      remoteEnvInfo += `│    /remote-env list       - List all environments  │\n`;
      remoteEnvInfo += `│    /remote-env set <id>   - Set default environment│\n`;
      remoteEnvInfo += `│    /remote-env clear      - Clear configuration    │\n`;
      remoteEnvInfo += `│                                                    │\n`;
      remoteEnvInfo += `│  Remote Development Features:                      │\n`;
      remoteEnvInfo += `│    • SSH connection support                        │\n`;
      remoteEnvInfo += `│    • Docker container environments                 │\n`;
      remoteEnvInfo += `│    • Remote workspace synchronization              │\n`;
      remoteEnvInfo += `│                                                    │\n`;
      remoteEnvInfo += `│  Configuration:                                    │\n`;
      remoteEnvInfo += `│    Location: ~/.axon/settings.json               │\n`;
      remoteEnvInfo += `│    Key: remote.defaultEnvironmentId                │\n`;
      remoteEnvInfo += `│                                                    │\n`;
      remoteEnvInfo += `│  Web Console:                                      │\n`;
      remoteEnvInfo += `│    https://claude.ai/code                          │\n`;
      remoteEnvInfo += `│                                                    │\n`;
      remoteEnvInfo += `╰────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', remoteEnvInfo);
      return { success: true };
    }

    // 列出所有可用环境
    if (action === 'list') {
      let envList = `Available Remote Environments:\n\n`;

      if (mockEnvironments.length === 0) {
        envList += `No remote environments available.\n\n`;
        envList += `To configure remote environments:\n`;
        envList += `1. Visit https://claude.ai/code\n`;
        envList += `2. Set up your remote development environments\n`;
        envList += `3. Use /remote-env set <id> to configure\n`;
      } else {
        for (const env of mockEnvironments) {
          const isCurrent = env.environment_id === defaultEnvironmentId ? ' (current)' : '';
          envList += `${isCurrent ? '→' : ' '} ${env.name}${isCurrent}\n`;
          envList += `    ID:     ${env.environment_id}\n`;
          envList += `    Type:   ${env.type}\n`;
          envList += `    Status: ${env.status}\n\n`;
        }

        envList += `\nTo set default environment:\n`;
        envList += `  /remote-env set <environment-id>\n\n`;
        envList += `Example:\n`;
        envList += `  /remote-env set env-1\n`;
      }

      ctx.ui.addMessage('assistant', envList);
      return { success: true };
    }

    // 设置默认环境
    if (action === 'set') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /remote-env set <environment-id>

Available environment IDs:
${mockEnvironments.map(e => `  - ${e.environment_id} (${e.name})`).join('\n')}

Example: /remote-env set env-1`);
        return { success: false };
      }

      const envId = args[1];
      const selectedEnv = mockEnvironments.find(e => e.environment_id === envId);

      if (!selectedEnv) {
        ctx.ui.addMessage('assistant', `Environment ID '${envId}' not found.

Available environments:
${mockEnvironments.map(e => `  - ${e.environment_id} (${e.name})`).join('\n')}

Use /remote-env list to see all environments.`);
        return { success: false };
      }

      // 保存配置
      config.remote = {
        ...currentRemoteConfig,
        defaultEnvironmentId: envId
      };

      if (writeConfig(config)) {
        ctx.ui.addMessage('assistant', `✓ Set default remote environment to: ${selectedEnv.name}

Environment ID: ${envId}
Type: ${selectedEnv.type}
Status: ${selectedEnv.status}

Configuration saved to: ${getConfigFile()}

This environment will be used for:
  • Remote development sessions
  • SSH connections
  • Container-based workflows

Restart Axon to apply changes.`);
        ctx.ui.addActivity(`Set remote environment: ${selectedEnv.name}`);
        return { success: true };
      } else {
        ctx.ui.addMessage('assistant', 'Failed to save remote environment configuration.');
        return { success: false };
      }
    }

    // 清除配置
    if (action === 'clear') {
      if (config.remote) {
        delete config.remote.defaultEnvironmentId;

        // 如果 remote 对象为空，删除整个 remote 配置
        if (Object.keys(config.remote).length === 0) {
          delete config.remote;
        }

        if (writeConfig(config)) {
          ctx.ui.addMessage('assistant', `✓ Cleared default remote environment configuration

Configuration updated: ${getConfigFile()}

No default environment is configured. You can set one with:
  /remote-env set <environment-id>

Use /remote-env list to see available environments.`);
          ctx.ui.addActivity('Cleared remote environment configuration');
          return { success: true };
        } else {
          ctx.ui.addMessage('assistant', 'Failed to clear remote environment configuration.');
          return { success: false };
        }
      } else {
        ctx.ui.addMessage('assistant', 'No remote environment configuration to clear.');
        return { success: true };
      }
    }

    // 未知操作
    ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available commands:
  /remote-env              - Show current configuration
  /remote-env list         - List all available environments
  /remote-env set <id>     - Set default environment
  /remote-env clear        - Clear configuration

For more information: https://claude.ai/code`);
    return { success: false };
  },
};

// /terminal-setup - 终端快捷键配置 (从官方源码复制实现)
export const terminalSetupCommand: SlashCommand = {
  name: 'terminal-setup',
  description: 'Configure Shift+Enter key binding for multi-line prompts',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    // 检测终端类型
    const termProgram = process.env.TERM_PROGRAM;
    const term = process.env.TERM;
    const tmux = process.env.TMUX;
    const ghost = process.env.GHOSTTY_RESOURCES_DIR;

    let terminalType = 'unknown';
    let inTmux = false;

    // 检测是否在 tmux/screen 中
    if (tmux || term?.includes('screen')) {
      inTmux = true;
    }

    // 检测终端类型
    if (termProgram === 'vscode') {
      terminalType = 'VSCode';
    } else if (termProgram === 'Cursor') {
      terminalType = 'Cursor';
    } else if (termProgram === 'Windsurf') {
      terminalType = 'Windsurf';
    } else if (termProgram === 'WezTerm') {
      terminalType = 'WezTerm';
    } else if (ghost) {
      terminalType = 'Ghostty';
    } else if (termProgram === 'Apple_Terminal') {
      terminalType = 'Apple Terminal';
    } else if (termProgram === 'iTerm.app') {
      terminalType = 'iTerm2';
    }

    // 如果在不支持的终端中运行
    if (inTmux || terminalType === 'unknown') {
      const currentTerm = inTmux ? 'tmux/screen' : terminalType;
      const platform = process.platform;
      let supportedTerminals = '';

      if (platform === 'darwin') {
        supportedTerminals = `   • macOS: iTerm2, Apple Terminal\n`;
      } else if (platform === 'win32') {
        supportedTerminals = `   • Windows: Windows Terminal\n`;
      }

      const message = `Terminal setup cannot be run from ${currentTerm}.

This command configures a convenient Shift+Enter shortcut for multi-line prompts.
${inTmux ? '' : 'Note: You can already use backslash (\\\\) + return to add newlines.\\n'}

To set up the shortcut (optional):
${inTmux ? '1. Exit tmux/screen temporarily\\n2. Run /terminal-setup directly in one of these terminals:' : 'Please run this in one of these supported terminals:'}
${supportedTerminals}   • IDE: VSCode, Cursor, Windsurf
   • Other: Ghostty, WezTerm
${inTmux ? '3. Return to tmux/screen - settings will persist' : ''}

For more help, visit: https://code.claude.com/terminal-setup`;

      ctx.ui.addMessage('assistant', message);
      return { success: false };
    }

    // 在支持的终端中运行 - 显示配置说明
    let configInstructions = '';

    switch (terminalType) {
      case 'VSCode':
      case 'Cursor':
      case 'Windsurf':
        configInstructions = `Terminal Setup for ${terminalType}

Shift+Enter is already configured in ${terminalType}'s integrated terminal!

Usage:
  • Shift+Enter: Add a newline without submitting
  • Enter: Submit your prompt

Tips:
  • You can also use backslash (\\\\) + Enter for newlines
  • Multi-line editing works in all supported terminals
  • No additional configuration needed for ${terminalType}

The Shift+Enter binding should work automatically in the integrated terminal.`;
        break;

      case 'WezTerm':
        configInstructions = `Terminal Setup for WezTerm

To configure Shift+Enter for multi-line prompts in WezTerm:

1. Open (or create) your WezTerm config file:
   ~/.config/wezterm/wezterm.lua

2. Add this key binding:

   local config = wezterm.config_builder()

   config.keys = {
     {key="Enter", mods="SHIFT", action=wezterm.action{SendString="\\\\x1b\\\\r"}},
   }

   return config

3. Save and restart WezTerm

After this, Shift+Enter will add newlines without submitting your prompt.

Documentation: https://wezfurlong.org/wezterm/config/keys.html`;
        break;

      case 'Ghostty':
        configInstructions = `Terminal Setup for Ghostty

To configure Shift+Enter for multi-line prompts in Ghostty:

1. Open (or create) your Ghostty config file:
   ~/.config/ghostty/config

2. Add this key binding:

   keybind = shift+enter=text:\\\\x1b\\\\r

3. Save and restart Ghostty

After this, Shift+Enter will add newlines without submitting your prompt.

Documentation: https://ghostty.org/docs`;
        break;

      case 'Apple Terminal':
        configInstructions = `Terminal Setup for Apple Terminal

Terminal.app doesn't support custom Shift+Enter binding.

Alternative options:
  • Use Option+Enter for newlines (if "Use Option as Meta" is enabled)
  • Use backslash (\\\\) + Enter for newlines
  • Consider using iTerm2 for better customization

To enable Option as Meta in Terminal.app:
1. Terminal > Preferences
2. Select your profile
3. Check "Use Option as Meta key"

After this, Option+Enter will work as a newline.`;
        break;

      case 'iTerm2':
        configInstructions = `Terminal Setup for iTerm2

To configure Shift+Enter for multi-line prompts in iTerm2:

1. Open iTerm2 > Preferences > Profiles
2. Select your profile
3. Go to Keys tab
4. Click "+" to add a key mapping
5. Configure:
   - Keyboard Shortcut: Shift+Enter
   - Action: Send Escape Sequence
   - Value: \\r

After this, Shift+Enter will add newlines without submitting your prompt.

Documentation: https://iterm2.com/documentation-preferences.html`;
        break;

      default:
        configInstructions = `Terminal Setup

Your terminal (${terminalType}) is supported!

General Instructions:
  • Configure Shift+Enter to send escape sequence: \\\\x1b\\\\r
  • This allows multi-line input without submitting
  • You can also use backslash (\\\\) + Enter for newlines

Check your terminal's documentation for custom key binding configuration.`;
    }

    ctx.ui.addMessage('assistant', configInstructions);
    ctx.ui.addActivity(`Showed terminal setup for ${terminalType}`);
    return { success: true };
  },
};

// /sandbox - 沙箱设置
export const sandboxCommand: SlashCommand = {
  name: 'sandbox',
  description: 'Configure sandbox settings for tool execution',
  usage: '/sandbox [status|enable|disable]',
  category: 'config',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const action = args[0]?.toLowerCase();

    // 检查当前沙箱状态
    const sandboxEnabled = process.env.AXON_ENABLE_SANDBOX === 'true';
    const platform = process.platform;
    const supportsSandbox = platform === 'linux'; // Bubblewrap 仅支持 Linux

    if (!action || action === 'status') {
      let sandboxInfo = `Sandbox Settings\n\n`;
      sandboxInfo += `Status: ${sandboxEnabled ? '✓ Enabled' : '✗ Disabled'}\n`;
      sandboxInfo += `Platform: ${platform}\n`;
      sandboxInfo += `Sandbox Support: ${supportsSandbox ? '✓ Available (Linux with Bubblewrap)' : '✗ Not available (requires Linux)'}\n\n`;

      if (!supportsSandbox) {
        sandboxInfo += `Note: Sandbox isolation requires Linux with Bubblewrap installed.\n`;
        sandboxInfo += `On Windows, consider using WSL for sandbox support.\n`;
        sandboxInfo += `On macOS, sandbox features are limited.\n\n`;
      }

      sandboxInfo += `Commands:\n`;
      sandboxInfo += `  /sandbox status   - Show current status\n`;
      sandboxInfo += `  /sandbox enable   - Enable sandbox (Linux only)\n`;
      sandboxInfo += `  /sandbox disable  - Disable sandbox\n\n`;

      sandboxInfo += `Environment Variable:\n`;
      sandboxInfo += `  AXON_ENABLE_SANDBOX=true|false\n`;

      ctx.ui.addMessage('assistant', sandboxInfo);
      return { success: true };
    }

    if (action === 'enable') {
      if (!supportsSandbox) {
        ctx.ui.addMessage('assistant', `Cannot enable sandbox on ${platform}.\n\nSandbox requires Linux with Bubblewrap installed.`);
        return { success: false };
      }
      process.env.AXON_ENABLE_SANDBOX = 'true';
      ctx.ui.addMessage('assistant', 'Sandbox enabled for this session.\n\nTo make permanent, set AXON_ENABLE_SANDBOX=true in your environment.');
      return { success: true };
    }

    if (action === 'disable') {
      process.env.AXON_ENABLE_SANDBOX = 'false';
      ctx.ui.addMessage('assistant', 'Sandbox disabled for this session.');
      return { success: true };
    }

    ctx.ui.addMessage('assistant', `Unknown action: ${action}\n\nUsage: /sandbox [status|enable|disable]`);
    return { success: false };
  },
};

// /keybindings - 键盘快捷键配置 (v2.1.18)
export const keybindingsCommand: SlashCommand = {
  name: 'keybindings',
  aliases: ['keys', 'shortcuts'],
  description: 'Open or create your keybindings configuration file',
  usage: '/keybindings',
  category: 'config',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    // 动态导入以避免循环依赖
    const { getKeybindingsPath, generateTemplateContent, isUserCustomizationEnabled } = await import('../config/keybindings.js');
    const { openInEditor } = await import('../utils/editor.js');
    const fsPromises = await import('fs/promises');

    if (!isUserCustomizationEnabled()) {
      ctx.ui.addMessage('assistant', 'Keybinding customization is not enabled. This feature is currently in preview.');
      return { success: false };
    }

    const filePath = getKeybindingsPath();
    let fileExists = false;

    try {
      await fsPromises.stat(filePath);
      fileExists = true;
    } catch {
      // 文件不存在
    }

    if (!fileExists) {
      // 创建默认模板
      const template = generateTemplateContent();
      const dirPath = path.dirname(filePath);

      try {
        await fsPromises.mkdir(dirPath, { recursive: true });
        await fsPromises.writeFile(filePath, template, 'utf-8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.addMessage('assistant', `Failed to create keybindings.json: ${message}`);
        return { success: false };
      }
    }

    // 尝试在编辑器中打开
    try {
      await openInEditor(filePath);
      const message = fileExists
        ? `Opened ${filePath} in your editor.`
        : `Created ${filePath} with template. Opened in your editor.`;
      ctx.ui.addMessage('assistant', message);
      ctx.ui.addActivity('Opened keybindings configuration');
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const prefix = fileExists ? 'Opened' : 'Created';
      ctx.ui.addMessage('assistant', `${prefix} ${filePath}. Could not open in editor: ${message}\n\nYou can edit the file manually at:\n${filePath}`);
      return { success: true };
    }
  },
};

// 注册所有配置命令
export function registerConfigCommands(): void {
  commandRegistry.register(configCommand);
  commandRegistry.register(permissionsCommand);
  commandRegistry.register(memoryCommand);
  commandRegistry.register(hooksCommand);
  commandRegistry.register(modelCommand);
  commandRegistry.register(initCommand);
  commandRegistry.register(privacySettingsCommand);
  commandRegistry.register(vimCommand);
  commandRegistry.register(themeCommand);
  commandRegistry.register(discoverCommand);
  commandRegistry.register(outputStyleCommand);
  commandRegistry.register(statuslineCommand);
  commandRegistry.register(remoteEnvCommand);
  commandRegistry.register(terminalSetupCommand);
  commandRegistry.register(sandboxCommand);
  commandRegistry.register(keybindingsCommand);
}
