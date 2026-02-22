/**
 * Extension Relay Server
 * 
 * WebSocket relay that bridges Playwright CDP clients with Chrome extension debugger API.
 * This allows Playwright to control Chrome without being detected by anti-automation.
 */

import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { resolveRelayAuthToken, verifyRelayAuthToken } from './extension-relay-auth.js';

interface RelayServer {
  port: number;
  httpServer: http.Server;
  extensionWss: WebSocketServer;
  cdpWss: WebSocketServer;
  extensionSocket: WebSocket | null;
  cdpClients: Set<WebSocket>;
  connectedTargets: Map<string, any>;
  messageId: number;
  stop: () => Promise<void>;
}

let activeServer: RelayServer | null = null;

/**
 * Ensure extension relay server is running
 */
export function ensureExtensionRelayServer(options: { port: number }): RelayServer {
  if (activeServer && activeServer.port === options.port) {
    return activeServer;
  }

  if (activeServer) {
    // Stop existing server on different port
    activeServer.stop();
  }

  const server = createRelayServer(options.port);
  activeServer = server;
  return server;
}

/**
 * Stop extension relay server
 */
export async function stopExtensionRelayServer(): Promise<void> {
  if (activeServer) {
    await activeServer.stop();
    activeServer = null;
  }
}

/**
 * Create relay server
 */
