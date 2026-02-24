/**
 * Claude Code Browser Bridge - Background Service Worker
 * 
 * Complete CDP relay bridge implementation adapted from OpenClaw (MIT License).
 * Supports per-tab debugger attach/detach, session management, state persistence,
 * and robust reconnection logic.
 *
 * Architecture:
 * - User manually installs extension to their Chrome
 * - User clicks toolbar button to attach current tab
 * - Extension connects to local relay server via WebSocket
 * - Relay forwards CDP commands to extension, extension executes via chrome.debugger API
 * - Extension forwards CDP events and responses back to relay
 * - Playwright connects to relay, controls tabs through extension (anti-detection)
 */

import { reconnectDelayMs, buildRelayWsUrl, isRetryableReconnectError } from './background-utils.js';

// ========================================================================
// Configuration & State
// ========================================================================

const RELAY_HOST = '127.0.0.1';
const DEFAULT_RELAY_PORT = 18792;
const PREFLIGHT_TIMEOUT_MS = 2000;
const WEBSOCKET_TIMEOUT_MS = 10000;
const PING_INTERVAL_MS = 5000;
const KEEPALIVE_INTERVAL_MS = 30000;

// __RELAY_CONFIG_START__ (do not edit - replaced by installExtension)
const INJECTED_RELAY_PORT = 9223;
const INJECTED_GATEWAY_TOKEN = "70aae498aa81cdb63c37f5d561a9e1bfa1dd0208206132417bc0a3301c8b6d37";
// __RELAY_CONFIG_END__

// Tab states: 'attaching' | 'attached' | 'detaching' | 'detached'
const tabs = new Map(); // tabId -> { state, sessionId, targetId (mainFrameId), attachOrder }
const tabBySession = new Map(); // sessionId -> tabId
const childSessionToTab = new Map(); // child sessionId -> tabId
const tabOperationLocks = new Map(); // tabId -> Promise
let nextSessionId = 1000;

/**
 * Find tabId by targetId (mainFrameId).
 * Since targetId is now the CDP main frame ID (not the numeric tab ID),
 * we need to search through tabs map to find the matching entry.
 */
function findTabIdByTargetId(targetId) {
  // First try parsing as numeric tab ID (backwards compat)
  const numericId = parseInt(targetId, 10);
  if (!isNaN(numericId) && tabs.has(numericId)) return numericId;
  // Then search by targetId (mainFrameId)
  for (const [tabId, state] of tabs.entries()) {
    if (state.targetId === targetId) return tabId;
  }
  return null;
}
let nextAttachOrder = 1;

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let pingTimer = null;
let keepaliveAlarm = null;

let relayPort = DEFAULT_RELAY_PORT;
let gatewayToken = '';
let isReady = false;
let readyResolvers = [];

// ========================================================================
// Initialization & Lifecycle
// ========================================================================

/**
 * Initialize extension: rehydrate state from storage
 */
async function initialize() {
  try {
    // 1. Use inline injected config (replaced by installExtension CLI command)
    let configFromFile = false;
    if (INJECTED_RELAY_PORT && INJECTED_GATEWAY_TOKEN) {
      relayPort = INJECTED_RELAY_PORT;
      gatewayToken = INJECTED_GATEWAY_TOKEN;
      configFromFile = true;
      console.log('[Bridge] Config loaded from injected values, port:', relayPort);
    }

    // 2. Fallback: load from chrome.storage.local (options page)
    if (!configFromFile) {
      const config = await chrome.storage.local.get(['relayPort', 'gatewayToken']);
      if (config.relayPort) relayPort = config.relayPort;
      if (config.gatewayToken) gatewayToken = config.gatewayToken;
      console.log('[Bridge] Config loaded from chrome.storage.local');
    }

    console.log('[Bridge] Initialized with relay port:', relayPort);

    // Rehydrate tab state from chrome.storage.session
    const sessionData = await chrome.storage.session.get('tabs');
    if (sessionData.tabs) {
      const savedTabs = sessionData.tabs;
      for (const [tabIdStr, tabState] of Object.entries(savedTabs)) {
        const tabId = parseInt(tabIdStr, 10);
        if (!isNaN(tabId)) {
          tabs.set(tabId, tabState);
          if (tabState.sessionId) {
            tabBySession.set(tabState.sessionId, tabId);
          }
        }
      }
      console.log('[Bridge] Rehydrated', tabs.size, 'tab states from session storage');
    }

    // Set up keepalive alarm
    chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });

    isReady = true;
    readyResolvers.forEach(resolve => resolve());
    readyResolvers = [];

    // Connect to relay
    connectToRelay();
  } catch (error) {
    console.error('[Bridge] Initialization error:', error);
    isReady = true;
    readyResolvers.forEach(resolve => resolve());
    readyResolvers = [];
  }
}

