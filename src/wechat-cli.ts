#!/usr/bin/env node

/**
 * Claude Code 微信 Bot CLI 入口
 *
 * 使用方式:
 *   npx tsx src/wechat-cli.ts
 *   npm run wechat
 *
 * 认证方式（自动检测，优先级从高到低）:
 *   1. 环境变量 ANTHROPIC_API_KEY / CLAUDE_API_KEY
 *   2. OAuth 订阅账户（通过 claude login 登录后自动读取）
 *   3. ~/.claude/credentials.json 或 auth.json
 *
 * 环境变量:
 *   WECHAT_PUPPET      - Wechaty Puppet 名称（默认: wechaty-puppet-wechat4u）
 *   WECHAT_MODEL       - 模型选择 opus/sonnet/haiku（默认: sonnet）
 *   WECHAT_WORKING_DIR - 工作目录
 *   WECHAT_TRIGGER_KEYWORD - 触发关键词（默认: @提及触发）
 *   WECHAT_RATE_LIMIT   - 每分钟请求上限（默认: 5）
 *   WECHAT_DAILY_BUDGET - 每日预算美元（默认: 10）
 *   WECHAT_EXTRA_TOOLS  - 额外允许的工具（逗号分隔）
 *   WECHAT_RESPOND_PRIVATE - 是否响应私聊 true/false（默认: true）
 *   WECHAT_SESSION_TIMEOUT - 会话超时秒数（默认: 1800）
 *   WECHAT_SYSTEM_PROMPT - 自定义系统提示词
 */

import chalk from 'chalk';
import { WeChatBot } from './wechat/bot.js';
import { getDefaultConfig, loadConfigFromEnv } from './wechat/config.js';
import { initAuth, isAuthenticated, getAuthType, getAuth } from './auth/index.js';

async function main() {
  console.log(chalk.cyan('╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║      Claude Code × 微信 Bot             ║'));
  console.log(chalk.cyan('║      Personal WeChat Integration        ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝'));

  // 初始化认证（自动检测 API Key / OAuth / 本地凭据）
  initAuth();

  if (!isAuthenticated()) {
    console.error(chalk.red('\n✗ 错误: 未找到有效的认证凭据'));
    console.error(chalk.yellow('\n请使用以下任一方式认证:'));
    console.error(chalk.gray('  1. OAuth 订阅账户: 先运行 claude login 完成登录'));
    console.error(chalk.gray('  2. API Key: 设置环境变量 ANTHROPIC_API_KEY'));
    process.exit(1);
  }

  const authType = getAuthType();
  const auth = getAuth();
  const authDisplay = authType === 'oauth'
    ? `OAuth 订阅 (${auth?.email || auth?.userId || 'unknown'})`
    : `API Key (${auth?.apiKey?.slice(0, 12)}...)`;
  console.log(chalk.green(`\n✓ 认证方式: ${authDisplay}`));

  // 加载配置
  const config = loadConfigFromEnv(getDefaultConfig());

  // 打印配置摘要
  console.log(chalk.gray('\n配置:'));
  console.log(chalk.gray(`  Puppet:    ${config.puppet}`));
  console.log(chalk.gray(`  模型:      ${config.model}`));
  console.log(chalk.gray(`  工作目录:  ${config.workingDir}`));
  console.log(chalk.gray(`  触发方式:  ${config.triggerKeyword || '@提及'}`));
  console.log(chalk.gray(`  速率限制:  ${config.rateLimitPerMinute} 次/分钟`));
  console.log(chalk.gray(`  每日预算:  $${config.dailyBudgetUSD}`));
  console.log(chalk.gray(`  允许工具:  ${config.allowedTools.join(', ')}`));
  console.log(chalk.gray(`  私聊响应:  ${config.respondToPrivate ? '是' : '否'}`));
  console.log(chalk.gray(`  会话超时:  ${config.sessionTimeout / 1000}s`));

  // 创建并启动 Bot
  const bot = new WeChatBot(config);

  // 优雅退出
  const gracefulShutdown = async () => {
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  try {
    await bot.start();
  } catch (err) {
    console.error(chalk.red('\n✗ Bot 启动失败:'), err);
    console.error(chalk.yellow('\n常见问题:'));
    console.error(chalk.gray('  1. 确保已安装 Wechaty puppet:'));
    console.error(chalk.gray(`     npm install wechaty ${config.puppet}`));
    console.error(chalk.gray('  2. 如果使用 padlocal puppet，需要配置 token'));
    console.error(chalk.gray('  3. Web 协议可能需要微信账号支持网页版登录'));
    process.exit(1);
  }
}

main().catch(console.error);
