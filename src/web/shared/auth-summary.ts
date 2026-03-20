import { getRuntimeBackendLabel, type WebRuntimeBackend } from './model-catalog.js';

export interface AuthSummaryInput {
  authenticated: boolean;
  type?: string;
  accountType?: string;
  provider?: string;
  runtimeBackend?: WebRuntimeBackend;
  email?: string;
  displayName?: string;
  isAxonCloud?: boolean;
}

export interface AuthSummaryLabels {
  claudeAi: string;
  console: string;
  apiKey: string;
  axonCloud: string;
  chatgpt: string;
  userFallback: string;
}

export interface AuthSummary {
  avatar: string;
  triggerLabel: string;
  accountLabel: string;
  accountDetail: string;
  runtimeLabel: string;
}

export function summarizeAuthStatus(
  input: AuthSummaryInput,
  labels: AuthSummaryLabels,
): AuthSummary {
  const runtimeLabel = input.runtimeBackend
    ? getRuntimeBackendLabel(input.runtimeBackend)
    : labels.axonCloud;

  const isAxonCloud = input.isAxonCloud || input.accountType === 'axon-cloud';
  const isCodex = input.provider === 'codex' || input.accountType === 'chatgpt';

  if (isAxonCloud) {
    return {
      avatar: '☁️',
      triggerLabel: input.displayName || input.email || labels.axonCloud,
      accountLabel: labels.axonCloud,
      accountDetail: input.email || labels.axonCloud,
      runtimeLabel,
    };
  }

  if (isCodex) {
    return {
      avatar: '🧠',
      triggerLabel: input.displayName || input.email || labels.chatgpt,
      accountLabel: labels.chatgpt,
      accountDetail: input.email || labels.chatgpt,
      runtimeLabel,
    };
  }

  if (input.type === 'oauth') {
    const accountLabel = input.accountType === 'claude.ai' ? labels.claudeAi : labels.console;
    return {
      avatar: input.accountType === 'claude.ai' ? '🎨' : '⚡',
      triggerLabel: input.displayName || input.email || accountLabel || labels.userFallback,
      accountLabel,
      accountDetail: input.displayName || input.email || accountLabel,
      runtimeLabel,
    };
  }

  if (input.type === 'api_key') {
    return {
      avatar: '🔑',
      triggerLabel: labels.apiKey,
      accountLabel: labels.apiKey,
      accountDetail: input.provider || input.accountType || labels.apiKey,
      runtimeLabel,
    };
  }

  return {
    avatar: '☁️',
    triggerLabel: input.email || labels.userFallback,
    accountLabel: labels.userFallback,
    accountDetail: input.email || labels.userFallback,
    runtimeLabel,
  };
}
