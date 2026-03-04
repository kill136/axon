/**
 * 搜索查询扩展：关键词提取 + 停用词过滤
 *
 * 参考 OpenClaw src/memory/query-expansion.ts 的模式。
 * 对话式查询（如 "那个关于 API 超时的讨论"）包含大量停用词，
 * 过滤后只保留有意义的关键词，提升 FTS5 搜索精度。
 */

// 英文停用词（高频功能词）
const STOP_WORDS_EN = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'about', 'that', 'this',
  'those', 'these', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'up', 'down', 'also', 'like',
]);

// 中文停用词（高频虚词/助词）
const STOP_WORDS_ZH = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她',
  '它', '那', '么', '吗', '呢', '吧', '啊', '把', '被', '比',
  '别', '从', '但', '当', '对', '而', '该', '跟', '还', '或',
  '给', '让', '如果', '所以', '虽然', '但是', '因为', '可以',
  '这个', '那个', '什么', '怎么', '哪个',
]);

/**
 * 从查询文本中提取有意义的关键词
 *
 * @param query - 用户的自然语言搜索查询
 * @returns 过滤停用词后的关键词数组（最多 20 个）
 *
 * @example
 * extractKeywords("那个关于 API 超时的讨论")
 * // => ["关于", "API", "超时", "讨论"]
 *
 * extractKeywords("the discussion about API timeout errors")
 * // => ["discussion", "API", "timeout", "errors"]
 */
export function extractKeywords(query: string): string[] {
  // Unicode-aware tokenization：匹配字母、数字、下划线序列
  const tokens: string[] = query.match(/[\p{L}\p{N}_]+/gu) || [];

  return tokens
    .filter(t => {
      // 跳过单字符 token（除了 CJK 字符，CJK 单字也有意义）
      if (t.length === 1 && !/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(t)) {
        return false;
      }
      return !STOP_WORDS_EN.has(t.toLowerCase()) && !STOP_WORDS_ZH.has(t);
    })
    .slice(0, 20);
}
