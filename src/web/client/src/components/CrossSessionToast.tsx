/**
 * CrossSessionToast - 跨会话通知
 * 当其他会话有权限请求或用户问题等待时，在右下角弹出通知
 * 点击后自动切换到对应会话
 */

import './CrossSessionToast.css';
import { useLanguage } from '../i18n';
import type { CrossSessionNotification } from '../hooks/useMessageHandler';

interface CrossSessionToastProps {
  notification: CrossSessionNotification;
  sessionName?: string;
  onSwitch: (sessionId: string) => void;
  onDismiss: () => void;
}

export function CrossSessionToast({ notification, sessionName, onSwitch, onDismiss }: CrossSessionToastProps) {
  const { t } = useLanguage();
  const isDelegated = notification.type === 'delegated_task';
  const isPermission = notification.type === 'permission_request';

  let title: string;
  let detail: string;
  let icon: string;

  if (isDelegated) {
    title = t('crossSession.delegatedTaskRunning');
    const from = notification.fromAgent || 'Agent';
    const desc = notification.taskDescription || '';
    detail = t('crossSession.delegatedTaskDetail', { agent: from, task: desc.slice(0, 60) });
    icon = '\uD83E\uDD1D'; // handshake emoji
  } else if (isPermission) {
    title = t('crossSession.permissionWaiting');
    detail = t('crossSession.toolRequestPermission', { tool: notification.toolName || t('crossSession.unknown') });
    icon = '\u26A0';
  } else {
    title = t('crossSession.questionWaiting');
    detail = notification.questionHeader || t('crossSession.hasQuestion');
    icon = '\u2753';
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSwitch(notification.sessionId);
    onDismiss();
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss();
  };

  return (
    <div className="cross-session-toast cross-session-toast-pulse" onClick={handleClick}>
      <div className="cross-session-toast-icon">
        {icon}
      </div>
      <div className="cross-session-toast-body">
        <div className="cross-session-toast-title">{title}</div>
        <div className="cross-session-toast-detail">
          {sessionName ? `${sessionName}: ` : ''}{detail}
        </div>
        <div className="cross-session-toast-action">
          {t('crossSession.clickToSwitch')}
        </div>
      </div>
      <button className="cross-session-toast-close" onClick={handleClose} title={t('crossSession.close')}>
        &times;
      </button>
    </div>
  );
}
