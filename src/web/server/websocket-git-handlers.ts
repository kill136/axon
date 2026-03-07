/**
 * Git WebSocket 消息处理函数
 * 处理所有 git:* 类型的 WebSocket 消息
 */

import { WebSocket } from 'ws';
import { GitManager } from './git-manager.js';
import { ConversationManager } from './conversation.js';
import { ClaudeClient } from '../../core/client.js';
import { webAuth } from './web-auth.js';

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
  conversationManager: ConversationManager,
  options?: { all?: boolean; branch?: string }
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getLog(limit || 200, { all: options?.all ?? true, branch: options?.branch });
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

/**
 * 获取 commit 详情（含文件列表）
 */
export async function handleGitGetCommitDetail(
  client: ClientConnection,
  hash: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const detail = git.getCommitDetail(hash);
  const files = git.getCommitFiles(hash);

  sendMessage(client.ws, {
    type: 'git:commit_detail_response',
    payload: {
      success: detail.success && files.success,
      data: detail.success ? {
        ...detail.data,
        files: files.data?.files || [],
      } : undefined,
      error: detail.error || files.error,
    },
  });
}

export async function handleGitGetCommitFileDiff(
  client: ClientConnection,
  hash: string,
  file: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.getCommitFileDiff(hash, file);

  sendMessage(client.ws, {
    type: 'git:diff_response',
    payload: {
      success: result.success,
      data: result.success ? result.data : undefined,
      error: result.error,
    },
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
  const result = await git.push();
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
  const result = await git.pull();
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

  // 检测 "local changes would be overwritten" 冲突
  if (!result.success && result.error && /would be overwritten by checkout/i.test(result.error)) {
    sendMessage(client.ws, {
      type: 'git:checkout_conflict',
      payload: {
        branch,
        error: result.error,
      },
    });
    return;
  }

  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'checkout', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

/**
 * Stash 当前更改后切换分支
 */
export async function handleGitStashAndCheckout(
  client: ClientConnection,
  branch: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);

  // Step 1: stash
  const stashResult = git.stashSave(`Auto-stash before checkout to ${branch}`);
  if (!stashResult.success) {
    sendMessage(client.ws, {
      type: 'git:operation_result',
      payload: { operation: 'stash_and_checkout', success: false, error: stashResult.error },
    });
    return;
  }

  // Step 2: checkout
  const checkoutResult = git.checkout(branch);
  if (!checkoutResult.success) {
    // checkout 失败，恢复 stash
    git.stashPop(0);
    sendMessage(client.ws, {
      type: 'git:operation_result',
      payload: { operation: 'stash_and_checkout', success: false, error: checkoutResult.error },
    });
    return;
  }

  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'stash_and_checkout', success: true },
  });

  // 刷新状态
  const status = git.getStatus();
  sendMessage(client.ws, { type: 'git:status_response', payload: status });
  const stashes = git.getStashes();
  sendMessage(client.ws, { type: 'git:stashes_response', payload: stashes });
}

/**
 * 强制切换分支（丢弃本地更改）
 */
export async function handleGitForceCheckout(
  client: ClientConnection,
  branch: string,
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);
  const result = git.forceCheckout(branch);

  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'force_checkout', ...result },
  });
  if (result.success) {
    const status = git.getStatus();
    sendMessage(client.ws, { type: 'git:status_response', payload: status });
  }
}

