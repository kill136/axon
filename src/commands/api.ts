/**
 * API 子命令 - query, models, usage, test, tokens
 * 基于官方 Claude Code 源码实现
 */

import type { SlashCommand, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './registry.js';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 获取API密钥
function getApiKey(): string | null {
  // 优先从环境变量获取
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
  if (envKey) return envKey;

  // 从配置文件获取
  const credentialsFile = path.join(os.homedir(), '.axon', 'credentials.json');
  if (fs.existsSync(credentialsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
      return creds.apiKey || creds.api_key || null;
    } catch {
      return null;
    }
  }

  return null;
}

// /api query - 直接发送 API 查询
export const apiQueryCommand: SlashCommand = {
  name: 'api',
  aliases: ['api-query'],
  description: 'Send a direct query to Claude API',
  usage: '/api <query> or /api query <query>',
  category: 'utility',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { args } = ctx;

    // 如果没有参数或第一个参数是 help
    if (args.length === 0 || args[0] === 'help' || args[0] === '-h' || args[0] === '--help') {
      const helpInfo = `╭─ Claude API Commands ─────────────────────────────╮
│                                                    │
│  Usage:                                            │
│    /api query <query>    Send a direct API query   │
│    /api models           List available models     │
│    /api usage            Show API usage stats      │
│    /api test             Test API connection       │
│    /api tokens           Manage API tokens         │
│                                                    │
│  Examples:                                         │
│    /api query "What is TypeScript?"                │
│    /api models                                     │
│    /api usage                                      │
│    /api test                                       │
│                                                    │
│  Shortcuts:                                        │
│    /api <query>          Same as /api query        │
│                                                    │
╰────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', helpInfo);
      return { success: true };
    }

    // 处理子命令
    const subcommand = args[0].toLowerCase();

    // 如果是子命令，分派到对应处理器
    if (['query', 'models', 'usage', 'test', 'tokens'].includes(subcommand)) {
      return executeApiSubcommand(subcommand, args.slice(1), ctx);
    }

    // 否则将整个参数作为查询
    const query = args.join(' ');
    return executeApiQuery(query, ctx);
  },
};

// 执行 API 查询
async function executeApiQuery(query: string, ctx: CommandContext): Promise<CommandResult> {
  if (!query.trim()) {
    ctx.ui.addMessage('assistant', 'Please provide a query. Usage: /api query <your question>');
    return { success: false };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    ctx.ui.addMessage(
      'assistant',
      `No API key found. Please set up your API key:

1. Environment variable:
   export ANTHROPIC_API_KEY=sk-ant-your-key-here

2. Run /login --api-key for setup instructions

3. Or use /setup-token to save your key`
    );
    return { success: false };
  }

  ctx.ui.addActivity('Sending query to Claude API...');

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: ctx.config.model || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: query,
        },
      ],
    });

    // 提取响应文本
    const textContent = response.content.find((block) => block.type === 'text');
    const responseText = textContent && 'text' in textContent ? textContent.text : 'No text response';

    // 显示响应
    ctx.ui.addMessage('assistant', `API Response:\n\n${responseText}`);

    // 显示使用统计
    const usageInfo = `
Usage:
  • Input tokens: ${response.usage.input_tokens}
  • Output tokens: ${response.usage.output_tokens}
  • Model: ${response.model}
  • Stop reason: ${response.stop_reason}`;

    ctx.ui.addActivity(usageInfo);

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    ctx.ui.addMessage('assistant', `API Error: ${errorMsg}`);
    return { success: false };
  }
}

// 执行 API 子命令
async function executeApiSubcommand(
  subcommand: string,
  args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  switch (subcommand) {
    case 'query':
      return executeApiQuery(args.join(' '), ctx);

    case 'models':
      return executeApiModels(ctx);

    case 'usage':
      return executeApiUsage(ctx);

    case 'test':
      return executeApiTest(ctx);

    case 'tokens':
      return executeApiTokens(args, ctx);

    default:
      ctx.ui.addMessage('assistant', `Unknown subcommand: ${subcommand}`);
      return { success: false };
  }
}

// /api models - 列出可用模型
async function executeApiModels(ctx: CommandContext): Promise<CommandResult> {
  const modelsInfo = `Available Claude Models

╭─────────────────────────────────────────────────────╮
│ Claude 4.6 Series (Latest)                          │
│                                                     │
│ • claude-opus-4-6                                   │
│   ├─ Context: 1M tokens                             │
│   ├─ Best for: Complex reasoning, long tasks        │
│   ├─ Pricing: $15 / $75 per MTok (in/out)           │
│   └─ Highest capability (latest)                    │
│                                                     │
│ Claude 4.5 Series                                   │
│                                                     │
│ • claude-sonnet-4-5-20250929                        │
│   ├─ Context: 200K tokens                           │
│   ├─ Best for: Most tasks, balanced performance     │
│   ├─ Pricing: $3 / $15 per MTok (in/out)            │
│   └─ Recommended: Default choice                    │
│                                                     │
│ • claude-haiku-4-5-20250514                         │
│   ├─ Context: 200K tokens                           │
│   ├─ Best for: Fast, simple tasks                   │
│   ├─ Pricing: $0.80 / $4 per MTok (in/out)          │
│   └─ Most cost-effective                            │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Claude 3.5 Series                                   │
│                                                     │
│ • claude-3-5-sonnet-20241022                        │
│ • claude-3-5-haiku-20241022                         │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Claude 3 Series (Legacy)                            │
│                                                     │
│ • claude-3-opus-20240229                            │
│ • claude-3-sonnet-20240229                          │
│ • claude-3-haiku-20240307                           │
│                                                     │
╰─────────────────────────────────────────────────────╯

Current Model: ${ctx.config.model}

To switch models:
  /model               Interactive model selector
  /model sonnet        Switch to Claude 4.5 Sonnet
  /model opus          Switch to Claude 4.5 Opus
  /model haiku         Switch to Claude 4.5 Haiku

Documentation:
  https://docs.anthropic.com/en/docs/models-overview`;

  ctx.ui.addMessage('assistant', modelsInfo);
  return { success: true };
}

// /api usage - 显示 API 使用统计
async function executeApiUsage(ctx: CommandContext): Promise<CommandResult> {
  const stats = ctx.session.getStats();

  const usageInfo = `API Usage Statistics

Session Information:
  • Session ID: ${ctx.session.id}
  • Duration: ${Math.floor(stats.duration / 1000)}s
  • Messages: ${stats.messageCount}

Token Usage:
  • Total cost: $${stats.totalCost}
  • Model: ${ctx.config.modelDisplayName}

Model-specific Usage:
${formatModelUsage(stats.modelUsage)}

To view detailed costs:
  /cost                Show detailed cost breakdown
  /session stats       Show full session statistics

To check API limits:
  Visit https://platform.axon.com/settings/limits`;

  ctx.ui.addMessage('assistant', usageInfo);
  return { success: true };
}

// 格式化模型使用情况
function formatModelUsage(modelUsage: Record<string, number>): string {
  if (Object.keys(modelUsage).length === 0) {
    return '  (No usage data available)';
  }

  return Object.entries(modelUsage)
    .map(([model, count]) => `  • ${model}: ${count} calls`)
    .join('\n');
}

// /api test - 测试 API 连接
async function executeApiTest(ctx: CommandContext): Promise<CommandResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    ctx.ui.addMessage(
      'assistant',
      `❌ API Key Not Found

No API key detected. Please set up your API key:

1. Environment variable:
   export ANTHROPIC_API_KEY=sk-ant-your-key-here

2. Configuration file:
   Run /setup-token to save your key

3. Login:
   Run /login --api-key for detailed setup`
    );
    return { success: false };
  }

  // 验证 API key 格式
  if (!apiKey.startsWith('sk-ant-')) {
    ctx.ui.addMessage(
      'assistant',
      `⚠️  Invalid API Key Format

Your API key should start with "sk-ant-"
Current key: ${apiKey.substring(0, 15)}...

Please check your API key and try again.`
    );
    return { success: false };
  }

  ctx.ui.addActivity('Testing API connection...');

  try {
    const client = new Anthropic({ apiKey });

    // 发送简单的测试请求
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20250514', // 使用最快的模型
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Hello',
        },
      ],
    });

    const successInfo = `✅ API Connection Successful

API Key Status:
  • Format: Valid (sk-ant-...)
  • Authentication: ✓ Successful
  • API Key: ${apiKey.substring(0, 20)}...

Test Request:
  • Model: ${response.model}
  • Input tokens: ${response.usage.input_tokens}
  • Output tokens: ${response.usage.output_tokens}
  • Response time: < 1s

Configuration:
  • Current model: ${ctx.config.model}
  • Model display: ${ctx.config.modelDisplayName}
  • API type: ${ctx.config.apiType || 'anthropic'}

Your API connection is working correctly!

Next steps:
  • Use /api query <question> to send queries
  • Use /model to switch between models
  • Use /api usage to monitor usage`;

    ctx.ui.addMessage('assistant', successInfo);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    let errorInfo = `❌ API Connection Failed

Error: ${errorMsg}

Common Issues:

1. Invalid API Key:
   • Check that your key starts with "sk-ant-"
   • Verify the key at https://platform.axon.com/settings/keys
   • Try regenerating your API key

2. Network Issues:
   • Check your internet connection
   • Verify firewall settings
   • Try again in a few moments

3. Rate Limits:
   • You may have exceeded rate limits
   • Visit https://platform.axon.com/settings/limits
   • Wait a few minutes and try again

To update your API key:
  /setup-token         Save a new API key
  /login --api-key     View setup instructions`;

    ctx.ui.addMessage('assistant', errorInfo);
    return { success: false };
  }
}

