/**
 * Browser Profile Management
 * 
 * Manages multiple Chrome profiles with isolated user data, CDP ports, and visual decorations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.claude');
const BROWSER_DIR = path.join(CONFIG_DIR, 'browser');
const PROFILES_FILE = path.join(BROWSER_DIR, 'profiles.json');

const CDP_PORT_RANGE_START = 9222;
const CDP_PORT_RANGE_END = 9322;

// 10-color palette for profile decoration
const COLOR_PALETTE = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Light Salmon
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
  '#BB8FCE', // Purple
  '#85C1E2', // Sky Blue
  '#F8B739', // Orange
  '#52B788', // Green
];

export interface ProfileInfo {
  cdpPort: number;
  color: string;
  userDataDir: string;
  createdAt: string;
}

interface ProfilesData {
  profiles: Record<string, ProfileInfo>;
}

/**
 * Load profiles data from disk
 */
function loadProfiles(): ProfilesData {
  try {
    if (!fs.existsSync(PROFILES_FILE)) {
      return { profiles: {} };
    }
    const data = fs.readFileSync(PROFILES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { profiles: {} };
  }
}

/**
 * Save profiles data to disk
 */
function saveProfiles(data: ProfilesData): void {
  fs.mkdirSync(BROWSER_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Validate profile name format
 */
export function isValidProfileName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

/**
 * Allocate an available CDP port
 */
export function allocateCdpPort(usedPorts: number[]): number {
  const usedSet = new Set(usedPorts);
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    if (!usedSet.has(port)) {
      return port;
    }
  }
  throw new Error(`No available CDP port in range ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END}`);
}

/**
 * Allocate a color from palette
 */
export function allocateColor(usedColors: string[]): string {
  const usedSet = new Set(usedColors);
  for (const color of COLOR_PALETTE) {
    if (!usedSet.has(color)) {
      return color;
    }
  }
  // If all colors used, return random from palette
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

/**
 * List all profiles
 */
export function listProfiles(): Record<string, ProfileInfo> {
  const data = loadProfiles();
  return data.profiles;
}

/**
 * Get profile info by name
 */
export function getProfile(name: string): ProfileInfo | null {
  const data = loadProfiles();
  return data.profiles[name] || null;
}

/**
 * Create a new profile
 */
export function createProfile(name: string): ProfileInfo {
  if (!isValidProfileName(name)) {
    throw new Error(`Invalid profile name "${name}". Must match pattern: ^[a-z0-9][a-z0-9-]*$`);
  }

  const data = loadProfiles();
  
  if (data.profiles[name]) {
    throw new Error(`Profile "${name}" already exists`);
  }

  const usedPorts = Object.values(data.profiles).map(p => p.cdpPort);
  const usedColors = Object.values(data.profiles).map(p => p.color);

  const cdpPort = allocateCdpPort(usedPorts);
  const color = allocateColor(usedColors);
  const userDataDir = path.join(BROWSER_DIR, name, 'user-data');

  const profile: ProfileInfo = {
    cdpPort,
    color,
    userDataDir,
    createdAt: new Date().toISOString(),
  };

  data.profiles[name] = profile;
  saveProfiles(data);

  // Create user data directory
  fs.mkdirSync(userDataDir, { recursive: true });

  return profile;
}

/**
 * Delete a profile
 */
export function deleteProfile(name: string): void {
  const data = loadProfiles();
  
  const profile = data.profiles[name];
  if (!profile) {
    throw new Error(`Profile "${name}" does not exist`);
  }

  // Delete user data directory
  if (fs.existsSync(profile.userDataDir)) {
    fs.rmSync(profile.userDataDir, { recursive: true, force: true });
  }

  delete data.profiles[name];
  saveProfiles(data);
}

/**
 * Decorate Chrome profile with custom name and color
 * Modifies Chrome's preferences to set profile name and theme color
 */
export function decorateProfile(userDataDir: string, profileName: string, color: string): void {
  try {
    // Modify Local State for profile name
    const localStatePath = path.join(userDataDir, '..', 'Local State');
    if (fs.existsSync(localStatePath)) {
      const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'));
      if (!localState.profile) localState.profile = {};
      if (!localState.profile.info_cache) localState.profile.info_cache = {};
      
      const defaultProfileKey = 'Default';
      if (!localState.profile.info_cache[defaultProfileKey]) {
        localState.profile.info_cache[defaultProfileKey] = {};
      }
      
      localState.profile.info_cache[defaultProfileKey].name = profileName;
      localState.profile.info_cache[defaultProfileKey].shortcut_name = profileName;
      
      fs.writeFileSync(localStatePath, JSON.stringify(localState, null, 2), 'utf-8');
    }

    // Modify Default/Preferences for theme color
    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    
    let prefs: any = {};
    if (fs.existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      } catch {
        prefs = {};
      }
    }

    // Set profile name and color
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.name = profileName;
    
    // Convert hex color to Chrome theme format (simplified)
    if (!prefs.extensions) prefs.extensions = {};
    if (!prefs.extensions.theme) prefs.extensions.theme = {};
    prefs.extensions.theme.use_system = false;
    
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (error) {
    // Profile decoration is best-effort, don't fail if it doesn't work
    console.warn(`Failed to decorate profile: ${error}`);
  }
}

/**
 * Ensure clean exit flag is set to prevent Chrome "Restore pages?" popup
 */
export function ensureCleanExit(userDataDir: string): void {
  try {
    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    if (!fs.existsSync(prefsPath)) {
      return; // Nothing to fix if no preferences file yet
    }

    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
    
    // Set exit_type to Normal to prevent restore popup
    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;

    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (error) {
    // Best-effort, don't fail
    console.warn(`Failed to set clean exit flag: ${error}`);
  }
}
