/**
 * useVoiceRecognition Hook
 * 使用 Web Speech API 实现语音识别，支持唤醒词检测
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export type VoiceState = 'idle' | 'listening' | 'activated';

export interface UseVoiceRecognitionOptions {
  wakeWord?: string;        // 默认 'claude'
  silenceTimeout?: number;  // 静默超时 ms，默认 2000
  lang?: string;            // 语言，默认 'zh-CN'
  onCommand?: (text: string) => void;  // 命令完成回调
  onWake?: () => void;      // 唤醒回调
}

export interface UseVoiceRecognitionReturn {
  voiceState: VoiceState;
  transcript: string;       // 当前识别文本
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

// 检测浏览器是否支持 Web Speech API
function getSpeechRecognition(): SpeechRecognitionStatic | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}

// 用 Web Audio API 播放升调提示音
function playWakeSound(): void {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx() as AudioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // 忽略 AudioContext 错误
  }
}

const SpeechRecognitionClass = getSpeechRecognition();
const isSupported = SpeechRecognitionClass !== null;

export function useVoiceRecognition({
  wakeWord = 'claude',
  silenceTimeout = 2000,
  lang = 'zh-CN',
  onCommand,
  onWake,
}: UseVoiceRecognitionOptions = {}): UseVoiceRecognitionReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const voiceStateRef = useRef<VoiceState>('idle');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandBufferRef = useRef<string>('');
  const onCommandRef = useRef(onCommand);
  const onWakeRef = useRef(onWake);

  // 保持回调引用最新
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);

  // 同步 voiceState 到 ref（避免闭包陈旧值）
  const updateVoiceState = useCallback((state: VoiceState) => {
    voiceStateRef.current = state;
    setVoiceState(state);
  }, []);

  // 清理静默计时器
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // 触发命令发送
  const fireCommand = useCallback((text: string) => {
    clearSilenceTimer();
    commandBufferRef.current = '';
    setTranscript('');
    updateVoiceState('listening');
    onCommandRef.current?.(text.trim());
  }, [clearSilenceTimer, updateVoiceState]);

  // 重置静默计时器（激活模式下静默超时后发送命令）
  const resetSilenceTimer = useCallback((currentText: string) => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      const text = commandBufferRef.current;
      if (text.trim()) {
        fireCommand(text);
      } else {
        updateVoiceState('listening');
      }
    }, silenceTimeout);
  }, [clearSilenceTimer, fireCommand, silenceTimeout, updateVoiceState]);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    commandBufferRef.current = '';
    setTranscript('');
    updateVoiceState('idle');
  }, [clearSilenceTimer, updateVoiceState]);

  const startListening = useCallback(() => {
    if (!isSupported || !SpeechRecognitionClass) return;

    // 如果已在运行则停止（切换关闭）
    if (voiceStateRef.current !== 'idle') {
      stopListening();
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      const combinedText = (finalText || interimText).trim();
      if (!combinedText) return;

      const currentState = voiceStateRef.current;

      if (currentState === 'listening') {
        // 检测唤醒词
        const lowerText = combinedText.toLowerCase();
        if (lowerText.includes(wakeWord.toLowerCase())) {
          // 触发唤醒
          playWakeSound();
          onWakeRef.current?.();
          updateVoiceState('activated');
          commandBufferRef.current = '';
          setTranscript('');
          // 去掉唤醒词之后的部分作为初始命令片段
          const afterWake = combinedText.substring(
            lowerText.indexOf(wakeWord.toLowerCase()) + wakeWord.length
          ).trim();
          if (afterWake) {
            commandBufferRef.current = afterWake;
            setTranscript(afterWake);
            resetSilenceTimer(afterWake);
          }
        } else if (finalText.trim()) {
          // 非唤醒词的终态文本 → 直接作为命令发送
          fireCommand(finalText.trim());
        }
      } else if (currentState === 'activated') {
        // 累积命令文本
        if (finalText) {
          commandBufferRef.current += (commandBufferRef.current ? ' ' : '') + finalText.trim();
          setTranscript(commandBufferRef.current);
          resetSilenceTimer(commandBufferRef.current);
        } else {
          // 中间结果仅显示
          setTranscript(commandBufferRef.current + (commandBufferRef.current ? ' ' : '') + interimText);
          resetSilenceTimer(interimText);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        // 忽略无语音/音频捕获错误，继续监听
        return;
      }
      console.warn('SpeechRecognition error:', event.error);
      // aborted 是主动停止触发的，不需要额外处理
      if (event.error !== 'aborted') {
        stopListening();
      }
    };

    recognition.onend = () => {
      // 如果状态不是 idle，说明是意外结束（如超时），需要重启
      if (voiceStateRef.current !== 'idle') {
        try {
          recognitionRef.current?.start();
        } catch {
          // 重启失败时静默处理
        }
      }
    };

    recognitionRef.current = recognition;
    updateVoiceState('listening');
    commandBufferRef.current = '';
    setTranscript('');

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start SpeechRecognition:', e);
      updateVoiceState('idle');
      recognitionRef.current = null;
    }
  }, [lang, wakeWord, stopListening, updateVoiceState, fireCommand, resetSilenceTimer]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, [clearSilenceTimer]);

  return {
    voiceState,
    transcript,
    isSupported,
    startListening,
    stopListening,
  };
}
