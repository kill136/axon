/**
 * Git WebSocket 消息处理函数
 * 处理所有 git:* 类型的 WebSocket 消息
 */

import { WebSocket } from 'ws';
import { GitManager } from './git-manager.js';
import { ConversationManager } from './conversation.js';
import { ClaudeClient } from '../../core/client.js';

// 复用 websocket.ts 中的类型
interface ClientConnection {
  id: string;
  ws: WebSocket;
  sessionId: string;
  model: string;
  isAlive: boolean;
  swarmSubscriptions: Set<string>;
  projectPath?: string;
  permissionMode?: string;
}

interface ServerMessage {
  type: string;
  payload?: any;
}

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function getGitManager(client: ClientConnection): GitManager {
  const cwd = client.projectPath || process.cwd();
  return new GitManager(cwd);
}

// ============================================================================
// 基础 Git 操作处理函数
// ============================================================================

export async function handleGitGetStatus(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getStatus();
  sendMessage(client.ws, {
    type: 'git:status_response',
    payload: result,
  });
}

export async function handleGitGetLog(
  client: ClientConnection,
  limit: number | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getLog(limit || 50);
  sendMessage(client.ws, {
    type: 'git:log_response',
    payload: result,
  });
}

export async function handleGitGetBranches(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getBranches();
  sendMessage(client.ws, {
    type: 'git:branches_response',
    payload: result,
  });
}

export async function handleGitGetStashes(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getStashes();
  sendMessage(client.ws, {
    type: 'git:stashes_response',
    payload: result,
  });
}

export async function handleGitStage(
  client: ClientConnection,
  files: string[],
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.stage(files);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stage', ...result },
  });
  // 操作后自动刷新状态
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitUnstage(
  client: ClientConnection,
  files: string[],
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.unstage(files);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'unstage', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitCommit(
  client: ClientConnection,
  message: string,
  conversationManager: ConversationManager,
  autoStage?: boolean
): Promise<void> {
  const git = getGitManager(client);
  if (autoStage) {
    const stageResult = git.stageAll();
    if (!stageResult.success) {
      sendMessage(client.ws, {
        type: 'git:operation_result',
        payload: { operation: 'commit', success: false, error: `Stage failed: ${stageResult.error}` },
      });
      return;
    }
  }
  const result = git.commit(message);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'commit', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitPush(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.push();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'push', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitPull(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.pull();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'pull', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitCheckout(
  client: ClientConnection,
  branch: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.checkout(branch);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'checkout', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitCreateBranch(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.createBranch(name);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'create_branch', ...result },
  });
  if (result.success) {
    const branches = git.getBranches();
    sendMessage(client.ws, { type: 'git:branches_response', payload: branches });
  }
}

export async function handleGitDeleteBranch(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.deleteBranch(name);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'delete_branch', ...result },
  });
  if (result.success) {
    const branches = git.getBranches();
    sendMessage(client.ws, { type: 'git:branches_response', payload: branches });
  }
}

export async function handleGitStashSave(
  client: ClientConnection,
  message: string | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.stashSave(message);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stash_save', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
    const stashes = git.getStashes();
    sendMessage(client.ws, { type: 'git:stashes_response', payload: stashes });
  }
}

export async function handleGitStashPop(
  client: ClientConnection,
  index: number | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.stashPop(index ?? 0);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stash_pop', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
    const stashes = git.getStashes();
    sendMessage(client.ws, { type: 'git:stashes_response', payload: stashes });
  }
}

export async function handleGitStashDrop(
  client: ClientConnection,
  index: number,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.stashDrop(index);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stash_drop', ...result },
  });
  if (result.success) {
    const stashes = git.getStashes();
    sendMessage(client.ws, { type: 'git:stashes_response', payload: stashes });
  }
}

export async function handleGitStashApply(
  client: ClientConnection,
  index: number,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.stashApply(index);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stash_apply', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitGetDiff(
  client: ClientConnection,
  file: string | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getDiff(file);
  sendMessage(client.ws, {
    type: 'git:diff_response',
    payload: result,
  });
}

// ============================================================================
// AI 增强处理函数
// ============================================================================

/**
 * 创建 ClaudeClient（复用 ConversationManager 的完整认证逻辑）
 */
function createGitAIClient(conversationManager: ConversationManager): ClaudeClient {
  const config = conversationManager.getClientConfig('haiku');

  if (!config.apiKey && !config.authToken) {
    throw new Error('未配置 API Key 或 Auth Token');
  }

  return new ClaudeClient({
    apiKey: config.authToken ? undefined : config.apiKey,
    authToken: config.authToken,
    baseUrl: config.baseUrl,
    model: 'haiku',
  });
}

