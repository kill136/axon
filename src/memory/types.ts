/**
 * 记忆系统共享类型定义
 */

// 记忆来源类型
export type MemorySource = 'memory' | 'session' | 'notebook';

// 记忆搜索结果
export interface MemorySearchResult {
  id: string;                   // chunk ID
  path: string;                 // 来源文件路径
  startLine: number;            // chunk 起始行
  endLine: number;              // chunk 结束行
  score: number;                // BM25 分数（已应用时间衰减）
  snippet: string;              // 匹配文本片段
  source: MemorySource;         // 来源类型
  timestamp: string;            // 写入时间 (ISO 8601)
  age: number;                  // 距今毫秒数（用于衰减计算）
}
