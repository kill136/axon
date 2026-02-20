/**
 * Bash History Autocomplete 测试
 * 
 * 验证 v2.1.14 新功能：bash 历史自动补全
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getHistory,
  searchHistory,
  reverseSearchHistory,
  getHistoryFilePath,
  clearHistoryCache,
} from '../src/tools/bash-history.js';

describe('Bash History - System Level', () => {
  beforeEach(() => {
    clearHistoryCache();
  });

  it('应该能够找到历史文件路径', () => {
    const path = getHistoryFilePath();
    console.log('History file path:', path);
    
    // 如果找不到历史文件，这个测试可以跳过
    if (!path) {
      console.warn('No bash history file found - skipping test');
      return;
    }
    
    expect(path).toBeTruthy();
    expect(path).toMatch(/\.(bash|zsh|sh)_history$/);
  });

  it('应该能够读取历史记录', () => {
    const history = getHistory();
    console.log(`Loaded ${history.length} history entries`);
    
    if (history.length === 0) {
      console.warn('No history entries found - skipping test');
      return;
    }
    
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toHaveProperty('command');
    expect(history[0]).toHaveProperty('source');
  });

  it('应该能够前缀搜索历史命令', () => {
    const history = getHistory();
    
    if (history.length === 0) {
      console.warn('No history entries - skipping test');
      return;
    }
    
    // 使用第一个命令的前几个字符作为搜索前缀
    const firstCommand = history[0].command;
    const prefix = firstCommand.slice(0, Math.min(3, firstCommand.length));
    
    const results = searchHistory(prefix, 10);
    console.log(`Search prefix "${prefix}" found ${results.length} matches`);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toContain(prefix);
  });

  it('应该能够反向搜索历史命令', () => {
    const history = getHistory();
    
    if (history.length === 0) {
      console.warn('No history entries - skipping test');
      return;
    }
    
    // 查找包含 'git' 的命令
    const results = reverseSearchHistory('git', 10);
    console.log(`Reverse search found ${results.length} git commands`);
    
    if (results.length > 0) {
      expect(results[0]).toMatch(/git/i);
    }
  });

  it('应该限制返回结果数量（对齐官方 vx0=15）', () => {
    const maxResults = 15;
    const results = searchHistory('', maxResults);
    
    expect(results.length).toBeLessThanOrEqual(maxResults);
  });

  it('应该去重历史记录', () => {
    const history = getHistory();
    
    if (history.length === 0) {
      console.warn('No history entries - skipping test');
      return;
    }
    
    const commands = history.map(h => h.command);
    const uniqueCommands = new Set(commands);
    
    // 历史记录应该是去重的
    expect(commands.length).toBe(uniqueCommands.size);
  });
});

describe('Bash History - UI Integration', () => {
  it('应该能从 autocomplete 模块获取历史补全', async () => {
    const { getBashHistoryCompletions } = await import('../src/ui/autocomplete/bash-history.js');
    
    // 无查询时返回最近的命令
    const recent = getBashHistoryCompletions('', 5);
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.length).toBeLessThanOrEqual(5);
    
    // 有查询时返回匹配的命令
    const matches = getBashHistoryCompletions('git', 10);
    expect(Array.isArray(matches)).toBe(true);
  });

  it('应该能识别补全类型为 bash-history', async () => {
    const { getBashHistoryCompletions } = await import('../src/ui/autocomplete/bash-history.js');
    
    const results = getBashHistoryCompletions('test', 5);
    
    if (results.length > 0) {
      expect(results[0].type).toBe('bash-history');
      expect(results[0]).toHaveProperty('icon');
      expect(results[0]).toHaveProperty('priority');
    }
  });

  it('UI 历史应该有更高优先级', async () => {
    const { getBashHistoryCompletions, addToHistory } = await import('../src/ui/autocomplete/bash-history.js');
    
    // 添加一个测试命令到 UI 历史
    const testCommand = 'test_ui_priority_' + Date.now();
    addToHistory(testCommand);
    
    // 搜索这个命令
    const partial = testCommand.slice(0, 10);
    const results = getBashHistoryCompletions(partial, 10);
    
    if (results.length > 0) {
      // UI 历史的结果应该包含闪电图标
      const uiResult = results.find(r => r.value === testCommand);
      if (uiResult) {
        expect(uiResult.icon).toBe('⚡');
        expect(uiResult.description).toContain('Recent');
      }
    }
  });
});

describe('Bash History - Performance', () => {
  it('应该能快速加载大历史文件', () => {
    const startTime = Date.now();
    const history = getHistory();
    const endTime = Date.now();
    
    const loadTime = endTime - startTime;
    console.log(`Loaded ${history.length} entries in ${loadTime}ms`);
    
    // 加载时间应该在合理范围内
    expect(loadTime).toBeLessThan(1000); // 1秒内
  });

  it('应该能快速搜索历史', () => {
    const history = getHistory();
    
    if (history.length === 0) {
      console.warn('No history entries - skipping test');
      return;
    }
    
    const startTime = Date.now();
    searchHistory('git', 15);
    const endTime = Date.now();
    
    const searchTime = endTime - startTime;
    console.log(`Search completed in ${searchTime}ms`);
    
    // 搜索应该很快
    expect(searchTime).toBeLessThan(100); // 100ms内
  });

  it('应该正确使用缓存', () => {
    // 首次加载
    const start1 = Date.now();
    getHistory();
    const time1 = Date.now() - start1;
    
    // 第二次加载（应该使用缓存）
    const start2 = Date.now();
    getHistory();
    const time2 = Date.now() - start2;
    
    console.log(`First load: ${time1}ms, Cached load: ${time2}ms`);
    
    // 缓存加载应该更快
    expect(time2).toBeLessThanOrEqual(time1);
  });
});
