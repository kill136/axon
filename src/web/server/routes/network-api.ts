/**
 * Agent Network REST API 路由
 *
 * 提供网络状态、Agent 列表、审计日志、信任管理等 HTTP 端点。
 */

import { Router, type Request, type Response } from 'express';
import type { AgentNetwork } from '../../../network/index.js';
import { configManager } from '../../../config/index.js';

const router = Router();

/**
 * 获取 AgentNetwork 实例（从 app.locals）
 */
function getNetwork(req: Request): AgentNetwork | null {
  return req.app.locals.agentNetwork || null;
}

/**
 * GET /api/network/status
 * 返回网络状态（身份、Agent 列表、端口）
 */
router.get('/status', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.json({
      enabled: false,
      identity: null,
      agents: [],
      port: 0,
    });
  }
  res.json(network.getStatus());
});

/**
 * GET /api/network/identity
 * 返回本机 Agent 身份
 */
router.get('/identity', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.status(503).json({ error: 'Agent Network not enabled' });
  }
  res.json(network.identity);
});

/**
 * GET /api/network/agents
 * 返回发现的 Agent 列表
 */
router.get('/agents', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.json([]);
  }
  res.json(network.getDiscoveredAgents());
});

/**
 * GET /api/network/audit
 * 返回审计日志（支持分页 + 过滤）
 * Query: agentId, taskId, limit, offset
 */
router.get('/audit', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.json([]);
  }

  const filter = {
    agentId: req.query.agentId as string | undefined,
    taskId: req.query.taskId as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
    offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
  };

  res.json(network.getAuditLog(filter));
});

/**
 * POST /api/network/send
 * 发送消息给指定 Agent
 * Body: { agentId, method, params? }
 */
router.post('/send', async (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.status(503).json({ error: 'Agent Network not enabled' });
  }

  const { agentId, method, params } = req.body;
  if (!agentId || !method) {
    return res.status(400).json({ error: 'agentId and method are required' });
  }

  try {
    const result = await network.sendRequest(agentId, method, params);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/network/trust
 * 信任/取消信任某个 Agent
 * Body: { agentId, trust: boolean }
 */
router.post('/trust', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.status(503).json({ error: 'Agent Network not enabled' });
  }

  const { agentId, trust } = req.body;
  if (!agentId || typeof trust !== 'boolean') {
    return res.status(400).json({ error: 'agentId and trust (boolean) are required' });
  }

  if (trust) {
    network.trustAgent(agentId);
  } else {
    network.untrustAgent(agentId);
  }

  res.json({ success: true });
});

/**
 * POST /api/network/kick
 * 踢出某个 Agent
 * Body: { agentId }
 */
router.post('/kick', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.status(503).json({ error: 'Agent Network not enabled' });
  }

  const { agentId } = req.body;
  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  network.kickAgent(agentId);
  res.json({ success: true });
});

/**
 * POST /api/network/connect
 * 手动连接 Agent（mDNS 不可靠时的备选方案）
 * Body: { endpoint: "ip:port" }
 */
router.post('/connect', async (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) {
    return res.status(503).json({ error: 'Agent Network not enabled' });
  }

  const { endpoint } = req.body;
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'endpoint (string, e.g. "192.168.1.100:7860") is required' });
  }

  try {
    const agent = await network.connectManually(endpoint);
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// ===== 清除聊天记录 =====

/**
 * DELETE /api/network/audit
 * 清除所有聊天记录
 * Query: ?agentId=xxx (可选，只清除与指定 Agent 的记录)
 */
router.delete('/audit', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.status(503).json({ error: 'Agent Network not enabled' });

  const agentId = req.query.agentId as string | undefined;
  const deleted = network.clearAuditLog(agentId);
  res.json({ success: true, deleted });
});

// ===== 聊天消息 API =====

/**
 * GET /api/network/conversations
 * 获取所有会话摘要列表
 */
router.get('/conversations', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.json([]);
  res.json(network.getConversations());
});

/**
 * GET /api/network/messages
 * 获取某个会话的消息列表
 * Query: conversationId (required), limit?, before? (timestamp)
 */
router.get('/messages', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.json([]);

  const conversationId = req.query.conversationId as string;
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const before = req.query.before ? parseInt(req.query.before as string) : undefined;

  res.json(network.getMessages(conversationId, limit, before));
});

/**
 * DELETE /api/network/messages
 * 清除某个会话的聊天消息
 * Query: conversationId (required)
 */
