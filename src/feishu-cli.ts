#!/usr/bin/env node

/**
 * Axon 飞书 Bot CLI 入口
 *
 * 使用方式:
 *   npx tsx src/feishu-cli.ts            # 独立模式
 *   npx tsx src/feishu-cli.ts --webui    # WebUI 桥接模式（同进程启动 WebUI + 飞书 Bot）
 *   npm run feishu
 *
 * 必需环境变量:
 *   FEISHU_APP_ID       - 飞书应用 App ID
 *   FEISHU_APP_SECRET   - 飞书应用 App Secret
 *
 * 可选环境变量:
 *   FEISHU_CONNECTION_MODE    - 连接模式 websocket/webhook（默认: websocket）
 *   FEISHU_WEBHOOK_PORT       - Webhook 端口（默认: 3001）
 *   FEISHU_ENCRYPT_KEY        - 事件加密密钥
 *   FEISHU_VERIFICATION_TOKEN - 验证令牌
 *   FEISHU_MODEL              - 模型选择 opus/sonnet/haiku（默认: sonnet）
 *   FEISHU_WORKING_DIR        - 工作目录
 *   FEISHU_RATE_LIMIT         - 每分钟请求上限（默认: 5）
 *   FEISHU_DAILY_BUDGET       - 每日预算美元（默认: 10）
 *   FEISHU_EXTRA_TOOLS        - 额外允许的工具（逗号分隔）
 *   FEISHU_RESPOND_PRIVATE    - 是否响应私聊 true/false（默认: true）
 *   FEISHU_SESSION_TIMEOUT    - 会话超时秒数（默认: 1800）
 *   FEISHU_SYSTEM_PROMPT      - 自定义系统提示词
 *   FEISHU_WEBUI_SESSION      - WebUI 模式下使用的会话 ID（默认: feishu-bot）
 *
 * WebUI 桥接模式专用环境变量:
 *   AXON_WEB_PORT           - WebUI 端口（默认: 3456）
 *   AXON_WEB_HOST           - WebUI 主机（默认: 127.0.0.1）
 */

import chalk from 'chalk';
import { FeishuBot } from './feishu/bot.js';
import { getDefaultConfig, loadConfigFromEnv } from './feishu/config.js';
import { initAuth, isAuthenticated, getAuthType, getAuth } from './auth/index.js';

const isWebUIMode = process.argv.includes('--webui');

async function main() {
  console.log(chalk.cyan('╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║      Axon × Feishu Bot                  ║'));
  console.log(chalk.cyan('║      Feishu (Lark) Integration          ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝'));

  if (isWebUIMode) {
    console.log(chalk.yellow('\n  Mode: WebUI Bridge (same process)'));
  }

  // 初始化认证（Anthropic API）
  initAuth();

  if (!isAuthenticated()) {
    console.error(chalk.red('\n✗ Error: No valid Anthropic authentication credentials found'));
    console.error(chalk.yellow('\nPlease authenticate using one of the following methods:'));
    console.error(chalk.gray('  1. OAuth subscription: Run claude login to complete authentication'));
    console.error(chalk.gray('  2. API Key: Set the environment variable ANTHROPIC_API_KEY'));
    process.exit(1);
  }

  const authType = getAuthType();
  const auth = getAuth();
  const authDisplay = authType === 'oauth'
    ? `OAuth Subscription (${auth?.email || auth?.userId || 'unknown'})`
    : `API Key (${auth?.apiKey?.slice(0, 12)}...)`;
  console.log(chalk.green(`\n✓ Anthropic Auth: ${authDisplay}`));

  // 加载飞书配置
  const config = loadConfigFromEnv(getDefaultConfig());

  // 校验飞书凭据
  if (!config.appId || !config.appSecret) {
    console.error(chalk.red('\n✗ Error: Missing Feishu app credentials'));
    console.error(chalk.yellow('\nPlease set the following environment variables:'));
    console.error(chalk.gray('  FEISHU_APP_ID       - Feishu App ID'));
    console.error(chalk.gray('  FEISHU_APP_SECRET   - Feishu App Secret'));
    console.error(chalk.yellow('\nHow to obtain:'));
    console.error(chalk.gray('  1. Visit https://open.feishu.cn/app to create an app'));
    console.error(chalk.gray('  2. Get App ID and App Secret from the app details page'));
    console.error(chalk.gray('  3. Enable permissions: im:message, im:message.receive_v1'));
    console.error(chalk.gray('  4. Publish the app'));
    process.exit(1);
  }

  // 打印配置摘要
  console.log(chalk.gray('\nConfiguration:'));
  console.log(chalk.gray(`  App ID:      ${config.appId.slice(0, 8)}...`));
  console.log(chalk.gray(`  Connection:  ${config.connectionMode}`));
  if (config.connectionMode === 'webhook') {
    console.log(chalk.gray(`  Webhook:     http://0.0.0.0:${config.webhookPort}${config.webhookPath}`));
  }
  console.log(chalk.gray(`  Model:       ${config.model}`));
  console.log(chalk.gray(`  Working Dir: ${config.workingDir}`));
  console.log(chalk.gray(`  Rate Limit:  ${config.rateLimitPerMinute} req/min`));
  console.log(chalk.gray(`  Daily Budget: ${config.dailyBudgetUSD}`));
  console.log(chalk.gray(`  Allowed Tools: ${config.allowedTools.join(', ')}`));
  console.log(chalk.gray(`  Private Chat: ${config.respondToPrivate ? 'Yes' : 'No'}`));
  console.log(chalk.gray(`  Session TTL: ${config.sessionTimeout / 1000}s`));

  let bot: FeishuBot;

  if (isWebUIMode) {
    // WebUI 桥接模式：先启动 WebUI 服务器，再启动飞书 Bot
    console.log(chalk.cyan('\nStarting WebUI server...'));
    const { startWebServer } = await import('./web/server/index.js');
    const { conversationManager } = await startWebServer({
      cwd: config.workingDir,
      model: config.model,
    });

    const sessionId = process.env.FEISHU_WEBUI_SESSION || 'feishu-bot';
    console.log(chalk.green(`✓ WebUI started, Feishu messages will be bridged to session: ${sessionId}`));

    bot = new FeishuBot({
      config,
      conversationManager: conversationManager as any,
      sessionId,
    });
  } else {
    // 独立模式
    bot = new FeishuBot({ config });
  }

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
    console.error(chalk.red('\n✗ Bot failed to start:'), err);
    console.error(chalk.yellow('\nCommon issues:'));
    console.error(chalk.gray('  1. Check if FEISHU_APP_ID and FEISHU_APP_SECRET are correct'));
    console.error(chalk.gray('  2. Ensure Feishu app has im:message permission enabled'));
    console.error(chalk.gray('  3. Ensure Feishu app is published (test version is fine)'));
    console.error(chalk.gray('  4. WebSocket mode requires long connection enabled in Feishu backend'));
    process.exit(1);
  }
}

main().catch(console.error);
