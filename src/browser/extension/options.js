/**
 * Options page logic for Axon Browser Bridge
 */

const DEFAULT_RELAY_PORT = 18792;

// ========================================================================
// DOM Elements
// ========================================================================

const form = document.getElementById('settings-form');
const relayPortInput = document.getElementById('relayPort');
const gatewayTokenInput = document.getElementById('gatewayToken');
const statusDiv = document.getElementById('status');
const connectionStatusDiv = document.getElementById('connection-status');
const testConnectionBtn = document.getElementById('test-connection');

// ========================================================================
// Load Settings
// ========================================================================

async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get(['relayPort', 'gatewayToken']);

    relayPortInput.value = settings.relayPort || DEFAULT_RELAY_PORT;
    gatewayTokenInput.value = settings.gatewayToken || '';

    // Check connection status
    checkConnectionStatus();
  } catch (error) {
    showStatus('Failed to load settings: ' + error.message, 'error');
  }
}

// ========================================================================
// Save Settings
// ========================================================================

async function saveSettings(event) {
  event.preventDefault();

  const relayPort = parseInt(relayPortInput.value, 10);
  const gatewayToken = gatewayTokenInput.value.trim();

  if (!relayPort || relayPort < 1 || relayPort > 65535) {
    showStatus('Invalid port number. Must be between 1 and 65535.', 'error');
    return;
  }

  if (!gatewayToken) {
    showStatus('Authentication token is required.', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({ relayPort, gatewayToken });
    showStatus('Settings saved successfully! Extension will reconnect automatically.', 'success');
    
    // Check connection after saving
    setTimeout(() => {
      checkConnectionStatus();
    }, 1000);
  } catch (error) {
    showStatus('Failed to save settings: ' + error.message, 'error');
  }
}

// ========================================================================
// Test Connection
// ========================================================================

async function testConnection() {
  const relayPort = parseInt(relayPortInput.value, 10);
  const gatewayToken = gatewayTokenInput.value.trim();

  if (!relayPort || !gatewayToken) {
    showStatus('Please enter both relay port and token before testing.', 'error');
    return;
  }

  testConnectionBtn.disabled = true;
  testConnectionBtn.textContent = 'Testing...';
  showStatus('Testing connection to relay server...', 'info');

  try {
    const relayUrl = `http://127.0.0.1:${relayPort}/extension/status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(relayUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'x-claude-relay-token': gatewayToken
      }
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      showStatus(`✅ Connection successful! Relay server is running.`, 'success');
      updateConnectionStatus(true);
    } else {
      showStatus(`❌ Connection failed: HTTP ${response.status}. Check your token.`, 'error');
      updateConnectionStatus(false);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      showStatus('❌ Connection timeout. Is the relay server running?', 'error');
    } else {
      showStatus(`❌ Connection failed: ${error.message}. Is the relay server running on port ${relayPort}?`, 'error');
    }
    updateConnectionStatus(false);
  } finally {
    testConnectionBtn.disabled = false;
    testConnectionBtn.textContent = 'Test Connection';
  }
}

// ========================================================================
// Connection Status
// ========================================================================

async function checkConnectionStatus() {
  try {
    const settings = await chrome.storage.local.get(['relayPort', 'gatewayToken']);
    const relayPort = settings.relayPort || DEFAULT_RELAY_PORT;
    const gatewayToken = settings.gatewayToken || '';

    if (!gatewayToken) {
      updateConnectionStatus(false, 'Not configured');
      return;
    }

    const relayUrl = `http://127.0.0.1:${relayPort}/extension/status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(relayUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'x-claude-relay-token': gatewayToken
      }
    });

    clearTimeout(timeout);

    if (response.ok) {
      updateConnectionStatus(true, 'Connected to relay');
    } else {
      updateConnectionStatus(false, 'Authentication failed');
    }
  } catch (error) {
    updateConnectionStatus(false, 'Relay server not reachable');
  }
}

function updateConnectionStatus(connected, message) {
  if (connected) {
    connectionStatusDiv.classList.add('connected');
    connectionStatusDiv.querySelector('.text').textContent = message || 'Connected to relay server';
  } else {
    connectionStatusDiv.classList.remove('connected');
    connectionStatusDiv.querySelector('.text').textContent = message || 'Disconnected from relay server';
  }
}

// ========================================================================
// Status Message
// ========================================================================

function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
  
  // Auto-hide after 5 seconds for success messages
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 5000);
  }
}

// ========================================================================
// Event Listeners
// ========================================================================

form.addEventListener('submit', saveSettings);
testConnectionBtn.addEventListener('click', testConnection);

// ========================================================================
// Initialize
// ========================================================================

loadSettings();

// Periodically check connection status
setInterval(checkConnectionStatus, 10000);