router.delete('/messages', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.status(503).json({ error: 'Agent Network not enabled' });

  const conversationId = req.query.conversationId as string;
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  const deleted = network.clearConversation(conversationId);
  res.json({ success: true, deleted });
});

// ===== 群组发送 =====

/**
 * POST /api/network/group-send
 * 向群组所有成员广播消息
 * Body: { groupId, method, params? }
 */
router.post('/group-send', async (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.status(503).json({ error: 'Agent Network not enabled' });

  const { groupId, method, params } = req.body;
  if (!groupId || !method) {
    return res.status(400).json({ error: 'groupId and method are required' });
  }

  const groups = network.getGroups();
  const group = groups.find(g => g.id === groupId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }

  // Tag params with group info so receivers know they're in a group
  const taggedParams = {
    ...params,
    _groupId: groupId,
    _groupName: group.name,
    _groupMembers: group.members,
  };

  const results: Array<{ agentId: string; success: boolean; error?: string }> = [];
  for (const memberId of group.members) {
    try {
      await network.sendRequest(memberId, method, taggedParams);
      results.push({ agentId: memberId, success: true });
    } catch (error) {
      results.push({
        agentId: memberId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.json({ success: true, results });
});

// ===== 群组 CRUD =====

/**
 * GET /api/network/groups
 */
router.get('/groups', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.json([]);
  res.json(network.getGroups());
});

/**
 * POST /api/network/groups
 * Body: { name, members: string[] }
 */
router.post('/groups', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.status(503).json({ error: 'Agent Network not enabled' });

  const { name, members } = req.body;
  if (!name || !Array.isArray(members)) {
    return res.status(400).json({ error: 'name (string) and members (string[]) are required' });
  }

  const group = network.createGroup(name, members);
  res.json(group);
});

/**
 * PUT /api/network/groups/:id
 * Body: { name?, members? }
 */
router.put('/groups/:id', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.status(503).json({ error: 'Agent Network not enabled' });

  const { name, members } = req.body;
  network.updateGroup(req.params.id, { name, members });
  res.json({ success: true });
});

/**
 * DELETE /api/network/groups/:id
 */
router.delete('/groups/:id', (req: Request, res: Response) => {
  const network = getNetwork(req);
  if (!network) return res.status(503).json({ error: 'Agent Network not enabled' });

  network.deleteGroup(req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/network/toggle
 * 启用或停用 Agent Network
 * Body: { enabled: boolean }
 */
router.post('/toggle', async (req: Request, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }

  try {
    const currentNetwork = getNetwork(req);

    if (enabled && !currentNetwork) {
      // 启动 Agent Network
      const { AgentNetwork: AgentNetworkClass } = await import('../../../network/index.js');
      const { broadcastMessage } = await import('../websocket.js');
      const { VERSION } = await import('../../../version.js');

      const networkConfig = (configManager.getAll() as any)?.network || {};
      const network = new AgentNetworkClass();
      await network.start(
        {
          enabled: true,
          port: networkConfig.port || 7860,
          advertise: networkConfig.advertise !== false,
          autoAcceptSameOwner: networkConfig.autoAcceptSameOwner !== false,
          name: networkConfig.name,
        },
        process.cwd(),
        VERSION,
      );

      // 转发事件到前端
      network.on('agent:found', (agent: any) => broadcastMessage({ type: 'network:agent_found', payload: agent }));
      network.on('agent:lost', (agentId: string) => broadcastMessage({ type: 'network:agent_lost', payload: { agentId } }));
      network.on('agent:updated', (agent: any) => broadcastMessage({ type: 'network:agent_updated', payload: agent }));
      network.on('message', (entry: any) => broadcastMessage({ type: 'network:message', payload: entry }));
      network.on('trust_request', (agent: any) => broadcastMessage({ type: 'network:trust_request', payload: agent }));
      network.on('chat:message', (msg: any) => broadcastMessage({ type: 'network:chat_message', payload: msg }));

      req.app.locals.agentNetwork = network;

      // 持久化配置
      configManager.save({ network: { ...networkConfig, enabled: true } });

      res.json({ success: true, enabled: true });
    } else if (!enabled && currentNetwork) {
      // 停止 Agent Network
      await currentNetwork.stop();
      req.app.locals.agentNetwork = null;

      // 持久化配置
      const networkConfig = (configManager.getAll() as any)?.network || {};
      configManager.save({ network: { ...networkConfig, enabled: false } });

      res.json({ success: true, enabled: false });
    } else {
      // 已经是目标状态
      res.json({ success: true, enabled });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
