/**
 * AskUserQuestion 工具
 * 向用户提出问题并获取选择
 *
 * 官方 API 规范（与 @anthropic-ai/claude-code 完全一致）:
 *
 * Schema:
 * {
 *   questions: [{
 *     question: string,        // 完整问题文本
 *     header: string,          // 最多 12 字符的标签
 *     options: [{
 *       label: string,         // 1-5 个单词的选项标签
 *       description: string    // 选项说明
 *     }],                     // 2-4 个选项
 *     multiSelect: boolean    // 是否允许多选
 *   }],                       // 1-4 个问题
 *   answers?: Record<string, string>  // 可选的预填答案
 * }
 *
 * 返回格式:
 * User has answered your questions: "header1"="answer1", "header2"="answer2". You can now continue with the user's answers in mind.
 *
 * 核心功能:
 * - 键盘导航 (↑/↓ 箭头键)
 * - 多选模式 (空格键选择/取消，支持复选框 UI)
 * - 数字快捷键 (1-9)
 * - 自动添加 "Other" 选项支持自定义输入
 * - 美化的终端 UI
 * - 支持 1-4 个问题同时询问
 * - 每个问题支持 2-4 个选项
 * - Header 最大 12 字符
 * - Label 限制 1-5 个单词
 *
 * 本地增强功能（实现层面，不影响 API 兼容性）:
 * - defaultIndex: 默认选中的选项索引 (0-based)
 * - timeout: 超时时间（毫秒），超时后使用默认值
 * - validator: 自定义验证函数 (input: string) => { valid: boolean; message?: string }
 * - 空输入保护 - 自动拒绝空的自定义输入
 *
 * 注意: 增强功能是可选的，通过类型断言使用，不会破坏与官方 API 的兼容性
 *
 * 基本使用示例:
 * ```typescript
 * {
 *   question: "Which framework should we use?",
 *   header: "Framework",
 *   options: [
 *     { label: "React (Recommended)", description: "Popular UI library" },
 *     { label: "Vue", description: "Progressive framework" }
 *   ],
 *   multiSelect: false
 * }
 * ```
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { BaseTool } from './base.js';
import type { AskUserQuestionInput, ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';

interface QuestionOption {
  label: string;
  description: string;
}

// 官方 Question 接口（与 SDK 完全一致）
interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// 扩展接口（包含本地增强功能，但不暴露给 API）
// 这些字段是可选的，不影响与官方 API 的兼容性
interface QuestionWithExtensions extends Question {
  defaultIndex?: number; // 默认选中的选项索引 (0-based)
  timeout?: number; // 超时时间（毫秒）
  validator?: (input: string) => { valid: boolean; message?: string }; // 自定义验证函数
}

// 最大 header 长度（官方限制）
const MAX_HEADER_LENGTH = 12;

export class AskUserQuestionTool extends BaseTool<AskUserQuestionInput, ToolResult> {
  name = 'AskUserQuestion';
  description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions to ask the user (1-4 questions)',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The complete question to ask the user',
              },
              header: {
                type: 'string',
                description: 'Short label displayed as a chip/tag (max 12 chars)',
              },
              options: {
                type: 'array',
                description: 'The available choices (2-4 options)',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'Display text for this option (1-5 words)',
                    },
                    description: {
                      type: 'string',
                      description: 'Explanation of what this option means',
                    },
                  },
                  required: ['label', 'description'],
                },
              },
              multiSelect: {
                type: 'boolean',
                description: 'Allow multiple selections',
              },
            },
            required: ['question', 'header', 'options', 'multiSelect'],
          },
        },
      },
      required: ['questions'],
    };
  }

  async execute(input: AskUserQuestionInput): Promise<ToolResult> {
    const { questions, answers: preAnswers } = input;

    // 如果已有答案（通过权限组件收集），直接返回
    if (preAnswers && Object.keys(preAnswers).length > 0) {
      // 使用官方格式：User has answered your questions: "header1"="answer1", "header2"="answer2"
      const formattedAnswers = Object.entries(preAnswers)
        .map(([header, answer]) => `"${header}"="${answer}"`)
        .join(', ');
      const output = `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`;

      return {
        success: true,
        output,
      };
    }

    if (!questions || questions.length === 0) {
      return { success: false, error: 'No questions provided' };
    }

    if (questions.length > 4) {
      return { success: false, error: 'Maximum 4 questions allowed' };
    }

    // 验证所有问题
    for (const q of questions) {
      // 验证 header 长度
      if (q.header && q.header.length > MAX_HEADER_LENGTH) {
        return {
          success: false,
          error: `Question header "${q.header}" exceeds maximum length of ${MAX_HEADER_LENGTH} characters`
        };
      }

      // 验证选项数量
      if (!q.options || q.options.length < 2 || q.options.length > 4) {
        return {
          success: false,
          error: `Question "${q.header}" must have 2-4 options (has ${q.options?.length ?? 0})`
        };
      }

      // 验证每个选项都有 label 和 description
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        if (!opt.label || typeof opt.label !== 'string') {
          return {
            success: false,
            error: `Option ${i + 1} in question "${q.header}" must have a label`
          };
        }
        if (!opt.description || typeof opt.description !== 'string') {
          return {
            success: false,
            error: `Option ${i + 1} in question "${q.header}" must have a description`
          };
        }
      }
    }

    const answers: Record<string, string> = {};

    try {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const answer = await this.askInteractiveQuestion(q, i + 1, questions.length);
        answers[q.header] = answer;
      }
    } catch (error) {
      return {
        success: false,
        error: t('ask.responseError', { error: error instanceof Error ? error.message : String(error) })
      };
    }

    // 格式化答案输出 - 使用官方格式
    const formattedAnswers = Object.entries(answers)
      .map(([header, answer]) => `"${header}"="${answer}"`)
      .join(', ');
    const output = `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`;

    return {
      success: true,
      output,
    };
  }

  /**
   * 交互式问题选择器 - 支持键盘导航
   */
  private async askInteractiveQuestion(
    question: QuestionWithExtensions,
    questionNum: number,
    totalQuestions: number
  ): Promise<string> {
    // 添加 "Other" 选项
    const allOptions = [...question.options, { label: 'Other', description: 'Enter custom response' }];

    // 检查是否支持交互模式
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (isInteractive) {
      return this.interactiveSelect(question, allOptions, questionNum, totalQuestions);
    } else {
      // 降级到简单模式
      return this.simpleSelect(question, allOptions, questionNum, totalQuestions);
    }
  }

  /**
   * 交互式选择模式 - 支持箭头键导航和复选框 UI
   */
  private async interactiveSelect(
    question: QuestionWithExtensions,
    options: QuestionOption[],
    questionNum: number,
    totalQuestions: number
  ): Promise<string> {
    // 应用默认值
    let currentIndex = question.defaultIndex !== undefined &&
                       question.defaultIndex >= 0 &&
                       question.defaultIndex < options.length
                       ? question.defaultIndex
                       : 0;
    const selectedIndices = new Set<number>();

    // 如果是多选模式且设置了默认值，预先选中
    if (question.multiSelect && question.defaultIndex !== undefined &&
        question.defaultIndex >= 0 && question.defaultIndex < options.length) {
      selectedIndices.add(question.defaultIndex);
    }

    let isFirstRender = true;
    let timeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    // 显示问题头部
    this.displayQuestionHeader(question, questionNum, totalQuestions);

    return new Promise((resolve, reject) => {
      // 设置超时（如果配置了）
      if (question.timeout && question.timeout > 0) {
        timeoutId = setTimeout(() => {
          isTimedOut = true;
          cleanup();
          console.log(chalk.yellow(`\n  Timeout after ${question.timeout}ms. Using default selection.`));

          // 超时时使用当前选中项或默认值
          if (question.multiSelect && selectedIndices.size > 0) {
            const selectedLabels: string[] = [];
            for (const idx of Array.from(selectedIndices).sort((a, b) => a - b)) {
              if (idx < options.length - 1) {
                selectedLabels.push(options[idx].label);
              }
            }
            resolve(selectedLabels.join(', '));
          } else {
            resolve(options[currentIndex].label);
          }
        }, question.timeout);
      }

      // 设置原始模式
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      readline.emitKeypressEvents(process.stdin);

      // 计算需要清除的行数（选项数 + 空行 + 提示行）
      const linesToClear = options.length + 2;

      const render = () => {
        // 清除之前的选项显示（非首次渲染时）
        if (!isFirstRender) {
          readline.moveCursor(process.stdout, 0, -linesToClear);
          readline.clearScreenDown(process.stdout);
        }
        isFirstRender = false;

        // 显示选项
        options.forEach((opt, idx) => {
          const isSelected = selectedIndices.has(idx);
          const isCurrent = idx === currentIndex;

          // 多选模式显示复选框，单选模式显示单选按钮
          let checkbox = '  ';
          if (question.multiSelect) {
            // 复选框样式: [x] 或 [ ]
            checkbox = isSelected ? chalk.green('[x] ') : chalk.dim('[ ] ');
          } else {
            // 单选样式: (●) 或 ( )
            checkbox = isCurrent ? chalk.cyan('(●) ') : chalk.dim('( ) ');
          }

          const cursor = isCurrent ? chalk.cyan('> ') : '  ';
          const number = chalk.dim(`${idx + 1}.`);
          const label = isCurrent ? chalk.cyan.bold(opt.label) : opt.label;
          const desc = chalk.dim(`- ${opt.description}`);

          console.log(`${cursor}${checkbox}${number} ${label} ${desc}`);
        });

        // 显示提示
        console.log();
        let helpText = '';
        if (question.multiSelect) {
          helpText = '[Up/Down]: Navigate | [Space]: Toggle selection | [Enter]: Confirm | [1-9]: Quick toggle';
        } else {
          helpText = '[Up/Down]: Navigate | [Enter]: Select | [1-9]: Quick select';
        }

        // 添加超时提示
        if (question.timeout && question.timeout > 0) {
          const seconds = (question.timeout / 1000).toFixed(0);
          helpText += ` | Timeout: ${seconds}s`;
        }

        // 添加默认值提示
        if (question.defaultIndex !== undefined && question.defaultIndex >= 0 && question.defaultIndex < options.length) {
          helpText += ` | Default: ${options[question.defaultIndex].label}`;
        }

        console.log(chalk.dim('  ' + helpText));
      };

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeAllListeners('keypress');
      };

      const finishSelection = async () => {
        cleanup();

        // 清除选项显示
        readline.moveCursor(process.stdout, 0, -linesToClear);
        readline.clearScreenDown(process.stdout);

        let result: string;

        if (question.multiSelect) {
          // 多选模式: 如果没有选择任何项，默认选择当前项
          if (selectedIndices.size === 0) {
            selectedIndices.add(currentIndex);
          }

          const selectedLabels: string[] = [];
          for (const idx of Array.from(selectedIndices).sort((a, b) => a - b)) {
            if (idx === options.length - 1) {
              // "Other" 选项 - 获取自定义输入
              const custom = await this.getCustomInput(question);
              if (custom) {
                selectedLabels.push(custom);
              }
            } else {
              selectedLabels.push(options[idx].label);
            }
          }
          result = selectedLabels.join(', ');
        } else {
          // 单选模式
          if (currentIndex === options.length - 1) {
            // "Other" 选项 - 获取自定义输入
            result = await this.getCustomInput(question);
          } else {
            result = options[currentIndex].label;
          }
        }

        // 显示选中结果
        console.log(chalk.green(`  Selected: ${chalk.bold(result)}\n`));

        resolve(result);
      };

      // 键盘事件处理
      const handleKeypress = async (str: string | undefined, key: readline.Key) => {
        if (!key) return;

        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(0);
        }

        if (key.name === 'up') {
          currentIndex = (currentIndex - 1 + options.length) % options.length;
          render();
        } else if (key.name === 'down') {
          currentIndex = (currentIndex + 1) % options.length;
          render();
        } else if (key.name === 'space' && question.multiSelect) {
          // 空格键切换选择状态（仅多选模式）
          if (selectedIndices.has(currentIndex)) {
            selectedIndices.delete(currentIndex);
          } else {
            selectedIndices.add(currentIndex);
          }
          render();
        } else if (key.name === 'return') {
          await finishSelection();
        } else if (str && /^[1-9]$/.test(str)) {
          const idx = parseInt(str, 10) - 1;
          if (idx >= 0 && idx < options.length) {
            currentIndex = idx;
            if (question.multiSelect) {
              // 多选模式: 数字键切换选择状态
              if (selectedIndices.has(idx)) {
                selectedIndices.delete(idx);
              } else {
                selectedIndices.add(idx);
              }
              render();
            } else {
              // 单选模式: 数字键直接选择并完成
              await finishSelection();
            }
          }
        }
      };

      process.stdin.on('keypress', handleKeypress);

      // 初始渲染
      render();
    });
  }

  /**
   * 简单选择模式 - 用于非 TTY 环境
   * 在不支持原始输入模式的终端中使用
   */
  private async simpleSelect(
    question: QuestionWithExtensions,
    options: QuestionOption[],
    questionNum: number,
    totalQuestions: number
  ): Promise<string> {
    // 显示问题头部
    this.displayQuestionHeader(question, questionNum, totalQuestions);

    // 显示选项（带复选框/单选框样式）
    options.forEach((opt, idx) => {
      const checkbox = question.multiSelect ? '[ ]' : '( )';
      console.log(chalk.cyan(`  ${checkbox} ${idx + 1}. ${opt.label}`));
      console.log(chalk.gray(`        ${opt.description}`));
    });
    console.log();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer.trim());
        });
      });
    };

    try {
      const prompt = question.multiSelect
        ? chalk.blue('Enter choices (comma-separated numbers, e.g., 1,3): ')
        : chalk.blue('Enter your choice (number): ');

      const response = await askQuestion(prompt);

      // 解析响应
      if (question.multiSelect) {
        const indices = response.split(',').map((s) => parseInt(s.trim(), 10));
        const selected: string[] = [];

        for (const idx of indices) {
          if (idx >= 1 && idx < options.length) {
            selected.push(options[idx - 1].label);
          } else if (idx === options.length) {
            // "Other" 选项 - 使用带验证的输入方法
            rl.close();
            const custom = await this.getCustomInput(question);
            if (custom) {
              selected.push(custom);
            }
            // 重新创建 readline 接口（如果需要继续）
            const newRl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            Object.assign(rl, newRl);
          }
        }

        const result = selected.length > 0 ? selected.join(', ') : response;
        console.log(chalk.green(`  Selected: ${result}\n`));
        return result;
      } else {
        const idx = parseInt(response, 10);
        let result: string;

        if (idx >= 1 && idx < options.length) {
          result = options[idx - 1].label;
        } else if (idx === options.length) {
          // "Other" 选项 - 使用带验证的输入方法
          rl.close();
          result = await this.getCustomInput(question);
        } else {
          // 如果输入不是有效的数字，尝试作为自定义输入处理（带验证）
          rl.close();
          // 先验证输入
          if (question.validator) {
            const validation = question.validator(response);
            if (!validation.valid) {
              console.log(chalk.red(`  Error: ${validation.message || 'Invalid input'}`));
              result = await this.getCustomInput(question);
            } else {
              result = response;
            }
          } else {
            result = response;
          }
        }

        console.log(chalk.green(`  Selected: ${result}\n`));
        return result;
      }
    } finally {
      rl.close();
    }
  }

  /**
   * 显示问题头部
   */
  private displayQuestionHeader(question: QuestionWithExtensions, questionNum: number, totalQuestions: number): void {
    console.log();
    console.log(chalk.bgBlue.white.bold(` Question ${questionNum}/${totalQuestions} `));
    console.log();

    // 显示标签芯片
    const headerChip = chalk.bgCyan.black.bold(` ${question.header} `);
    console.log(`  ${headerChip}`);
    console.log();

    // 显示问题
    console.log(chalk.bold(`  ${question.question}`));
    console.log();
  }

  /**
   * 获取自定义输入（带验证）
   */
  private async getCustomInput(question?: QuestionWithExtensions): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askForInput = (): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(chalk.blue('  Enter custom response: '), async (answer) => {
          const trimmed = answer.trim();

          // 基础验证：不能为空
          if (!trimmed) {
            console.log(chalk.red('  Error: Response cannot be empty. Please try again.'));
            const retry = await askForInput();
            resolve(retry);
            return;
          }

          // 自定义验证器
          if (question?.validator) {
            const validation = question.validator(trimmed);
            if (!validation.valid) {
              const message = validation.message || t('ask.invalidInput');
              console.log(chalk.red(`  Error: ${message}`));
              const retry = await askForInput();
              resolve(retry);
              return;
            }
          }

          resolve(trimmed);
        });
      });
    };

    try {
      const result = await askForInput();
      return result;
    } finally {
      rl.close();
    }
  }
}
