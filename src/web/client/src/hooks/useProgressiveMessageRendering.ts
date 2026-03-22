import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

const LARGE_HISTORY_THRESHOLD = 120;
const INITIAL_RENDER_COUNT = 48;
const HYDRATE_BATCH_SIZE = 64;
const HYDRATE_TIMEOUT_MS = 24;

type IdleHandle = number;
type IdleScheduler = (callback: () => void) => IdleHandle;
type IdleCanceller = (handle: IdleHandle) => void;

function createIdleScheduler(): { schedule: IdleScheduler; cancel: IdleCanceller } {
  const schedulerHost = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof schedulerHost.requestIdleCallback === 'function' && typeof schedulerHost.cancelIdleCallback === 'function') {
    return {
      schedule: (callback) => schedulerHost.requestIdleCallback?.(() => callback(), { timeout: 120 }) ?? 0,
      cancel: (handle) => schedulerHost.cancelIdleCallback?.(handle),
    };
  }

  return {
    schedule: (callback) => globalThis.setTimeout(callback, HYDRATE_TIMEOUT_MS),
    cancel: (handle) => globalThis.clearTimeout(handle),
  };
}

function shouldProgressivelyHydrate(
  previousSessionId: string | null,
  nextSessionId: string | null,
  previousCount: number,
  nextCount: number,
): boolean {
  if (nextCount <= LARGE_HISTORY_THRESHOLD) {
    return false;
  }

  if (previousCount === 0) {
    return true;
  }

  if (previousSessionId !== nextSessionId) {
    return true;
  }

  return nextCount - previousCount > LARGE_HISTORY_THRESHOLD;
}

export interface ProgressiveMessageRenderingState {
  renderedMessages: ChatMessage[];
  hiddenMessageCount: number;
  isHydratingHistory: boolean;
  revealAllMessages: () => void;
}

export function useProgressiveMessageRendering(
  messages: ChatMessage[],
  sessionId: string | null,
): ProgressiveMessageRenderingState {
  const [renderStartIndex, setRenderStartIndex] = useState(0);
  const previousSessionIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const manuallyRevealedAllRef = useRef(false);
  const scheduledHydrationRef = useRef<IdleHandle | null>(null);
  const schedulerRef = useRef(createIdleScheduler());

  const cancelScheduledHydration = useCallback(() => {
    if (scheduledHydrationRef.current != null) {
      schedulerRef.current.cancel(scheduledHydrationRef.current);
      scheduledHydrationRef.current = null;
    }
  }, []);

  const revealAllMessages = useCallback(() => {
    manuallyRevealedAllRef.current = true;
    cancelScheduledHydration();
    setRenderStartIndex(0);
  }, [cancelScheduledHydration]);

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    const previousMessageCount = previousMessageCountRef.current;
    const nextMessageCount = messages.length;
    const sessionChanged = previousSessionId !== sessionId;

    cancelScheduledHydration();

    if (sessionChanged) {
      manuallyRevealedAllRef.current = false;
    }

    if (nextMessageCount === 0) {
      manuallyRevealedAllRef.current = false;
      setRenderStartIndex(0);
    } else if (!sessionChanged && manuallyRevealedAllRef.current) {
      setRenderStartIndex(0);
    } else if (shouldProgressivelyHydrate(previousSessionId, sessionId, previousMessageCount, nextMessageCount)) {
      setRenderStartIndex(Math.max(0, nextMessageCount - INITIAL_RENDER_COUNT));
    } else {
      setRenderStartIndex((currentStartIndex) => (
        Math.min(currentStartIndex, Math.max(0, nextMessageCount - INITIAL_RENDER_COUNT))
      ));
    }

    previousSessionIdRef.current = sessionId;
    previousMessageCountRef.current = nextMessageCount;
  }, [cancelScheduledHydration, messages.length, sessionId]);

  useEffect(() => {
    if (renderStartIndex <= 0) {
      return;
    }

    scheduledHydrationRef.current = schedulerRef.current.schedule(() => {
      startTransition(() => {
        setRenderStartIndex((currentStartIndex) => Math.max(0, currentStartIndex - HYDRATE_BATCH_SIZE));
      });
    });

    return cancelScheduledHydration;
  }, [cancelScheduledHydration, renderStartIndex]);

  useEffect(() => cancelScheduledHydration, [cancelScheduledHydration]);

  const renderedMessages = useMemo(
    () => (renderStartIndex > 0 ? messages.slice(renderStartIndex) : messages),
    [messages, renderStartIndex],
  );

  return {
    renderedMessages,
    hiddenMessageCount: renderStartIndex,
    isHydratingHistory: renderStartIndex > 0,
    revealAllMessages,
  };
}

export const __progressiveMessageRenderingForTests = {
  shouldProgressivelyHydrate,
};