/**
 * Wait for extension to be ready
 */
function whenReady() {
  if (isReady) return Promise.resolve();
  return new Promise(resolve => readyResolvers.push(resolve));
}

/**
 * Persist tab state to chrome.storage.session
 */
async function persistTabState() {
  const tabsObj = {};
  for (const [tabId, state] of tabs.entries()) {
    tabsObj[tabId] = state;
  }
  await chrome.storage.session.set({ tabs: tabsObj });
}

// ========================================================================
// Relay Connection
// ========================================================================

/**
 * Connect to relay server with preflight check
 */
async function connectToRelay() {
  if (!relayPort || !gatewayToken) {
    console.error('[Bridge] Missing relay configuration. Please configure in extension options.');
    setBadgeText('!');
    scheduleReconnect();
    return;
  }

  setBadgeText('…');

  // Preflight check: HEAD request to relay
  try {
    const preflightUrl = `http://${RELAY_HOST}:${relayPort}/extension/status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
    
    const response = await fetch(preflightUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'x-claude-relay-token': gatewayToken }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn('[Bridge] Relay preflight failed:', response.status);
      scheduleReconnect();
      return;
    }
  } catch (error) {
    console.warn('[Bridge] Relay preflight error:', error.message);
    if (isRetryableReconnectError(error)) {
      scheduleReconnect();
    }
    return;
  }

  // Establish WebSocket connection
  try {
    const wsUrl = buildRelayWsUrl(relayPort, gatewayToken);
    console.log('[Bridge] Connecting to relay:', wsUrl);

    ws = new WebSocket(wsUrl);
    
    const wsTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        console.warn('[Bridge] WebSocket connection timeout');
        ws.close();
      }
    }, WEBSOCKET_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      console.log('[Bridge] Connected to relay server');
      reconnectAttempt = 0;
      setBadgeText('ON');
      startPing();

      // Flush any messages queued while ws was connecting
      flushPendingMessages();

      // Re-announce any already-attached tabs so relay knows about them
      for (const [tabId, tabState] of tabs.entries()) {
        if (tabState.state === 'attached' && tabState.sessionId) {
          forwardCDPEvent('Target.attachedToTarget', {
            sessionId: tabState.sessionId,
            targetInfo: {
              targetId: tabState.targetId || String(tabId),
              type: 'page',
              title: tabState.targetInfo?.title || '',
              url: tabState.targetInfo?.url || '',
              attached: true,
              canAccessOpener: false
            },
            waitingForDebugger: false
          });
          console.log('[Bridge] Re-announced tab', tabId, 'sessionId:', tabState.sessionId);
        }
      }

      // Pipe mode auto-attach: when config is injected (not manual install),
      // automatically attach all existing tabs on first relay connection.
      // This ensures the extension works without user clicking the toolbar button.
      if (INJECTED_RELAY_PORT && INJECTED_GATEWAY_TOKEN && tabs.size === 0) {
        autoAttachExistingTabs();
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleRelayMessage(message);
      } catch (error) {
        console.error('[Bridge] Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[Bridge] WebSocket error:', error);
    };

    ws.onclose = (event) => {
      clearTimeout(wsTimeout);
      console.log('[Bridge] Disconnected from relay server, code:', event.code);
      ws = null;
      stopPing();
      setBadgeText('');
      scheduleReconnect();
    };
  } catch (error) {
    console.error('[Bridge] WebSocket creation failed:', error);
    scheduleReconnect();
  }
}

/**
 * Schedule reconnection with exponential backoff
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  
  const delay = reconnectDelayMs(reconnectAttempt);
  reconnectAttempt++;
  
  console.log(`[Bridge] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToRelay();
  }, delay);
}

