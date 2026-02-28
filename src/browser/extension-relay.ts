/**
 * Chrome Extension Relay Server
 * 
 * Complete CDP browser-level protocol emulation for anti-detection mode.
 * Adapted from OpenClaw (MIT License).
 * 
 * Architecture:
 * - Extension connects to /extension endpoint via WebSocket
 * - CDP clients (Playwright) connect to /cdp endpoint
 * - Relay simulates Browser.* and Target.* CDP commands
 * - Relay forwards page-level commands to extension via forwardCDPCommand message
 * - Extension executes via chrome.debugger API and responds via forwardCDPEvent
 * - Relay maintains connectedTargets Map for Target.getTargets etc.
 * 
 * This enables Playwright to control Chrome through extension's debugger API,
 * bypassing navigator.webdriver detection.
 */

import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { resolveRelayAuthToken } from './extension-relay-auth.js';

// ========================================================================
// Types
// ========================================================================

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
  canAccessOpener?: boolean;
}

interface ConnectedTarget {
  targetId: string;
  sessionId: string;
  targetInfo: TargetInfo;
}

interface PendingExtensionRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ClientTargetSubscription {
  autoAttach?: boolean;
  discover?: boolean;
}

export interface ChromeExtensionRelayServer {
  host: string;
  port: number;
  baseUrl: string;
  cdpWsUrl: string;
  extensionConnected: () => boolean;
  targetCount: () => number;
  stop: () => Promise<void>;
}

// ========================================================================
// Constants
// ========================================================================

// Default browser context ID for extension-attached targets.
// Chrome CDP provides a real browserContextId per context; we use a fixed UUID
// because extension-based targets don't have a native context ID.
// Playwright requires this field (asserts it in crBrowser._onAttachedToTarget).
const DEFAULT_BROWSER_CONTEXT_ID = 'EBC0C30E2D0B1FA4BAB30B1F84AD42E6';

// ========================================================================
// Server Registry
// ========================================================================

// Global registry: cdpUrl -> server
const activeServers = new Map<string, ChromeExtensionRelayServer>();

/**
 * Ensure extension relay server is running
 */
