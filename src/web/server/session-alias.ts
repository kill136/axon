export interface SessionAliasFinder {
  findSessionIdByTemporarySessionId(temporarySessionId: string): string | null;
}

export interface SessionAliasConversationManager {
  getSessionManager(): SessionAliasFinder;
  setWebSocket(sessionId: string, ws: unknown): void;
}

export interface SessionAliasClient {
  sessionId: string;
  ws: unknown;
}

/**
 * 将临时 sessionId 解析为真实持久化 sessionId。
 * 如果找不到映射，返回原值，方便调用方继续按现有逻辑处理。
 */
export function resolveSessionAlias(
  sessionId: string,
  sessionAliasFinder: SessionAliasFinder,
): string {
  if (!sessionId) {
    return sessionId;
  }

  const resolvedSessionId = sessionAliasFinder.findSessionIdByTemporarySessionId(sessionId);
  return resolvedSessionId || sessionId;
}

/**
 * 修正客户端持有的 sessionId，并把 WebSocket 重新绑定到真实会话。
 */
export function syncClientSessionAlias(
  client: SessionAliasClient,
  conversationManager: SessionAliasConversationManager,
): string {
  const resolvedSessionId = resolveSessionAlias(
    client.sessionId,
    conversationManager.getSessionManager(),
  );

  if (resolvedSessionId !== client.sessionId) {
    client.sessionId = resolvedSessionId;
    conversationManager.setWebSocket(resolvedSessionId, client.ws);
  }

  return resolvedSessionId;
}
