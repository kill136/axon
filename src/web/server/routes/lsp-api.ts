/**
 * LSP API 路由
 * 为 Web UI Monaco Editor 提供 Language Server Protocol 代理
 * 支持 Python (pyright)、Go、Rust 等语言的 go-to-definition 功能
 */

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { LSPServerManager, defaultLSPConfigs, getLSPServerStatus } from '../../../lsp/manager.js';

// 每个已知 LSP server 对应的语言和 npm 包名
const SERVER_METADATA: Record<string, { languages: string[]; npmPackage: string }> = {
  'pyright': { languages: ['python'], npmPackage: 'pyright' },
  'typescript-language-server': { languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'], npmPackage: 'typescript-language-server' },
  'vscode-json-languageserver': { languages: ['json'], npmPackage: 'vscode-json-languageserver' },
  'vscode-css-languageserver': { languages: ['css', 'scss', 'less'], npmPackage: 'vscode-langservers-extracted' },
  'vscode-html-languageserver': { languages: ['html'], npmPackage: 'vscode-langservers-extracted' },
};

const router = express.Router();

// 每个工作区一个 LSP manager 实例
const lspManagers = new Map<string, LSPServerManager>();
// 正在初始化中的 Promise（防止并发重复初始化）
const lspInitPromises = new Map<string, Promise<LSPServerManager | null>>();

/**
 * 获取或创建指定工作区的 LSP Manager
 * 懒初始化：第一次请求时启动 LSP 服务器
 */
async function getOrCreateManager(workspaceRoot: string): Promise<LSPServerManager | null> {
  if (lspManagers.has(workspaceRoot)) {
    return lspManagers.get(workspaceRoot)!;
  }

  if (lspInitPromises.has(workspaceRoot)) {
    return lspInitPromises.get(workspaceRoot)!;
  }

  const initPromise = (async (): Promise<LSPServerManager | null> => {
    try {
      const manager = new LSPServerManager(workspaceRoot);

      // 只注册对应语言的服务器（避免启动不需要的服务器）
      for (const config of defaultLSPConfigs) {
        manager.registerServer(config);
      }

      await manager.initialize();
      lspManagers.set(workspaceRoot, manager);
      return manager;
    } catch (err) {
      console.error('[LSP API] Failed to initialize LSP manager:', err);
      return null;
    } finally {
      lspInitPromises.delete(workspaceRoot);
    }
  })();

  lspInitPromises.set(workspaceRoot, initPromise);
  return initPromise;
}

/**
 * POST /api/lsp/definition
 * 获取符号定义位置（用于 Ctrl+Click 跳转）
 *
 * Body: { filePath: string, line: number, character: number, projectPath?: string }
 * Response: { location: { filePath, line, character } | null }
 */
router.post('/definition', async (req, res) => {
  const { filePath, line, character, projectPath } = req.body as {
    filePath: string;
    line: number;
    character: number;
    projectPath?: string;
  };

  if (!filePath || line === undefined || character === undefined) {
    return res.status(400).json({ error: 'Missing required fields: filePath, line, character' });
  }

  const workspaceRoot = projectPath || process.cwd();

  try {
    const manager = await getOrCreateManager(workspaceRoot);
    if (!manager) {
      return res.json({ location: null });
    }

    const server = manager.getServerForFile(filePath);
    if (!server || server.getState() !== 'ready') {
      return res.json({ location: null });
    }

    // 如果文档未打开，先打开
    if (!server.isDocumentOpen(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const languageId = getLanguageId(ext);
        await server.openDocument(filePath, content, languageId);
      } catch (_err) {
        return res.json({ location: null });
      }
    }

    const uri = pathToFileURL(filePath).href;
    const result = await server.sendRequestWithRetry('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });

    if (!result || (Array.isArray(result) && result.length === 0)) {
      return res.json({ location: null });
    }

    // 支持 Location 和 LocationLink 两种格式
    const loc = Array.isArray(result) ? result[0] : result;
    const defUri: string = loc.uri ?? loc.targetUri;
    const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange;

    if (!defUri || !range) {
      return res.json({ location: null });
    }

    let defFilePath: string;
    try {
      defFilePath = fileURLToPath(defUri);
    } catch (_err) {
      return res.json({ location: null });
    }

    res.json({
      location: {
        filePath: defFilePath,
        line: range.start.line,
        character: range.start.character,
      },
    });
  } catch (err) {
    console.error('[LSP API] Definition error:', err);
    res.json({ location: null });
  }
});

/**
 * POST /api/lsp/hover
 * 获取悬停信息（可选功能，用于 hover 提示）
 */
router.post('/hover', async (req, res) => {
  const { filePath, line, character, projectPath } = req.body as {
    filePath: string;
    line: number;
    character: number;
    projectPath?: string;
  };

  if (!filePath || line === undefined || character === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const workspaceRoot = projectPath || process.cwd();

  try {
    const manager = await getOrCreateManager(workspaceRoot);
    if (!manager) {
      return res.json({ contents: null });
    }

    const server = manager.getServerForFile(filePath);
    if (!server || server.getState() !== 'ready') {
      return res.json({ contents: null });
    }

    if (!server.isDocumentOpen(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        await server.openDocument(filePath, content, getLanguageId(ext));
      } catch (_err) {
        return res.json({ contents: null });
      }
    }

    const uri = pathToFileURL(filePath).href;
    const result = await server.sendRequestWithRetry('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    });

    if (!result?.contents) {
      return res.json({ contents: null });
    }

    // 统一转为字符串
    let text: string;
    if (typeof result.contents === 'string') {
      text = result.contents;
    } else if (typeof result.contents === 'object' && 'value' in result.contents) {
      text = result.contents.value;
    } else if (Array.isArray(result.contents)) {
      text = result.contents
        .map((c: any) => (typeof c === 'string' ? c : c.value))
        .join('\n');
    } else {
      text = String(result.contents);
    }

    res.json({ contents: text });
  } catch (err) {
    console.error('[LSP API] Hover error:', err);
    res.json({ contents: null });
  }
});

/**
 * GET /api/lsp/status
 * 查询 LSP 服务器状态
 */
router.get('/status', async (req, res) => {
  const projectPath = (req.query.projectPath as string) || process.cwd();
  const manager = lspManagers.get(projectPath);

  if (!manager) {
    return res.json({ status: 'not_started', servers: [] });
  }

  const serversMap = manager.getAllServers();
  const servers: { name: string; state: string }[] = [];
  serversMap.forEach((server, name) => {
    servers.push({ name, state: server.getState() });
  });

  res.json({ status: manager.getStatus().status, servers });
});

/**
 * GET /api/lsp/servers
 * 返回所有已知 LSP 服务器列表及安装状态
 */
router.get('/servers', (_req, res) => {
  const status = getLSPServerStatus();
  const servers = Object.entries(status).map(([name, info]) => {
    const s = info as { installed: boolean; command: string };
    return {
      name,
      installed: s.installed,
      languages: SERVER_METADATA[name]?.languages || [],
      npmPackage: SERVER_METADATA[name]?.npmPackage || name,
    };
  });
  res.json({ servers });
});

/**
 * POST /api/lsp/install
 * 安装指定 LSP 服务器（SSE 流式推送进度）
 * Body: { serverName: string }
 */
router.post('/install', (req, res) => {
  const { serverName } = req.body as { serverName: string };

  if (!serverName) {
    return res.status(400).json({ error: 'Missing serverName' });
  }

  const meta = SERVER_METADATA[serverName];
  if (!meta) {
    return res.status(404).json({ error: `Unknown server: ${serverName}` });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ status: 'installing', message: `Installing ${meta.npmPackage}...` });

  const proc = spawn('npm', ['install', '-g', meta.npmPackage], { shell: true });

  proc.stdout.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) sendEvent({ status: 'progress', message: msg });
  });

  proc.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) sendEvent({ status: 'progress', message: msg });
  });

  proc.on('close', (code: number) => {
    if (code === 0) {
      // 清掉所有缓存的 manager，让下次请求重新初始化（此时已能找到新安装的 server）
      lspManagers.clear();
      sendEvent({ status: 'success', message: `${serverName} installed successfully` });
    } else {
      sendEvent({ status: 'error', message: `Installation failed (exit code ${code})` });
    }
    res.end();
  });

  req.on('close', () => { proc.kill(); });
});

function getLanguageId(ext: string): string {
  const map: Record<string, string> = {
    '.py': 'python',
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
  };
  return map[ext] || 'plaintext';
}

export default router;