/**
 * Start ping/pong heartbeat
 */
function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendToRelay({ method: 'ping', id: Date.now() });
    }
  }, PING_INTERVAL_MS);
}

/**
 * Stop ping/pong heartbeat
 */
function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

/**
 * Queued messages waiting for ws to open
 */
const pendingMessages = [];

/**
 * Send message to relay server (queues if not connected)
 */
function sendToRelay(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    // Queue important messages (not ping) for delivery when ws opens
    if (message.method !== 'ping' && message.method !== 'pong') {
      pendingMessages.push(message);
    }
  }
}

/**
 * Flush queued messages
 */
function flushPendingMessages() {
  while (pendingMessages.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    const msg = pendingMessages.shift();
    ws.send(JSON.stringify(msg));
    console.log('[Bridge] Flushed queued message:', msg.method || 'response');
  }
}

// ========================================================================
// Message Handling
// ========================================================================

/**
 * Handle messages from relay server
 */
async function handleRelayMessage(message) {
  const { id, method, params } = message;

  // Handle ping
  if (method === 'ping') {
    sendToRelay({ method: 'pong', id });
    return;
  }

  // Handle forwardCDPCommand
  if (method === 'forwardCDPCommand') {
    await handleForwardCdpCommand(message);
    return;
  }

  console.warn('[Bridge] Unknown message method:', method);
}

/**
 * Handle forwardCDPCommand from relay
 */
