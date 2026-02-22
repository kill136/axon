/**
 * Claude Code Browser Bridge - Background Service Worker
 * 
 * Connects to local relay server and forwards CDP commands to Chrome via debugger API.
 * This allows Playwright to control Chrome without being detected by anti-automation scripts.
 */

const RELAY_HOST = '127.0.0.1';
let relayPort = null;
let relayToken = null;
let ws = null;
let attachedTargets = new Map(); // tabId -> { protocol: '1.3' }
let reconnectTimer = null;
let heartbeatTimer = null;

/**
 * Connect to relay server
 */
function connectToRelay() {
  // Get relay connection info from extension storage or query params
  chrome.storage.local.get(['relayPort', 'relayToken'], (data) => {
    relayPort = data.relayPort || 9223; // Default relay port
    relayToken = data.relayToken || '';

    const wsUrl = `ws://${RELAY_HOST}:${relayPort}/extension?token=${encodeURIComponent(relayToken)}`;
    
    console.log('[Bridge] Connecting to relay:', wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Bridge] Connected to relay server');
      startHeartbeat();
      
      // Notify relay of all open tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            notifyTargetAttached(tab.id, tab.url);
          }
        });
      });
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

    ws.onclose = () => {
      console.log('[Bridge] Disconnected from relay server');
      stopHeartbeat();
      scheduleReconnect();
    };
  });
}

/**
 * Handle messages from relay server
 */
function handleRelayMessage(message) {
  const { type, id, method, params, targetId } = message;

  switch (type) {
    case 'forwardCDPCommand':
      executeCDPCommand(id, method, params, targetId);
      break;
    
    case 'ping':
      sendToRelay({ type: 'pong', id: message.id });
      break;
    
    default:
      console.warn('[Bridge] Unknown message type:', type);
  }
}

/**
 * Execute CDP command via chrome.debugger API
 */
function executeCDPCommand(messageId, method, params, targetId) {
  const tabId = parseInt(targetId);
  
  if (isNaN(tabId)) {
    sendToRelay({
      type: 'cdpError',
      id: messageId,
      error: { message: 'Invalid target ID' },
    });
    return;
  }

  // Attach debugger if not already attached
  if (!attachedTargets.has(tabId)) {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        sendToRelay({
          type: 'cdpError',
          id: messageId,
          error: { message: chrome.runtime.lastError.message },
        });
        return;
      }
      
      attachedTargets.set(tabId, { protocol: '1.3' });
      sendCDPCommand(messageId, tabId, method, params);
    });
  } else {
    sendCDPCommand(messageId, tabId, method, params);
  }
}

/**
 * Send CDP command to attached debugger
 */
function sendCDPCommand(messageId, tabId, method, params) {
  chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
    if (chrome.runtime.lastError) {
      sendToRelay({
        type: 'cdpError',
        id: messageId,
        error: { message: chrome.runtime.lastError.message },
      });
    } else {
      sendToRelay({
        type: 'cdpResult',
        id: messageId,
        result: result || {},
      });
    }
  });
}

/**
 * Send message to relay server
 */
function sendToRelay(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Notify relay that target is attached
 */
function notifyTargetAttached(tabId, url) {
  sendToRelay({
    type: 'targetAttached',
    targetId: String(tabId),
    targetInfo: {
      type: 'page',
      url: url || 'about:blank',
      title: '',
    },
  });
}

/**
 * Notify relay that target is detached
 */
function notifyTargetDetached(tabId) {
  sendToRelay({
    type: 'targetDetached',
    targetId: String(tabId),
  });
}

/**
 * Start heartbeat to keep connection alive
 */
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    sendToRelay({ type: 'ping', timestamp: Date.now() });
  }, 30000); // 30 seconds
}

/**
 * Stop heartbeat
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Schedule reconnection
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToRelay();
  }, 5000); // Reconnect after 5 seconds
}

/**
 * Listen for debugger events and forward to relay
 */
chrome.debugger.onEvent.addListener((source, method, params) => {
  sendToRelay({
    type: 'cdpEvent',
    method: method,
    params: params || {},
    targetId: String(source.tabId),
  });
});

/**
 * Listen for debugger detach events
 */
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  attachedTargets.delete(tabId);
  console.log('[Bridge] Debugger detached from tab', tabId, 'reason:', reason);
});

/**
 * Listen for tab close events
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTargets.has(tabId)) {
    attachedTargets.delete(tabId);
    notifyTargetDetached(tabId);
  }
});

/**
 * Listen for new tab creation
 */
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id && ws && ws.readyState === WebSocket.OPEN) {
    notifyTargetAttached(tab.id, tab.url);
  }
});

/**
 * Listen for extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Bridge] Extension installed:', details.reason);
  
  // Get connection info from URL parameters if available
  const params = new URLSearchParams(location.search);
  const port = params.get('port');
  const token = params.get('token');
  
  if (port) {
    chrome.storage.local.set({ relayPort: parseInt(port), relayToken: token || '' }, () => {
      connectToRelay();
    });
  } else {
    connectToRelay();
  }
});

/**
 * Start connection on service worker startup
 */
connectToRelay();
