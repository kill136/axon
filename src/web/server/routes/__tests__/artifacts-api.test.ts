/**
 * Tests for artifacts-api route
 *
 * The API now returns data grouped by session with same-file operations merged.
 * Response shape: { sessions: ArtifactSession[], stats: {...} }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers to build mock data
// ---------------------------------------------------------------------------

function createMockSessionManager(sessions: any[] = []) {
  return {
    listSessions: vi.fn().mockReturnValue(sessions.map(s => s.metadata)),
    loadSessionById: vi.fn().mockImplementation((id: string) => {
      return sessions.find(s => s.metadata.id === id) || null;
    }),
  };
}

function createMockConversationManager(sessionManager: any) {
  return {
    getSessionManager: vi.fn().mockReturnValue(sessionManager),
  };
}

function createTestSession(
  id: string,
  name: string,
  chatHistory: any[],
  updatedAt: number = Date.now(),
): any {
  return {
    metadata: {
      id,
      name,
      createdAt: updatedAt - 10000,
      updatedAt,
    },
    chatHistory,
  };
}

function toolUse(
  id: string,
  name: string,
  input: any,
  status = 'completed',
  subagentToolCalls?: any[],
): any {
  return {
    type: 'tool_use',
    id,
    name,
    input,
    status,
    ...(subagentToolCalls ? { subagentToolCalls } : {}),
  };
}

function chatMsg(id: string, role: string, timestamp: number, content: any[]): any {
  return { id, role, timestamp, content };
}

// ---------------------------------------------------------------------------
// Minimal mock Express request / response
// ---------------------------------------------------------------------------

function mockReqRes(query: Record<string, string> = {}, conversationManager: any = {}) {
  const req: any = {
    query,
    app: { locals: { conversationManager } },
  };
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
      statusCode = statusCode || 200;
      return res;
    },
  };
  return {
    req, res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

// ---------------------------------------------------------------------------
// Import the route handler
// ---------------------------------------------------------------------------

async function getHandlerAndClearCache() {
  const mod = await import('../artifacts-api.js');
  mod.clearArtifactsCache();
  const router = mod.default;
  const layer = (router as any).stack.find(
    (l: any) => l.route && l.route.path === '/' && l.route.methods.get,
  );
  if (!layer) throw new Error('GET / handler not found on router');
  const handler = layer.route.stack[0].handle;
  return handler;
}

// ---------------------------------------------------------------------------
// Helper: get files from a specific session in response
// ---------------------------------------------------------------------------

function getSessionFiles(body: any, sessionId: string) {
  const session = body.sessions.find((s: any) => s.sessionId === sessionId);
  return session?.files || [];
}

function getSessionByName(body: any, name: string) {
  return body.sessions.find((s: any) => s.sessionName === name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('artifacts-api', () => {
  let handler: Function;

  beforeEach(async () => {
    handler = await getHandlerAndClearCache();
  });

  describe('GET /api/artifacts', () => {
    it('should return empty response when no sessions exist', async () => {
      const sm = createMockSessionManager([]);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody, getStatus } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getStatus()).toBe(200);
      const body = getBody();
      expect(body.sessions).toEqual([]);
      expect(body.stats).toEqual({
        totalFiles: 0,
        totalEdits: 0,
        totalWrites: 0,
        sessionCount: 0,
      });
    });

    it('should group artifacts by session', async () => {
      const sessions = [
        createTestSession('s1', 'Session One', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/a.ts', content: 'a' }),
          ]),
        ]),
        createTestSession('s2', 'Session Two', [
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Edit', { file_path: '/b.ts', old_string: 'x', new_string: 'y' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions).toHaveLength(2);
      expect(body.stats.sessionCount).toBe(2);
    });

    it('should merge same-file operations within a session', async () => {
      const sessions = [
        createTestSession('s1', 'Test Session', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Edit', { file_path: '/src/index.ts', old_string: 'a', new_string: 'b' }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Edit', { file_path: '/src/index.ts', old_string: 'c', new_string: 'd\ne' }),
          ]),
          chatMsg('m3', 'assistant', 3000, [
            toolUse('t3', 'Write', { file_path: '/src/other.ts', content: 'hello' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions).toHaveLength(1);
      const files = body.sessions[0].files;
      // Two unique files: /src/index.ts (2 edits) and /src/other.ts (1 write)
      expect(files).toHaveLength(2);

      const indexFile = files.find((f: any) => f.filePath.includes('index.ts'));
      expect(indexFile.ops).toBe(2);
      expect(indexFile.toolNames).toContain('Edit');
      // added: 1 (b) + 2 (d\ne) = 3, removed: 1 (a) + 1 (c) = 2
      expect(indexFile.added).toBe(3);
      expect(indexFile.removed).toBe(2);
    });

    it('should convert absolute file paths to relative', async () => {
      const cwd = process.cwd().replace(/\\/g, '/');
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: `${cwd}/src/app.ts`, content: 'hello' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      const file = body.sessions[0].files[0];
      expect(file.filePath).toBe('src/app.ts');
    });

    it('should extract Write artifacts with content preview', async () => {
      const longContent = 'x'.repeat(300);
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 2000, [
            toolUse('t1', 'Write', { file_path: '/src/app.ts', content: longContent }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      const file = body.sessions[0].files[0];
      expect(file.contentPreview).toBe('x'.repeat(200));
      expect(body.stats.totalWrites).toBe(1);
    });

    it('should extract MultiEdit artifacts and sum changes', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 3000, [
            toolUse('t1', 'MultiEdit', {
              file_path: '/src/utils.ts',
              edits: [
                { old_string: 'line1\nline2', new_string: 'new1' },
                { old_string: 'a', new_string: 'b\nc' },
              ],
            }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      const file = body.sessions[0].files[0];
      expect(file.toolNames).toContain('MultiEdit');
      expect(file.added).toBe(3);
      expect(file.removed).toBe(3);
      expect(body.stats.totalEdits).toBe(1);
    });

    it('should extract artifacts from subagentToolCalls in Task blocks', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 4000, [
            toolUse('tu-task', 'Task', { prompt: 'do something' }, 'completed', [
              {
                id: 'sub-1', name: 'Write',
                input: { file_path: '/src/sub-file.ts', content: 'hello world' },
                status: 'completed', startTime: 4100,
              },
              {
                id: 'sub-2', name: 'Edit',
                input: { file_path: '/src/sub-edit.ts', old_string: 'old', new_string: 'new' },
                status: 'completed', startTime: 4200,
              },
            ]),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      const files = body.sessions[0].files;
      expect(files).toHaveLength(2);
      expect(body.stats.totalEdits).toBe(1);
      expect(body.stats.totalWrites).toBe(1);
    });

    it('should extract artifacts from ScheduleTask blocks', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 5000, [
            toolUse('tu-sched', 'ScheduleTask', { prompt: 'scheduled' }, 'completed', [
              {
                id: 'sub-s1', name: 'Write',
                input: { file_path: '/src/scheduled.ts', content: 'scheduled content' },
                status: 'completed', startTime: 5100,
              },
            ]),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions[0].files).toHaveLength(1);
      expect(body.sessions[0].files[0].filePath).toContain('scheduled.ts');
    });

    it('should sort sessions by latest timestamp descending', async () => {
      const sessions = [
        createTestSession('s1', 'Early', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/a.ts', content: 'a' }),
          ]),
        ], 1000),
        createTestSession('s2', 'Late', [
          chatMsg('m2', 'assistant', 3000, [
            toolUse('t2', 'Write', { file_path: '/b.ts', content: 'b' }),
          ]),
        ], 3000),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions[0].sessionName).toBe('Late');
      expect(body.sessions[1].sessionName).toBe('Early');
    });

    it('should apply search filter on filePath (case-insensitive)', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/src/App.tsx', content: 'a' }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Write', { file_path: '/src/utils.ts', content: 'b' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({ search: 'app' }, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].files).toHaveLength(1);
      expect(body.sessions[0].files[0].filePath).toContain('App.tsx');
    });

    it('should apply type=edit filter', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Edit', { file_path: '/src/edit.ts', old_string: 'a', new_string: 'b' }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Write', { file_path: '/src/write.ts', content: 'c' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({ type: 'edit' }, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions[0].files).toHaveLength(1);
      expect(body.sessions[0].files[0].toolNames).toContain('Edit');
    });

    it('should apply type=write filter', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Edit', { file_path: '/src/edit.ts', old_string: 'a', new_string: 'b' }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Write', { file_path: '/src/write.ts', content: 'c' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({ type: 'write' }, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions[0].files).toHaveLength(1);
      expect(body.sessions[0].files[0].toolNames).toContain('Write');
    });

    it('should count unique files across sessions in stats', async () => {
      const sessions = [
        createTestSession('s1', 'S1', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Edit', { file_path: '/src/index.ts', old_string: 'a', new_string: 'b' }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Edit', { file_path: '/src/index.ts', old_string: 'c', new_string: 'd' }),
          ]),
          chatMsg('m3', 'assistant', 3000, [
            toolUse('t3', 'Write', { file_path: '/src/other.ts', content: 'e' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.stats.totalFiles).toBe(2);
      expect(body.stats.totalEdits).toBe(2);
      expect(body.stats.totalWrites).toBe(1);
    });

    it('should exclude sessions without artifacts', async () => {
      const sessions = [
        createTestSession('s1', 'Has Artifacts', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/a.ts', content: 'a' }),
          ]),
        ]),
        createTestSession('s2', 'No Artifacts', [
          chatMsg('m2', 'assistant', 2000, [
            { type: 'text', text: 'no tools here' },
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions).toHaveLength(1);
      expect(body.stats.sessionCount).toBe(1);
    });

    it('should pass sessionLimit to listSessions', async () => {
      const sessions = [
        createTestSession('s1', 'S1', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/a.ts', content: 'a' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res } = mockReqRes({ sessionLimit: '10' }, cm);

      await handler(req, res);

      expect(sm.listSessions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('should skip tool_use blocks without file_path', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Edit', { old_string: 'a', new_string: 'b' }),
            toolUse('t2', 'Write', { content: 'no path' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getBody().sessions).toHaveLength(0);
    });

    it('should skip non-tool_use content blocks', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            { type: 'text', text: 'Hello' },
            { type: 'thinking', text: 'Let me think...' },
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getBody().sessions).toHaveLength(0);
    });

    it('should handle sessions with null chatHistory', async () => {
      const sessions = [
        {
          metadata: { id: 's1', name: 'Empty', createdAt: 1000, updatedAt: 2000 },
          chatHistory: null,
        },
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getBody().sessions).toHaveLength(0);
    });

    it('should skip sessions that fail to load', async () => {
      const sessions = [
        createTestSession('s1', 'Good Session', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/a.ts', content: 'a' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      sm.loadSessionById = vi.fn().mockReturnValue(null);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getBody().sessions).toHaveLength(0);
    });

    it('should return 500 on unexpected error', async () => {
      const sm = createMockSessionManager([]);
      sm.listSessions = vi.fn().mockImplementation(() => {
        throw new Error('Database connection failed');
      });
      const cm = createMockConversationManager(sm);
      const { req, res, getBody, getStatus } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getStatus()).toBe(500);
      expect(getBody().error).toBeDefined();
    });

    it('should fallback session name to id when name is undefined', async () => {
      const sessions = [
        {
          metadata: { id: 's1', createdAt: 1000, updatedAt: 2000 },
          chatHistory: [
            chatMsg('m1', 'assistant', 1000, [
              toolUse('t1', 'Write', { file_path: '/a.ts', content: 'a' }),
            ]),
          ],
        },
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      expect(getBody().sessions[0].sessionName).toBe('s1');
    });

    it('should include MultiEdit in edit type filter', async () => {
      const sessions = [
        createTestSession('s1', 'S', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'MultiEdit', {
              file_path: '/x.ts',
              edits: [{ old_string: 'a', new_string: 'b' }],
            }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Write', { file_path: '/y.ts', content: 'c' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({ type: 'edit' }, cm);

      await handler(req, res);

      const body = getBody();
      expect(body.sessions[0].files).toHaveLength(1);
      expect(body.sessions[0].files[0].toolNames).toContain('MultiEdit');
    });

    it('should record mixed toolNames when file has both Write and Edit', async () => {
      const sessions = [
        createTestSession('s1', 'Mixed', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/src/app.ts', content: 'initial' }),
          ]),
          chatMsg('m2', 'assistant', 2000, [
            toolUse('t2', 'Edit', { file_path: '/src/app.ts', old_string: 'initial', new_string: 'modified' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      const file = body.sessions[0].files[0];
      expect(file.ops).toBe(2);
      expect(file.toolNames).toContain('Write');
      expect(file.toolNames).toContain('Edit');
    });

    it('should sort files within session by timestamp descending', async () => {
      const sessions = [
        createTestSession('s1', 'Test', [
          chatMsg('m1', 'assistant', 1000, [
            toolUse('t1', 'Write', { file_path: '/early.ts', content: 'a' }),
          ]),
          chatMsg('m2', 'assistant', 3000, [
            toolUse('t2', 'Write', { file_path: '/late.ts', content: 'b' }),
          ]),
        ]),
      ];
      const sm = createMockSessionManager(sessions);
      const cm = createMockConversationManager(sm);
      const { req, res, getBody } = mockReqRes({}, cm);

      await handler(req, res);

      const body = getBody();
      const files = body.sessions[0].files;
      expect(files[0].filePath).toContain('late.ts');
      expect(files[1].filePath).toContain('early.ts');
    });
  });
});
