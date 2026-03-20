/**
 * useNotificationSound — 通知声音 hook
 *
 * 使用 Web Audio API 合成提示音，不需要额外音频文件。
 * 支持多种声音类型：info, success, warning, error, attention
 * 设置保存在 localStorage 中。
 */

import { useCallback, useRef } from 'react';

const STORAGE_KEY = 'axon_notification_sound_enabled';
const VOLUME_KEY = 'axon_notification_sound_volume';

export type SoundType = 'info' | 'success' | 'warning' | 'error' | 'attention';

/**
 * 获取声音是否启用（可在 hook 外部使用）
 */
export function isSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // 默认开启
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

/**
 * 获取音量 (0-1)
 */
export function getSoundVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return 0.5;
    const vol = parseFloat(stored);
    return isNaN(vol) ? 0.5 : Math.max(0, Math.min(1, vol));
  } catch {
    return 0.5;
  }
}

/**
 * 用 Web Audio API 合成提示音
 */
function synthesizeSound(ctx: AudioContext, type: SoundType, volume: number): void {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume * 0.3, now);

  switch (type) {
    case 'info': {
      // 两声短促的 "叮叮"
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + 0.1);
      gain.gain.setValueAtTime(volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      const gain2 = ctx.createGain();
      gain2.connect(ctx.destination);
      gain2.gain.setValueAtTime(volume * 0.3, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1100, now + 0.15);
      osc2.connect(gain2);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.25);
      break;
    }
    case 'success': {
      // 上行三连音
      const notes = [523, 659, 784]; // C5, E5, G5
      notes.forEach((freq, i) => {
        const g = ctx.createGain();
        g.connect(ctx.destination);
        const t = now + i * 0.12;
        g.gain.setValueAtTime(volume * 0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, t);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.15);
      });
      break;
    }
    case 'warning': {
      // 两声低沉的 "咚咚"
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      const gain2 = ctx.createGain();
      gain2.connect(ctx.destination);
      gain2.gain.setValueAtTime(volume * 0.3, now + 0.25);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(440, now + 0.25);
      osc2.connect(gain2);
      osc2.start(now + 0.25);
      osc2.stop(now + 0.4);
      break;
    }
    case 'error': {
      // 下行不和谐音
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      break;
    }
    case 'attention': {
      // 急促重复音 — 用于需要用户注意的跨会话通知
      for (let i = 0; i < 3; i++) {
        const g = ctx.createGain();
        g.connect(ctx.destination);
        const t = now + i * 0.2;
        g.gain.setValueAtTime(volume * 0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(988, t); // B5
        o.connect(g);
        o.start(t);
        o.stop(t + 0.1);
      }
      break;
    }
  }
}

/**
 * 在 hook 外部直接播放声音（用于 useMessageHandler 等非组件场景）
 */
let sharedAudioContext: AudioContext | null = null;

export function playNotificationSound(type: SoundType = 'attention'): void {
  if (!isSoundEnabled()) return;
  try {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioContext();
    }
    if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume();
    }
    synthesizeSound(sharedAudioContext, type, getSoundVolume());
  } catch {
    // Web Audio API not available, silently ignore
  }
}

/**
 * React hook 版本
 */
export function useNotificationSound() {
  const audioContextRef = useRef<AudioContext | null>(null);

  const play = useCallback((type: SoundType = 'attention') => {
    if (!isSoundEnabled()) return;
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      synthesizeSound(audioContextRef.current, type, getSoundVolume());
    } catch {
      // Web Audio API not available
    }
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  }, []);

  const setVolume = useCallback((volume: number) => {
    localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, volume))));
  }, []);

  return {
    play,
    isEnabled: isSoundEnabled,
    setEnabled,
    getVolume: getSoundVolume,
    setVolume,
  };
}