export async function ensureChromeExtensionRelayServer(opts: {
  cdpUrl: string;
}): Promise<ChromeExtensionRelayServer> {
  const normalized = opts.cdpUrl.replace(/\/$/, '');

  // Return existing server if already running
  if (activeServers.has(normalized)) {
    return activeServers.get(normalized)!;
  }

  // Parse cdpUrl to get host and port
  const url = new URL(normalized);
  const host = url.hostname;
  const port = parseInt(url.port, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in cdpUrl: ${opts.cdpUrl}`);
  }

  const server = await createRelayServer(host, port);
  activeServers.set(normalized, server);
  return server;
}

/**
 * Stop extension relay server
 */
export async function stopChromeExtensionRelayServer(opts: {
  cdpUrl: string;
}): Promise<boolean> {
  const normalized = opts.cdpUrl.replace(/\/$/, '');
  const server = activeServers.get(normalized);
  if (!server) return false;

  await server.stop();
  activeServers.delete(normalized);
  return true;
}

// ========================================================================
// Server Implementation
// ========================================================================

async function createRelayServer(
  host: string,
  port: number,
): Promise<ChromeExtensionRelayServer> {
  const authToken = resolveRelayAuthToken(port);

  // Verbose CDP logging — only when CLAUDE_VERBOSE or RELAY_VERBOSE is set
  const verbose = process.env.CLAUDE_VERBOSE === 'true' || process.env.RELAY_VERBOSE === 'true';
  
  // State
  const connectedTargets = new Map<string, ConnectedTarget>();
  const clientSubscriptions = new Map<WebSocket, ClientTargetSubscription>();
  // Maps original targetId (e.g. Chrome tab ID) → corrected targetId (mainFrameId)
  // Used by Target.detachedFromTarget and Target.targetInfoChanged to find the right entry
  const targetIdRemapping = new Map<string, string>();
  // Guards against concurrent async handling of duplicate Target.attachedToTarget
  // events for the same sessionId.  The first event claims the sessionId; any
  // subsequent event arriving before the first finishes is dropped immediately.
  const pendingTargetAttach = new Set<string>();
  let extensionSocket: WebSocket | null = null;
  const cdpClients = new Set<WebSocket>();
  
  // Message IDs
  let nextExtensionId = 1;
  const pendingExtension = new Map<number, PendingExtensionRequest>();
  
  // Ping interval
  let pingInterval: NodeJS.Timeout | null = null;

  // ======================================================================
  // Session Event Ordering
  // ======================================================================
  //
  // Playwright's FrameSession._initialize() sends Page.getFrameTree and
  // Runtime.enable in parallel. The frame tree response registers event
  // listeners for Runtime.executionContextCreated. If the Runtime.enable
  // response (and subsequent events) arrives before Page.getFrameTree,
  // the execution context events are silently discarded because the frame
  // hasn't been created yet.
  //
  // In direct Chrome CDP this doesn't happen because responses travel
  // over a single WebSocket in order. In our relay, commands are forwarded
  // to the extension in parallel, so responses can arrive out of order.
  //
  // Fix: buffer Runtime.executionContext* events while Page.getFrameTree
  // is pending for a session. Flush after the frame tree response is sent.
  // ======================================================================

  /** Sessions with a pending Page.getFrameTree command. */
  const sessionsPendingFrameTree = new Set<string>();
  /** Buffered events per session while frame tree is pending. */
  const sessionEventBuffer = new Map<string, any[]>();

  /** Events to buffer while frame tree is being processed. */
  const BUFFERED_EVENTS = new Set([
    'Runtime.executionContextCreated',
    'Runtime.executionContextDestroyed',
    'Runtime.executionContextsCleared',
  ]);

  function bufferEventForSession(sessionId: string, message: any): boolean {
    if (!sessionId || !sessionsPendingFrameTree.has(sessionId)) return false;
    const eventMethod = message.method;
    if (!BUFFERED_EVENTS.has(eventMethod)) return false;

    let buf = sessionEventBuffer.get(sessionId);
    if (!buf) {
      buf = [];
      sessionEventBuffer.set(sessionId, buf);
    }
    buf.push(message);
    if (verbose) console.log(`[Relay] Buffered ${eventMethod} for session ${sessionId} (${buf.length} buffered)`);
    return true;
  }

  function flushSessionEvents(sessionId: string): void {
    sessionsPendingFrameTree.delete(sessionId);
    const buf = sessionEventBuffer.get(sessionId);
    if (!buf || buf.length === 0) {
      sessionEventBuffer.delete(sessionId);
      return;
    }
    sessionEventBuffer.delete(sessionId);
    if (verbose) console.log(`[Relay] Flushing ${buf.length} buffered events for session ${sessionId}`);
    for (const msg of buf) {
      broadcastToCDPClients(msg);
    }
  }

  // ======================================================================
  // HTTP Server
  // ======================================================================

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    // Normalize trailing slashes (Playwright requests /json/version/)
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // CORS headers for localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-claude-relay-token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // /json/* endpoints: no auth required (loopback-only is sufficient).
    // Playwright connectOverCDP fetches /json/version internally and cannot send custom headers.
    // Security is ensured by loopback binding + /extension and /cdp WS auth.

    // GET /json/version
    if (pathname === '/json/version') {
      // Only return wsUrl if extension is connected
      if (!extensionSocket) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Extension not connected' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        Browser: 'Chrome/131.0.0.0',
        'Protocol-Version': '1.3',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'V8-Version': '13.1.0',
        'WebKit-Version': '537.36',
        webSocketDebuggerUrl: `ws://${host}:${port}/cdp`,
      }));
      return;
    }

    // GET /json, /json/list
    if (pathname === '/json' || pathname === '/json/list') {
      const targets = Array.from(connectedTargets.values()).map((target) => ({
        id: target.targetId,
        type: target.targetInfo.type,
        title: target.targetInfo.title,
        url: target.targetInfo.url,
        webSocketDebuggerUrl: `ws://${host}:${port}/cdp`,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(targets));
      return;
    }

    // GET /json/activate/:targetId
    if (pathname.startsWith('/json/activate/')) {
      const targetId = pathname.replace('/json/activate/', '');
      sendToExtension({
        method: 'forwardCDPCommand',
        params: {
          method: 'Target.activateTarget',
          params: { targetId },
        },
      }).catch(() => {});
      
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Target activated');
      return;
    }

    // GET /json/close/:targetId
    if (pathname.startsWith('/json/close/')) {
      const targetId = pathname.replace('/json/close/', '');
      sendToExtension({
        method: 'forwardCDPCommand',
        params: {
          method: 'Target.closeTarget',
          params: { targetId },
        },
      }).catch(() => {});
      
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Target closed');
      return;
    }

    // GET /extension/status
    if (pathname === '/extension/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: extensionSocket !== null }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  });

  // Handle client connection errors (e.g. ECONNRESET when Chrome is force-killed)
  httpServer.on('clientError', (err, socket) => {
    console.warn('[Relay] Client error (ignored):', err.message);
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  // ======================================================================
  // WebSocket Servers
  // ======================================================================

  // Extension WebSocket
  const extensionWss = new WebSocketServer({ noServer: true });
  extensionWss.on('error', (err) => {
    console.error('[Relay] Extension WSS error (non-fatal):', err.message);
  });

  extensionWss.on('connection', (ws, req) => {
    console.log('[Relay] Extension connected');

    // Only allow one extension connection
    if (extensionSocket) {
      console.log('[Relay] Closing previous extension connection');
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
      stopPing();
    });

    ws.on('error', (error) => {
      console.error('[Relay] Extension WebSocket error:', error);
    });

    // Start ping
    startPing();
  });

  // CDP Client WebSocket
  const cdpWss = new WebSocketServer({ noServer: true });
  cdpWss.on('error', (err) => {
    console.error('[Relay] CDP WSS error (non-fatal):', err.message);
  });

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
      clientSubscriptions.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[Relay] CDP client WebSocket error:', error);
    });
  });

  // HTTP Upgrade Handler
  httpServer.on('upgrade', (request, socket, head) => {
    // Prevent unhandled socket errors (e.g. ECONNRESET when Chrome is killed)
    socket.on('error', (err) => {
      console.warn('[Relay] Upgrade socket error (ignored):', err.message);
    });

    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const wsPathname = url.pathname.replace(/\/+$/, '') || '/';

    // Verify loopback connection
    const remoteAddress = (socket as any).remoteAddress;
    if (
      remoteAddress !== '127.0.0.1' &&
      remoteAddress !== '::1' &&
      remoteAddress !== '::ffff:127.0.0.1'
    ) {
      console.warn('[Relay] Rejected non-loopback connection from:', remoteAddress);
      socket.destroy();
      return;
    }

    // Route to appropriate WebSocket server
    if (wsPathname === '/extension') {
      // Verify auth token
      const token = url.searchParams.get('token') || '';
      if (token !== authToken) {
        console.warn('[Relay] Invalid extension auth token');
        socket.destroy();
        return;
      }

      // Verify origin (chrome-extension only)
      const origin = request.headers.origin || '';
      if (origin && !origin.startsWith('chrome-extension://')) {
        console.warn('[Relay] Invalid origin for extension:', origin);
        socket.destroy();
        return;
      }

      extensionWss.handleUpgrade(request, socket, head, (ws) => {
        extensionWss.emit('connection', ws, request);
      });
    } else if (wsPathname === '/cdp') {
      // Verify auth token (query param or header)
      const queryToken = url.searchParams.get('token') || '';
      const headerToken = request.headers['x-claude-relay-token'] as string;
      const token = headerToken || queryToken;

      if (token && token !== authToken) {
        console.warn('[Relay] Invalid CDP auth token');
        socket.destroy();
        return;
      }

      cdpWss.handleUpgrade(request, socket, head, (ws) => {
        cdpWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // ======================================================================
  // Message Handlers
  // ======================================================================

  /**
   * Handle messages from extension
   */
  function handleExtensionMessage(message: any) {
    const { id, method, params, result, error } = message;

    // Handle pong
    if (method === 'pong') {
      return;
    }

    if (verbose) console.log(`[Relay] EXT <<< ${method || 'response'}`, id !== undefined ? `id=${id}` : '', params ? JSON.stringify(params).substring(0, 200) : '');

    // Handle forwardCDPEvent
    if (method === 'forwardCDPEvent') {
      const { method: eventMethod, params: eventParams, sessionId } = params || {};

      // Update connectedTargets from Target.* events
      if (eventMethod === 'Target.attachedToTarget') {
        const { sessionId: sid, targetInfo } = eventParams || {};
        if (sid && targetInfo && targetInfo.type === 'page') {
          // --- Race-condition guard ---
          // The async block below awaits Page.getFrameTree.  If the extension
          // fires two attachedToTarget events for the same sessionId before the
          // first one completes, both would pass the connectedTargets.has()
          // check and both would broadcast, causing Playwright to assert on
          // "Duplicate target".  We use pendingTargetAttach as a synchronous
          // lock keyed by sessionId to ensure only the first event proceeds.
          if (pendingTargetAttach.has(sid)) {
            console.log(`[Relay] Dropping duplicate Target.attachedToTarget for session ${sid} (async handling in progress)`);
            return;
          }

          // Also check if we already have this target by sessionId
          // (the targetId isn't resolved yet, but sessionId is unique per tab)
          const alreadyKnownBySession = Array.from(connectedTargets.values()).some(t => t.sessionId === sid);
          if (alreadyKnownBySession) {
            console.log(`[Relay] Target.attachedToTarget for already-known session ${sid}, updating metadata only`);
            // Update targetInfo in-place for the existing entry
            for (const [key, t] of connectedTargets.entries()) {
              if (t.sessionId === sid) {
                t.targetInfo.url = targetInfo.url || t.targetInfo.url;
                t.targetInfo.title = targetInfo.title || t.targetInfo.title;
                broadcastToCDPClients({
                  method: 'Target.targetInfoChanged',
                  params: { targetInfo: t.targetInfo },
                });
                break;
              }
            }
            return;
          }

          pendingTargetAttach.add(sid);

          // Playwright requires browserContextId — inject a default one
          if (!targetInfo.browserContextId) {
            targetInfo.browserContextId = DEFAULT_BROWSER_CONTEXT_ID;
          }

          // CRITICAL FIX: Playwright's CRPage._sessions uses targetId as key,
          // and _sessionForFrame looks up frame._id in that map.
          // The extension uses Chrome tab ID as targetId, but Playwright expects
          // targetId === mainFrameId (the CDP frame ID of the main frame).
          // We must query Page.getFrameTree to get the real mainFrameId and
          // replace targetId before storing/broadcasting.
          const originalTargetId = targetInfo.targetId;
          (async () => {
            try {
              const frameTreeResult = await sendToExtension({
                method: 'forwardCDPCommand',
                params: {
                  method: 'Page.getFrameTree',
                  params: {},
                  sessionId: sid,
                },
              });
              const mainFrameId = frameTreeResult?.frameTree?.frame?.id;
              if (mainFrameId && mainFrameId !== originalTargetId) {
                console.log(`[Relay] Replacing targetId: ${originalTargetId} → ${mainFrameId}`);
                targetInfo.targetId = mainFrameId;
                eventParams.targetInfo = targetInfo;
                // Record remapping so Target.detachedFromTarget can find the right entry
                targetIdRemapping.set(originalTargetId, mainFrameId);
              }
            } catch (e: any) {
              console.warn('[Relay] Failed to get mainFrameId, keeping original targetId:', e?.message);
            }

            // Final dedup check by targetId — belt-and-suspenders guard in case
            // two different sessionIds somehow resolve to the same mainFrameId.
            if (connectedTargets.has(targetInfo.targetId)) {
              console.log('[Relay] Target already known by targetId after frameTree resolve:', targetInfo.targetId);
              pendingTargetAttach.delete(sid);
              return;
            }

            // Store with (possibly updated) targetId
            connectedTargets.set(targetInfo.targetId, {
              targetId: targetInfo.targetId,
              sessionId: sid,
              targetInfo,
            });
            console.log('[Relay] Target attached:', targetInfo.targetId, 'sessionId:', sid);

            // Broadcast the event (with corrected targetId) to any already-connected CDP clients
            broadcastToCDPClients({
              method: eventMethod,
              params: eventParams,
              sessionId,
            });

            pendingTargetAttach.delete(sid);
          })();
          return; // Don't broadcast synchronously; the async block above will do it
        }
      } else if (eventMethod === 'Target.detachedFromTarget') {
        let { targetId } = eventParams || {};
        if (targetId) {
          // Resolve remapped targetId (extension may send original tab ID)
          const remapped = targetIdRemapping.get(targetId);
          if (remapped) {
            targetId = remapped;
            eventParams.targetId = remapped;
            targetIdRemapping.delete(targetId);
          }
          // Clean up pending lock (in case detach races with attach)
          const detachedTarget = connectedTargets.get(targetId);
          if (detachedTarget) {
            pendingTargetAttach.delete(detachedTarget.sessionId);
          }
          connectedTargets.delete(targetId);
          console.log('[Relay] Target detached:', targetId);
        }
      } else if (eventMethod === 'Target.targetInfoChanged') {
        const { targetInfo } = eventParams || {};
        if (targetInfo && targetInfo.targetId) {
          // Resolve remapped targetId
          const remapped = targetIdRemapping.get(targetInfo.targetId);
          if (remapped) {
            targetInfo.targetId = remapped;
            eventParams.targetInfo = targetInfo;
          }
          const existing = connectedTargets.get(targetInfo.targetId);
          if (existing) {
            existing.targetInfo = targetInfo;
          }
        }
      }

      // Buffer Runtime.executionContext* events while Page.getFrameTree is pending.
      // This prevents Playwright from losing execution contexts during initialization.
      const eventMessage = {
        method: eventMethod,
        params: eventParams || {},
        sessionId,
      };
      if (sessionId && bufferEventForSession(sessionId, eventMessage)) {
        return; // Event buffered, will be flushed after Page.getFrameTree response
      }

      // Broadcast event to all CDP clients
      broadcastToCDPClients(eventMessage);
      return;
    }

    // Handle command responses
    if (id !== undefined) {
      const pending = pendingExtension.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingExtension.delete(id);

        if (error) {
          pending.reject(new Error(error.message || 'Extension command failed'));
        } else {
          pending.resolve(result || {});
        }
      }
      return;
    }

    console.warn('[Relay] Unknown extension message:', message);
  }

  /**
   * Handle messages from CDP clients
   */
  async function handleCDPMessage(client: WebSocket, message: any) {
    const { id, method, params, sessionId } = message;
    if (verbose) console.log(`[Relay] CDP <<< ${method}`, params ? JSON.stringify(params).substring(0, 200) : '', 'targets:', connectedTargets.size);

    // Track Page.getFrameTree commands to buffer Runtime events during init.
    const isFrameTree = method === 'Page.getFrameTree' && sessionId;
    if (isFrameTree) {
      sessionsPendingFrameTree.add(sessionId);
      if (verbose) console.log(`[Relay] Page.getFrameTree pending for session ${sessionId}`);
    }

    try {
      // Route CDP command
      const result = await routeCdpCommand(client, method, params, sessionId);
      
      // Send response
      const response: any = { id, result };
      if (sessionId) response.sessionId = sessionId;
      const resultStr = JSON.stringify(result || {});
      if (verbose) console.log(`[Relay] CDP >>> id=${id} ${method} ${sessionId ? 'sid=' + sessionId : ''}`, resultStr.substring(0, method === 'Page.getFrameTree' ? 5000 : 200));
      sendToCDPClient(client, response);

      // After sending Page.getFrameTree response, flush buffered events.
      // Playwright's .then() callback will process the frame tree (creating frames)
      // before the flushed events are processed (microtask ordering).
      if (isFrameTree) {
        flushSessionEvents(sessionId);
      }
    } catch (error: any) {
      // Send error response
      const response: any = {
        id,
        error: {
          code: error.code || -32000,
          message: error.message || 'Unknown error',
        },
      };
      if (sessionId) response.sessionId = sessionId;
      sendToCDPClient(client, response);

      // Also flush on error to avoid leaking buffered events
      if (isFrameTree) {
        flushSessionEvents(sessionId);
      }
    }
  }

  /**
   * Route CDP command (simulate browser-level commands or forward to extension)
   */
  async function routeCdpCommand(
    client: WebSocket,
    method: string,
    params: any = {},
    sessionId?: string,
  ): Promise<any> {
    // Browser.getVersion
    if (method === 'Browser.getVersion') {
      return {
        protocolVersion: '1.3',
        product: 'Chrome/131.0.0.0',
        revision: '@0',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        jsVersion: '13.1.0',
      };
    }

    // Browser.setDownloadBehavior
    if (method === 'Browser.setDownloadBehavior') {
      return {};
    }

    // Browser.getWindowForTarget - Playwright calls this during page init.
    // chrome.debugger can't execute browser-level commands, so simulate it.
    if (method === 'Browser.getWindowForTarget') {
      return { windowId: 1, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'normal' } };
    }

    // Browser.getWindowBounds
    if (method === 'Browser.getWindowBounds') {
      return { bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'normal' } };
    }

    // Target.setAutoAttach
    if (method === 'Target.setAutoAttach') {
      ensureTargetEventsForClient(client, 'autoAttach');
      return {};
    }

    // Target.setDiscoverTargets
    if (method === 'Target.setDiscoverTargets') {
      ensureTargetEventsForClient(client, 'discover');
      return {};
    }

    // Target.getTargets
    if (method === 'Target.getTargets') {
      const targetInfos = Array.from(connectedTargets.values()).map((target) => ({
        targetId: target.targetId,
        type: target.targetInfo.type,
        title: target.targetInfo.title,
        url: target.targetInfo.url,
        attached: target.targetInfo.attached || false,
        canAccessOpener: target.targetInfo.canAccessOpener || false,
      }));
      return { targetInfos };
    }

    // Target.getTargetInfo
    if (method === 'Target.getTargetInfo') {
      const { targetId } = params || {};
      if (!targetId) {
        // No targetId = requesting browser target info (Playwright does this after setAutoAttach)
        return {
          targetInfo: {
            targetId: 'browser',
            type: 'browser',
            title: '',
            url: '',
            attached: true,
            canAccessOpener: false,
          },
        };
      }
      const target = connectedTargets.get(targetId);
      if (!target) {
        throw new Error(`Target not found: ${targetId}`);
      }
      return { targetInfo: target.targetInfo };
    }

    // Target.attachToTarget
    if (method === 'Target.attachToTarget') {
      const { targetId } = params;
      const target = connectedTargets.get(targetId);
      if (!target) {
        throw new Error(`Target not found: ${targetId}`);
      }

      // Send attachedToTarget event to client
      sendToCDPClient(client, {
        method: 'Target.attachedToTarget',
        params: {
          sessionId: target.sessionId,
          targetInfo: target.targetInfo,
          waitingForDebugger: false,
        },
      });

      return { sessionId: target.sessionId };
    }

    // Forward all other commands to extension
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      throw Object.assign(new Error('Extension not connected'), { code: -32000 });
    }

    return await sendToExtension({
      method: 'forwardCDPCommand',
      params: { method, params, sessionId },
    });
  }

  /**
   * Ensure target events are sent to client based on subscription mode
   */
  function ensureTargetEventsForClient(client: WebSocket, mode: 'autoAttach' | 'discover') {
    let subscription = clientSubscriptions.get(client);
    if (!subscription) {
      subscription = {};
      clientSubscriptions.set(client, subscription);
    }

    const isFirstSubscription = !subscription.autoAttach && !subscription.discover;

    if (mode === 'autoAttach') {
      subscription.autoAttach = true;
    } else if (mode === 'discover') {
      subscription.discover = true;
    }

    // Send all current targets on first subscription
    if (isFirstSubscription) {
      for (const target of connectedTargets.values()) {
        if (mode === 'autoAttach') {
          sendToCDPClient(client, {
            method: 'Target.attachedToTarget',
            params: {
              sessionId: target.sessionId,
              targetInfo: target.targetInfo,
              waitingForDebugger: false,
            },
          });
        } else if (mode === 'discover') {
          sendToCDPClient(client, {
            method: 'Target.targetCreated',
            params: { targetInfo: target.targetInfo },
          });
        }
      }
    }
  }

  /**
   * Send command to extension and wait for response
   */
  function sendToExtension(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
        reject(new Error('Extension not connected'));
        return;
      }

      const id = nextExtensionId++;
      const timer = setTimeout(() => {
        pendingExtension.delete(id);
        reject(new Error('Extension command timeout'));
      }, 30000);

      pendingExtension.set(id, { resolve, reject, timer });
      extensionSocket.send(JSON.stringify({ id, ...message }));
    });
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
   * Broadcast message to all subscribed CDP clients.
   * Only forward events to clients that have registered via Target.setAutoAttach or Target.setDiscoverTargets.
   * This prevents Playwright from receiving events before it's ready to handle them.
   */
  function broadcastToCDPClients(message: any) {
    cdpClients.forEach((client) => {
      const subscription = clientSubscriptions.get(client);
      if (!subscription || (!subscription.autoAttach && !subscription.discover)) {
        return; // Client hasn't subscribed yet, don't send events
      }
      sendToCDPClient(client, message);
    });
  }

  /**
   * Start ping to extension
   */
  function startPing() {
    stopPing();
    pingInterval = setInterval(() => {
      if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
        extensionSocket.send(JSON.stringify({ method: 'ping', id: Date.now() }));
      }
    }, 5000);
  }

  /**
   * Stop ping
   */
  function stopPing() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  // ======================================================================
  // Server Lifecycle
  // ======================================================================

  // Start server
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      console.log(`[Relay] Server listening on http://${host}:${port}`);
      resolve();
    });
    httpServer.on('error', reject);
  });

  // Persistent error handler for runtime (the above only covers startup)
  httpServer.on('error', (err) => {
    console.error('[Relay] HTTP server error (non-fatal):', err.message);
  });

  // Return server interface
  const server: ChromeExtensionRelayServer = {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    cdpWsUrl: `ws://${host}:${port}/cdp`,
    extensionConnected: () => extensionSocket !== null,
    targetCount: () => connectedTargets.size,
    stop: async () => {
      console.log('[Relay] Stopping server...');

      // Stop ping
      stopPing();

      // Close connections
      if (extensionSocket) extensionSocket.close();
      cdpClients.forEach((client) => client.close());

      // Clear pending requests
      pendingExtension.forEach((pending) => {
        clearTimeout(pending.timer);
        pending.reject(new Error('Server stopped'));
      });
      pendingExtension.clear();

      // Close WebSocket servers
      extensionWss.close();
      cdpWss.close();

      // Close HTTP server
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          console.log('[Relay] Server stopped');
          resolve();
        });
      });
    },
  };

  return server;
}