async function handleForwardCdpCommand(message) {
  const { id, params } = message;
  if (!params) {
    sendToRelay({ id, error: { message: 'Missing params' } });
    return;
  }

  const { method, params: cmdParams, sessionId } = params;

  try {
    // Runtime.enable: must disable first so Chrome re-sends executionContextCreated events.
    // Without this, Playwright never gets execution contexts and page.evaluate() hangs forever.
    if (method === 'Runtime.enable') {
      const tabId = sessionId ? tabBySession.get(sessionId) : null;
      if (tabId) {
        try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.disable', {}); } catch {}
        const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable', cmdParams || {});
        sendToRelay({ id, result: result || {} });
        return;
      }
    }

    if (method === 'Target.createTarget') {
      // Create new tab
      const url = cmdParams?.url || 'about:blank';
      const tab = await chrome.tabs.create({ url, active: false });
      await attachTab(tab.id);
      // Return mainFrameId as targetId (set during attachTab)
      const tabState = tabs.get(tab.id);
      sendToRelay({ id, result: { targetId: tabState?.targetId || String(tab.id) } });
      return;
    }

    if (method === 'Target.closeTarget') {
      // Close tab - targetId may be mainFrameId or numeric tabId
      const targetId = cmdParams?.targetId;
      if (targetId) {
        const tabId = findTabIdByTargetId(targetId);
        if (tabId !== null) {
          await chrome.tabs.remove(tabId);
          sendToRelay({ id, result: { success: true } });
          return;
        }
      }
      sendToRelay({ id, error: { message: 'Invalid targetId' } });
      return;
    }

    if (method === 'Target.activateTarget') {
      // Activate tab - targetId may be mainFrameId or numeric tabId
      const targetId = cmdParams?.targetId;
      if (targetId) {
        const tabId = findTabIdByTargetId(targetId);
        if (tabId !== null) {
          const tab = await chrome.tabs.get(tabId);
          await chrome.tabs.update(tabId, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          sendToRelay({ id, result: {} });
          return;
        }
      }
      sendToRelay({ id, error: { message: 'Invalid targetId' } });
      return;
    }

    // Forward to chrome.debugger
    const tabId = sessionId ? tabBySession.get(sessionId) : null;
    if (!tabId) {
      sendToRelay({ id, error: { message: 'No tab for sessionId: ' + sessionId } });
      return;
    }

    const tabState = tabs.get(tabId);
    if (!tabState || tabState.state !== 'attached') {
      sendToRelay({ id, error: { message: 'Tab not attached: ' + tabId } });
      return;
    }

    const result = await chrome.debugger.sendCommand({ tabId }, method, cmdParams || {});
    sendToRelay({ id, result: result || {} });
  } catch (error) {
    console.error('[Bridge] CDP command error:', method, error);
    sendToRelay({ id, error: { message: error.message || String(error) } });
  }
}

/**
 * Forward CDP event to relay
 */
function forwardCDPEvent(method, params, sessionId) {
  sendToRelay({
    method: 'forwardCDPEvent',
    params: { method, params: params || {}, sessionId }
  });
}

// ========================================================================
// Tab Management
// ========================================================================

/**
 * Attach debugger to tab
 */
async function attachTab(tabId) {
  await whenReady();

  // Prevent concurrent operations on same tab
  if (tabOperationLocks.has(tabId)) {
    await tabOperationLocks.get(tabId);
  }

  const existingState = tabs.get(tabId);
  if (existingState?.state === 'attached' || existingState?.state === 'attaching') {
    console.log('[Bridge] Tab already attached or attaching:', tabId);
    return;
  }

  const lockPromise = (async () => {
    try {
      console.log('[Bridge] attachTab: starting attach for tab', tabId);
      tabs.set(tabId, { state: 'attaching', sessionId: null, targetId: String(tabId), attachOrder: nextAttachOrder++ });
      await persistTabState();

      // Attach debugger
      console.log('[Bridge] attachTab: calling chrome.debugger.attach...');
      await chrome.debugger.attach({ tabId }, '1.3');
      console.log('[Bridge] attachTab: debugger attached successfully');

      // Get target info
      const targetInfo = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo', {});
      
      // Get main frame ID from Page.getFrameTree - Playwright requires targetId === mainFrameId
      let mainFrameId = String(tabId);
      try {
        const frameTree = await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree', {});
        if (frameTree?.frameTree?.frame?.id) {
          mainFrameId = frameTree.frameTree.frame.id;
          console.log('[Bridge] Got mainFrameId:', mainFrameId, 'for tab:', tabId);
        }
      } catch (e) {
        console.warn('[Bridge] Failed to get frame tree, using tabId as targetId:', e);
      }

      // Assign sessionId
      const sessionId = `session_${nextSessionId++}`;
      tabs.set(tabId, {
        state: 'attached',
        sessionId,
        targetId: mainFrameId,
        attachOrder: tabs.get(tabId).attachOrder,
        targetInfo: targetInfo.targetInfo || {}
      });
      tabBySession.set(sessionId, tabId);
      await persistTabState();

      // Send Target.attachedToTarget event
      // Use mainFrameId as targetId - Playwright's CRPage uses targetId to index sessions,
      // and _sessionForFrame looks up frame._id in that map. If targetId !== mainFrameId,
      // _sessionForFrame fails with "Frame has been detached."
      forwardCDPEvent('Target.attachedToTarget', {
        sessionId,
        targetInfo: {
          targetId: mainFrameId,
          type: 'page',
          title: targetInfo.targetInfo?.title || '',
          url: targetInfo.targetInfo?.url || '',
          attached: true,
          canAccessOpener: false
        },
        waitingForDebugger: false
      });

      console.log('[Bridge] Tab attached:', tabId, 'sessionId:', sessionId);
      setBadgeText('ON');
    } catch (error) {
      console.error('[Bridge] Failed to attach tab:', tabId, error);
      tabs.delete(tabId);
      await persistTabState();
      throw error;
    } finally {
      tabOperationLocks.delete(tabId);
    }
  })();

  tabOperationLocks.set(tabId, lockPromise);
  await lockPromise;
}

/**
 * Detach debugger from tab
 */
async function detachTab(tabId) {
  await whenReady();

  // Prevent concurrent operations
  if (tabOperationLocks.has(tabId)) {
    await tabOperationLocks.get(tabId);
  }

  const tabState = tabs.get(tabId);
  if (!tabState || tabState.state === 'detached' || tabState.state === 'detaching') {
    console.log('[Bridge] Tab already detached or detaching:', tabId);
    return;
  }

  const lockPromise = (async () => {
    try {
      const sessionId = tabState.sessionId;
      
      tabs.set(tabId, { ...tabState, state: 'detaching' });
      await persistTabState();

      // Send Target.detachedFromTarget event
      if (sessionId) {
        forwardCDPEvent('Target.detachedFromTarget', {
          sessionId,
          targetId: tabState.targetId || String(tabId)
        });
        tabBySession.delete(sessionId);
      }

      // Detach debugger
      await chrome.debugger.detach({ tabId });

      tabs.delete(tabId);
      await persistTabState();

      console.log('[Bridge] Tab detached:', tabId);
      
      // Update badge
      if (tabs.size === 0) {
        setBadgeText('');
      }
    } catch (error) {
      console.error('[Bridge] Failed to detach tab:', tabId, error);
      tabs.delete(tabId);
      await persistTabState();
    } finally {
      tabOperationLocks.delete(tabId);
    }
  })();

  tabOperationLocks.set(tabId, lockPromise);
  await lockPromise;
}

/**
 * Connect or toggle attachment for active tab
 */
async function connectOrToggleForActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    console.warn('[Bridge] No active tab found');
    return;
  }

  const tabState = tabs.get(activeTab.id);
  if (tabState?.state === 'attached') {
    // Detach if already attached
    await detachTab(activeTab.id);
  } else {
    // Attach if not attached
    await attachTab(activeTab.id);
  }
}

