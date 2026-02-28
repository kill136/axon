/**
 * 首次启动引导向导
 * 使用 Node.js 内置 readline 实现交互式配置
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { configManager } from '../config/index.js';

/**
 * 创建 readline 接口
 */
function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 询问用户一个问题
 * @param rl readline 接口
 * @param question 问题文本
 * @returns 用户输入
 */
function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * 显示欢迎页
 */
function showWelcome(): void {
  console.clear();
  console.log(chalk.cyan.bold('\n╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║                                              ║'));
  console.log(chalk.cyan.bold('║       Welcome to Axon!                       ║'));
  console.log(chalk.cyan.bold('║                                              ║'));
  console.log(chalk.cyan.bold('╚══════════════════════════════════════════════╝\n'));
  console.log(chalk.gray('Let\'s set up your environment...\n'));
}

/**
 * 询问 API Key
 * @param rl readline 接口
 * @returns API Key 或 null（如果用户选择跳过）
 */
async function askApiKey(rl: readline.Interface): Promise<string | null> {
  console.log(chalk.yellow('\n📝 Step 1: API Key Configuration'));
  console.log(chalk.gray('─'.repeat(50)));
  
  const hasKey = await ask(rl, chalk.white('Do you have an Anthropic API key? (y/n): '));
  
  if (hasKey.toLowerCase() === 'y' || hasKey.toLowerCase() === 'yes') {
    console.log(chalk.gray('\nYou can get your API key from:'));
    console.log(chalk.blue('https://console.anthropic.com/settings/keys\n'));
    
    let apiKey = '';
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      apiKey = await ask(rl, chalk.white('Enter your API key: '));
      
      if (!apiKey) {
        console.log(chalk.red('API key cannot be empty.'));
        attempts++;
        continue;
      }
      
      // 简单验证格式
      if (!apiKey.startsWith('sk-ant-')) {
        console.log(chalk.yellow('Warning: API key should start with "sk-ant-"'));
        const confirm = await ask(rl, chalk.white('Continue anyway? (y/n): '));
        if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
          attempts++;
          continue;
        }
      }
      
      // 验证 API key（调用 API）
      console.log(chalk.gray('\nValidating API key...'));
      
      try {
        const { ClaudeClient } = await import('../core/client.js');
        const client = new ClaudeClient({
          model: 'claude-sonnet-4-5-20250929',
          apiKey: apiKey,
        });
        
        // 发送一个简单的测试请求
        await client.createMessage(
          [{ role: 'user', content: 'Hi' }],
          [],
          'You are a helpful assistant.',
          {}
        );
        
        console.log(chalk.green('✓ API key is valid!\n'));
        return apiKey;
      } catch (error: any) {
        console.log(chalk.red(`✗ API key validation failed: ${error.message}`));
        attempts++;
        
        if (attempts < maxAttempts) {
          console.log(chalk.gray(`Please try again (${maxAttempts - attempts} attempts left)`));
        }
      }
    }
    
    console.log(chalk.yellow('\nSkipping API key configuration...'));
    return null;
  } else {
    console.log(chalk.gray('\nNo problem! You can use the built-in proxy (limited features).'));
    console.log(chalk.gray('You can add your API key later in ~/.axon/settings.json\n'));
    return null;
  }
}

/**
 * 询问默认模型
 * @param rl readline 接口
 * @returns 模型名称
 */
async function askModel(rl: readline.Interface): Promise<string> {
  console.log(chalk.yellow('\n🤖 Step 2: Default Model'));
  console.log(chalk.gray('─'.repeat(50)));
  
  console.log(chalk.white('\nChoose your default model:'));
  console.log(chalk.cyan('  1) Sonnet (Recommended) - Balance of speed and quality'));
  console.log(chalk.gray('  2) Opus - Most capable, slower'));
  console.log(chalk.gray('  3) Haiku - Fastest, for simple tasks\n'));
  
  while (true) {
    const choice = await ask(rl, chalk.white('Enter your choice (1-3) [1]: '));
    
    if (!choice || choice === '1') {
      return 'sonnet';
    } else if (choice === '2') {
      return 'opus';
    } else if (choice === '3') {
      return 'haiku';
    } else {
      console.log(chalk.red('Invalid choice. Please enter 1, 2, or 3.'));
    }
  }
}

/**
 * 显示完成页
 * @param config 配置摘要
 */
function showCompletion(config: { apiKey: string | null; model: string }): void {
  console.log(chalk.green.bold('\n✨ Setup Complete!\n'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white('\nConfiguration Summary:'));
  console.log(chalk.gray(`  API Key: ${config.apiKey ? '✓ Configured' : '✗ Not configured (using proxy)'}`));
  console.log(chalk.gray(`  Default Model: ${config.model}`));
  console.log(chalk.gray('\n─'.repeat(50)));
  console.log(chalk.white('\nNext Steps:'));
  console.log(chalk.cyan('  • Type /help to see available commands'));
  console.log(chalk.cyan('  • Type /skill to manage skills'));
  console.log(chalk.cyan('  • Start chatting to use Axon!\n'));
  console.log(chalk.gray('Configuration saved to: ~/.axon/settings.json\n'));
}

/**
 * 运行首次启动向导
 */
export async function runOnboardingWizard(): Promise<void> {
  const rl = createInterface();
  
  try {
    showWelcome();
    
    // Step 1: API Key
    const apiKey = await askApiKey(rl);
    
    // Step 2: Model
    const model = await askModel(rl);
    
    // 保存配置
    if (apiKey) {
      configManager.set('apiKey', apiKey);
    }
    configManager.set('model', model as any);
    
    // 显示完成页
    showCompletion({ apiKey, model });
    
    // 创建 .onboarded 标志文件
    const claudeDir = path.join(os.homedir(), '.axon');
    const onboardedFile = path.join(claudeDir, '.onboarded');
    
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    
    fs.writeFileSync(onboardedFile, new Date().toISOString());
  } catch (error) {
    if ((error as any).message === 'interrupted') {
      console.log(chalk.yellow('\n\nSetup cancelled. You can run "claude onboard" later to configure.\n'));
    } else {
      console.error(chalk.red('\n\nSetup failed:'), error);
    }
  } finally {
    rl.close();
  }
}

/**
 * 检查是否已完成首次设置
 */
export function isOnboarded(): boolean {
  const onboardedFile = path.join(os.homedir(), '.axon', '.onboarded');
  return fs.existsSync(onboardedFile);
}
