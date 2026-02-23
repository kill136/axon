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

// Tab states: 'attaching' | 'attached' | 'detaching' | 'detached'
const tabs = new Map(); // tabId -> { state, sessionId, targetId, attachOrder }
const tabBySession = new Map(); // sessionId -> tabId
const childSessionToTab = new Map(); // child sessionId -> tabId
const tabOperationLocks = new Map(); // tabId -> Promise
let nextSessionId = 1000;
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
    // Load config from chrome.storage.local
    const config = await chrome.storage.local.get(['relayPort', 'gatewayToken']);
    if (config.relayPort) relayPort = config.relayPort;
    if (config.gatewayToken) gatewayToken = config.gatewayToken;

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
 * Send message to relay server
 */
function sendToRelay(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
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
    // Special handling for certain CDP commands
    if (method === 'Runtime.enable') {
      // Runtime.enable can fail if already enabled, so disable first
      const tabId = sessionId ? tabBySession.get(sessionId) : null;
      if (tabId) {
        try {
          await chrome.debugger.sendCommand({ tabId }, 'Runtime.disable', {});
        } catch {
          // Ignore error
        }
      }
    }

    if (method === 'Target.createTarget') {
      // Create new tab
      const url = cmdParams?.url || 'about:blank';
      const tab = await chrome.tabs.create({ url, active: false });
      await attachTab(tab.id);
      sendToRelay({ id, result: { targetId: String(tab.id) } });
      return;
    }

    if (method === 'Target.closeTarget') {
      // Close tab
      const targetId = cmdParams?.targetId;
      if (targetId) {
        const tabId = parseInt(targetId, 10);
        if (!isNaN(tabId)) {
          await chrome.tabs.remove(tabId);
          sendToRelay({ id, result: { success: true } });
          return;
        }
      }
      sendToRelay({ id, error: { message: 'Invalid targetId' } });
      return;
    }

    if (method === 'Target.activateTarget') {
      // Activate tab
      const targetId = cmdParams?.targetId;
      if (targetId) {
        const tabId = parseInt(targetId, 10);
        if (!isNaN(tabId)) {
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
      tabs.set(tabId, { state: 'attaching', sessionId: null, targetId: String(tabId), attachOrder: nextAttachOrder++ });
      await persistTabState();

      // Attach debugger
      await chrome.debugger.attach({ tabId }, '1.3');

      // Get target info
      const targetInfo = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo', {});
      
      // Assign sessionId
      const sessionId = `session_${nextSessionId++}`;
      tabs.set(tabId, {
        state: 'attached',
        sessionId,
        targetId: String(tabId),
        attachOrder: tabs.get(tabId).attachOrder,
        targetInfo: targetInfo.targetInfo || {}
      });
      tabBySession.set(sessionId, tabId);
      await persistTabState();

      // Send Target.attachedToTarget event
      forwardCDPEvent('Target.attachedToTarget', {
        sessionId,
        targetInfo: {
          targetId: String(tabId),
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
          targetId: String(tabId)
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

  // If detached due to navigation (target_closed), try to reattach after delay
  if (reason === 'target_closed') {
    setTimeout(async () => {
      try {
        // Check if tab still exists
        await chrome.tabs.get(tabId);
        await attachTab(tabId);
      } catch {
        // Tab no longer exists, clean up
        const sessionId = tabState.sessionId;
        if (sessionId) {
          forwardCDPEvent('Target.detachedFromTarget', { sessionId, targetId: String(tabId) });
          tabBySession.delete(sessionId);
        }
        tabs.delete(tabId);
        await persistTabState();
      }
    }, 500);
  } else {
    // Other reasons: clean up immediately
    const sessionId = tabState.sessionId;
    if (sessionId) {
      forwardCDPEvent('Target.detachedFromTarget', { sessionId, targetId: String(tabId) });
      tabBySession.delete(sessionId);
    }
    tabs.delete(tabId);
    await persistTabState();
  }
});

// Action button clicked
chrome.action.onClicked.addListener(async () => {
  await connectOrToggleForActiveTab();
});

// Tab removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabState = tabs.get(tabId);
  if (!tabState) return;

  const sessionId = tabState.sessionId;
  if (sessionId) {
    forwardCDPEvent('Target.detachedFromTarget', { sessionId, targetId: String(tabId) });
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
  tabs.set(addedTabId, { ...tabState, targetId: String(addedTabId) });
  tabs.delete(removedTabId);
  if (tabState.sessionId) {
    tabBySession.set(tabState.sessionId, addedTabId);
  }
  await persistTabState();
});

// Keepalive alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Keep service worker alive
    console.log('[Bridge] Keepalive ping');
  }
});

// ========================================================================
// Startup
// ========================================================================

initialize();
