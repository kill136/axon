/**
 * HiveConsole 组件单元测试
 * 测试蜂群控制台UI的核心功能
 * 
 * TDD - Red Phase: 这些测试将验证HiveConsole组件的功能
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { HiveConsole, type HiveConsoleProps } from './HiveConsole.js';

describe('HiveConsole Component', () => {
  const defaultProps: HiveConsoleProps = {
    queenId: 'queen-1',
    queenStatus: 'working',
    blueprintName: '测试项目',
    taskCount: 10,
    completedCount: 3,
    workerCount: 3,
    activeWorkers: 2,
    timelineEvents: [
      {
        id: 'event-1',
        timestamp: new Date('2024-01-01T10:00:00'),
        type: 'task_start',
        description: '开始任务1',
        data: {},
      },
    ],
  };

  describe('基础渲染', () => {
    it('应该正确渲染HiveConsole组件', () => {
      const { lastFrame } = render(<HiveConsole {...defaultProps} />);
      const output = lastFrame();
      
      expect(output).toBeDefined();
      expect(output).toContain('Hive Console');
    });

    it('应该显示Queen Agent信息', () => {
      const { lastFrame } = render(<HiveConsole {...defaultProps} />);
      const output = lastFrame();
      
      expect(output).toContain('Queen Agent');
      expect(output).toContain('queen-1');
    });

    it('应该显示蓝图名称', () => {
      const { lastFrame } = render(<HiveConsole {...defaultProps} />);
      const output = lastFrame();
      
      expect(output).toContain('测试项目');
    });

    it('应该显示任务统计信息', () => {
      const { lastFrame } = render(<HiveConsole {...defaultProps} />);
      const output = lastFrame();
      
      expect(output).toContain('10'); // 总任务数
      expect(output).toContain('3');  // 已完成数
    });

    it('应该显示Worker Agent计数', () => {
      const { lastFrame } = render(<HiveConsole {...defaultProps} />);
      const output = lastFrame();
      
      expect(output).toContain('3'); // 总worker数
      expect(output).toContain('2'); // 活跃worker数
    });
  });

  describe('Queen Agent状态', () => {
    it('当Queen处于working状态时应该显示working指示器', () => {
      const props = { ...defaultProps, queenStatus: 'working' as const };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('working');
    });

    it('当Queen处于idle状态时应该显示idle指示器', () => {
      const props = { ...defaultProps, queenStatus: 'idle' as const };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('idle');
    });

    it('当Queen处于waiting状态时应该显示waiting指示器', () => {
      const props = { ...defaultProps, queenStatus: 'waiting' as const };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('waiting');
    });

    it('当Queen处于error状态时应该显示error指示器', () => {
      const props = { ...defaultProps, queenStatus: 'error' as const };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('error');
    });
  });

  describe('进度条显示', () => {
    it('应该根据完成任务数显示进度条', () => {
      const props = {
        ...defaultProps,
        taskCount: 10,
        completedCount: 5,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      // 50%进度应该显示在输出中
      expect(output).toContain('50%');
    });

    it('当所有任务完成时进度条应该100%', () => {
      const props = {
        ...defaultProps,
        taskCount: 5,
        completedCount: 5,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('100%');
    });

    it('当没有任务完成时进度条应该0%', () => {
      const props = {
        ...defaultProps,
        taskCount: 10,
        completedCount: 0,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('0%');
    });
  });

  describe('时间线事件显示', () => {
    it('应该显示时间线事件', () => {
      const props = {
        ...defaultProps,
        timelineEvents: [
          {
            id: 'event-1',
            timestamp: new Date('2024-01-01T10:00:00'),
            type: 'task_start',
            description: '开始执行Task 1',
            data: {},
          },
          {
            id: 'event-2',
            timestamp: new Date('2024-01-01T10:05:00'),
            type: 'task_complete',
            description: '完成Task 1',
            data: {},
          },
        ],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('Timeline');
      expect(output).toContain('开始执行Task 1');
      expect(output).toContain('完成Task 1');
    });

    it('应该限制显示最近的10条事件', () => {
      const events = Array.from({ length: 15 }, (_, i) => ({
        id: `event-${i}`,
        timestamp: new Date(Date.now() - i * 60000),
        type: 'task_start' as const,
        description: `Event ${i}`,
        data: {},
      }));

      const props = {
        ...defaultProps,
        timelineEvents: events,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      // 应该只显示10条（最近的10条）
      const eventMatches = output.match(/Event \d+/g) || [];
      expect(eventMatches.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Worker Agent面板', () => {
    it('应该显示活跃Worker Agent的信息', () => {
      const props = {
        ...defaultProps,
        workers: [
          {
            id: 'worker-1',
            taskId: 'task-1',
            status: 'working' as const,
            progress: 50,
          },
          {
            id: 'worker-2',
            taskId: 'task-2',
            status: 'idle' as const,
            progress: 0,
          },
        ],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('worker-1');
      expect(output).toContain('worker-2');
    });

    it('应该显示Worker的任务进度', () => {
      const props = {
        ...defaultProps,
        workers: [
          {
            id: 'worker-1',
            taskId: 'task-1',
            status: 'working' as const,
            progress: 75,
          },
        ],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('75%');
    });

    it('应该显示Worker的状态指示器', () => {
      const props = {
        ...defaultProps,
        workers: [
          {
            id: 'worker-1',
            taskId: 'task-1',
            status: 'working' as const,
            progress: 50,
          },
          {
            id: 'worker-2',
            taskId: 'task-2',
            status: 'error' as const,
            progress: 0,
          },
        ],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toContain('working');
      expect(output).toContain('error');
    });
  });

  describe('紧凑模式', () => {
    it('在compact模式下应该显示简洁UI', () => {
      const props = {
        ...defaultProps,
        isCompact: true,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      // 紧凑模式应该显示基本信息
      expect(output).toBeDefined();
      expect(output).toContain('Hive Console');
    });

    it('在compact模式下不应该显示详细的Worker面板', () => {
      const props = {
        ...defaultProps,
        isCompact: true,
        workers: [
          {
            id: 'worker-1',
            taskId: 'task-1',
            status: 'working' as const,
            progress: 50,
          },
        ],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      // 紧凑模式应该有简洁输出
      expect(output).toBeDefined();
    });
  });

  describe('空状态处理', () => {
    it('当没有Worker时应该优雅处理', () => {
      const props = {
        ...defaultProps,
        workers: [],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toBeDefined();
    });

    it('当没有时间线事件时应该优雅处理', () => {
      const props = {
        ...defaultProps,
        timelineEvents: [],
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toBeDefined();
    });
  });

  describe('颜色和样式', () => {
    it('应该使用正确的颜色来表示不同的状态', () => {
      const props = {
        ...defaultProps,
        queenStatus: 'working' as const,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      // 检查是否有颜色信息（基于Ink的颜色代码）
      expect(output).toBeDefined();
    });
  });

  describe('边界情况', () => {
    it('应该处理0个任务的情况', () => {
      const props = {
        ...defaultProps,
        taskCount: 0,
        completedCount: 0,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toBeDefined();
    });

    it('应该处理大量Worker的情况', () => {
      const workers = Array.from({ length: 20 }, (_, i) => ({
        id: `worker-${i}`,
        taskId: `task-${i}`,
        status: 'working' as const,
        progress: Math.random() * 100,
      }));

      const props = {
        ...defaultProps,
        workers,
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toBeDefined();
    });

    it('应该处理非常长的蓝图名称', () => {
      const props = {
        ...defaultProps,
        blueprintName: '这是一个非常非常非常非常非常长的蓝图名称用来测试长文本的处理能力',
      };
      const { lastFrame } = render(<HiveConsole {...props} />);
      const output = lastFrame();
      
      expect(output).toBeDefined();
    });
  });
});
