/**
 * 设置命令 - discover, upgrade, output-style, privacy-settings, rate-limit-options, remote-env, extra-usage, install-github-app, install-slack-app
 */

import type { SlashCommand, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './registry.js';
import { VERSION_BASE } from '../version.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// /discover - MCP 服务器市场
export const discoverCommand: SlashCommand = {
  name: 'discover',
  description: 'Discover and browse MCP servers',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const discoverInfo = `╭─ MCP Server Discovery ──────────────────────────────╮
│                                                     │
│  🔍 Discover MCP Servers                            │
│                                                     │
│  Browse the MCP server marketplace to find          │
│  tools and integrations for Axon.            │
│                                                     │
╰─────────────────────────────────────────────────────╯

Popular MCP Servers:

  📁 filesystem        File system access and management
  🔍 brave-search      Web search via Brave Search API
  🐙 github            GitHub API integration
  🗄️  postgres          PostgreSQL database access
  📝 memory            Persistent memory for Claude
  🌐 fetch             HTTP request capabilities
  🐳 docker            Docker container management
  ☁️  aws               AWS services integration

Categories:

  • Developer Tools    Git, GitHub, GitLab, Bitbucket
  • Databases          PostgreSQL, MySQL, SQLite, MongoDB
  • Cloud Services     AWS, GCP, Azure
  • Productivity       Notion, Slack, Discord
  • Search             Brave, Google, DuckDuckGo

Commands:

  /install <server>    Install an MCP server
  /mcp                 Manage installed servers
  /mcp list            List installed servers

Learn more: https://modelcontextprotocol.io/servers`;

    ctx.ui.addMessage('assistant', discoverInfo);
    return { success: true };
  },
};

// /upgrade - 升级 Axon
export const upgradeCommand: SlashCommand = {
  name: 'upgrade',
  description: 'Upgrade Axon to the latest version',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const currentVersion = VERSION_BASE;

    const upgradeInfo = `╭─ Axon Upgrade ────────────────────────────────╮
│                                                     │
│  📦 Current Version: v${currentVersion.padEnd(30)}│
│                                                     │
╰─────────────────────────────────────────────────────╯

To upgrade Axon, run one of these commands:

  npm:
    npm update -g @anthropic-ai/claude-code

  npx (always latest):
    npx @anthropic-ai/claude-code@latest

  Homebrew (macOS):
    brew upgrade claude-code

Changelog: https://github.com/anthropics/claude-code/releases

After upgrading, restart Axon to use the new version.

Tip: You can check for updates at any time with:
  claude --version`;

    ctx.ui.addMessage('assistant', upgradeInfo);
    return { success: true };
  },
};

// /output-style - 输出样式设置
export const outputStyleCommand: SlashCommand = {
  name: 'output-style',
  aliases: ['style'],
  description: 'Configure output style (concise/verbose)',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const action = args[0];

    if (!action) {
      const styleInfo = `╭─ Output Style Settings ──────────────────────────────╮
│                                                     │
│  Configure how Claude formats its responses         │
│                                                     │
╰─────────────────────────────────────────────────────╯

Current Style: default

Available Styles:

  default     Standard formatting with markdown
  concise     Shorter responses, less decoration
  verbose     Detailed explanations and context
  minimal     Bare minimum output
  technical   Focus on code and technical details

Usage:

  /output-style <style>    Set the output style
  /output-style reset      Reset to default

Examples:

  /output-style concise
  /output-style verbose
  /output-style reset`;

      ctx.ui.addMessage('assistant', styleInfo);
      return { success: true };
    }

    const validStyles = ['default', 'concise', 'verbose', 'minimal', 'technical', 'reset'];
    if (!validStyles.includes(action)) {
      ctx.ui.addMessage('assistant', `Unknown style: ${action}\n\nValid styles: ${validStyles.join(', ')}`);
      return { success: false };
    }

    const newStyle = action === 'reset' ? 'default' : action;
    ctx.ui.addMessage('assistant', `✓ Output style set to: ${newStyle}\n\nThis setting will apply to future responses.`);
    ctx.ui.addActivity(`Output style: ${newStyle}`);
    return { success: true };
  },
};

