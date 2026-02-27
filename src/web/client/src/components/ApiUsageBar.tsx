import { useState } from 'react';
import { useLanguage } from '../i18n';
import './ApiUsageBar.css';

export interface RateLimitInfo {
  status: string;
  utilization5h?: number;
  utilization7d?: number;
  resetsAt?: number;
  rateLimitType?: string;
}

interface ApiUsageBarProps {
  info: RateLimitInfo | null;
}

function getLevel(percentage: number): 'safe' | 'warning' | 'danger' {
  if (percentage >= 80) return 'danger';
  if (percentage >= 50) return 'warning';
  return 'safe';
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

  // 没有数据时不渲染
  if (!info || (info.utilization5h === undefined && info.utilization7d === undefined)) {
    return null;
  }

  // 取 5h 和 7d 中较大的那个作为主显示
  const util5h = info.utilization5h ?? 0;
  const util7d = info.utilization7d ?? 0;
  const maxUtilization = Math.max(util5h, util7d);
  const percentage = Math.round(maxUtilization * 100);
  const level = getLevel(percentage);

  return (
    <div 
      className="api-usage-bar"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="api-usage-bar__label">api</span>
      <div className="api-usage-bar__progress">
        <div
          className={`api-usage-bar__fill api-usage-bar__fill--${level}`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      <span className={`api-usage-bar__text api-usage-bar__text--${level}`}>
        {percentage}%
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div className="api-usage-bar__tooltip">
          <div className="api-usage-bar__tooltip-arrow" />
          <div className="api-usage-bar__tooltip-content">
            {info.utilization5h !== undefined && (
              <div className="api-usage-bar__tooltip-row">
                <span>5h usage:</span>
                <span>{Math.round(info.utilization5h * 100)}%</span>
              </div>
            )}
            {info.utilization7d !== undefined && (
              <div className="api-usage-bar__tooltip-row">
                <span>7d usage:</span>
                <span>{Math.round(info.utilization7d * 100)}%</span>
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
