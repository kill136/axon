export type RecallSourceKind =
  | 'notebook'
  | 'session-summary'
  | 'transcript'
  | 'memory-doc'
  | 'unknown';

/**
 * 基于 MemorySearchResult/索引路径推断 recall 的内部来源类型。
 *
 * 设计目标：
 * - 不改现有数据库 schema
 * - 不改外部 MemorySource 公共接口
 * - 先用运行时 path/source 识别，支撑 Phase 1/2 的分层 recall
 */
export function getRecallSourceKind(input: { path: string; source?: string }): RecallSourceKind {
  const source = input.source || '';
  const normalizedPath = (input.path || '').replace(/\\/g, '/');

  if (normalizedPath.startsWith('notebook:')) {
    return 'notebook';
  }

  if (normalizedPath.startsWith('transcript:')) {
    return 'transcript';
  }

  if (source === 'session' && /(^|\/)session-memory\/summary\.md$/i.test(normalizedPath)) {
    return 'session-summary';
  }

  if (source === 'memory') {
    return 'memory-doc';
  }

  return 'unknown';
}
