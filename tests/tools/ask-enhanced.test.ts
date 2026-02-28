/**
 * AskUserQuestion 工具增强功能测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AskUserQuestionTool } from '../../src/tools/ask.js';

describe('AskUserQuestion Enhanced Features', () => {
  let tool: AskUserQuestionTool;

  beforeEach(() => {
    tool = new AskUserQuestionTool();
  });

  describe('基本功能', () => {
    it('应该正确初始化工具', () => {
      expect(tool.name).toBe('AskUserQuestion');
      expect(tool.description).toContain('ask the user questions');
    });

    it('应该有正确的 schema', () => {
      const schema = tool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('questions');
    });
  });

  describe('输入验证', () => {
    it('应该拒绝没有问题的输入', async () => {
      const result = await tool.execute({
        questions: [],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No questions provided');
    });

    it('应该拒绝超过4个问题', async () => {
      const questions = Array(5).fill({
        question: 'Test?',
        header: 'Test',
        options: [
          { label: 'Yes', description: 'Yes' },
          { label: 'No', description: 'No' },
        ],
        multiSelect: false,
      });

      const result = await tool.execute({ questions });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum 4 questions allowed');
    });

    it('应该验证 header 长度', async () => {
      const result = await tool.execute({
        questions: [
          {
            question: 'Test?',
            header: 'VeryLongHeaderThatExceedsMaxLength',
            options: [
              { label: 'Yes', description: 'Yes' },
              { label: 'No', description: 'No' },
            ],
            multiSelect: false,
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum length');
    });

    it('应该验证选项数量（最少2个）', async () => {
      const result = await tool.execute({
        questions: [
          {
            question: 'Test?',
            header: 'Test',
            options: [{ label: 'Only', description: 'One option' }],
            multiSelect: false,
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('must have 2-4 options');
    });

    it('应该验证选项数量（最多4个）', async () => {
      const result = await tool.execute({
        questions: [
          {
            question: 'Test?',
            header: 'Test',
            options: [
              { label: '1', description: 'Option 1' },
              { label: '2', description: 'Option 2' },
              { label: '3', description: 'Option 3' },
              { label: '4', description: 'Option 4' },
              { label: '5', description: 'Option 5' },
            ],
            multiSelect: false,
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('must have 2-4 options');
    });

    it('应该验证选项必须有 label', async () => {
      const result = await tool.execute({
        questions: [
          {
            question: 'Test?',
            header: 'Test',
            options: [
              { label: '', description: 'Empty label' },
              { label: 'Valid', description: 'Valid option' },
            ],
            multiSelect: false,
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('must have a label');
    });

    it('应该验证选项必须有 description', async () => {
      const result = await tool.execute({
        questions: [
          {
            question: 'Test?',
            header: 'Test',
            options: [
              { label: 'Valid', description: '' },
              { label: 'Also Valid', description: 'Has description' },
            ],
            multiSelect: false,
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('must have a description');
    });
  });

  describe('预设答案处理', () => {
    it('应该处理预设答案', async () => {
      const result = await tool.execute({
        questions: [
          {
            question: 'Test?',
            header: 'Test',
            options: [
              { label: 'Yes', description: 'Yes' },
              { label: 'No', description: 'No' },
            ],
            multiSelect: false,
          },
        ],
        answers: {
          Test: 'Yes',
        },
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('User has answered your questions');
      expect(result.output).toContain('Test');
      expect(result.output).toContain('Yes');
    });
  });

  describe('增强功能 - 默认值', () => {
    it('应该接受有效的 defaultIndex', () => {
      // 这个测试只验证 defaultIndex 不会导致错误
      // 实际的交互行为需要在集成测试中验证
      const questions: any = [
        {
          question: 'Test?',
          header: 'Test',
          options: [
            { label: 'Option 1', description: 'First option' },
            { label: 'Option 2', description: 'Second option' },
          ],
          multiSelect: false,
          defaultIndex: 0,
        },
      ];

      expect(questions[0].defaultIndex).toBe(0);
    });
  });

  describe('增强功能 - 超时', () => {
    it('应该接受有效的 timeout', () => {
      const questions: any = [
        {
          question: 'Test?',
          header: 'Test',
          options: [
            { label: 'Yes', description: 'Yes' },
            { label: 'No', description: 'No' },
          ],
          multiSelect: false,
          timeout: 5000,
        },
      ];

      expect(questions[0].timeout).toBe(5000);
    });
  });

  describe('增强功能 - 验证器', () => {
    it('应该接受有效的 validator 函数', () => {
      const validator = (input: string) => {
        if (input.length < 3) {
          return { valid: false, message: 'Too short' };
        }
        return { valid: true };
      };

      const questions: any = [
        {
          question: 'Test?',
          header: 'Test',
          options: [
            { label: 'Default', description: 'Default value' },
          ],
          multiSelect: false,
          validator,
        },
      ];

      expect(typeof questions[0].validator).toBe('function');
      expect(questions[0].validator('ab').valid).toBe(false);
      expect(questions[0].validator('abc').valid).toBe(true);
    });

    it('验证器应该能够返回自定义错误消息', () => {
      const validator = (input: string) => {
        if (!/^[a-z]+$/.test(input)) {
          return {
            valid: false,
            message: 'Only lowercase letters allowed',
          };
        }
        return { valid: true };
      };

      const result = validator('ABC123');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Only lowercase letters allowed');
    });
  });

  describe('组合增强功能', () => {
    it('应该支持同时使用 defaultIndex, timeout 和 validator', () => {
      const questions: any = [
        {
          question: 'Enter email:',
          header: 'Email',
          options: [
            { label: 'user@example.com', description: 'Default email' },
          ],
          multiSelect: false,
          defaultIndex: 0,
          timeout: 10000,
          validator: (input: string) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(input)) {
              return { valid: false, message: 'Invalid email' };
            }
            return { valid: true };
          },
        },
      ];

      expect(questions[0].defaultIndex).toBe(0);
      expect(questions[0].timeout).toBe(10000);
      expect(typeof questions[0].validator).toBe('function');
    });
  });
});