export async function handleGitCreateBranch(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager,
  startPoint?: string,
): Promise<void> {
  const git = getGitManager(client);
  const result = git.createBranch(name, startPoint);
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
    throw new Error('API Key or Auth Token not configured');
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
  // 确保 OAuth token 有效（对齐官方 NM()）
  await webAuth.ensureValidToken();
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
 * 清理 AI 返回的 commit message，去掉多余的分析、markdown 标记等
 */
function cleanCommitMessage(raw: string): string {
  let msg = raw.trim();

  // 去掉 markdown 代码围栏
  msg = msg.replace(/^```[\s\S]*?\n([\s\S]*?)\n```$/gm, '$1').trim();

  // 如果包含 "---" 分隔符，提取其中的内容（AI 常用格式）
  const dashMatch = msg.match(/---\s*\n([\s\S]*?)\n\s*---/);
  if (dashMatch) {
    msg = dashMatch[1].trim();
  }

  // 去掉开头的 "Here's the commit message:" 类前缀
  msg = msg.replace(/^(?:Here(?:'s| is) (?:the|my|a) commit message[:\s]*\n*)/i, '').trim();

  // 去掉 markdown 格式符号（**bold**、*italic*）
  msg = msg.replace(/\*\*(.*?)\*\*/g, '$1');
  msg = msg.replace(/\*(.*?)\*/g, '$1');

  // 确保不以空行开头
  msg = msg.replace(/^\n+/, '');

  return msg;
}

/**
 * 获取 diff 内容的辅助函数
 */
async function getDiffContent(cwd: string, staged: boolean): Promise<string> {
  const { execSync } = await import('child_process');
  try {
    const cmd = staged ? 'git diff --cached' : 'git diff';
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000, maxBuffer: 50 * 1024 * 1024 }).trim();
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
        payload: { success: false, error: 'No changes to commit' },
      });
      return;
    }

    const rawMessage = await aiRequest(conversationManager, `You are a commit message generator. Output ONLY the commit message, nothing else. No analysis, no explanation, no markdown, no code fences, no "---" separators.

Rules:
- First line: type(scope): description (max 72 chars, English)
- type: feat|fix|refactor|docs|style|test|chore|perf
- If complex, add a blank line then a short body paragraph
- Output the commit message directly. Do NOT include any preamble like "Here's the commit message:" or analysis

Diff:
${diff.substring(0, 8000)}`);

    // 后处理：清理 AI 可能输出的多余内容
    const message = cleanCommitMessage(rawMessage);

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
        payload: { success: false, error: 'No changes to review' },
      });
      return;
    }

    const review = await aiRequest(conversationManager, `As a senior code reviewer, review the following code changes. Please identify:

1. **Bug Risks** - Potential bugs or logic errors
2. **Security Issues** - XSS, injection, sensitive data exposure, etc.
3. **Design Issues** - Architecture, maintainability, complexity
4. **Improvement Suggestions** - Code quality, best practices

If the code quality is good, also provide positive feedback.

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
 * Smart Commit + Review: 并行执行审查和生成 commit message，一次性返回
 * 流程：审查结果 + commit message → 用户确认 → 提交
 */
export async function handleGitSmartCommitAndReview(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  try {
    const cwd = client.projectPath || process.cwd();

    const stagedDiff = await getDiffContent(cwd, true);
    const unstagedDiff = await getDiffContent(cwd, false);
    const needsStaging = !stagedDiff;
    const diff = stagedDiff || unstagedDiff;
    const fullDiff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n\n');

    if (!diff) {
      sendMessage(client.ws, {
        type: 'git:smart_commit_and_review_response',
        payload: { success: false, error: 'No changes to commit or review' },
      });
      return;
    }

    // 并行执行 review 和 commit message 生成
    const [review, rawMessage] = await Promise.all([
      fullDiff
        ? aiRequest(conversationManager, `As a senior code reviewer, review the following code changes. Please identify:

1. **Bug Risks** - Potential bugs or logic errors
2. **Security Issues** - XSS, injection, sensitive data exposure, etc.
3. **Design Issues** - Architecture, maintainability, complexity
4. **Improvement Suggestions** - Code quality, best practices

If the code quality is good, also provide positive feedback.

Diff:
\`\`\`
${fullDiff.substring(0, 12000)}
\`\`\``)
        : Promise.resolve(''),
      aiRequest(conversationManager, `You are a commit message generator. Output ONLY the commit message, nothing else. No analysis, no explanation, no markdown, no code fences, no "---" separators.

Rules:
- First line: type(scope): description (max 72 chars, English)
- type: feat|fix|refactor|docs|style|test|chore|perf
- If complex, add a blank line then a short body paragraph
- Output the commit message directly. Do NOT include any preamble like "Here's the commit message:" or analysis

Diff:
${diff.substring(0, 8000)}`),
    ]);

    const message = cleanCommitMessage(rawMessage);

    sendMessage(client.ws, {
      type: 'git:smart_commit_and_review_response',
      payload: { success: true, review, message, needsStaging },
    });
  } catch (error: any) {
    sendMessage(client.ws, {
      type: 'git:smart_commit_and_review_response',
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
        payload: { success: false, error: commitDetail.error || 'Failed to get commit details' },
      });
      return;
    }

    const explanation = await aiRequest(conversationManager, `Explain what the following git commit does.

Commit: ${commitDetail.data.shortHash} - ${commitDetail.data.message}
Author: ${commitDetail.data.author}
Date: ${commitDetail.data.date}

Diff:
\`\`\`
${commitDetail.data.diff.substring(0, 10000)}
\`\`\`

Please briefly explain:
1. The main purpose of this commit
2. What specific changes were made
3. Why these changes were made (inferred intent)`);

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
  conversationManager: ConversationManager,
  commit?: string,
): Promise<void> {
  const git = getGitManager(client);
  const result = git.createTag(name, message, type, commit);
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
  const result = await git.pushTags();
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
  const result = await git.fetch(remote);
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

/**
 * 处理 Git Lock 文件冲突
 * action: 'delete' 删除 lock 文件, 'retry' 只重试（先检查 lock 是否还在）
 */
export async function handleGitResolveLock(
  client: ClientConnection,
  action: 'delete' | 'retry',
  conversationManager: ConversationManager
): Promise<void> {
  const git = getGitManager(client);

  if (action === 'delete') {
    const removeResult = git.removeLockFile();
    if (!removeResult.success) {
      sendMessage(client.ws, {
        type: 'git:operation_result',
        payload: { operation: 'resolve_lock', success: false, error: removeResult.error },
      });
      return;
    }
  }

  // 删除后 / retry 时刷新状态
  const status = git.getStatus();
  sendMessage(client.ws, {
    type: 'git:operation_result',
    payload: { operation: 'resolve_lock', success: true },
  });
  sendMessage(client.ws, { type: 'git:status_response', payload: status });
}
