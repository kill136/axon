#!/usr/bin/env node

/**
 * Claude Code 飞书 Bot CLI 入口
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
 *   CLAUDE_WEB_PORT           - WebUI 端口（默认: 3456）
 *   CLAUDE_WEB_HOST           - WebUI 主机（默认: 127.0.0.1）
 */

import chalk from 'chalk';
import { FeishuBot } from './feishu/bot.js';
import { getDefaultConfig, loadConfigFromEnv } from './feishu/config.js';
import { initAuth, isAuthenticated, getAuthType, getAuth } from './auth/index.js';

const isWebUIMode = process.argv.includes('--webui');

async function main() {
  console.log(chalk.cyan('╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║      Claude Code × 飞书 Bot             ║'));
  console.log(chalk.cyan('║      Feishu (Lark) Integration          ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝'));

  if (isWebUIMode) {
    console.log(chalk.yellow('\n  模式: WebUI 桥接（同进程）'));
  }

  // 初始化认证（Anthropic API）
  initAuth();

  if (!isAuthenticated()) {
    console.error(chalk.red('\n✗ 错误: 未找到有效的 Anthropic 认证凭据'));
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
  console.log(chalk.green(`\n✓ Anthropic 认证: ${authDisplay}`));

  // 加载飞书配置
  const config = loadConfigFromEnv(getDefaultConfig());

  // 校验飞书凭据
  if (!config.appId || !config.appSecret) {
    console.error(chalk.red('\n✗ 错误: 缺少飞书应用凭据'));
    console.error(chalk.yellow('\n请设置以下环境变量:'));
    console.error(chalk.gray('  FEISHU_APP_ID       - 飞书应用 App ID'));
    console.error(chalk.gray('  FEISHU_APP_SECRET   - 飞书应用 App Secret'));
    console.error(chalk.yellow('\n获取方式:'));
    console.error(chalk.gray('  1. 访问 https://open.feishu.cn/app 创建应用'));
    console.error(chalk.gray('  2. 在应用详情页获取 App ID 和 App Secret'));
    console.error(chalk.gray('  3. 开通权限: im:message、im:message.receive_v1'));
    console.error(chalk.gray('  4. 发布应用'));
    process.exit(1);
  }

  // 打印配置摘要
  console.log(chalk.gray('\n配置:'));
  console.log(chalk.gray(`  App ID:      ${config.appId.slice(0, 8)}...`));
  console.log(chalk.gray(`  连接模式:    ${config.connectionMode}`));
  if (config.connectionMode === 'webhook') {
    console.log(chalk.gray(`  Webhook:     http://0.0.0.0:${config.webhookPort}${config.webhookPath}`));
  }
  console.log(chalk.gray(`  模型:        ${config.model}`));
  console.log(chalk.gray(`  工作目录:    ${config.workingDir}`));
  console.log(chalk.gray(`  速率限制:    ${config.rateLimitPerMinute} 次/分钟`));
  console.log(chalk.gray(`  每日预算:    $${config.dailyBudgetUSD}`));
  console.log(chalk.gray(`  允许工具:    ${config.allowedTools.join(', ')}`));
  console.log(chalk.gray(`  私聊响应:    ${config.respondToPrivate ? '是' : '否'}`));
  console.log(chalk.gray(`  会话超时:    ${config.sessionTimeout / 1000}s`));

  let bot: FeishuBot;

  if (isWebUIMode) {
    // WebUI 桥接模式：先启动 WebUI 服务器，再启动飞书 Bot
    console.log(chalk.cyan('\n启动 WebUI 服务器...'));
    const { startWebServer } = await import('./web/server/index.js');
    const { conversationManager } = await startWebServer({
      cwd: config.workingDir,
      model: config.model,
    });

    const sessionId = process.env.FEISHU_WEBUI_SESSION || 'feishu-bot';
    console.log(chalk.green(`✓ WebUI 已启动，飞书消息将桥接到会话: ${sessionId}`));

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
    console.error(chalk.red('\n✗ Bot 启动失败:'), err);
    console.error(chalk.yellow('\n常见问题:'));
    console.error(chalk.gray('  1. 检查 FEISHU_APP_ID 和 FEISHU_APP_SECRET 是否正确'));
    console.error(chalk.gray('  2. 确保飞书应用已开通 im:message 权限'));
    console.error(chalk.gray('  3. 确保飞书应用已发布（测试版也行）'));
    console.error(chalk.gray('  4. WebSocket 模式需要在飞书后台启用长连接'));
    process.exit(1);
  }
}

main().catch(console.error);
