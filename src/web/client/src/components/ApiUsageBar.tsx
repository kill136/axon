import { useState } from 'react';
import { useLanguage } from '../i18n';
import './ApiUsageBar.css';

export interface RateLimitInfo {
  status: string;
  utilization5h?: number;
  utilization7d?: number;
  resetsAt?: number;
  rateLimitType?: string;
  remainingRequests?: number;
  limitRequests?: number;
  remainingTokens?: number;
  limitTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface ApiUsageBarProps {
  info: RateLimitInfo | null;
}

function getLevel(percentage: number): 'safe' | 'warning' | 'danger' {
  if (percentage >= 80) return 'danger';
  if (percentage >= 50) return 'warning';
  return 'safe';
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatRatio(remaining?: number, limit?: number): string | null {
  if (remaining === undefined && limit === undefined) {
    return null;
  }
  if (remaining !== undefined && limit !== undefined) {
    return `${formatCompactNumber(remaining)}/${formatCompactNumber(limit)}`;
  }
  if (remaining !== undefined) {
    return formatCompactNumber(remaining);
  }
  return formatCompactNumber(limit!);
}

function formatTimeRemaining(resetsAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const seconds = resetsAt - now;
  
  if (seconds <= 0) return 'Reset now';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}min`;
  }
  return `Resets in ${minutes}min`;
}

export function ApiUsageBar({ info }: ApiUsageBarProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const { t } = useLanguage();
  const hasAnthropicUtilization = info && (info.utilization5h !== undefined || info.utilization7d !== undefined);
  const requestRatio = info ? formatRatio(info.remainingRequests, info.limitRequests) : null;
  const tokenRatio = info ? formatRatio(info.remainingTokens, info.limitTokens) : null;
  const hasOpenAiQuota = !!info && (requestRatio !== null || tokenRatio !== null);
  const hasCacheInfo = !!info && ((info.cacheReadTokens || 0) > 0 || (info.cacheCreationTokens || 0) > 0);

  if (!info || (!hasAnthropicUtilization && !hasOpenAiQuota && !hasCacheInfo)) {
    return null;
  }

  const util5h = info.utilization5h ?? 0;
  const util7d = info.utilization7d ?? 0;
  const maxUtilization = Math.max(util5h, util7d);
  const percentage = Math.round(maxUtilization * 100);
  const level = getLevel(percentage);
  const labelText = hasAnthropicUtilization
    ? `${percentage}%`
    : hasCacheInfo && (info.cacheReadTokens || 0) > 0
      ? t('apiUsage.cacheHit')
      : t('apiUsage.remaining');

  return (
    <div 
      className="api-usage-bar"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="api-usage-bar__label">api</span>
      {hasAnthropicUtilization ? (
        <>
          <div className="api-usage-bar__progress">
            <div
              className={`api-usage-bar__fill api-usage-bar__fill--${level}`}
              style={{ width: `${Math.min(100, percentage)}%` }}
            />
          </div>
          <span className={`api-usage-bar__text api-usage-bar__text--${level}`}>
            {labelText}
          </span>
        </>
      ) : (
        <span className={`api-usage-bar__badge${hasCacheInfo && (info.cacheReadTokens || 0) > 0 ? ' api-usage-bar__badge--cache' : ''}`}>
          {labelText}
        </span>
      )}

      {showTooltip && (
        <div className="api-usage-bar__tooltip">
          <div className="api-usage-bar__tooltip-arrow" />
          <div className="api-usage-bar__tooltip-content">
            {info.utilization5h !== undefined && (
              <div className="api-usage-bar__tooltip-row">
                <span>{t('apiUsage.tooltip5h')}</span>
                <span>{Math.round(info.utilization5h * 100)}%</span>
              </div>
            )}
            {info.utilization7d !== undefined && (
              <div className="api-usage-bar__tooltip-row">
                <span>{t('apiUsage.tooltip7d')}</span>
                <span>{Math.round(info.utilization7d * 100)}%</span>
              </div>
            )}
            {requestRatio && (
              <div className="api-usage-bar__tooltip-row">
                <span>{t('apiUsage.requestsRemaining')}</span>
                <span>{requestRatio}</span>
              </div>
            )}
            {tokenRatio && (
              <div className="api-usage-bar__tooltip-row">
                <span>{t('apiUsage.tokensRemaining')}</span>
                <span>{tokenRatio}</span>
              </div>
            )}
            {(info.cacheReadTokens || 0) > 0 && (
              <div className="api-usage-bar__tooltip-row">
                <span>{t('apiUsage.cacheHitTokens')}</span>
                <span>{formatCompactNumber(info.cacheReadTokens || 0)}</span>
              </div>
            )}
            {(info.cacheCreationTokens || 0) > 0 && (
              <div className="api-usage-bar__tooltip-row">
                <span>{t('apiUsage.cacheWriteTokens')}</span>
                <span>{formatCompactNumber(info.cacheCreationTokens || 0)}</span>
              </div>
            )}
            {info.resetsAt && (
              <div className="api-usage-bar__tooltip-row">
                <span className="api-usage-bar__tooltip-reset">
                  {formatTimeRemaining(info.resetsAt)}
                </span>
              </div>
            )}
            {info.rateLimitType && (
              <div className="api-usage-bar__tooltip-type">
                {info.rateLimitType}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