/**
 * Auto-attach all existing tabs (pipe mode).
 * Called once when extension first connects to relay with injected config.
 */
async function autoAttachExistingTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    // Filter to http/https/about tabs (skip chrome://, chrome-extension://, etc.)
    const attachableTabs = allTabs.filter(tab => {
      if (!tab.id) return false;
      const url = tab.url || '';
      return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('about:');
    });

    console.log('[Bridge] Auto-attaching', attachableTabs.length, 'existing tabs (pipe mode)');
    for (const tab of attachableTabs) {
      try {
        await attachTab(tab.id);
      } catch (e) {
        console.warn('[Bridge] Failed to auto-attach tab', tab.id, ':', e.message);
      }
    }
  } catch (error) {
    console.error('[Bridge] autoAttachExistingTabs error:', error);
  }
}

/**
 * Set badge text to indicate status
 */
function setBadgeText(text) {
  chrome.action.setBadgeText({ text });
  if (text === 'ON') {
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else if (text === '!') {
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
  } else if (text === '…') {
    chrome.action.setBadgeBackgroundColor({ color: '#FF9800' });
  }
}

// ========================================================================
// Chrome Event Listeners
// ========================================================================

// Debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  const tabState = tabs.get(tabId);
  if (!tabState || !tabState.sessionId) return;

  forwardCDPEvent(method, params, tabState.sessionId);
});

