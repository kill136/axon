/**
 * ActivityPage -- Recent file activity log
 *
 * Extracted from the old AppsPage "activity" section into its own standalone page.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '../../i18n';
import './ActivityPage.css';

// ============ Types ============

interface ArtifactFile {
  filePath: string;
  ops: number;
  toolNames: string[];
  added: number;
  removed: number;
  latestTimestamp: number;
}

interface ArtifactSession {
  sessionId: string;
  sessionName: string;
  latestTimestamp: number;
  files: ArtifactFile[];
}

interface ArtifactsResponse {
  sessions: ArtifactSession[];
  stats: { totalFiles: number; totalEdits: number; totalWrites: number; sessionCount: number };
}

type FilterType = 'all' | 'edit' | 'write';

interface ActivityPageProps {
  onNavigateToSession?: (sessionId: string) => void;
}

// ============ Helpers ============

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function splitPath(filePath: string): { dir: string; name: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return { dir: '', name: normalized };
  return { dir: normalized.slice(0, lastSlash + 1), name: normalized.slice(lastSlash + 1) };
}

function toolBadgeClass(toolNames: string[]): string {
  if (toolNames.includes('Write') && toolNames.length === 1) return 'write';
  if (toolNames.every(t => t === 'Edit' || t === 'MultiEdit')) return 'edit';
  return 'mixed';
}

function toolBadgeLabel(toolNames: string[]): string {
  if (toolNames.length === 1) {
    switch (toolNames[0]) {
      case 'Write': return 'W';
      case 'Edit': return 'E';
      case 'MultiEdit': return 'M';
    }
  }
  return 'M';
}

function groupSessionsByDate(sessions: ArtifactSession[]): Map<string, ArtifactSession[]> {
  const groups = new Map<string, ArtifactSession[]>();
  for (const s of sessions) {
    const key = formatDate(s.latestTimestamp);
    const list = groups.get(key) || [];
    list.push(s);
    groups.set(key, list);
  }
  return groups;
}

// ============ Main Component ============

export default function ActivityPage({ onNavigateToSession }: ActivityPageProps) {
  const { t } = useLanguage();

  const [data, setData] = useState<ArtifactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const fetchActivity = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterType !== 'all') params.set('type', filterType);
      params.set('sessionLimit', '20');
      const res = await fetch(`/api/artifacts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ArtifactsResponse = await res.json();
      setData(json);
      if (json.sessions.length > 0) {
        setExpandedSessions(new Set(json.sessions.slice(0, 3).map(s => s.sessionId)));
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [search, filterType]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleSession = (sessionId: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      return next;
    });
  };

  const stats = data?.stats;
  const sessions = data?.sessions || [];
  const dateGroups = useMemo(() => groupSessionsByDate(sessions), [sessions]);

  return (
    <div className="activity-page">
      {/* Title + stats */}
      <div className="activity-page-header">
        <h2>{t('apps.activityTitle')}</h2>
        {stats && (
          <span className="activity-page-stats">
            {t('apps.subtitle', { files: stats.totalFiles, edits: stats.totalEdits + stats.totalWrites, sessions: stats.sessionCount })}
          </span>
        )}
      </div>

      {/* Search & filters */}
      <div className="ag-header">
        <input
          className="ag-search"
          type="text"
          placeholder={t('apps.search')}
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <div className="ag-filters">
          {(['all', 'edit', 'write'] as FilterType[]).map(f => (
            <button
              key={f}
              className={`ag-filter-btn ${filterType === f ? 'active' : ''}`}
              onClick={() => setFilterType(f)}
            >
              {f === 'all' ? t('apps.filterAll') : f === 'edit' ? t('apps.filterEdit') : t('apps.filterWrite')}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="ag-body">
        {loading && (
          <div className="ag-loading"><div className="ag-loading-spinner" /><span>{t('apps.loading')}</span></div>
        )}
        {error && !loading && (
          <div className="ag-empty"><div className="ag-empty-icon">{'\u26A0'}</div><p>{error}</p></div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <div className="ag-empty">
            <div className="ag-empty-icon">{'\uD83D\uDCC4'}</div>
            <h2>{search ? t('apps.noResults') : t('apps.empty')}</h2>
            <p>{search ? '' : t('apps.emptyDesc')}</p>
          </div>
        )}
        {!loading && !error && sessions.length > 0 && (
          <div className="ag-timeline">
            {Array.from(dateGroups.entries()).map(([date, dateSessions]) => (
              <div key={date}>
                <div className="ag-date-sep">
                  <div className="ag-date-sep-line" /><span className="ag-date-sep-label">{date}</span><div className="ag-date-sep-line" />
                </div>
                {dateSessions.map(session => {
                  const isExpanded = expandedSessions.has(session.sessionId);
                  const totalOps = session.files.reduce((sum, f) => sum + f.ops, 0);
                  return (
                    <div key={session.sessionId} className="ag-session-block">
                      <div className="ag-session-header" onClick={() => toggleSession(session.sessionId)}>
                        <span className="ag-expand-icon">{isExpanded ? '\u25BE' : '\u25B8'}</span>
                        <span className="ag-session-name" title={session.sessionName}>
                          {session.sessionName.length > 40 ? session.sessionName.slice(0, 40) + '...' : session.sessionName}
                        </span>
                        <span className="ag-session-meta">{session.files.length} {t('apps.filesCount')} · {totalOps} {t('apps.opsCount')}</span>
                        <span className="ag-session-time">{formatTime(session.latestTimestamp)}</span>
                        <button className="ag-session-link" onClick={e => { e.stopPropagation(); onNavigateToSession?.(session.sessionId); }}>
                          {t('apps.jumpToSession')}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="ag-session-files">
                          {session.files.map(file => {
                            const { dir, name } = splitPath(file.filePath);
                            return (
                              <div key={file.filePath} className="ag-file-row">
                                <span className={`ag-tool-badge ${toolBadgeClass(file.toolNames)}`}>{toolBadgeLabel(file.toolNames)}</span>
                                <span className="ag-file-path">
                                  {dir && <span className="ag-dir">{dir}</span>}
                                  <span className="ag-filename">{name}</span>
                                </span>
                                {file.ops > 1 && <span className="ag-ops-count">{t('apps.opsDetail', { count: file.ops })}</span>}
                                {(file.added > 0 || file.removed > 0) && (
                                  <span className="ag-change-stats">
                                    {file.added > 0 && <span className="ag-change-added">+{file.added}</span>}
                                    {file.removed > 0 && <span className="ag-change-removed">-{file.removed}</span>}
                                  </span>
                                )}
                                {file.ops === 1 && file.toolNames[0] === 'Write' && <span className="ag-action-label">{t('apps.wrote')}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
