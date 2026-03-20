/**
 * TunnelPanel - Cloudflare Tunnel 公网分享面板
 *
 * 允许用户一键将本地 Axon Web UI 暴露到公网，
 * 通过 Cloudflare Quick Tunnel (trycloudflare.com) 实现。
 *
 * cloudflared 由 npm 包自动管理，用户无需手动安装。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../../i18n';
import styles from './TunnelPanel.module.css';

interface TunnelInfo {
  status: 'stopped' | 'starting' | 'connected' | 'error' | 'installing';
  url: string | null;
  wsUrl: string | null;
  error: string | null;
  startedAt: number | null;
  localPort: number;
}

export default function TunnelPanel() {
  const { t } = useLanguage();
  const [info, setInfo] = useState<TunnelInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 获取状态
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel/status');
      if (res.ok) {
        const data: TunnelInfo = await res.json();
        setInfo(data);
      }
    } catch {
      // ignore
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 连接中/安装中轮询
  useEffect(() => {
    if (info?.status === 'starting' || info?.status === 'installing') {
      pollRef.current = setInterval(fetchStatus, 2000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [info?.status, fetchStatus]);

  // 启动隧道
  const handleStart = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tunnel/start', { method: 'POST' });
      const data: TunnelInfo = await res.json();
      setInfo(data);
    } catch (err: any) {
      setInfo(prev => prev ? { ...prev, status: 'error', error: err.message } : null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 停止隧道
  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tunnel/stop', { method: 'POST' });
      const data: TunnelInfo = await res.json();
      setInfo(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // 复制 URL
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  // 格式化运行时间
  const formatUptime = (startedAt: number): string => {
    const diff = Math.floor((Date.now() - startedAt) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const status = info?.status || 'stopped';

  return (
    <div className={styles.tunnelPanel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('tunnel.title')}</h2>
        <p className={styles.subtitle}>{t('tunnel.subtitle')}</p>
      </div>

      <div className={styles.statusCard}>
        {/* Status indicator */}
        <div className={styles.statusRow}>
          <span className={`${styles.statusDot} ${styles[status]}`} />
          <span className={styles.statusText}>
            {t(`tunnel.status.${status}`)}
          </span>
        </div>

        {/* Connected: show URL */}
        {status === 'connected' && info?.url && (
          <>
            <div className={styles.urlSection}>
              <div className={styles.urlLabel}>Public URL</div>
              <div className={styles.urlBox}>
                <span className={styles.urlText}>
                  <a href={info.url} target="_blank" rel="noopener noreferrer">{info.url}</a>
                </span>
                <button
                  className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
                  onClick={() => handleCopy(info.url!)}
                >
                  {copied ? t('tunnel.copied') : t('tunnel.copy')}
                </button>
              </div>
            </div>

            {info.wsUrl && (
              <div className={styles.urlSection}>
                <div className={styles.urlLabel}>WebSocket</div>
                <div className={styles.urlBox}>
                  <span className={styles.urlText}>{info.wsUrl}/ws</span>
                  <button
                    className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
                    onClick={() => handleCopy(info.wsUrl + '/ws')}
                  >
                    {copied ? t('tunnel.copied') : t('tunnel.copy')}
                  </button>
                </div>
              </div>
            )}

            {info.startedAt && (
              <div className={styles.uptime}>
                {t('tunnel.uptime')}: {formatUptime(info.startedAt)}
              </div>
            )}
          </>
        )}

        {/* Error message */}
        {status === 'error' && info?.error && (
          <div className={styles.errorBox}>{info.error}</div>
        )}

        {/* Action buttons */}
        <div className={styles.actions}>
          {(status === 'stopped' || status === 'error') && (
            <button
              className={styles.startBtn}
              onClick={handleStart}
              disabled={loading}
            >
              {loading ? t('tunnel.starting') : t('tunnel.start')}
            </button>
          )}
          {(status === 'starting' || status === 'installing') && (
            <button className={styles.startBtn} disabled>
              {status === 'installing' ? t('tunnel.installing') : t('tunnel.starting')}
            </button>
          )}
          {status === 'connected' && (
            <button
              className={styles.stopBtn}
              onClick={handleStop}
              disabled={loading}
            >
              {t('tunnel.stop')}
            </button>
          )}
        </div>
      </div>

      {/* Security note */}
      <div className={styles.note}>
        <strong>{t('tunnel.noteTitle')}</strong> {t('tunnel.noteContent')}
      </div>
    </div>
  );
}
