import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConversationLoop } from '../../src/core/loop.js';
import { getNotebookManagerForProject, resetNotebookManager } from '../../src/memory/notebook.js';
import { resetMemorySearchManager } from '../../src/memory/memory-search.js';

describe('ConversationLoop auto memory', () => {
  let configDir: string;
  let projectDir: string;
  const originalConfigDir = process.env.AXON_CONFIG_DIR;
  const originalDisableBuiltinEmbedding = process.env.AXON_DISABLE_BUILTIN_EMBEDDING;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-auto-memory-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-auto-memory-project-'));
    process.env.AXON_CONFIG_DIR = configDir;
    process.env.AXON_DISABLE_BUILTIN_EMBEDDING = '1';
    resetNotebookManager();
    resetMemorySearchManager();
  });

  afterEach(() => {
    if (originalConfigDir) {
      process.env.AXON_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.AXON_CONFIG_DIR;
    }

    if (originalDisableBuiltinEmbedding) {
      process.env.AXON_DISABLE_BUILTIN_EMBEDDING = originalDisableBuiltinEmbedding;
    } else {
      delete process.env.AXON_DISABLE_BUILTIN_EMBEDDING;
    }

    resetNotebookManager();
    resetMemorySearchManager();

    for (const dir of [configDir, projectDir]) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // Windows 下 SQLite 句柄释放可能稍慢，不影响断言结果
      }
    }
  });

  it('autoMemorize writes profile, experience, and project notebooks', async () => {
    const loop = new ConversationLoop({
      workingDir: projectDir,
      apiKey: 'test-key',
      model: 'sonnet',
    }) as any;

    const session = loop.getSession();
    session.addMessage({
      role: 'user',
      content: '我叫小王，长期偏好中文交流，而且我非常在意回答别太官腔，最好直接一点、像合作者一样说话。',
    });
    session.addMessage({
      role: 'assistant',
      content: '明白，我会用更直接、更像同伴协作的方式来和你沟通。',
    });
    session.addMessage({
      role: 'user',
      content: '我在做 Axon，最烦的就是助手记不住我刚纠正过的事情，所以你以后最好把反复纠正点记下来。',
    });
    session.addMessage({
      role: 'assistant',
      content: '收到，这说明“用户纠正点优先记忆”应该成为长期协作规则，而不是一次性回应。',
    });

    loop.createAutoMemoryClient = () => ({
      createMessage: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: `===PROFILE===
# User Profile

## Basic Info
- Language: Chinese [updated: 2026-03-21; evidence: user stated directly]

## Communication Style
- Prefers direct, non-corporate wording [updated: 2026-03-21; evidence: explicit tone preference]

## Decision Signals
- Gets frustrated when repeated corrections are forgotten [updated: 2026-03-21; evidence: user complained about repeated corrections being forgotten]
===END_PROFILE===
===EXPERIENCE===
# Experience Notebook
- User values remembering explicit corrections across sessions
===END_EXPERIENCE===
===PROJECT===
# Project Notebook
- Axon user profiling quality is a recurring product concern
===END_PROJECT===`,
        }],
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 80 },
      }),
    });

    await loop.autoMemorize();

    const notebookMgr = getNotebookManagerForProject(projectDir);
    expect(notebookMgr).not.toBeNull();
    const profile = notebookMgr!.read('profile');
    expect(profile).toContain('## Basic Info');
    expect(profile).toContain('Language: Chinese [updated: 2026-03-21; evidence: user stated directly]');
    expect(profile).toContain('## Communication Style');
    expect(profile).toContain('Prefers direct, non-corporate wording [updated: 2026-03-21; evidence: explicit tone preference]');
    expect(profile).toContain('## Decision Signals');
    expect(profile).toContain('Gets frustrated when repeated corrections are forgotten [updated: 2026-03-21; evidence: user complained about repeated corrections being forgotten]');
    expect(notebookMgr!.read('experience')).toContain('remembering explicit corrections');
    expect(notebookMgr!.read('project')).toContain('user profiling quality');
  });

  it('autoSave schedules auto memory only once for the same message set', async () => {
    const loop = new ConversationLoop({
      workingDir: projectDir,
      apiKey: 'test-key',
      model: 'sonnet',
    }) as any;

    const session = loop.getSession();
    session.addMessage({ role: 'user', content: '第一条足够长的用户消息，用来触发自动记忆统计。' });
    session.addMessage({ role: 'assistant', content: '第一条回复，同样是自然语言。' });
    session.addMessage({ role: 'user', content: '第二条用户消息，说明这是两轮真实对话而不是工具噪音。' });
    session.addMessage({ role: 'assistant', content: '第二条回复，满足自动记忆最低门槛。' });

    const autoMemorizeSpy = vi.spyOn(loop, 'autoMemorize').mockResolvedValue(true);

    loop.autoSave();
    await loop.autoMemorizePromise;

    expect(autoMemorizeSpy).toHaveBeenCalledTimes(1);

    loop.autoSave();

    expect(autoMemorizeSpy).toHaveBeenCalledTimes(1);
    expect(loop.autoMemorizePromise).toBeNull();
  });

  it('retries background auto memory on later growth when the previous attempt failed', async () => {
    const loop = new ConversationLoop({
      workingDir: projectDir,
      apiKey: 'test-key',
      model: 'sonnet',
    }) as any;

    const session = loop.getSession();
    session.addMessage({ role: 'user', content: '第一条足够长的用户消息，用来触发自动记忆统计。' });
    session.addMessage({ role: 'assistant', content: '第一条回复，同样是自然语言。' });
    session.addMessage({ role: 'user', content: '第二条用户消息，说明这是两轮真实对话而不是工具噪音。' });
    session.addMessage({ role: 'assistant', content: '第二条回复，满足自动记忆最低门槛。' });

    const autoMemorizeSpy = vi.spyOn(loop, 'autoMemorize')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    loop.autoSave();
    await loop.autoMemorizePromise;

    expect(autoMemorizeSpy).toHaveBeenCalledTimes(1);
    expect(loop.lastAutoMemorizedMessageCount).toBe(0);
    expect(loop.lastAutoMemorizeAttemptedMessageCount).toBe(4);

    session.addMessage({ role: 'user', content: '第三条用户消息，表示会话继续推进并带来新的可记忆内容。' });
    session.addMessage({ role: 'assistant', content: '第三条回复，确保有效消息数继续增长。' });

    loop.autoSave();
    await loop.autoMemorizePromise;

    expect(autoMemorizeSpy).toHaveBeenCalledTimes(2);
    expect(autoMemorizeSpy).toHaveBeenNthCalledWith(1, {
      startMessageCount: 0,
      endMessageCount: 4,
      updateSuccessCursor: true,
    });
    expect(autoMemorizeSpy).toHaveBeenNthCalledWith(2, {
      startMessageCount: 0,
      endMessageCount: 6,
      updateSuccessCursor: true,
    });
  });

  it('only summarizes messages after the last successful auto memory cursor', async () => {
    const loop = new ConversationLoop({
      workingDir: projectDir,
      apiKey: 'test-key',
      model: 'sonnet',
    }) as any;

    const session = loop.getSession();
    session.addMessage({ role: 'user', content: '旧用户消息 1：这是应该被跳过的历史内容。' });
    session.addMessage({ role: 'assistant', content: '旧助手回复 1：同样属于已经成功记忆过的内容。' });
    session.addMessage({ role: 'user', content: '旧用户消息 2：仍然属于旧增量之前。' });
    session.addMessage({ role: 'assistant', content: '旧助手回复 2：这是上一轮成功游标之前的尾部。' });
    session.addMessage({ role: 'user', content: '新用户消息 3：这是本次应该被提取的新内容。' });
    session.addMessage({ role: 'assistant', content: '新助手回复 3：也是本次应该被提取的新内容。' });

    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'NO_UPDATE' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    loop.createAutoMemoryClient = () => ({ createMessage });
    loop.lastAutoMemorizedMessageCount = 4;

    const result = await loop.autoMemorize({
      startMessageCount: 4,
      endMessageCount: 6,
      updateSuccessCursor: true,
    });

    expect(result).toBe(true);
    expect(createMessage).toHaveBeenCalledTimes(1);
    const prompt = createMessage.mock.calls[0]?.[0]?.[0]?.content;
    expect(prompt).toContain('新用户消息 3');
    expect(prompt).toContain('新助手回复 3');
    expect(prompt).not.toContain('旧用户消息 1');
    expect(prompt).not.toContain('旧助手回复 1');
    expect(loop.lastAutoMemorizedMessageCount).toBe(6);
  });

  it('refreshes notebook summary before building the next prompt', async () => {
    const loop = new ConversationLoop({
      workingDir: projectDir,
      apiKey: 'test-key',
      model: 'sonnet',
    }) as any;

    const notebookMgr = getNotebookManagerForProject(projectDir);
    expect(notebookMgr).not.toBeNull();

    notebookMgr!.write('profile', '# User Profile\n- Prefers concise responses');

    let seenNotebookSummary = '';
    loop.promptBuilder = {
      build: vi.fn().mockImplementation(async (context: any) => {
        seenNotebookSummary = context.notebookSummary || '';
        return {
          content: 'mock-system-prompt',
          blocks: [],
          hashInfo: {
            hash: 'mock-hash',
            computedAt: Date.now(),
            length: 18,
            estimatedTokens: 5,
          },
          attachments: [],
          truncated: false,
          buildTimeMs: 1,
        };
      }),
    };

    loop.client.createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '好的' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await loop.processMessage('继续');

    expect(result).toBe('好的');
    expect(seenNotebookSummary).toContain('Prefers concise responses');
  });
});
