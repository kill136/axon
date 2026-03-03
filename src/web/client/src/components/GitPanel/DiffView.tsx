/**
 * DiffView - Git Diff 视图组件
 * 使用 <table> 布局渲染，支持语法高亮和 word-level diff
 * 支持 unified（统一视图）和 split（分栏视图）两种模式
 */

import { useMemo, useState, useCallback } from 'react';
import { useLanguage } from '../../i18n';

interface DiffViewProps {
  diff: string;
  fileName: string;
  onClose: () => void;
}

type DiffMode = 'unified' | 'split';

type DiffLineType = 'added' | 'removed' | 'context' | 'header' | 'hunk';

interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLn?: number;
  newLn?: number;
}

interface SplitRow {
  type: 'pair' | 'header' | 'hunk';
  left?: { type: DiffLineType; content: string; ln?: number };
  right?: { type: DiffLineType; content: string; ln?: number };
  content?: string;
}

// ---- Word-level diff ----

/**
 * 计算两个字符串之间的 word-level 差异
 * 返回带有 <mark> 标签的 JSX 片段
 */
function computeWordDiff(oldLine: string, newLine: string): { oldHighlighted: React.ReactNode[]; newHighlighted: React.ReactNode[] } {
  // 去掉 diff 前缀（+/-）
  const oldText = oldLine.startsWith('-') ? oldLine.slice(1) : oldLine;
  const newText = newLine.startsWith('+') ? newLine.slice(1) : newLine;

  // 按 word 边界分割（保留空白）
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);

  // 使用简化版 LCS 计算差异
  const { oldMarks, newMarks } = diffWords(oldWords, newWords);

  const oldResult: React.ReactNode[] = [];
  const newResult: React.ReactNode[] = [];

  // 渲染旧行
  let keyIdx = 0;
  oldResult.push(<span key={`p-${keyIdx++}`} className="diff-prefix">-</span>);
  for (let i = 0; i < oldWords.length; i++) {
    if (oldMarks[i]) {
      oldResult.push(<mark key={`o-${i}`} className="diff-word-removed">{oldWords[i]}</mark>);
    } else {
      oldResult.push(<span key={`o-${i}`}>{oldWords[i]}</span>);
    }
  }

  // 渲染新行
  newResult.push(<span key={`p-${keyIdx++}`} className="diff-prefix">+</span>);
  for (let i = 0; i < newWords.length; i++) {
    if (newMarks[i]) {
      newResult.push(<mark key={`n-${i}`} className="diff-word-added">{newWords[i]}</mark>);
    } else {
      newResult.push(<span key={`n-${i}`}>{newWords[i]}</span>);
    }
  }

  return { oldHighlighted: oldResult, newHighlighted: newResult };
}

/**
 * 按 word 边界分词（保留空白和标点作为独立 token）
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
      tokens.push(ch);
    } else if (/[{}()\[\];:,.<>=!&|+\-*\/\\@#$%^~`?"']/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
      tokens.push(ch);
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * 简化版 word diff：基于 LCS 计算哪些 token 被修改
 */
function diffWords(oldTokens: string[], newTokens: string[]): { oldMarks: boolean[]; newMarks: boolean[] } {
  const m = oldTokens.length;
  const n = newTokens.length;

  // 性能保护：token 过多时回退到全标记
  if (m * n > 50000) {
    return {
      oldMarks: new Array(m).fill(true),
      newMarks: new Array(n).fill(true),
    };
  }

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯找出 LCS
  const oldMarks = new Array(m).fill(true);
  const newMarks = new Array(n).fill(true);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1] === newTokens[j - 1]) {
      oldMarks[i - 1] = false;
      newMarks[j - 1] = false;
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return { oldMarks, newMarks };
}

// ---- 语法高亮 ----

type LanguageType = 'js' | 'ts' | 'css' | 'html' | 'py' | 'json' | 'md' | 'sh' | 'go' | 'rust' | 'java' | 'plain';

const EXT_TO_LANG: Record<string, LanguageType> = {
  '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.html': 'html', '.htm': 'html', '.xml': 'html', '.svg': 'html',
  '.py': 'py', '.pyw': 'py',
  '.json': 'json', '.jsonc': 'json',
  '.md': 'md', '.mdx': 'md',
  '.sh': 'sh', '.bash': 'sh', '.zsh': 'sh', '.fish': 'sh',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java', '.kt': 'java', '.scala': 'java',
};

