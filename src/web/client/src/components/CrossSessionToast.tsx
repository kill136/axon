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
  const isPermission = notification.type === 'permission_request';
  const title = isPermission ? t('crossSession.permissionWaiting') : t('crossSession.questionWaiting');
  const detail = isPermission
    ? t('crossSession.toolRequestPermission', { tool: notification.toolName || t('crossSession.unknown') })
    : notification.questionHeader || t('crossSession.hasQuestion');

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
        {isPermission ? '\u26A0' : '\u2753'}
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
