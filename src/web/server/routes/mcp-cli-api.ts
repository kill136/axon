/**
 * MCP CLI API Routes
 * 
 * Provides HTTP endpoints for the mcp-cli command to interact with
 * MCP servers running in the main process. This bridges the gap between
 * the CLI process (invoked via Bash tool) and the in-memory MCP connections.
 * 
 * Endpoints:
 *   GET  /api/mcp-cli/servers          - List all servers
 *   GET  /api/mcp-cli/tools            - List all tools (optionally filter by server)
 *   GET  /api/mcp-cli/tools/:server/:tool  - Get tool schema (info)
 *   POST /api/mcp-cli/call/:server/:tool   - Call a tool
 *   GET  /api/mcp-cli/resources        - List all resources
 *   POST /api/mcp-cli/resources/read   - Read a resource
 *   GET  /api/mcp-cli/grep             - Search tools by pattern
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  getMcpServers,
  callMcpTool,
  connectMcpServer,
  sendMcpMessageForCli,
} from '../../../tools/mcp.js';

const router = Router();

/**
 * 认证中间件：校验 X-MCP-CLI-Token header
 * token 由 web server 启动时生成，通过环境变量传给 CLI 子进程
 */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.MCP_CLI_TOKEN;
  if (!expected) {
    // token 未配置，拒绝所有请求
    res.status(503).json({ error: 'MCP CLI token not configured' });
    return;
  }
  const provided = req.headers['x-mcp-cli-token'] as string;
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid or missing MCP CLI token' });
    return;
  }
  next();
}

router.use(authMiddleware);

/**
 * GET /servers - List all connected MCP servers
 */
router.get('/servers', (_req: Request, res: Response) => {
  const servers = getMcpServers();
  const result: Array<{
    name: string;
    connected: boolean;
    toolCount: number;
    resourceCount: number;
  }> = [];

  for (const [name, state] of servers) {
    result.push({
      name,
      connected: state.connected,
      toolCount: state.tools.length,
      resourceCount: state.resources.length,
    });
  }

  res.json(result);
});

/**
 * GET /tools?server=xxx - List tools, optionally filtered by server
 */
router.get('/tools', (req: Request, res: Response) => {
  const serverFilter = req.query.server as string | undefined;
  const servers = getMcpServers();
  const tools: Array<{
    server: string;
    name: string;
    description: string;
  }> = [];

  for (const [name, state] of servers) {
    if (serverFilter && name !== serverFilter) continue;
    if (!state.connected) continue;

    for (const tool of state.tools) {
      tools.push({
        server: name,
        name: tool.name,
        description: tool.description || '',
      });
    }
  }

  res.json(tools);
});

/**
 * GET /tools/:server/:tool - Get tool schema (JSON Schema for input parameters)
 */
router.get('/tools/:server/:tool', (req: Request, res: Response) => {
  const { server, tool: toolName } = req.params;
  const servers = getMcpServers();
  const serverState = servers.get(server);

  if (!serverState) {
    res.status(404).json({ error: `Server "${server}" not found` });
    return;
  }

  if (!serverState.connected) {
    res.status(503).json({ error: `Server "${server}" is not connected` });
    return;
  }

  const tool = serverState.tools.find(t => t.name === toolName);
  if (!tool) {
    res.status(404).json({
      error: `Tool "${toolName}" not found on server "${server}"`,
      available: serverState.tools.map(t => t.name),
    });
    return;
  }

  res.json({
    server,
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
  });
});

/**
 * POST /call/:server/:tool - Call an MCP tool
 * Body: JSON arguments for the tool
 */
router.post('/call/:server/:tool', async (req: Request, res: Response) => {
  const { server, tool: toolName } = req.params;
  const args = req.body || {};
  const servers = getMcpServers();
  const serverState = servers.get(server);

  if (!serverState) {
    res.status(404).json({ error: `Server "${server}" not found` });
    return;
  }

  // Auto-connect if not connected
  if (!serverState.connected) {
    const connected = await connectMcpServer(server);
    if (!connected) {
      res.status(503).json({ error: `Failed to connect to server "${server}"` });
      return;
    }
  }

  const result = await callMcpTool(server, toolName, args);
  if (result.success) {
    res.json({ output: result.output });
  } else {
    res.status(400).json({ error: result.error });
  }
});

/**
 * GET /resources?server=xxx - List resources, optionally filtered by server
 */
router.get('/resources', (req: Request, res: Response) => {
  const serverFilter = req.query.server as string | undefined;
  const servers = getMcpServers();
  const resources: Array<{
    server: string;
    uri: string;
    name: string;
    mimeType?: string;
    description?: string;
  }> = [];

  for (const [name, state] of servers) {
    if (serverFilter && name !== serverFilter) continue;
    if (!state.connected) continue;

    for (const resource of state.resources) {
      resources.push({
        server: name,
        uri: resource.uri,
        name: resource.name || resource.uri,
        mimeType: resource.mimeType,
        description: resource.description,
      });
    }
  }

  res.json(resources);
});

/**
 * POST /resources/read - Read an MCP resource
 * Body: { server: string, uri: string }
 */
router.post('/resources/read', async (req: Request, res: Response) => {
  const { server, uri } = req.body;

  if (!server || !uri) {
    res.status(400).json({ error: 'Missing "server" or "uri" in request body' });
    return;
  }

  const servers = getMcpServers();
  const serverState = servers.get(server);

  if (!serverState) {
    res.status(404).json({ error: `Server "${server}" not found` });
    return;
  }

  if (!serverState.connected) {
    res.status(503).json({ error: `Server "${server}" is not connected` });
    return;
  }

  try {
    const result = await sendMcpMessageForCli(server, 'resources/read', { uri });
    if (result) {
      res.json({ output: result });
    } else {
      res.status(500).json({ error: 'Failed to read resource' });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /grep?q=pattern - Search tools by name/description pattern
 */
router.get('/grep', (req: Request, res: Response) => {
  const pattern = (req.query.q as string || '').toLowerCase();

  if (!pattern) {
    res.status(400).json({ error: 'Missing query parameter "q"' });
    return;
  }

  const servers = getMcpServers();
  const matches: Array<{
    server: string;
    name: string;
    description: string;
    matchedIn: string;
  }> = [];

  for (const [serverName, state] of servers) {
    if (!state.connected) continue;

    for (const tool of state.tools) {
      const nameMatch = tool.name.toLowerCase().includes(pattern);
      const descMatch = (tool.description || '').toLowerCase().includes(pattern);

      if (nameMatch || descMatch) {
        matches.push({
          server: serverName,
          name: tool.name,
          description: tool.description || '',
          matchedIn: nameMatch ? 'name' : 'description',
        });
      }
    }
  }

  res.json(matches);
});

export default router;