// Debugger detach
chrome.debugger.onDetach.addListener(async (source, reason) => {
  const tabId = source.tabId;
  const tabState = tabs.get(tabId);
  if (!tabState) return;

  console.log('[Bridge] Debugger detached from tab', tabId, 'reason:', reason);

  // User clicked "Cancel" in the debugger banner — respect and clean up
  if (reason === 'canceled_by_user') {
    const sessionId = tabState.sessionId;
    if (sessionId) {
      forwardCDPEvent('Target.detachedFromTarget', { sessionId, targetId: tabState.targetId || String(tabId) });
      tabBySession.delete(sessionId);
    }
    tabs.delete(tabId);
    await persistTabState();
    return;
  }

  // For all other reasons (target_closed, replaced_with_devtools, etc.),
  // try to reattach after a short delay — navigation and site-isolation
  // process swaps both trigger detach but the tab still exists.
  setTimeout(async () => {
    try {
      await chrome.tabs.get(tabId);
      console.log('[Bridge] Attempting reattach after detach (reason:', reason, ') tab:', tabId);
      await attachTab(tabId);
    } catch {
      // Tab no longer exists, clean up
      const sessionId = tabState.sessionId;
      if (sessionId) {
        forwardCDPEvent('Target.detachedFromTarget', { sessionId, targetId: tabState.targetId || String(tabId) });
        tabBySession.delete(sessionId);
      }
      tabs.delete(tabId);
      await persistTabState();
    }
  }, 500);
});

// Action button clicked
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Bridge] === ACTION CLICKED === tab:', tab?.id, tab?.url);
  try {
    // Ensure relay connection before tab operations
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[Bridge] WS not connected, attempting to connect...');
      await connectToRelay();
      // Wait for WebSocket to actually open (up to 5s)
      for (let i = 0; i < 50; i++) {
        if (ws && ws.readyState === WebSocket.OPEN) break;
        await new Promise(r => setTimeout(r, 100));
      }
      console.log('[Bridge] WS state after connect attempt:', ws?.readyState);
    }
    await connectOrToggleForActiveTab();
    console.log('[Bridge] === ACTION DONE === tabs attached:', tabs.size);
  } catch (error) {
    console.error('[Bridge] === ACTION ERROR ===', error);
  }
});

// Auto-attach new tabs in pipe mode
chrome.tabs.onCreated.addListener(async (tab) => {
  // Only auto-attach in pipe mode (injected config)
  if (!INJECTED_RELAY_PORT || !INJECTED_GATEWAY_TOKEN) return;
  if (!tab.id) return;
  // Wait a bit for the tab to settle (URL may not be set yet)
  setTimeout(async () => {
    try {
      const current = await chrome.tabs.get(tab.id);
      const url = current.url || '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
      if (tabs.has(tab.id)) return; // Already attached
      await attachTab(tab.id);
      console.log('[Bridge] Auto-attached new tab', tab.id);
    } catch (e) {
      // Tab may have been closed already
      console.warn('[Bridge] Failed to auto-attach new tab', tab.id, ':', e.message);
    }
  }, 500);
});

// Tab removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabState = tabs.get(tabId);
  if (!tabState) return;

  const sessionId = tabState.sessionId;
  if (sessionId) {
    forwardCDPEvent('Target.detachedFromTarget', { sessionId, targetId: tabState.targetId || String(tabId) });
    tabBySession.delete(sessionId);
  }
  tabs.delete(tabId);
  await persistTabState();
});

// Tab replaced
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const tabState = tabs.get(removedTabId);
  if (!tabState) return;

  // Migrate state to new tab
  // TODO: onReplaced means the tab was replaced (e.g. prerender), the old debugger session
  // may be invalid. Ideally we should detach old + reattach new to get correct mainFrameId.
  // For now, relay layer's targetIdRemapping provides a safety net.
  tabs.set(addedTabId, { ...tabState, targetId: tabState.targetId || String(addedTabId) });
  tabs.delete(removedTabId);
  if (tabState.sessionId) {
    tabBySession.set(tabState.sessionId, addedTabId);
  }
  await persistTabState();
});

// Keepalive alarm - also ensures relay connection stays alive
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[Bridge] Keepalive: relay disconnected, reconnecting...');
      connectToRelay();
    }
  }
});

// ========================================================================
// Startup
// ========================================================================

initialize();