// /api tokens - 管理 API tokens
async function executeApiTokens(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand || subcommand === 'help') {
    const tokensHelp = `API Token Management

Commands:
  /api tokens status      Show current token configuration
  /api tokens set         Set a new API token
  /api tokens clear       Clear stored API token
  /api tokens help        Show this help

Token Storage Locations:

1. Environment Variables (Highest Priority):
   • ANTHROPIC_API_KEY
   • AXON_API_KEY

2. Configuration File:
   • ~/.axon/credentials.json

3. Session Token:
   • Temporary tokens for current session

Current Status:
  ${getTokenStatus()}

To manage tokens:
  /api tokens status       Check current configuration
  /setup-token             Interactive token setup
  /login --api-key         Detailed setup guide`;

    ctx.ui.addMessage('assistant', tokensHelp);
    return { success: true };
  }

  switch (subcommand) {
    case 'status': {
      const status = `API Token Status

${getTokenStatus()}

Priority Order:
  1. ANTHROPIC_API_KEY (environment)
  2. AXON_API_KEY (environment)
  3. ~/.axon/credentials.json (file)

Configuration:
  • API Type: ${ctx.config.apiType || 'anthropic'}
  • Model: ${ctx.config.model}
  • Organization: ${ctx.config.organization || 'N/A'}

To test your token:
  /api test            Test API connection

To update token:
  /setup-token         Interactive setup
  /api tokens set      Set new token`;

      ctx.ui.addMessage('assistant', status);
      return { success: true };
    }

    case 'set': {
      const setInfo = `Set API Token

To set a new API token, use one of these methods:

1. Interactive Setup (Recommended):
   /setup-token

   This will prompt you for your API key and save it securely.

2. Environment Variable:
   export ANTHROPIC_API_KEY=sk-ant-your-key-here

   Add to ~/.bashrc or ~/.zshrc for persistence.

3. Manual File Edit:
   Edit ~/.axon/credentials.json:
   {
     "apiKey": "sk-ant-your-key-here"
   }

Security Notes:
  • Never commit API keys to git
  • Use environment variables in production
  • Rotate keys regularly
  • Set spend limits at platform.axon.com

Get your API key:
  https://platform.axon.com/settings/keys`;

      ctx.ui.addMessage('assistant', setInfo);
      return { success: true };
    }

    case 'clear': {
      const credentialsFile = path.join(os.homedir(), '.axon', 'credentials.json');

      if (fs.existsSync(credentialsFile)) {
        try {
          fs.unlinkSync(credentialsFile);
          ctx.ui.addMessage(
            'assistant',
            `✅ Cleared stored API token

Removed: ~/.axon/credentials.json

Note: Environment variables are still set if you have them.
To clear environment variables:
  unset ANTHROPIC_API_KEY
  unset AXON_API_KEY

To set a new token:
  /setup-token
  /api tokens set`
          );
          return { success: true };
        } catch (error) {
          ctx.ui.addMessage('assistant', `Error clearing token: ${error}`);
          return { success: false };
        }
      } else {
        ctx.ui.addMessage(
          'assistant',
          `No stored token file found.

If you have environment variables set:
  unset ANTHROPIC_API_KEY
  unset AXON_API_KEY`
        );
        return { success: true };
      }
    }

    default: {
      ctx.ui.addMessage(
        'assistant',
        `Unknown subcommand: ${subcommand}

Available subcommands:
  /api tokens status      Show current token configuration
  /api tokens set         Set a new API token
  /api tokens clear       Clear stored API token
  /api tokens help        Show this help`
      );
      return { success: false };
    }
  }
}

// 获取 token 状态信息
function getTokenStatus(): string {
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
  const credentialsFile = path.join(os.homedir(), '.axon', 'credentials.json');
  const hasFileKey = fs.existsSync(credentialsFile);

  let status = '';

  if (envKey) {
    status += `✓ Environment Variable: ${envKey.substring(0, 20)}...\n`;
    status += `  Source: ${process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'AXON_API_KEY'}\n`;
  } else {
    status += `✗ Environment Variable: Not set\n`;
  }

  if (hasFileKey) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
      const fileKey = creds.apiKey || creds.api_key;
      if (fileKey) {
        status += `✓ File Token: ${fileKey.substring(0, 20)}...\n`;
        status += `  Location: ~/.axon/credentials.json\n`;
      } else {
        status += `✗ File Token: File exists but no key found\n`;
      }
    } catch {
      status += `✗ File Token: File exists but invalid format\n`;
    }
  } else {
    status += `✗ File Token: Not found\n`;
  }

  if (!envKey && !hasFileKey) {
    status += `\n⚠️  No API token configured\n`;
    status += `Run /login --api-key for setup instructions`;
  }

  return status;
}

// 注册 API 命令
export function registerApiCommands(): void {
  commandRegistry.register(apiQueryCommand);
}
