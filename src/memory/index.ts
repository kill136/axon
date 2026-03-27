/**
 * Memory 系统入口
 *
 * 记忆系统架构（3 套）：
 * 1. Notebook (experience.md + project.md) — Agent 自管理笔记本，注入 system prompt
 * 2. Session Memory (summary.md) — 对话摘要，compact 时自动更新
 * 3. LongTermStore + MemorySearch — SQLite FTS5 全文检索，索引历史 .md 文件
 */

export { NotebookManager, initNotebookManager, getNotebookManager, getNotebookManagerForProject, activateNotebookManager, resetNotebookManager } from './notebook.js';
export type { NotebookType, NotebookWriteResult, NotebookStats } from './notebook.js';
export { MemorySearchManager, initMemorySearchManager, getMemorySearchManager, resetMemorySearchManager } from './memory-search.js';
export type { EmbeddingConfig } from './memory-search.js';
export { LongTermStore } from './long-term-store.js';
export type { MemorySource, MemorySearchResult } from './types.js';

// v2.1.85: Auto-memory 打分系统和 Timestamp 管理
export { AutoMemoryScorer, scoreMemory, scoreMemories } from './auto-memory-scorer.js';
export type { MemoryType, FreshnessLevel, MemoryItem, ScoringResult, ScoringStats } from './auto-memory-scorer.js';
export { MemoryTimestampManager } from './memory-timestamp.js';
export type { TimestampedMemory, TimestampStats } from './memory-timestamp.js';
