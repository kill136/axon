import type { MemorySearchManager } from './memory-search.js';
import type { MemorySearchResult } from './types.js';
import { getRecallSourceKind } from './recall-source-kind.js';

export interface LayeredRecallOptions {
  sessionId?: string;
  hasCompactSummary?: boolean;
  notebookLimit?: number;
  sessionSummaryLimit?: number;
  searchPoolSize?: number;
}

export interface LayeredRecallPlan {
  formatted: string | null;
  notebookResults: MemorySearchResult[];
  sessionSummaryResults: MemorySearchResult[];
}

function formatAge(ms: number): string {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

function normalizeSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sanitizeSummaryText(snippet: string): string {
  return snippet
    .replace(/^#+\s*Current State\s*/i, '')
    .replace(/^#+\s*Task specification\s*/i, '')
    .replace(/^[-*]\s*/gm, '')
    .trim();
}

function isCurrentSessionSummary(result: MemorySearchResult, sessionId?: string): boolean {
  if (!sessionId) return false;
  if (getRecallSourceKind(result) !== 'session-summary') return false;
  const normalized = result.path.replace(/\\/g, '/');
  return normalized === `${sessionId}/session-memory/summary.md`
    || normalized.endsWith(`/${sessionId}/session-memory/summary.md`)
    || normalized.endsWith(`${sessionId}/session-memory/summary.md`);
}

function dedupeSecondaryBySnippet(
  primary: MemorySearchResult[],
  secondary: MemorySearchResult[],
): MemorySearchResult[] {
  const seen = new Set(primary.map(result => normalizeSnippet(result.snippet)));
  return secondary.filter(result => {
    const normalized = normalizeSnippet(result.snippet);
    if (!normalized) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function formatSection(title: string, results: MemorySearchResult[]): string | null {
  if (results.length === 0) return null;

  const lines = [title];
  for (const result of results) {
    const text = getRecallSourceKind(result) === 'session-summary'
      ? sanitizeSummaryText(result.snippet)
      : result.snippet;
    lines.push(`- (${formatAge(result.age)} ago) ${text}`);
  }
  return lines.join('\n');
}

export function planLayeredRecallFromResults(
  results: MemorySearchResult[],
  opts: LayeredRecallOptions = {},
): LayeredRecallPlan {
  const notebookLimit = opts.notebookLimit ?? 2;
  const sessionSummaryLimit = opts.sessionSummaryLimit ?? 1;

  const notebookResults = results
    .filter(result => getRecallSourceKind(result) === 'notebook')
    .slice(0, notebookLimit);

  let sessionSummaryResults: MemorySearchResult[] = [];
  if (!opts.hasCompactSummary) {
    sessionSummaryResults = dedupeSecondaryBySnippet(
      notebookResults,
      results.filter(result => isCurrentSessionSummary(result, opts.sessionId)),
    ).slice(0, sessionSummaryLimit);
  }

  const sections = [
    formatSection('[Notebook]', notebookResults),
    formatSection('[Current session background]', sessionSummaryResults),
  ].filter((section): section is string => Boolean(section));

  return {
    formatted: sections.length > 0 ? sections.join('\n\n') : null,
    notebookResults,
    sessionSummaryResults,
  };
}

export async function buildLayeredMemoryRecall(
  manager: MemorySearchManager,
  query: string,
  opts: LayeredRecallOptions = {},
): Promise<LayeredRecallPlan> {
  if (!query || query.trim().length < 3) {
    return {
      formatted: null,
      notebookResults: [],
      sessionSummaryResults: [],
    };
  }

  const notebookLimit = opts.notebookLimit ?? 2;
  const sessionSummaryLimit = opts.sessionSummaryLimit ?? 1;
  const searchPoolSize = opts.searchPoolSize ?? 8;

  const [notebookRaw, sessionRaw] = await Promise.all([
    manager.hybridSearch(query, {
      source: 'notebook',
      maxResults: Math.max(searchPoolSize, notebookLimit * 2),
    }),
    opts.hasCompactSummary
      ? Promise.resolve([])
      : manager.hybridSearch(query, {
          source: 'session',
          maxResults: Math.max(searchPoolSize, sessionSummaryLimit * 4),
        }),
  ]);

  const notebookResults = notebookRaw
    .filter(result => result.score > 0.1 && getRecallSourceKind(result) === 'notebook')
    .slice(0, notebookLimit);

  const sessionSummaryResults = opts.hasCompactSummary
    ? []
    : dedupeSecondaryBySnippet(
        notebookResults,
        sessionRaw.filter(result => result.score > 0.1 && isCurrentSessionSummary(result, opts.sessionId)),
      ).slice(0, sessionSummaryLimit);

  const sections = [
    formatSection('[Notebook]', notebookResults),
    formatSection('[Current session background]', sessionSummaryResults),
  ].filter((section): section is string => Boolean(section));

  return {
    formatted: sections.length > 0 ? sections.join('\n\n') : null,
    notebookResults,
    sessionSummaryResults,
  };
}
