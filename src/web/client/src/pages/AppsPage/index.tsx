/**
 * AppsPage -- App management (register, start/stop, share, logs)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../../i18n';
import './AppsPage.css';

// ============ Types ============

interface AppRuntime {
  id: string;
  name: string;
  description: string;
  directory: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  startCommand: string;
  port?: number;
  entryPath?: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  pid: number | null;
  tunnelUrl: string | null;
  error: string | null;
  startedAt: number | null;
  uptime: number | null;
}

// ============ Helpers ============

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return '#3fb950';
    case 'starting': return '#d29922';
    case 'error': return '#f85149';
    default: return '#8b949e';
  }
}

// ============ Register App Dialog ============

function RegisterAppDialog({ isOpen, onClose, onSubmit, t }: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; directory: string; startCommand: string; port?: number; entryPath?: string; description?: string }) => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('');
  const [startCommand, setStartCommand] = useState('');
  const [port, setPort] = useState('');
  const [entryPath, setEntryPath] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!name.trim() || !directory.trim() || !startCommand.trim()) return;
    onSubmit({
      name: name.trim(),
      directory: directory.trim(),
      startCommand: startCommand.trim(),
      port: port ? Number(port) : undefined,
      entryPath: entryPath.trim() || undefined,
      description: description.trim() || undefined,
    });
    setName(''); setDirectory(''); setStartCommand(''); setPort(''); setEntryPath(''); setDescription('');
  };

  return (
    <div className="app-dialog-overlay" onClick={onClose}>
      <div className="app-dialog" onClick={e => e.stopPropagation()}>
        <h3>{t('apps.registerTitle')}</h3>
        <div className="app-dialog-field">
          <label>{t('apps.registerName')} *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('apps.registerNamePlaceholder')} />
        </div>
        <div className="app-dialog-field">
          <label>{t('apps.registerDir')} *</label>
          <input value={directory} onChange={e => setDirectory(e.target.value)} placeholder={t('apps.registerDirPlaceholder')} className="mono" />
        </div>
        <div className="app-dialog-field">
          <label>{t('apps.registerCommand')} *</label>
          <input value={startCommand} onChange={e => setStartCommand(e.target.value)} placeholder={t('apps.registerCommandPlaceholder')} className="mono" />
        </div>
        <div className="app-dialog-row">
          <div className="app-dialog-field" style={{ flex: 1 }}>
            <label>{t('apps.registerPort')}</label>
            <input type="number" value={port} onChange={e => setPort(e.target.value)} placeholder={t('apps.registerPortPlaceholder')} />
            <span className="app-dialog-hint">{t('apps.registerPortHint')}</span>
          </div>
          <div className="app-dialog-field" style={{ flex: 1 }}>
            <label>{t('apps.registerEntryPath')}</label>
            <input value={entryPath} onChange={e => setEntryPath(e.target.value)} placeholder={t('apps.registerEntryPathPlaceholder')} className="mono" />
            <span className="app-dialog-hint">{t('apps.registerEntryPathHint')}</span>
          </div>
        </div>
        <div className="app-dialog-field">
          <label>{t('apps.registerDesc')}</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('apps.registerDescPlaceholder')} />
        </div>
        <div className="app-dialog-actions">
          <button className="app-dialog-cancel" onClick={onClose}>{t('common.cancel') || 'Cancel'}</button>
          <button className="app-dialog-submit" onClick={handleSubmit} disabled={!name.trim() || !directory.trim() || !startCommand.trim()}>
            {t('apps.registerSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ App Card ============

function AppCard({ app, onStart, onStop, onRestart, onShare, onStopShare, onDelete, onPreview, t }: {
  app: AppRuntime;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onShare: () => void;
  onStopShare: () => void;
  onDelete: () => void;
  onPreview: () => void;
  t: (key: string, params?: any) => string;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsPollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showLogs) {
      if (logsPollRef.current) { clearInterval(logsPollRef.current); logsPollRef.current = null; }
      return;
    }
    const fetchLogs = () => {
      fetch(`/api/apps/${app.id}/logs?lines=100`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.success) setLogs(d.data || []); })
        .catch(() => {});
    };
    fetchLogs();
    logsPollRef.current = window.setInterval(fetchLogs, 2000);
    return () => { if (logsPollRef.current) clearInterval(logsPollRef.current); };
  }, [showLogs, app.id]);

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return; }
    onDelete();
    setConfirmDelete(false);
  };

  const isRunning = app.status === 'running';
  const isStarting = app.status === 'starting';
  const hasError = app.status === 'error';

  return (
    <div className={`app-card ${isRunning ? 'running' : ''} ${hasError ? 'error' : ''}`}>
      {/* Header */}
      <div className="app-card-header">
        <span className="app-card-icon">{app.icon}</span>
        <div className="app-card-title">
          <h4>{app.name}</h4>
          {app.description && <p className="app-card-desc">{app.description}</p>}
        </div>
        <div className="app-card-status" title={app.error || ''}>
          <span className="app-card-status-dot" style={{ background: statusColor(app.status) }} />
          <span className="app-card-status-text" style={{ color: statusColor(app.status) }}>
            {t(`apps.status${app.status.charAt(0).toUpperCase() + app.status.slice(1)}`)}
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="app-card-meta">
        <span className="app-card-meta-item" title={app.directory}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>
          <span className="mono truncate">{app.directory}</span>
        </span>
        <span className="app-card-meta-item">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm7.47 3.97-3.72 3.72a.75.75 0 1 0 1.06 1.06l3.72-3.72a.75.75 0 0 0-1.06-1.06Zm-5.69.53 1.5 1.5a.75.75 0 0 1-1.06 1.06l-1.5-1.5a.75.75 0 0 1 1.06-1.06Zm7.94 0a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1-1.06 1.06l-1.5-1.5a.75.75 0 0 1 0-1.06Z"/></svg>
          <span className="mono">{app.startCommand}</span>
        </span>
        {app.port && (
          <span className="app-card-meta-item">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/></svg>
            :{app.port}
          </span>
        )}
        {isRunning && app.uptime !== null && (
          <span className="app-card-meta-item uptime">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0ZM8 3.25a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 0 1-1.06 1.06l-2.5-2.5A.75.75 0 0 1 7.25 8V4A.75.75 0 0 1 8 3.25Z"/></svg>
            {formatUptime(app.uptime)}
          </span>
        )}
      </div>

      {/* Error */}
      {hasError && app.error && (
        <div className="app-card-error">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>
          <span>{app.error}</span>
        </div>
      )}

      {/* Tunnel URL */}
      {app.tunnelUrl && (
        <div className="app-card-tunnel">
          <span className="app-card-tunnel-label">{t('apps.publicUrl')}</span>
          <a href={app.tunnelUrl} target="_blank" rel="noopener noreferrer" className="app-card-tunnel-url">{app.tunnelUrl}</a>
          <button className="app-card-copy-btn" onClick={() => handleCopy(app.tunnelUrl!)} title={t('apps.copyUrl')}>
            {copied ? t('apps.copied') : <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>}
          </button>
          <span className="app-card-tunnel-warn">{t('apps.shareWarning')}</span>
        </div>
      )}

      {/* Actions */}
      <div className="app-card-actions">
        {!isRunning && !isStarting ? (
          <button className="app-btn app-btn-primary" onClick={onStart}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/></svg>
            {t('apps.start')}
          </button>
        ) : (
          <>
            <button className="app-btn app-btn-danger" onClick={onStop} disabled={isStarting}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3-2.5h7a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z"/></svg>
              {t('apps.stop')}
            </button>
            <button className="app-btn" onClick={onRestart} disabled={isStarting}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5ZM1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834Z"/></svg>
              {t('apps.restart')}
            </button>
          </>
        )}

        <div className="app-btn-spacer" />

        {isRunning && app.port && (
          <button className="app-btn app-btn-accent" onClick={onPreview}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.53 4.75A.75.75 0 0 1 5.28 4h6.01a.75.75 0 0 1 .75.75v6.01a.75.75 0 0 1-1.5 0v-4.2l-5.26 5.261a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L9.48 5.5H5.28a.75.75 0 0 1-.75-.75Z"/></svg>
            {t('apps.openPreview')}
          </button>
        )}

        {isRunning && app.port ? (
          app.tunnelUrl ? (
            <button className="app-btn app-btn-tunnel-stop" onClick={onStopShare}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 8c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M4 8c0-2.2 1.8-4 4-4s4 1.8 4 4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M8 9.5v4.5"/></svg>
              {t('apps.stopShare')}
            </button>
          ) : (
            <button className="app-btn app-btn-share" onClick={onShare}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 8c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M4 8c0-2.2 1.8-4 4-4s4 1.8 4 4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M8 9.5v4.5"/></svg>
              {t('apps.share')}
            </button>
          )
        ) : null}

        <button className="app-btn app-btn-log" onClick={() => setShowLogs(p => !p)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h9.5a.75.75 0 0 1 0 1.5h-9.5a.75.75 0 0 1 0-1.5Z"/></svg>
          {showLogs ? t('apps.hideLogs') : t('apps.viewLogs')}
        </button>

        <button className={`app-btn app-btn-delete ${confirmDelete ? 'confirming' : ''}`} onClick={handleDelete}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
          {confirmDelete ? t('apps.confirmDelete', { name: app.name }) : t('apps.delete')}
        </button>
      </div>

      {/* Logs panel */}
      {showLogs && (
        <div className="app-card-logs">
          {logs.length === 0 ? (
            <div className="app-card-logs-empty">{t('apps.noLogs')}</div>
          ) : (
            <pre className="app-card-logs-content">
              {logs.map((line, i) => <div key={i}>{line}</div>)}
              <div ref={logsEndRef} />
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Main Component ============

export default function AppsPage() {
  const { t } = useLanguage();
  const [apps, setApps] = useState<AppRuntime[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch('/api/apps');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) setApps(json.data || []);
    } catch { /* ignore */ }
    finally { setAppsLoading(false); }
  }, []);

  useEffect(() => {
    fetchApps();
    const timer = setInterval(fetchApps, 3000);
    return () => clearInterval(timer);
  }, [fetchApps]);

  const handleRegister = useCallback(async (data: { name: string; directory: string; startCommand: string; port?: number; entryPath?: string; description?: string }) => {
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) { setShowRegister(false); fetchApps(); }
    } catch { /* ignore */ }
  }, [fetchApps]);

  const handleAction = useCallback(async (id: string, action: string) => {
    try {
      await fetch(`/api/apps/${id}/${action}`, { method: 'POST' });
      fetchApps();
    } catch { /* ignore */ }
  }, [fetchApps]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/apps/${id}`, { method: 'DELETE' });
      fetchApps();
    } catch { /* ignore */ }
  }, [fetchApps]);

  const handlePreview = useCallback((port: number, entryPath?: string) => {
    const entry = entryPath ? (entryPath.startsWith('/') ? entryPath : '/' + entryPath) : '/';
    window.open(`/proxy/${port}${entry}`, '_blank');
  }, []);

  return (
    <div className="apps-page">
      <div className="apps-section">
        <div className="apps-section-header">
          <h2>{t('apps.tabMyApps')}</h2>
          <button className="app-btn app-btn-primary" onClick={() => setShowRegister(true)}>
            + {t('apps.registerApp')}
          </button>
        </div>

        {appsLoading ? (
          <div className="apps-loading">
            <div className="ag-loading-spinner" />
          </div>
        ) : apps.length === 0 ? (
          <div className="apps-empty">
            <div className="apps-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <p className="apps-empty-title">{t('apps.noApps')}</p>
            <p className="apps-empty-desc">{t('apps.noAppsDesc')}</p>
            <button className="app-btn app-btn-primary" onClick={() => setShowRegister(true)}>
              + {t('apps.registerApp')}
            </button>
          </div>
        ) : (
          <div className="apps-grid">
            {apps.map(app => (
              <AppCard
                key={app.id}
                app={app}
                t={t}
                onStart={() => handleAction(app.id, 'start')}
                onStop={() => handleAction(app.id, 'stop')}
                onRestart={() => handleAction(app.id, 'restart')}
                onShare={() => handleAction(app.id, 'tunnel/start')}
                onStopShare={() => handleAction(app.id, 'tunnel/stop')}
                onDelete={() => handleDelete(app.id)}
                onPreview={() => app.port && handlePreview(app.port, app.entryPath)}
              />
            ))}
          </div>
        )}
      </div>

      <RegisterAppDialog
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        onSubmit={handleRegister}
        t={t}
      />
    </div>
  );
}