/**
 * 通过 ClaudeClient 发送单次 AI 请求
 */
async function aiRequest(conversationManager: ConversationManager, prompt: string): Promise<string> {
  const client = createGitAIClient(conversationManager);
  const response = await client.createMessage(
    [{ role: 'user', content: prompt }],
    undefined,
    undefined,
    { enableThinking: false }
  );

  for (const block of response.content) {
    if (block.type === 'text') {
      return block.text.trim();
    }
  }
  return '';
}

/**
 * 获取 diff 内容的辅助函数
 */
async function getDiffContent(cwd: string, staged: boolean): Promise<string> {
  const { execSync } = await import('child_process');
  try {
    const cmd = staged ? 'git diff --cached' : 'git diff';
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

/**
 * Smart Commit: 分析当前 diff 生成 commit message（不提前 stageAll，避免污染暂存区）
 * 如果已有 staged 文件，只分析 staged diff；否则分析 unstaged diff 并标记 needsStaging
 */
export async function handleGitSmartCommit(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  try {
    const cwd = client.projectPath || process.cwd();

    // 优先使用已暂存的 diff，没有再用未暂存的 diff
    const stagedDiff = await getDiffContent(cwd, true);
    const unstagedDiff = await getDiffContent(cwd, false);
    const needsStaging = !stagedDiff;
    const diff = stagedDiff || unstagedDiff;

    if (!diff) {
      sendMessage(client.ws, {
        type: 'git:smart_commit_response',
        payload: { success: false, error: '没有可提交的更改' },
      });
      return;
    }

    const message = await aiRequest(conversationManager, `分析以下 git diff，生成一条高质量的 commit message。

要求：
- 第一行是简短的摘要（不超过 72 字符），使用英文
- 格式：type(scope): description
- type 可选：feat, fix, refactor, docs, style, test, chore, perf
- 如果改动复杂，可以空一行后添加详细说明
- 只输出纯文本 commit message，不要包含 markdown 格式符号（如反引号、星号等）

Diff:
${diff.substring(0, 8000)}`);

    sendMessage(client.ws, {
      type: 'git:smart_commit_response',
      payload: { success: true, message, needsStaging },
    });
  } catch (error: any) {
    sendMessage(client.ws, {
      type: 'git:smart_commit_response',
      payload: { success: false, error: error.message || String(error) },
    });
  }
}

/**
 * Smart Review: AI Code Review
 */
export async function handleGitSmartReview(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  try {
    const cwd = client.projectPath || process.cwd();

    const stagedDiff = await getDiffContent(cwd, true);
    const unstagedDiff = await getDiffContent(cwd, false);
    const fullDiff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n\n');

    if (!fullDiff) {
      sendMessage(client.ws, {
        type: 'git:smart_review_response',
        payload: { success: false, error: '没有可审查的更改' },
      });
      return;
    }

    const review = await aiRequest(conversationManager, `作为资深代码审查者，审查以下代码变更。请指出：

1. **Bug 风险** - 可能引入的 bug 或逻辑错误
2. **安全问题** - XSS、注入、敏感信息泄露等
3. **设计问题** - 架构、可维护性、复杂度
4. **改进建议** - 代码质量、最佳实践

如果代码质量好，也要给出正面评价。使用中文回复。

Diff:
\`\`\`
${fullDiff.substring(0, 12000)}
\`\`\``);

    sendMessage(client.ws, {
      type: 'git:smart_review_response',
      payload: { success: true, review },
    });
  } catch (error: any) {
    sendMessage(client.ws, {
      type: 'git:smart_review_response',
      payload: { success: false, error: error.message || String(error) },
    });
  }
}

/**
 * Explain Commit: AI 解释 commit
 */
export async function handleGitExplainCommit(
  client: ClientConnection,
  hash: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);

  try {
    const commitDetail = git.getCommitDetail(hash);

    if (!commitDetail.success || !commitDetail.data) {
      sendMessage(client.ws, {
        type: 'git:explain_commit_response',
        payload: { success: false, error: commitDetail.error || '无法获取 commit 详情' },
      });
      return;
    }

    const explanation = await aiRequest(conversationManager, `解释以下 git commit 做了什么。

Commit: ${commitDetail.data.shortHash} - ${commitDetail.data.message}
Author: ${commitDetail.data.author}
Date: ${commitDetail.data.date}

Diff:
\`\`\`
${commitDetail.data.diff.substring(0, 10000)}
\`\`\`

请用中文简要说明：
1. 这个 commit 的主要目的
2. 具体做了哪些更改
3. 为什么要这样改（推测意图）`);

    sendMessage(client.ws, {
      type: 'git:explain_commit_response',
      payload: { success: true, explanation },
    });
  } catch (error: any) {
    sendMessage(client.ws, {
      type: 'git:explain_commit_response',
      payload: { success: false, error: error.message || String(error) },
    });
  }
}

// ============================================================================
// Git Enhanced Features Handlers
// ============================================================================

export async function handleGitMerge(
  client: ClientConnection,
  branch: string,
  strategy: 'no-ff' | 'squash' | 'ff-only' | 'default' | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.merge(branch, strategy);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'merge', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitRebase(
  client: ClientConnection,
  branch: string,
  onto: string | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.rebase(branch, onto);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'rebase', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitMergeAbort(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.mergeAbort();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'merge_abort', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitRebaseContinue(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.rebaseContinue();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'rebase_continue', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitRebaseAbort(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.rebaseAbort();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'rebase_abort', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitReset(
  client: ClientConnection,
  commit: string,
  mode: 'soft' | 'mixed' | 'hard',
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.reset(commit, mode);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'reset', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitDiscardFile(
  client: ClientConnection,
  file: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.discardFile(file);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'discard_file', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitStageAll(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.stageAll();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stage_all', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitUnstageAll(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.unstageAll();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'unstage_all', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitDiscardAll(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.discardAll();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'discard_all', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitAmendCommit(
  client: ClientConnection,
  message: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.amendCommit(message);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'amend_commit', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitRevertCommit(
  client: ClientConnection,
  hash: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.revertCommit(hash);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'revert_commit', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitCherryPick(
  client: ClientConnection,
  hash: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.cherryPick(hash);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'cherry_pick', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitGetTags(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getTags();
  sendMessage(client.ws, { type: 'git:tags_response', payload: result });
}

export async function handleGitCreateTag(
  client: ClientConnection,
  name: string,
  message: string | undefined,
  type: 'lightweight' | 'annotated',
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.createTag(name, message, type);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'create_tag', ...result },
  });
  if (result.success) {
    const tags = git.getTags();
    sendMessage(client.ws, { type: 'git:tags_response', payload: tags });
  }
}

export async function handleGitDeleteTag(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.deleteTag(name);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'delete_tag', ...result },
  });
  if (result.success) {
    const tags = git.getTags();
    sendMessage(client.ws, { type: 'git:tags_response', payload: tags });
  }
}

export async function handleGitPushTags(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.pushTags();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'push_tags', ...result },
  });
}

export async function handleGitGetRemotes(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getRemotes();
  sendMessage(client.ws, { type: 'git:remotes_response', payload: result });
}

export async function handleGitAddRemote(
  client: ClientConnection,
  name: string,
  url: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.addRemote(name, url);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'add_remote', ...result },
  });
  if (result.success) {
    const remotes = git.getRemotes();
    sendMessage(client.ws, { type: 'git:remotes_response', payload: remotes });
  }
}

