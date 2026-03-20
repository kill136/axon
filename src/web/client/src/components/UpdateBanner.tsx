/**
 * UpdateBanner - Version update notification banner
 * Checks /api/update-check after mount and shows a dismissible banner if a new version is available
 */

import { useState, useEffect } from 'react';

interface UpdateInfo {
  hasUpdate: boolean;
  current: string;
  latest: string;
}

export function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Skip if already dismissed this session
    if (sessionStorage.getItem('axon-update-dismissed')) {
      setDismissed(true);
      return;
    }

    // Check after 5 seconds to let the backend finish its check
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/update-check');
        if (res.ok) {
          const data: UpdateInfo = await res.json();
          if (data.hasUpdate) {
            setUpdateInfo(data);
          }
        }
      } catch {
        // Silently ignore - update check is non-critical
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  if (!updateInfo || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('axon-update-dismissed', '1');
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: 'linear-gradient(90deg, #1a6b3c, #2d8a4e)',
      color: '#fff',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      fontSize: '13px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      WebkitAppRegion: 'no-drag' as any,
    }}>
      <span>
        New version <strong>{updateInfo.latest}</strong> available (current: {updateInfo.current}).
        Run <code style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '3px' }}>axon update</code> to upgrade.
      </span>
      <button
        onClick={handleDismiss}
        style={{
          background: 'none',
          border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff',
          cursor: 'pointer',
          padding: '2px 8px',
          borderRadius: '3px',
          fontSize: '12px',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
