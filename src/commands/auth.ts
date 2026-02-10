/**
 * 认证命令 - login, logout, upgrade, passes, etc.
 * 基于官方 Claude Code 源码实现
 */

import type { SlashCommand, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { forcePrefetchPenguinMode } from '../fast-mode/index.js';
import {
  startOAuthLogin,
  logout as authLogout,
  setupToken,
  getAuth,
  isAuthenticated,
  getAuthType,
} from '../auth/index.js';

// 获取认证文件路径
const getAuthFile = () => path.join(os.homedir(), '.claude', 'auth.json');
const getCredentialsFile = () => path.join(os.homedir(), '.claude', 'credentials.json');
const getConfigFile = () => path.join(os.homedir(), '.claude', 'settings.json');

// /login - 登录（基于官方源码完善）
export const loginCommand: SlashCommand = {
  name: 'login',
  description: 'Login to Claude API or claude.ai',
  usage: '/login [--api-key | --oauth | --console | --claudeai]',
  category: 'auth',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const method = args[0]?.toLowerCase() || '';

    // 检查当前认证状态
    const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    const hasCredentials = fs.existsSync(getCredentialsFile());
    const hasOAuthToken = fs.existsSync(getAuthFile());

    let authStatus = 'Not authenticated';
    if (hasApiKey) {
      authStatus = 'Authenticated (API Key from environment)';
    } else if (hasCredentials) {
      authStatus = 'Authenticated (API Key from file)';
    } else if (hasOAuthToken) {
      authStatus = 'Authenticated (OAuth)';
    }

    // 无参数时显示交互式登录选择器（官方行为）
    if (!method) {
      // 触发 UI 显示登录选择器
      if (ctx.ui.setShowLoginScreen) {
        ctx.ui.setShowLoginScreen(true);
        ctx.ui.addActivity('Opening login selector...');
        return { success: true, action: 'login' };
      }
      // 如果 UI 不支持，回退到文本提示
      ctx.ui.addMessage('assistant', `Select login method:

1. /login --claudeai    Claude account with subscription (Pro, Max, Team, Enterprise)
2. /login --console     Anthropic Console account (API usage billing)
3. /login --api-key     Setup with API key

Current status: ${authStatus}`);
      return { success: true };
    }

    // help 时显示详细帮助
    if (method === 'help' || method === '-h' || method === '--help') {
      const loginInfo = `╭─ Claude Code Login ────────────────────────────────╮
│                                                    │
│  Current Status: ${authStatus.padEnd(32)}│
│                                                    │
│  Login Methods:                                    │
│                                                    │
│  1. API Key (Recommended for developers)           │
│     • Get key from: https://platform.claude.com  │
│     • Command: /login --api-key                    │
│     • Best for: Pay-per-use API billing            │
│                                                    │
│  2. OAuth with Claude.ai Account                   │
│     • For Claude Pro/Max subscribers               │
│     • Command: /login --claudeai                   │
│     • Opens browser for authentication             │
│                                                    │
│  3. OAuth with Console Account                     │
│     • For Anthropic Console users                  │
│     • Command: /login --console                    │
│     • API usage billing                            │
│                                                    │
│  Quick Start:                                      │
│    /login --api-key        Setup API key           │
│    /login --oauth          Interactive OAuth       │
│    /setup-token            Generate long-term token│
│                                                    │
│  Environment Variables:                            │
│    ANTHROPIC_API_KEY       Primary API key         │
│    CLAUDE_API_KEY          Alternative API key     │
│    CLAUDE_CODE_OAUTH_TOKEN OAuth token             │
│                                                    │
│  Files:                                            │
│    ~/.claude/credentials.json   API keys           │
│    ~/.claude/auth.json          OAuth tokens       │
│                                                    │
│  Verify Authentication:                            │
│    /doctor                 Check auth status       │
│    /status                 Show current user       │
│                                                    │
╰────────────────────────────────────────────────────╯`;

      ctx.ui.addMessage('assistant', loginInfo);
      return { success: true };
    }

    // --api-key 方法
    if (method === '--api-key' || method === 'api-key' || method === 'apikey') {
      const apiKeyInfo = `API Key Setup

API keys provide usage-based billing and are the recommended method
for developers using Claude Code.

Steps:

1. Get your API key:
   Visit: https://platform.claude.com/settings/keys
   Create or copy an existing key

2. Set the API key (choose one method):

   a) Environment variable (recommended):
      # Add to ~/.bashrc, ~/.zshrc, or ~/.bash_profile
      export ANTHROPIC_API_KEY=sk-ant-your-key-here

      # Then reload your shell
      source ~/.bashrc

   b) Direct setup (stores in ~/.claude/credentials.json):
      Run: /setup-token
      Then paste your API key when prompted

   c) Temporary (session only):
      export ANTHROPIC_API_KEY=sk-ant-your-key-here
      claude

3. Verify:
   Run: /doctor
   Check that API key is detected

Current Status: ${authStatus}

Note: API keys start with "sk-ant-"`;

      ctx.ui.addMessage('assistant', apiKeyInfo);
      ctx.ui.addActivity('Showed API key setup guide');
      return { success: true };
    }

    // --oauth, --claudeai, --console 方法
    if (
      method === '--oauth' ||
      method === 'oauth' ||
      method === '--claudeai' ||
      method === 'claudeai' ||
      method === '--console' ||
      method === 'console'
    ) {
      // 确定账户类型
      const accountType: 'claude.ai' | 'console' = method.includes('claudeai')
        ? 'claude.ai'
        : 'console';

      const loginType = accountType === 'claude.ai'
        ? 'Claude.ai (Subscription)'
        : 'Console (API Billing)';

      // 显示开始登录信息
      ctx.ui.addMessage('assistant', `Starting OAuth login with ${loginType}...

Please follow the instructions in the terminal to complete authentication.`);
      ctx.ui.addActivity(`Starting OAuth login (${accountType})...`);

      // 尝试启动 OAuth 流程
      try {
        // 调用认证系统的 startOAuthLogin()
        const authResult = await startOAuthLogin({ accountType });

        if (authResult && authResult.accessToken) {
          const successMsg = `✅ OAuth Login Successful!

Authentication Details:
  • Type: OAuth (${loginType})
  • Access Token: ${authResult.accessToken.substring(0, 20)}...
  • Expires At: ${authResult.expiresAt ? new Date(authResult.expiresAt).toLocaleString() : 'N/A'}
  • Scope: ${authResult.scope?.join(', ') || 'N/A'}
  • OAuth API Key: ${authResult.oauthApiKey ? 'Created' : 'N/A (using OAuth token)'}

Credentials saved to:
  ~/.claude/auth.json

You can now use Claude Code with your OAuth credentials.

Current Status: Authenticated (OAuth)

To verify your authentication:
  /doctor
  /status`;

          ctx.ui.addMessage('assistant', successMsg);
          ctx.ui.addActivity('OAuth login completed successfully');
          // 返回 reinitClient action 以重新初始化客户端
          return { success: true, action: 'reinitClient' };
        } else {
          throw new Error('OAuth login returned invalid result');
        }
      } catch (error) {
        const errorMsg = `❌ OAuth Login Failed

Error: ${error instanceof Error ? error.message : String(error)}

For immediate use, please try:
  /login --api-key     Setup with API key
  /setup-token         Quick API key setup

Alternative OAuth Setup:
  1. If you have official Claude Code CLI, use that for OAuth
  2. Then copy ~/.claude/auth.json to this installation

Current Status: ${authStatus}`;

        ctx.ui.addMessage('assistant', errorMsg);
        ctx.ui.addActivity(`OAuth login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return { success: false };
      }
    }

    // 未知方法
    ctx.ui.addMessage('assistant', `Unknown login method: ${method}

Available methods:
  /login              Show this help
  /login --api-key    Setup with API key
  /login --oauth      OAuth login (interactive)
  /login --claudeai   OAuth with Claude.ai
  /login --console    OAuth with Console
  /setup-token        Quick API key setup

Use /login --help for detailed information.`);
    return { success: false };
  },
};

// /logout - 登出（基于官方源码完善）
export const logoutCommand: SlashCommand = {
  name: 'logout',
  description: 'Sign out from your Anthropic account',
  category: 'auth',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const credentialsFile = getCredentialsFile();
    const configFile = getConfigFile();

    ctx.ui.addActivity('Logging out...');

    // 调用认证系统的 logout() 函数
    try {
      authLogout();
    } catch (err) {
      // 继续处理其他清理
    }

    // 清除存储的 API key
    if (fs.existsSync(credentialsFile)) {
      try {
        fs.unlinkSync(credentialsFile);
      } catch (err) {
        // 忽略错误
      }
    }

    // 清除配置文件中的会话信息
    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        let modified = false;

        if (config.sessionToken) {
          delete config.sessionToken;
          modified = true;
        }

        if (config.oauthAccount) {
          delete config.oauthAccount;
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        }
      } catch (err) {
        // 忽略错误
      }
    }

    // 显示登出成功消息（与官方一致）
    ctx.ui.addMessage('assistant', 'Successfully logged out from your Anthropic account.');
    ctx.ui.addActivity('Logged out successfully');

    // 返回 logout action，App.tsx 会在 200ms 后退出程序（与官方行为一致）
    return { success: true, action: 'logout' };
  },
};

// /upgrade - 升级账户
export const upgradeCommand: SlashCommand = {
  name: 'upgrade',
  description: 'Upgrade your Claude subscription',
  category: 'auth',
  execute: (ctx: CommandContext): CommandResult => {
    const upgradeInfo = `Upgrade Claude Subscription

Current Plans:

┌─────────────────────────────────────────────────────┐
│ Free     - Limited usage                            │
│           • Basic features                           │
│           • Rate limits                              │
│           • Community support                        │
│                                                      │
│ Pro      - Higher limits, priority access            │
│           • ~10x more requests than Free             │
│           • Priority access                          │
│           • Extended context                         │
│           • $20/month                                │
│                                                      │
│ Max      - Maximum limits, enterprise features       │
│           • ~20x more requests than Pro              │
│           • Extended usage limits                    │
│           • Priority support                         │
│           • $200/month                               │
│                                                      │
│ Team     - Collaboration features                    │
│           • Shared workspaces                        │
│           • Team management                          │
│           • Usage analytics                          │
│           • Custom pricing                           │
│                                                      │
│ Enterprise - Custom solutions                        │
│           • Dedicated support                        │
│           • SLA guarantees                           │
│           • Custom integrations                      │
│           • Contact sales                            │
└─────────────────────────────────────────────────────┘

To upgrade:
  1. Visit https://claude.ai/settings
  2. Select your desired plan
  3. Complete payment
  4. Restart Claude Code to use your new limits

API Pricing (platform.claude.com):
  • Pay per token used
  • No subscription required
  • Best for developers and variable usage

  Claude 4.5 Sonnet:  $3 / $15 per MTok (in/out)
  Claude 4.5 Opus:    $15 / $75 per MTok (in/out)
  Claude 4.5 Haiku:   $0.80 / $4 per MTok (in/out)

For enterprise inquiries:
  https://www.anthropic.com/contact-sales

Current Usage:
  Use /usage to view your current usage statistics
  Use /cost to see detailed cost breakdown`;

    ctx.ui.addMessage('assistant', upgradeInfo);
    return { success: true };
  },
};

// /passes - Guest passes（基于官方源码）
export const passesCommand: SlashCommand = {
  name: 'passes',
  aliases: ['guest-passes'],
  description: 'View or share guest passes',
  category: 'auth',
  execute: (ctx: CommandContext): CommandResult => {
    const passesInfo = `Guest Passes

Guest passes let you share Claude Code with friends and colleagues.

Status: Feature available for Max subscribers

How it works:
  1. Max subscribers get 3 guest passes
  2. Each pass gives 1 week of Claude Code access
  3. Share via email or link
  4. Recipients get full Claude Code features for 7 days

To check your passes:
  • Requires Max subscription
  • Visit https://claude.ai/settings/passes
  • View available and used passes
  • Generate new invite links

To redeem a pass:
  • Click the shared link
  • Sign in or create a Claude account
  • Start using Claude Code immediately

Pass Details:
  • Duration: 7 days from activation
  • Features: Full Claude Code access
  • Limit: 3 active passes per Max subscriber
  • Renewal: Passes refresh monthly

Sharing a Pass:
  1. Log in to https://claude.ai
  2. Navigate to Settings > Guest Passes
  3. Click "Generate Pass"
  4. Copy and share the link

Note: This is an educational project and does not have access to
official Claude.ai pass generation. For actual passes, use the
official Claude Code installation from:
  https://code.claude.com`;

    ctx.ui.addMessage('assistant', passesInfo);
    return { success: true };
  },
};

// /extra-usage - 额外使用量（基于官方源码完善）
export const extraUsageCommand: SlashCommand = {
  name: 'extra-usage',
  description: 'Manage extra usage beyond your plan limits',
  usage: '/extra-usage [status | enable | disable | help]',
  category: 'auth',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const subcommand = args[0]?.toLowerCase() || 'help';

    // 模拟检查用户订阅状态
    // 官方代码从 API 获取：hasExtraUsageEnabled, f4() 等
    const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    const userPlan = hasApiKey ? 'api' : 'free'; // 在实际中从 API 获取

    // 处理子命令
    switch (subcommand) {
      case 'status': {
        // 显示当前 extra usage 状态
        // 官方从 /api/oauth/usage 获取 extra_usage 数据
        const statusInfo = `Extra Usage Status

Current Plan: ${userPlan === 'api' ? 'API (usage-based billing)' : userPlan.toUpperCase()}

${
  userPlan === 'api'
    ? `API Key Authentication:
  • You're using usage-based billing
  • Extra usage not applicable
  • Pay only for what you use
  • Set spend limits at https://platform.claude.com

Current Status:
  • Billing: Per-token usage
  • No subscription limits
  • Extra usage: N/A (automatic billing)`
    : `Subscription Status:
  • Extra usage: Not enabled
  • To enable extra usage:
    Run: /extra-usage enable
    Or visit: https://claude.ai/settings

What is Extra Usage?
  • Purchase additional usage beyond your plan limits
  • Available for Pro and Max subscribers
  • Pay-per-use pricing for overages
  • Automatic billing at end of billing cycle`
}

To manage extra usage:
  /extra-usage enable    Enable extra usage
  /extra-usage disable   Disable extra usage
  /extra-usage help      Show this help

For more information:
  Visit https://claude.ai/settings`;

        ctx.ui.addMessage('assistant', statusInfo);
        return { success: true };
      }

      case 'enable': {
        // 启用 extra usage
        const enableInfo = `Enable Extra Usage

${
  userPlan === 'api'
    ? `API Key Users:

Extra usage is not applicable when using API keys.
You're already on usage-based billing - you pay only for what you use.

To manage your API usage:
  • Set spend limits: https://platform.claude.com/settings/limits
  • View usage: https://platform.claude.com/settings/usage
  • Manage billing: https://platform.claude.com/settings/billing`
    : `To enable extra usage for your Claude subscription:

1. Visit Claude Settings:
   https://claude.ai/settings

2. Navigate to Billing section

3. Enable "Extra Usage" option
   • Available for Pro and Max plans
   • Set monthly spending limit (optional)
   • Confirm billing details

4. Pricing (approximate):
   • Pro users: Pay-per-use beyond plan limits
   • Max users: Higher included limits, then pay-per-use
   • Pricing similar to API rates

5. Safety Controls:
   • Set monthly spending caps
   • Receive notifications at thresholds
   • Can disable at any time

After enabling:
  • Run /extra-usage status to verify
  • Run /usage to see your limits
  • You'll be notified when approaching limits

Note: This educational project cannot enable extra usage directly.
Please use the official Claude Code CLI or web interface.`
}`;

        ctx.ui.addMessage('assistant', enableInfo);

        // v2.1.37: 启用 extra-usage 后立即触发 penguin mode 预检查
        // 修复 /fast 在启用 /extra-usage 后不能立即可用的问题
        forcePrefetchPenguinMode().catch(() => {});

        return { success: true };
      }

      case 'disable': {
        // 禁用 extra usage
        const disableInfo = `Disable Extra Usage

${
  userPlan === 'api'
    ? `API Key Users:

Extra usage is not applicable when using API keys.

To stop API usage completely:
  • Remove API key from environment
  • Or delete ~/.claude/credentials.json
  • Run: /logout`
    : `To disable extra usage for your Claude subscription:

1. Visit Claude Settings:
   https://claude.ai/settings

2. Navigate to Billing section

3. Disable "Extra Usage" option
   • Any pending charges will still apply
   • Future overages will not incur charges
   • You'll hit hard limits instead

After disabling:
  • You'll see rate limit errors when limits are reached
  • Options: Wait for reset, upgrade plan, or use API keys
  • No surprise charges

Alternative Options When Disabled:
  1. Wait for limit reset (daily/weekly)
  2. Upgrade to higher plan (/upgrade)
  3. Switch to lower-cost models (/model)
  4. Use API keys with custom spend limits

To re-enable:
  Run: /extra-usage enable

Note: This educational project cannot disable extra usage directly.
Please use the official Claude Code CLI or web interface.`
}`;

        ctx.ui.addMessage('assistant', disableInfo);
        return { success: true };
      }

      case 'info':
      case 'help':
      default: {
        // 显示帮助信息
        const extraUsageInfo = `Extra Usage - Manage Overages Beyond Plan Limits

What is Extra Usage?

Extra usage allows Pro and Max subscribers to continue using Claude
even after reaching their plan limits, with automatic billing for
additional usage.

┌─────────────────────────────────────────────────────┐
│ How It Works                                        │
│                                                     │
│ 1. Reach Your Plan Limit                            │
│    • Receive notification of approaching limit       │
│    • Choose to enable extra usage or wait for reset │
│                                                     │
│ 2. Extra Usage Kicks In                             │
│    • Continue using Claude seamlessly                │
│    • Usage tracked automatically                     │
│    • Billed at per-token rates                       │
│                                                     │
│ 3. Billing                                           │
│    • Added to next billing cycle                     │
│    • Set optional spending caps                      │
│    • Transparent usage tracking                      │
└─────────────────────────────────────────────────────┘

Availability:
  ✓ Pro Plan:   Available with pay-per-use pricing
  ✓ Max Plan:   Included with higher base limits
  ✗ Free Plan:  Not available (upgrade required)
  ✗ API Keys:   N/A (already usage-based billing)

Commands:
  /extra-usage status    Check if extra usage is enabled
  /extra-usage enable    Enable extra usage (web required)
  /extra-usage disable   Disable extra usage (web required)
  /extra-usage help      Show this help message

Pricing Information:
  • Pro users: Similar to API per-token rates
  • Max users: Higher included limits before charges
  • Transparent billing with detailed usage tracking
  • Set monthly spending caps for budget control

Safety Features:
  • Optional spending limits
  • Usage notifications at 50%, 75%, 90%
  • Real-time usage tracking via /usage
  • Can disable at any time

Alternative Options:
  1. Upgrade Plan:
     /upgrade              View plan options

  2. Check Current Usage:
     /usage                View usage statistics
     /cost                 View session costs

  3. Manage Rate Limits:
     /rate-limit-options   Options when limited

  4. Switch Models:
     /model                Use lower-cost models (Haiku)

For API Users:
  If you're using API keys, you're already on usage-based billing.
  Extra usage is not needed - you pay only for what you use.
  Manage spend limits at: https://platform.claude.com

For Claude.ai Users:
  Manage extra usage at: https://claude.ai/settings
  Enable/disable in billing settings
  Set spending caps and notifications

Current Status:
  Run: /extra-usage status

Documentation:
  https://code.claude.com/docs/en/usage-limits
  https://docs.anthropic.com/claude/docs/billing`;

        ctx.ui.addMessage('assistant', extraUsageInfo);
        return { success: true };
      }
    }
  },
};

// /rate-limit-options - 速率限制选项（基于官方源码）
export const rateLimitOptionsCommand: SlashCommand = {
  name: 'rate-limit-options',
  description: 'Show options when rate limit is reached',
  category: 'auth',
  execute: (ctx: CommandContext): CommandResult => {
    const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

    const optionsInfo = `Rate Limit Options

When you reach your API rate limits, you have several options:

┌─────────────────────────────────────────────────────┐
│ 1. Stop and Wait for Limit Reset                    │
│    • API rate limits typically reset hourly/daily    │
│    • Check your dashboard for exact reset times      │
│    • Free tier: Lower limits, longer reset periods   │
│    • Paid tier: Higher limits, shorter reset periods │
│                                                      │
│ 2. Switch to a Lower-Cost Model                      │
│    • Switch from Opus to Sonnet or Haiku             │
│    • Sonnet: Balanced performance and cost           │
│    • Haiku: Fastest and most cost-effective          │
│    • Use /model command to switch models             │
│                                                      │
│ 3. Add Extra Usage (claude.ai users)                 │
│    • Available for Pro and Max subscribers           │
│    • Purchase additional tokens beyond plan limits   │
│    • Visit https://claude.ai/settings                │
│    • Automatic billing when you exceed limits        │
│                                                      │
│ 4. Upgrade Your Plan                                 │
│    • Free → Pro: Higher limits, priority access      │
│    • Pro → Max: Maximum limits, 20x higher rates     │
│    • Visit /upgrade for upgrade options              │
│    • API users: Increase spend limits at console     │
│                                                      │
│ 5. Use API Keys with Usage-Based Billing             │
│    • Switch from claude.ai to API keys               │
│    • Pay only for what you use                       │
│    • No subscription required                        │
│    • Set custom spend limits                         │
│    • Get API key: https://platform.claude.com      │
└─────────────────────────────────────────────────────┘

Current Status:
  Authentication: ${hasApiKey ? 'API Key (usage-based billing)' : 'Not authenticated or using OAuth'}

Rate Limit Tiers:
  Free:  Limited requests per day
  Pro:   ~10x more requests than Free
  Max:   ~20x more requests than Pro
  API:   Custom limits based on spend limits

Best Practices:
  • Monitor your usage with /usage and /cost commands
  • Batch similar requests when possible
  • Use appropriate models for each task
  • Set up spend limits to avoid surprises
  • Consider caching responses for repeated queries

For immediate help:
  /usage   - Check current usage
  /cost    - View cost details
  /model   - Switch to different model
  /upgrade - Upgrade your plan`;

    ctx.ui.addMessage('assistant', optionsInfo);
    return { success: true };
  },
};

// 注册所有认证命令
export function registerAuthCommands(): void {
  commandRegistry.register(loginCommand);
  commandRegistry.register(logoutCommand);
  commandRegistry.register(upgradeCommand);
  commandRegistry.register(passesCommand);
  commandRegistry.register(extraUsageCommand);
  commandRegistry.register(rateLimitOptionsCommand);
}
