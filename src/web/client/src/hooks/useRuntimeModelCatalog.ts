import { useEffect, useState } from 'react';
import type { WSMessage } from '../types';
import {
  supportsDynamicModelCatalogForBackend,
  type WebRuntimeBackend,
} from '../../../shared/model-catalog';

interface UseRuntimeModelCatalogParams {
  connected: boolean;
  runtimeBackend: WebRuntimeBackend;
  send: (message: unknown) => void;
  addMessageHandler: (handler: (msg: WSMessage) => void) => () => void;
}

export function supportsDynamicModelCatalog(runtimeBackend: WebRuntimeBackend): boolean {
  return supportsDynamicModelCatalogForBackend(runtimeBackend);
}

export function parseRuntimeModelCatalogMessage(message: WSMessage): string[] | null {
  if (message.type !== 'api_models_response') {
    return null;
  }

  const payload = message.payload as { models?: unknown } | undefined;
  if (!Array.isArray(payload?.models)) {
    return [];
  }

  const values = new Set<string>();
  const models: string[] = [];
  for (const value of payload.models) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || values.has(normalized)) {
      continue;
    }
    values.add(normalized);
    models.push(normalized);
  }
  return models;
}

export function useRuntimeModelCatalog({
  connected,
  runtimeBackend,
  send,
  addMessageHandler,
}: UseRuntimeModelCatalogParams): string[] {
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    if (!supportsDynamicModelCatalog(runtimeBackend)) {
      setAvailableModels([]);
      return;
    }

    return addMessageHandler((message: WSMessage) => {
      const models = parseRuntimeModelCatalogMessage(message);
      if (models === null) {
        return;
      }
      setAvailableModels(models);
    });
  }, [addMessageHandler, runtimeBackend]);

  useEffect(() => {
    if (!connected || !supportsDynamicModelCatalog(runtimeBackend)) {
      setAvailableModels([]);
      return;
    }

    send({ type: 'api_models' });
  }, [connected, runtimeBackend, send]);

  return availableModels;
}