// /privacy-settings - 隐私设置
export const privacySettingsCommand: SlashCommand = {
  name: 'privacy-settings',
  aliases: ['privacy'],
  description: 'View and update your privacy settings',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const privacyInfo = `╭─ Privacy Settings ───────────────────────────────────╮
│                                                     │
│  🔒 Control how your data is used                   │
│                                                     │
╰─────────────────────────────────────────────────────╯

Current Settings:

  ✓ Terminal Command Logging    Enabled
  ✓ Code Context Sharing        Enabled
  ○ Telemetry                   Disabled
  ○ Error Reporting             Disabled

Data Handling:

  • Conversations are stored locally in ~/.claude/sessions/
  • Sessions expire after 30 days by default
  • API calls go directly to Anthropic's servers
  • No data is shared with third parties

Environment Variables:

  CLAUDE_CODE_DISABLE_TELEMETRY=1    Disable all telemetry
  CLAUDE_CODE_DISABLE_LOGGING=1      Disable command logging

To modify settings:

  /config set privacy.telemetry false
  /config set privacy.errorReporting false

Learn more: https://docs.anthropic.com/claude-code/privacy`;

    ctx.ui.addMessage('assistant', privacyInfo);
    return { success: true };
  },
};

// /rate-limit-options - 速率限制选项
export const rateLimitOptionsCommand: SlashCommand = {
  name: 'rate-limit-options',
  aliases: ['rate-limit', 'limits'],
  description: 'View rate limit options and status',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const rateLimitInfo = `╭─ Rate Limit Options ─────────────────────────────────╮
│                                                     │
│  ⏱️  Manage API rate limits and usage                │
│                                                     │
╰─────────────────────────────────────────────────────╯

Current Status:

  API Tier:           Standard
  Requests/min:       60
  Tokens/min:         100,000
  Tokens/day:         1,000,000

Rate Limit Handling:

  • Auto-retry         Enabled (with exponential backoff)
  • Retry attempts     3
  • Max wait time      60 seconds

When Rate Limited:

  1. Axon will automatically wait and retry
  2. Long-running tasks will pause and resume
  3. You'll see a notification when limits are hit

To Increase Limits:

  • Upgrade your API plan at platform.claude.com
  • For enterprise needs, contact Anthropic sales

Environment Variables:

  ANTHROPIC_RATE_LIMIT_RETRY=5       Max retry attempts
  ANTHROPIC_RATE_LIMIT_WAIT=120      Max wait time (seconds)

Check usage: https://platform.claude.com/settings/usage`;

    ctx.ui.addMessage('assistant', rateLimitInfo);
    return { success: true };
  },
};

// /remote-env - 远程环境配置
export const remoteEnvCommand: SlashCommand = {
  name: 'remote-env',
  aliases: ['remote', 'teleport'],
  description: 'Configure remote environment for teleport sessions',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const remoteEnvInfo = `╭─ Remote Environment Configuration ───────────────────╮
│                                                     │
│  🌐 Configure remote development environments       │
│                                                     │
╰─────────────────────────────────────────────────────╯

Remote environments allow Axon to connect to
remote machines for development tasks.

Status: Not configured

Setup Options:

  1. SSH Connection
     /remote-env ssh user@host

  2. Docker Container
     /remote-env docker container-name

  3. VS Code Remote
     /remote-env vscode-remote

  4. GitHub Codespaces
     /remote-env codespaces

Current Configuration:

  Default Environment:  local
  SSH Key Path:         ~/.ssh/id_rsa
  Known Hosts:          ~/.ssh/known_hosts

Commands:

  /remote-env list        List saved environments
  /remote-env add <name>  Add a new environment
  /remote-env remove <n>  Remove an environment
  /remote-env test        Test connection

Note: Remote execution requires additional setup.
See: https://docs.anthropic.com/claude-code/remote`;

    ctx.ui.addMessage('assistant', remoteEnvInfo);
    return { success: true };
  },
};