function getLanguage(fileName: string): LanguageType {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return 'plain';
  const ext = fileName.slice(lastDot).toLowerCase();
  return EXT_TO_LANG[ext] || 'plain';
}

// 定义语法高亮规则
interface HighlightRule {
  pattern: RegExp;
  className: string;
}

const HIGHLIGHT_RULES: Record<LanguageType, HighlightRule[]> = {
  js: [
    { pattern: /\/\/.*$/gm, className: 'hl-comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'hl-comment' },
    { pattern: /(["'`])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|import|export|from|default|async|await|try|catch|finally|throw|yield|this|super|null|undefined|true|false|void)\b/g, className: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*([eE][+-]?\d+)?|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)\b/g, className: 'hl-number' },
  ],
  ts: [
    { pattern: /\/\/.*$/gm, className: 'hl-comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'hl-comment' },
    { pattern: /(["'`])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|implements|interface|type|enum|namespace|module|import|export|from|default|async|await|try|catch|finally|throw|yield|this|super|null|undefined|true|false|void|as|is|keyof|readonly|declare|abstract|public|private|protected|static|override)\b/g, className: 'hl-keyword' },
    { pattern: /\b(string|number|boolean|any|unknown|never|object|symbol|bigint)\b/g, className: 'hl-type' },
    { pattern: /\b(\d+\.?\d*([eE][+-]?\d+)?|0[xX][0-9a-fA-F]+)\b/g, className: 'hl-number' },
  ],
  css: [
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'hl-comment' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /#[0-9a-fA-F]{3,8}\b/g, className: 'hl-number' },
    { pattern: /\b(\d+\.?\d*)(px|em|rem|%|vh|vw|vmin|vmax|deg|rad|s|ms)?\b/g, className: 'hl-number' },
    { pattern: /[.#][\w-]+(?=[^{]*\{)/g, className: 'hl-keyword' },
    { pattern: /\b(var|calc|rgb|rgba|hsl|hsla|url|linear-gradient|radial-gradient)\b/g, className: 'hl-function' },
  ],
  html: [
    { pattern: /<!--[\s\S]*?-->/g, className: 'hl-comment' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /&\w+;/g, className: 'hl-keyword' },
    { pattern: /<\/?[\w-]+/g, className: 'hl-keyword' },
    { pattern: /\b[\w-]+(?==)/g, className: 'hl-type' },
  ],
  py: [
    { pattern: /#.*$/gm, className: 'hl-comment' },
    { pattern: /("""[\s\S]*?"""|'''[\s\S]*?''')/g, className: 'hl-string' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(def|class|return|if|elif|else|for|while|break|continue|import|from|as|with|try|except|finally|raise|yield|lambda|pass|del|global|nonlocal|assert|in|not|and|or|is|True|False|None|self|cls|async|await)\b/g, className: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*([eE][+-]?\d+)?|0[xX][0-9a-fA-F]+)\b/g, className: 'hl-number' },
    { pattern: /@\w+/g, className: 'hl-type' },
  ],
  json: [
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1(?=\s*:)/g, className: 'hl-keyword' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(true|false|null)\b/g, className: 'hl-keyword' },
    { pattern: /\b-?\d+\.?\d*([eE][+-]?\d+)?\b/g, className: 'hl-number' },
  ],
  md: [
    { pattern: /^#{1,6}\s.*/gm, className: 'hl-keyword' },
    { pattern: /\*\*.*?\*\*/g, className: 'hl-keyword' },
    { pattern: /`[^`]+`/g, className: 'hl-string' },
    { pattern: /\[.*?\]\(.*?\)/g, className: 'hl-type' },
  ],
  sh: [
    { pattern: /#.*$/gm, className: 'hl-comment' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(if|then|else|elif|fi|for|do|done|while|until|case|esac|function|return|exit|export|source|local|readonly|declare|typeset|set|unset|shift|trap|eval|exec)\b/g, className: 'hl-keyword' },
    { pattern: /\$[\w{]+/g, className: 'hl-type' },
  ],
  go: [
    { pattern: /\/\/.*$/gm, className: 'hl-comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'hl-comment' },
    { pattern: /(["'`])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(func|return|if|else|for|range|switch|case|default|break|continue|go|select|defer|chan|map|struct|interface|type|package|import|var|const|true|false|nil|iota)\b/g, className: 'hl-keyword' },
    { pattern: /\b(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|complex64|complex128|string|bool|byte|rune|error|any)\b/g, className: 'hl-type' },
    { pattern: /\b(\d+\.?\d*([eE][+-]?\d+)?|0[xX][0-9a-fA-F]+)\b/g, className: 'hl-number' },
  ],
  rust: [
    { pattern: /\/\/.*$/gm, className: 'hl-comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'hl-comment' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(fn|let|mut|const|static|struct|enum|impl|trait|type|pub|crate|mod|use|self|super|return|if|else|match|for|while|loop|break|continue|async|await|move|unsafe|where|as|in|ref|true|false|Some|None|Ok|Err)\b/g, className: 'hl-keyword' },
    { pattern: /\b(i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Box|Option|Result)\b/g, className: 'hl-type' },
    { pattern: /\b(\d+\.?\d*([eE][+-]?\d+)?|0[xX][0-9a-fA-F]+)\b/g, className: 'hl-number' },
  ],
  java: [
    { pattern: /\/\/.*$/gm, className: 'hl-comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'hl-comment' },
    { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/g, className: 'hl-string' },
    { pattern: /\b(public|private|protected|static|final|abstract|synchronized|volatile|transient|native|class|interface|enum|extends|implements|import|package|return|if|else|for|while|do|switch|case|default|break|continue|new|instanceof|try|catch|finally|throw|throws|this|super|null|true|false|void)\b/g, className: 'hl-keyword' },
    { pattern: /\b(int|long|float|double|boolean|char|byte|short|String|Integer|Long|Float|Double|Boolean|Object|List|Map|Set)\b/g, className: 'hl-type' },
    { pattern: /\b(\d+\.?\d*([eE][+-]?\d+)?[LlFfDd]?|0[xX][0-9a-fA-F]+[Ll]?)\b/g, className: 'hl-number' },
    { pattern: /@\w+/g, className: 'hl-type' },
  ],
  plain: [],
};

/**
 * 对代码内容应用语法高亮
 * 返回带有 <span> 标签的 HTML 字符串
 */
function highlightCode(code: string, lang: LanguageType): string {
  if (lang === 'plain') return escapeHtml(code);

  const rules = HIGHLIGHT_RULES[lang];
  if (!rules || rules.length === 0) return escapeHtml(code);

  // 收集所有匹配，标记已覆盖范围
  interface Match {
    start: number;
    end: number;
    className: string;
  }

  const matches: Match[] = [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(code)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        className: rule.className,
      });
    }
  }

  // 按起始位置排序，同位置按长度降序
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // 去除重叠（先出现的优先级高）
  const filtered: Match[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // 构建 HTML
  let result = '';
  let pos = 0;
  for (const m of filtered) {
    if (m.start > pos) {
      result += escapeHtml(code.slice(pos, m.start));
    }
    result += `<span class="${m.className}">${escapeHtml(code.slice(m.start, m.end))}</span>`;
    pos = m.end;
  }
  if (pos < code.length) {
    result += escapeHtml(code.slice(pos));
  }

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Diff 解析 ----

function parseDiff(diffText: string) {
  const rawLines = diffText.split('\n');
  const lines: DiffLine[] = [];

  let oldLn = 0;
  let newLn = 0;

  for (const line of rawLines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
      lines.push({ type: 'header', content: line });
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (m) { oldLn = parseInt(m[1], 10); newLn = parseInt(m[2], 10); }
      lines.push({ type: 'hunk', content: line });
      continue;
    }
    if (line.startsWith('+')) {
      lines.push({ type: 'added', content: line, newLn });
      newLn++;
      continue;
    }
    if (line.startsWith('-')) {
      lines.push({ type: 'removed', content: line, oldLn });
      oldLn++;
      continue;
    }
    lines.push({ type: 'context', content: line, oldLn, newLn });
    if (line !== '' || rawLines.indexOf(line) < rawLines.length - 1) {
      oldLn++;
      newLn++;
    }
  }

  // Build split rows
  const splitRows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    if (cur.type === 'header') { splitRows.push({ type: 'header', content: cur.content }); i++; continue; }
    if (cur.type === 'hunk') { splitRows.push({ type: 'hunk', content: cur.content }); i++; continue; }
    if (cur.type === 'context') {
      splitRows.push({ type: 'pair', left: { type: 'context', content: cur.content, ln: cur.oldLn }, right: { type: 'context', content: cur.content, ln: cur.newLn } });
      i++; continue;
    }
    if (cur.type === 'removed') {
      const rm: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'removed') { rm.push(lines[i]); i++; }
      const ad: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'added') { ad.push(lines[i]); i++; }
      const max = Math.max(rm.length, ad.length);
      for (let j = 0; j < max; j++) {
        splitRows.push({
          type: 'pair',
          left: rm[j] ? { type: 'removed', content: rm[j].content, ln: rm[j].oldLn } : undefined,
          right: ad[j] ? { type: 'added', content: ad[j].content, ln: ad[j].newLn } : undefined,
        });
      }
      continue;
    }
    if (cur.type === 'added') {
      splitRows.push({ type: 'pair', left: undefined, right: { type: 'added', content: cur.content, ln: cur.newLn } });
      i++; continue;
    }
    i++;
  }

  // 计算 word-level diff 的行对（相邻的 removed + added）
  const wordDiffPairs = new Map<number, { oldHighlighted: React.ReactNode[]; newHighlighted: React.ReactNode[] }>();
  let li = 0;
  while (li < lines.length) {
    if (lines[li].type === 'removed') {
      const rmStart = li;
      while (li < lines.length && lines[li].type === 'removed') li++;
      const adStart = li;
      while (li < lines.length && lines[li].type === 'added') li++;
      const rmEnd = adStart;
      const adEnd = li;
      // 对每对 removed/added 计算 word diff
      const pairCount = Math.min(rmEnd - rmStart, adEnd - adStart);
      for (let p = 0; p < pairCount; p++) {
        const rmIdx = rmStart + p;
        const adIdx = adStart + p;
        const result = computeWordDiff(lines[rmIdx].content, lines[adIdx].content);
        wordDiffPairs.set(rmIdx, { oldHighlighted: result.oldHighlighted, newHighlighted: [] });
        wordDiffPairs.set(adIdx, { oldHighlighted: [], newHighlighted: result.newHighlighted });
      }
    } else {
      li++;
    }
  }

  return { lines, splitRows, wordDiffPairs };
}

// ---- 主组件 ----

export function DiffView({ diff, fileName, onClose }: DiffViewProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<DiffMode>('unified');
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const lang = useMemo(() => getLanguage(fileName), [fileName]);

  if (!diff || diff.trim().length === 0) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">
          <span className="git-diff-file-name">{fileName || t('git.diff')}</span>
          <button className="git-diff-close" onClick={onClose} title={t('common.close')}>✕</button>
        </div>
        <div className="git-diff-content">
          <div className="git-empty-state">{t('git.noChanges')}</div>
        </div>
      </div>
    );
  }

  // 统计加减行数
  const addedCount = parsed.lines.filter(l => l.type === 'added').length;
  const removedCount = parsed.lines.filter(l => l.type === 'removed').length;

  return (
    <div className="git-diff-view">
      <div className="git-diff-header">
        <span className="git-diff-file-name">{fileName || t('git.diff')}</span>
        <div className="git-diff-stats">
          <span className="git-diff-stat-added">+{addedCount}</span>
          <span className="git-diff-stat-removed">-{removedCount}</span>
        </div>
        <div className="git-diff-mode-switcher">
          <button className={`git-diff-mode-btn ${mode === 'unified' ? 'active' : ''}`} onClick={() => setMode('unified')}>
            {t('git.unified')}
          </button>
          <button className={`git-diff-mode-btn ${mode === 'split' ? 'active' : ''}`} onClick={() => setMode('split')}>
            {t('git.split')}
          </button>
        </div>
        <button className="git-diff-close" onClick={onClose} title={t('common.close')}>✕</button>
      </div>
      <div className="git-diff-content">
        {mode === 'unified'
          ? <UnifiedView lines={parsed.lines} lang={lang} wordDiffPairs={parsed.wordDiffPairs} />
          : <SplitView rows={parsed.splitRows} lang={lang} />
        }
      </div>
    </div>
  );
}

// ---- 渲染代码内容（带语法高亮） ----

function renderCodeContent(content: string, lang: LanguageType): React.ReactNode {
  // 去掉 diff 前缀（+/-/空格）
  const codeText = content.length > 0 && (content[0] === '+' || content[0] === '-' || content[0] === ' ')
    ? content.slice(1)
    : content;

  const prefix = content.length > 0 && (content[0] === '+' || content[0] === '-')
    ? content[0]
    : '';

  const highlighted = highlightCode(codeText, lang);

  return (
    <code>
      {prefix && <span className="diff-prefix">{prefix}</span>}
      <span dangerouslySetInnerHTML={{ __html: highlighted }} />
    </code>
  );
}

// ---- Unified 视图 ----

function UnifiedView({ lines, lang, wordDiffPairs }: {
  lines: DiffLine[];
  lang: LanguageType;
  wordDiffPairs: Map<number, { oldHighlighted: React.ReactNode[]; newHighlighted: React.ReactNode[] }>;
}) {
  return (
    <table className="diff-table diff-table--unified">
      <colgroup>
        <col className="diff-col-ln" />
        <col className="diff-col-ln" />
        <col className="diff-col-code" />
      </colgroup>
      <tbody>
        {lines.map((line, i) => {
          const cls = `diff-tr diff-tr--${line.type}`;

          if (line.type === 'header' || line.type === 'hunk') {
            return (
              <tr key={i} className={cls}>
                <td className="diff-td-ln"></td>
                <td className="diff-td-ln"></td>
                <td className="diff-td-code"><code>{line.content}</code></td>
              </tr>
            );
          }

          // 检查是否有 word-level diff
          const wordDiff = wordDiffPairs.get(i);
          if (wordDiff) {
            const highlighted = line.type === 'removed' ? wordDiff.oldHighlighted : wordDiff.newHighlighted;
            if (highlighted.length > 0) {
              return (
                <tr key={i} className={cls}>
                  <td className="diff-td-ln">{line.oldLn ?? ''}</td>
                  <td className="diff-td-ln">{line.newLn ?? ''}</td>
                  <td className="diff-td-code"><code>{highlighted}</code></td>
                </tr>
              );
            }
          }

          return (
            <tr key={i} className={cls}>
              <td className="diff-td-ln">{line.oldLn ?? ''}</td>
              <td className="diff-td-ln">{line.newLn ?? ''}</td>
              <td className="diff-td-code">{renderCodeContent(line.content, lang)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- Split 视图 ----

function SplitView({ rows, lang }: { rows: SplitRow[]; lang: LanguageType }) {
  return (
    <table className="diff-table diff-table--split">
      <colgroup>
        <col className="diff-col-ln" />
        <col className="diff-col-code" />
        <col className="diff-col-divider" />
        <col className="diff-col-ln" />
        <col className="diff-col-code" />
      </colgroup>
      <tbody>
        {rows.map((row, i) => {
          if (row.type === 'header' || row.type === 'hunk') {
            const cls = `diff-tr diff-tr--${row.type}`;
            return (
              <tr key={i} className={cls}>
                <td className="diff-td-ln"></td>
                <td colSpan={3} className="diff-td-code"><code>{row.content}</code></td>
                <td className="diff-td-ln"></td>
              </tr>
            );
          }

          const lt = row.left?.type ?? 'empty';
          const rt = row.right?.type ?? 'empty';

          return (
            <tr key={i} className="diff-tr">
              <td className={`diff-td-ln diff-td--${lt}`}>{row.left?.ln ?? ''}</td>
              <td className={`diff-td-code diff-td--${lt}`}>
                {row.left ? renderCodeContent(row.left.content, lang) : <code />}
              </td>
              <td className="diff-td-divider"></td>
              <td className={`diff-td-ln diff-td--${rt}`}>{row.right?.ln ?? ''}</td>
              <td className={`diff-td-code diff-td--${rt}`}>
                {row.right ? renderCodeContent(row.right.content, lang) : <code />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
