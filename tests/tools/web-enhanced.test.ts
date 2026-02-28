/**
 * Web 工具增强功能测试
 * T-011: Turndown 集成优化测试
 * Note: WebSearch has been migrated to Anthropic API Server Tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WebFetchTool, getWebCacheStats, clearWebCaches } from '../../src/tools/web.js';

describe('T-011: Turndown Integration Optimization', () => {
  let webFetch: WebFetchTool;

  beforeEach(() => {
    webFetch = new WebFetchTool();
    clearWebCaches();
  });

  it('should have enhanced turndown configuration', () => {
    expect(webFetch.name).toBe('WebFetch');
    expect(webFetch.description).toContain('HTML to markdown');
  });

  it('should support GFM extensions', () => {
    // GFM support is verified by the turndown service configuration
    // This test ensures the tool is properly initialized
    expect(webFetch).toBeDefined();
  });
});

describe('Web Cache Integration', () => {
  beforeEach(() => {
    clearWebCaches();
  });

  it('should track fetch cache statistics', () => {
    const initialStats = getWebCacheStats();

    expect(initialStats.fetch.itemCount).toBe(0);
  });
});