// /extra-usage - 额外使用量信息
export const extraUsageCommand: SlashCommand = {
  name: 'extra-usage',
  description: 'Request additional usage beyond your plan limits',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const extraUsageInfo = `╭─ Extra Usage ────────────────────────────────────────╮
│                                                     │
│  📊 Request additional API usage                    │
│                                                     │
╰─────────────────────────────────────────────────────╯

When you've reached your plan limits, you have options:

For Pro/Max Users:

  • Upgrade to a higher tier plan
  • Wait for your usage to reset (monthly)
  • Use /upgrade to see upgrade options

For Team/Enterprise Users:

  • Contact your organization admin
  • Request additional usage allocation
  • Admin can adjust team limits in console

Current Usage Status:

  Run /usage to see your current consumption
  Run /cost to see spending details

To Request More Usage:

  1. Visit platform.claude.com/settings
  2. Navigate to Usage & Limits
  3. Request limit increase or upgrade plan

Contact Support:

  For urgent needs: support@anthropic.com
  Enterprise: enterprise@anthropic.com`;

    ctx.ui.addMessage('assistant', extraUsageInfo);
    return { success: true };
  },
};

// /install-github-app - GitHub App 集成
export const installGithubAppCommand: SlashCommand = {
  name: 'install-github-app',
  aliases: ['github-app'],
  description: 'Install the Axon GitHub App for CI/CD integration',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const githubAppInfo = `╭─ GitHub App Integration ─────────────────────────────╮
│                                                     │
│  🐙 Connect Axon to GitHub                   │
│                                                     │
╰─────────────────────────────────────────────────────╯

The Axon GitHub App enables:

  ✓ Automated code reviews on PRs
  ✓ CI/CD pipeline integration
  ✓ Issue and PR commenting
  ✓ Repository context awareness

Installation Steps:

  1. Visit the GitHub App page:
     https://github.com/apps/claude-code

  2. Click "Install" and select repositories

  3. Authorize the app for your organization

  4. Configure webhook settings (optional)

After Installation:

  • Claude can access repository context
  • Use @github mention in prompts
  • Automated reviews on new PRs

Configuration:

  /config set github.autoReview true
  /config set github.commentOnPR true

Current Status: Not installed

To check connection:
  gh auth status

Required scopes: repo, read:org, write:discussion`;

    ctx.ui.addMessage('assistant', githubAppInfo);
    return { success: true };
  },
};

// /install-slack-app - Slack App 集成
export const installSlackAppCommand: SlashCommand = {
  name: 'install-slack-app',
  aliases: ['slack-app'],
  description: 'Install the Axon Slack App for notifications',
  category: 'settings',
  execute: (ctx: CommandContext): CommandResult => {
    const slackAppInfo = `╭─ Slack App Integration ──────────────────────────────╮
│                                                     │
│  💬 Get Axon notifications in Slack          │
│                                                     │
╰─────────────────────────────────────────────────────╯

The Axon Slack App enables:

  ✓ Task completion notifications
  ✓ Error alerts
  ✓ Long-running job status updates
  ✓ Direct messaging with Claude

Installation Steps:

  1. Visit the Slack App Directory:
     https://slack.com/apps/claude-code

  2. Click "Add to Slack"

  3. Select your workspace

  4. Choose a channel for notifications

After Installation:

  • Receive notifications for completed tasks
  • Get alerts when jobs need attention
  • Interact with Claude from Slack

Configuration:

  /config set slack.channel #claude-alerts
  /config set slack.notifyOnComplete true
  /config set slack.notifyOnError true

Current Status: Not installed

Notification Types:

  • task_complete    When a task finishes
  • task_error       When an error occurs
  • task_waiting     When input is needed
  • daily_summary    Daily usage summary`;

    ctx.ui.addMessage('assistant', slackAppInfo);
    return { success: true };
  },
};

// 注册所有设置命令
export function registerSettingsCommands(): void {
  commandRegistry.register(discoverCommand);
  commandRegistry.register(upgradeCommand);
  commandRegistry.register(outputStyleCommand);
  commandRegistry.register(privacySettingsCommand);
  commandRegistry.register(rateLimitOptionsCommand);
  commandRegistry.register(remoteEnvCommand);
  commandRegistry.register(extraUsageCommand);
  commandRegistry.register(installGithubAppCommand);
  commandRegistry.register(installSlackAppCommand);
}
