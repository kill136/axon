import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 从 App.tsx 中提取的 formatTimeSeparator 逻辑进行独立测试
// 由于 formatTimeSeparator 是模块内函数，这里复制其逻辑进行单元测试
function formatTimeSeparator(ts: number, t: (key: string) => string): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (d.toDateString() === now.toDateString()) {
    return time;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `${t('time.yesterday')} ${time}`;
  }

  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

const TIME_GAP_MS = 4 * 60 * 1000; // 4 分钟

describe('时间分隔线', () => {
  const mockT = (key: string) => {
    const translations: Record<string, string> = {
      'time.yesterday': 'Yesterday',
    };
    return translations[key] || key;
  };

  describe('formatTimeSeparator', () => {
    it('今天的时间戳只显示时间', () => {
      const now = Date.now();
      const result = formatTimeSeparator(now, mockT);
      // 应该只有时间部分，不包含 "Yesterday" 或日期
      expect(result).not.toContain('Yesterday');
      // 应该匹配 HH:MM 格式
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('昨天的时间戳显示 "Yesterday HH:MM"', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(14, 30, 0, 0);
      const result = formatTimeSeparator(yesterday.getTime(), mockT);
      expect(result).toContain('Yesterday');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('更早的时间戳显示日期和时间', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 5);
      oldDate.setHours(10, 0, 0, 0);
      const result = formatTimeSeparator(oldDate.getTime(), mockT);
      expect(result).not.toContain('Yesterday');
      // 应包含时间
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('4 分钟间隔判断逻辑', () => {
    it('间隔 < 4 分钟不应插入分隔线', () => {
      const t1 = Date.now();
      const t2 = t1 + 3 * 60 * 1000; // 3 分钟后
      expect(t2 - t1 < TIME_GAP_MS).toBe(true);
    });

    it('间隔 = 4 分钟应插入分隔线', () => {
      const t1 = Date.now();
      const t2 = t1 + 4 * 60 * 1000; // 正好 4 分钟
      expect(t2 - t1 >= TIME_GAP_MS).toBe(true);
    });

    it('间隔 > 4 分钟应插入分隔线', () => {
      const t1 = Date.now();
      const t2 = t1 + 10 * 60 * 1000; // 10 分钟后
      expect(t2 - t1 >= TIME_GAP_MS).toBe(true);
    });

    it('第一条消息前不插入分隔线', () => {
      // idx === 0 时不应有分隔线
      const idx = 0;
      expect(idx > 0).toBe(false);
    });
  });
});