export async function handleGitRemoveRemote(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.removeRemote(name);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'remove_remote', ...result },
  });
  if (result.success) {
    const remotes = git.getRemotes();
    sendMessage(client.ws, { type: 'git:remotes_response', payload: remotes });
  }
}

export async function handleGitFetch(
  client: ClientConnection,
  remote: string | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.fetch(remote);
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'fetch', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitSearchCommits(
  client: ClientConnection,
  filter: { query?: string; author?: string; since?: string; until?: string; limit?: number },
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.searchCommits(filter);
  sendMessage(client.ws, { type: 'git:log_response', payload: result });
}

export async function handleGitGetFileHistory(
  client: ClientConnection,
  file: string,
  limit: number | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getFileHistory(file, limit || 50);
  sendMessage(client.ws, { type: 'git:file_history_response', payload: result });
}

export async function handleGitGetBlame(
  client: ClientConnection,
  file: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getBlame(file);
  sendMessage(client.ws, { type: 'git:blame_response', payload: result });
}

export async function handleGitCompareBranches(
  client: ClientConnection,
  base: string,
  target: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.compareBranches(base, target);
  sendMessage(client.ws, { type: 'git:compare_branches_response', payload: result });
}

export async function handleGitGetMergeStatus(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getMergeStatus();
  sendMessage(client.ws, { type: 'git:merge_status_response', payload: result });
}

export async function handleGitGetConflicts(
  client: ClientConnection,
  file: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getConflicts(file);
  sendMessage(client.ws, { type: 'git:conflicts_response', payload: result });
}
