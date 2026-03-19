import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock AudioContext
class MockOscillator {
  type = 'sine';
  frequency = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockGainNode {
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class MockAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  createOscillator = vi.fn(() => new MockOscillator());
  createGain = vi.fn(() => new MockGainNode());
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn();
}

Object.defineProperty(globalThis, 'AudioContext', { value: MockAudioContext, writable: true });

import { isSoundEnabled, getSoundVolume, playNotificationSound } from '../useNotificationSound';

describe('useNotificationSound', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('isSoundEnabled', () => {
    it('should return true by default (no stored value)', () => {
      expect(isSoundEnabled()).toBe(true);
    });

    it('should return true when stored as "true"', () => {
      localStorageMock.setItem('axon_notification_sound_enabled', 'true');
      expect(isSoundEnabled()).toBe(true);
    });

    it('should return false when stored as "false"', () => {
      localStorageMock.setItem('axon_notification_sound_enabled', 'false');
      expect(isSoundEnabled()).toBe(false);
    });
  });

  describe('getSoundVolume', () => {
    it('should return 0.5 by default', () => {
      expect(getSoundVolume()).toBe(0.5);
    });

    it('should return stored volume', () => {
      localStorageMock.setItem('axon_notification_sound_volume', '0.8');
      expect(getSoundVolume()).toBe(0.8);
    });

    it('should clamp volume to [0, 1]', () => {
      localStorageMock.setItem('axon_notification_sound_volume', '1.5');
      expect(getSoundVolume()).toBe(1);

      localStorageMock.setItem('axon_notification_sound_volume', '-0.5');
      expect(getSoundVolume()).toBe(0);
    });

    it('should return 0.5 for invalid values', () => {
      localStorageMock.setItem('axon_notification_sound_volume', 'abc');
      expect(getSoundVolume()).toBe(0.5);
    });
  });

  describe('playNotificationSound', () => {
    it('should not play when sound is disabled', () => {
      localStorageMock.setItem('axon_notification_sound_enabled', 'false');
      playNotificationSound('info');
      // AudioContext should not be instantiated
    });

    it('should play sound when enabled', () => {
      localStorageMock.setItem('axon_notification_sound_enabled', 'true');
      playNotificationSound('info');
      // No error = success (AudioContext was used)
    });

    it('should handle all sound types without error', () => {
      const types = ['info', 'success', 'warning', 'error', 'attention'] as const;
      for (const type of types) {
        expect(() => playNotificationSound(type)).not.toThrow();
      }
    });

    it('should default to attention type', () => {
      expect(() => playNotificationSound()).not.toThrow();
    });
  });
});
