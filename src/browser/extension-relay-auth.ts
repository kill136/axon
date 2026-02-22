/**
 * Extension Relay Authentication
 * 
 * Manages authentication tokens for relay server.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.claude');
const BROWSER_DIR = path.join(CONFIG_DIR, 'browser');
const RELAY_TOKEN_FILE = path.join(BROWSER_DIR, 'relay-token');

/**
 * Get or generate relay auth token
 */
export function getRelayToken(): string {
  try {
    if (fs.existsSync(RELAY_TOKEN_FILE)) {
      return fs.readFileSync(RELAY_TOKEN_FILE, 'utf-8').trim();
    }
  } catch {
    // Ignore read errors
  }

  // Generate new token
  const token = crypto.randomBytes(32).toString('hex');
  
  // Save token
  try {
    fs.mkdirSync(BROWSER_DIR, { recursive: true });
    fs.writeFileSync(RELAY_TOKEN_FILE, token, 'utf-8');
  } catch (error) {
    console.warn('Failed to save relay token:', error);
  }

  return token;
}

/**
 * Derive connection-specific auth token using HMAC-SHA256
 */
export function resolveRelayAuthToken(port: number): string {
  const masterToken = getRelayToken();
  const hmac = crypto.createHmac('sha256', masterToken);
  hmac.update(`relay:${port}`);
  return hmac.digest('hex');
}

/**
 * Verify relay auth token
 */
export function verifyRelayAuthToken(port: number, token: string): boolean {
  const expected = resolveRelayAuthToken(port);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(token)
  );
}
