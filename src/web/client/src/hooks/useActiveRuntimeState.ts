import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WSMessage } from '../types';
import {
  getProviderForRuntimeBackend,
  type WebRuntimeBackend,
} from '../../../shared/model-catalog';

const FALLBACK_RUNTIME_BACKEND: WebRuntimeBackend = 'claude-compatible-api';

interface AuthStatusSnapshot {
  isAuthenticated: boolean;
  runtimeBackend: WebRuntimeBackend;
}

interface UseActiveRuntimeStateParams {
  connected: boolean;
  sessionReady: boolean;
  socketRuntimeBackend: WebRuntimeBackend | null;
  model: string;
  addMessageHandler: (handler: (msg: WSMessage) => void) => () => void;
  authRefreshKey?: number;
}

export function resolveActiveRuntimeBackend(
  sessionReady: boolean,
  socketRuntimeBackend: WebRuntimeBackend | null,
  defaultRuntimeBackend: WebRuntimeBackend,
): WebRuntimeBackend {
  if (sessionReady && socketRuntimeBackend) {
    return socketRuntimeBackend;
  }
  return defaultRuntimeBackend;
}

export function useActiveRuntimeState({
  connected,
  sessionReady,
  socketRuntimeBackend,
  model,
  addMessageHandler,
  authRefreshKey = 0,
}: UseActiveRuntimeStateParams) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [defaultRuntimeBackend, setDefaultRuntimeBackend] = useState<WebRuntimeBackend>(FALLBACK_RUNTIME_BACKEND);

  const fetchAuthStatus = useCallback(async (): Promise<AuthStatusSnapshot | null> => {
    try {
      const res = await fetch('/api/auth/oauth/status');
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      return {
        isAuthenticated: !!data.authenticated,
        runtimeBackend: (data.runtimeBackend || FALLBACK_RUNTIME_BACKEND) as WebRuntimeBackend,
      };
    } catch {
      return {
        isAuthenticated: false,
        runtimeBackend: FALLBACK_RUNTIME_BACKEND,
      };
    }
  }, []);

  const applyAuthStatus = useCallback((snapshot: AuthStatusSnapshot | null) => {
    if (!snapshot) {
      return;
    }
    setIsAuthenticated(snapshot.isAuthenticated);
    setDefaultRuntimeBackend(snapshot.runtimeBackend);
  }, []);

  useEffect(() => {
    if (!connected) {
      return;
    }

    let cancelled = false;
    fetchAuthStatus().then((snapshot) => {
      if (!cancelled) {
        applyAuthStatus(snapshot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyAuthStatus, authRefreshKey, connected, fetchAuthStatus]);

  useEffect(() => {
    const handler = (msg: WSMessage) => {
      if (msg.type !== 'auth_status_changed' && msg.type !== 'connected') {
        return;
      }

      fetchAuthStatus()
        .then(applyAuthStatus)
        .catch(() => {});
    };

    return addMessageHandler(handler);
  }, [addMessageHandler, applyAuthStatus, fetchAuthStatus]);

  const runtimeBackend = useMemo(
    () => resolveActiveRuntimeBackend(sessionReady, socketRuntimeBackend, defaultRuntimeBackend),
    [defaultRuntimeBackend, sessionReady, socketRuntimeBackend],
  );
  const runtimeProvider = useMemo(
    () => getProviderForRuntimeBackend(runtimeBackend, model),
    [model, runtimeBackend],
  );

  return {
    isAuthenticated,
    runtimeBackend,
    runtimeProvider,
    defaultRuntimeBackend,
  };
}