function createRelayServer(port: number): RelayServer {
  const connectedTargets = new Map<string, any>();
  let extensionSocket: WebSocket | null = null;
  const cdpClients = new Set<WebSocket>();
  let messageId = 1;

  // Create HTTP server
  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    // Handle CDP HTTP endpoints
    if (url.pathname === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        Browser: 'Chrome/131.0.0.0',
        'Protocol-Version': '1.3',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'V8-Version': '13.1.0',
        'WebKit-Version': '537.36',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/cdp`,
      }));
    } else if (url.pathname === '/json' || url.pathname === '/json/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const targets = Array.from(connectedTargets.values()).map((target) => ({
        id: target.targetId,
        type: target.targetInfo?.type || 'page',
        title: target.targetInfo?.title || '',
        url: target.targetInfo?.url || '',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/cdp?target=${target.targetId}`,
      }));
      res.end(JSON.stringify(targets));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  // WebSocket server for extension connection
  const extensionWss = new WebSocketServer({ noServer: true });
  
  extensionWss.on('connection', (ws, req) => {
    console.log('[Relay] Extension connected');
    
    // Only allow one extension connection
    if (extensionSocket) {
      extensionSocket.close();
    }
    extensionSocket = ws;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleExtensionMessage(message);
      } catch (error) {
        console.error('[Relay] Failed to parse extension message:', error);
      }
    });

    ws.on('close', () => {
      console.log('[Relay] Extension disconnected');
      if (extensionSocket === ws) {
        extensionSocket = null;
      }
    });

    ws.on('error', (error) => {
      console.error('[Relay] Extension WebSocket error:', error);
    });
  });

  // WebSocket server for CDP clients (Playwright)
  const cdpWss = new WebSocketServer({ noServer: true });
  
  cdpWss.on('connection', (ws, req) => {
    console.log('[Relay] CDP client connected');
    cdpClients.add(ws);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleCDPMessage(ws, message);
      } catch (error) {
        console.error('[Relay] Failed to parse CDP message:', error);
      }
    });

    ws.on('close', () => {
      console.log('[Relay] CDP client disconnected');
      cdpClients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[Relay] CDP client WebSocket error:', error);
    });
  });

  // Handle HTTP upgrade for WebSocket
  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const token = url.searchParams.get('token') || '';

    // Verify loopback connection
    const remoteAddress = (socket as any).remoteAddress;
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') {
      console.warn('[Relay] Rejected non-loopback connection from:', remoteAddress);
      socket.destroy();
      return;
    }

    // Route to appropriate WebSocket server
    if (url.pathname === '/extension') {
      // Verify auth token for extension
      if (!verifyRelayAuthToken(port, token)) {
        console.warn('[Relay] Invalid extension auth token');
        socket.destroy();
        return;
      }
      extensionWss.handleUpgrade(request, socket, head, (ws) => {
        extensionWss.emit('connection', ws, request);
      });
    } else if (url.pathname === '/cdp') {
      // CDP clients don't require auth (localhost only)
      cdpWss.handleUpgrade(request, socket, head, (ws) => {
        cdpWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  /**
   * Handle messages from extension
   */
  function handleExtensionMessage(message: any) {
    const { type } = message;

    switch (type) {
      case 'targetAttached':
        connectedTargets.set(message.targetId, {
          targetId: message.targetId,
          targetInfo: message.targetInfo,
        });
        // Notify CDP clients
        broadcastToCDPClients({
          method: 'Target.attachedToTarget',
          params: {
            sessionId: message.targetId,
            targetInfo: {
              targetId: message.targetId,
              type: message.targetInfo?.type || 'page',
              title: message.targetInfo?.title || '',
              url: message.targetInfo?.url || '',
            },
          },
        });
        break;

      case 'targetDetached':
        connectedTargets.delete(message.targetId);
        broadcastToCDPClients({
          method: 'Target.detachedFromTarget',
          params: {
            sessionId: message.targetId,
            targetId: message.targetId,
          },
        });
        break;

      case 'cdpResult':
      case 'cdpError':
        // Forward result/error to CDP clients
        broadcastToCDPClients(message);
        break;

      case 'cdpEvent':
        // Forward CDP event to CDP clients
        broadcastToCDPClients(message);
        break;

      case 'pong':
        // Heartbeat response
        break;

      default:
        console.warn('[Relay] Unknown extension message type:', type);
    }
  }

  /**
   * Handle messages from CDP clients
   */
  function handleCDPMessage(client: WebSocket, message: any) {
    const { id, method, params } = message;

    // Handle local CDP methods
    if (method === 'Browser.getVersion') {
      sendToCDPClient(client, {
        id,
        result: {
          protocolVersion: '1.3',
          product: 'Chrome/131.0.0.0',
          revision: '@0',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          jsVersion: '13.1.0',
        },
      });
      return;
    }

    if (method === 'Target.setAutoAttach') {
      sendToCDPClient(client, { id, result: {} });
      return;
    }

    if (method === 'Target.getTargets') {
      const targets = Array.from(connectedTargets.values()).map((target) => ({
        targetId: target.targetId,
        type: target.targetInfo?.type || 'page',
        title: target.targetInfo?.title || '',
        url: target.targetInfo?.url || '',
      }));
      sendToCDPClient(client, { id, result: { targetInfos: targets } });
      return;
    }

    // Forward command to extension
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      sendToCDPClient(client, {
        id,
        error: { code: -32000, message: 'Extension not connected' },
      });
      return;
    }

    // Get target ID (use first target if not specified)
    let targetId = params?.sessionId || params?.targetId;
    if (!targetId) {
      const firstTarget = connectedTargets.values().next().value;
      targetId = firstTarget?.targetId;
    }

    if (!targetId) {
      sendToCDPClient(client, {
        id,
        error: { code: -32000, message: 'No target available' },
      });
      return;
    }

    sendToExtension({
      type: 'forwardCDPCommand',
      id,
      method,
      params: params || {},
      targetId,
    });
  }

  /**
   * Send message to extension
   */
  function sendToExtension(message: any) {
    if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
      extensionSocket.send(JSON.stringify(message));
    }
  }

  /**
   * Send message to specific CDP client
   */
  function sendToCDPClient(client: WebSocket, message: any) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all CDP clients
   */
  function broadcastToCDPClients(message: any) {
    cdpClients.forEach((client) => {
      sendToCDPClient(client, message);
    });
  }

  // Start server
  httpServer.listen(port, '127.0.0.1', () => {
    console.log(`[Relay] Server listening on http://127.0.0.1:${port}`);
  });

  // Return server interface
  const server: RelayServer = {
    port,
    httpServer,
    extensionWss,
    cdpWss,
    extensionSocket: null,
    cdpClients,
    connectedTargets,
    messageId,
    stop: async () => {
      // Close all connections
      extensionSocket?.close();
      cdpClients.forEach((client) => client.close());
      
      // Close WebSocket servers
      extensionWss.close();
      cdpWss.close();

      // Close HTTP server
      return new Promise<void>((resolve) => {
        httpServer.close(() => {
          console.log('[Relay] Server stopped');
          resolve();
        });
      });
    },
  };

  Object.defineProperty(server, 'extensionSocket', {
    get: () => extensionSocket,
  });

  return server;
}
