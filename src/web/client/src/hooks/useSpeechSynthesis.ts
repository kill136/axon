/**
 * useSpeechSynthesis Hook — Claude's mouth.
 *
 * Converts streaming AI text into spoken audio using the browser's
 * Web Speech Synthesis API (free, no API key needed).
 *
 * Design:
 * - Text arrives token-by-token via feedText()
 * - Buffered until a sentence boundary (。.!?！？\n) is hit
 * - Each sentence is queued for TTS playback
 * - Code blocks and tool output are skipped (only natural language is spoken)
 * - flush() speaks any remaining buffered text
 * - cancel() stops all speech immediately
 * - onSpeechEnd callback fires when all queued speech finishes
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseSpeechSynthesisReturn {
  /** Whether TTS is enabled */
  enabled: boolean;
  /** Toggle TTS on/off */
  toggle: () => void;
  /** Programmatically set enabled state */
  setEnabled: (enabled: boolean) => void;
  /** Whether currently speaking */
  isSpeaking: boolean;
  /** Feed streaming text (call on each text_delta) */
  feedText: (text: string) => void;
  /** Flush remaining buffer (call on message end) */
  flush: () => void;
  /** Cancel all speech */
  cancel: () => void;
  /** Whether browser supports speech synthesis */
  isSupported: boolean;
  /** Register callback for when all speech finishes */
  onSpeechEnd: (cb: (() => void) | null) => void;
}

// Sentence boundary pattern: Chinese/English punctuation + newline
const SENTENCE_BOUNDARY = /[。.!?！？\n]/;

// Code block detection: skip content inside ``` blocks
const CODE_FENCE = '```';

function getIsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [enabled, setEnabledState] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSupported = getIsSupported();

  const bufferRef = useRef('');
  const inCodeBlockRef = useRef(false);
  const enabledRef = useRef(false);
  const activeCountRef = useRef(0);
  const speechEndCallbackRef = useRef<(() => void) | null>(null);

  // Keep ref in sync
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Monitor speaking state via polling
  useEffect(() => {
    if (!isSupported) return;
    const interval = setInterval(() => {
      const speaking = speechSynthesis.speaking;
      setIsSpeaking(speaking);
      // Fire onSpeechEnd when all utterances done
      if (!speaking && activeCountRef.current === 0) {
        // Already handled by utterance.onend
      }
    }, 200);
    return () => clearInterval(interval);
  }, [isSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isSupported) {
        speechSynthesis.cancel();
      }
    };
  }, [isSupported]);

  const speak = useCallback((text: string) => {
    if (!isSupported || !enabledRef.current) return;

    const cleaned = text.trim();
    if (!cleaned) return;

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.4;
    utterance.pitch = 1.0;

    activeCountRef.current++;

    utterance.onend = () => {
      activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      if (activeCountRef.current === 0 && !speechSynthesis.speaking) {
        speechEndCallbackRef.current?.();
      }
    };

    utterance.onerror = () => {
      activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      if (activeCountRef.current === 0 && !speechSynthesis.speaking) {
        speechEndCallbackRef.current?.();
      }
    };

    speechSynthesis.speak(utterance);
  }, [isSupported]);

  const feedText = useCallback((text: string) => {
    if (!enabledRef.current || !isSupported) return;

    for (const char of text) {
      // Track code block state
      bufferRef.current += char;

      // Check if we just completed a code fence
      if (bufferRef.current.endsWith(CODE_FENCE)) {
        inCodeBlockRef.current = !inCodeBlockRef.current;
        // Don't speak code fence markers or code content
        if (inCodeBlockRef.current) {
          // Entering code block — speak what we had before the fence
          const beforeFence = bufferRef.current.slice(0, -CODE_FENCE.length).trim();
          if (beforeFence) {
            speak(beforeFence);
          }
          bufferRef.current = '';
        } else {
          // Exiting code block — discard everything in the code block
          bufferRef.current = '';
        }
        continue;
      }

      // Skip content inside code blocks
      if (inCodeBlockRef.current) continue;

      // Check for sentence boundary
      if (SENTENCE_BOUNDARY.test(char)) {
        const sentence = bufferRef.current.trim();
        if (sentence) {
          speak(sentence);
        }
        bufferRef.current = '';
      }
    }
  }, [isSupported, speak]);

  const flush = useCallback(() => {
    if (!enabledRef.current || !isSupported) return;

    // Speak any remaining buffered text
    const remaining = bufferRef.current.trim();
    if (remaining && !inCodeBlockRef.current) {
      speak(remaining);
    }
    bufferRef.current = '';
    inCodeBlockRef.current = false;
  }, [isSupported, speak]);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    speechSynthesis.cancel();
    activeCountRef.current = 0;
    bufferRef.current = '';
    inCodeBlockRef.current = false;
  }, [isSupported]);

  const toggle = useCallback(() => {
    setEnabledState(prev => {
      const next = !prev;
      if (!next) {
        // Turning off — stop all speech
        speechSynthesis.cancel();
        activeCountRef.current = 0;
        bufferRef.current = '';
        inCodeBlockRef.current = false;
      }
      return next;
    });
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(prev => {
      if (prev === value) return prev;
      if (!value) {
        speechSynthesis.cancel();
        activeCountRef.current = 0;
        bufferRef.current = '';
        inCodeBlockRef.current = false;
      }
      return value;
    });
  }, []);

  const onSpeechEnd = useCallback((cb: (() => void) | null) => {
    speechEndCallbackRef.current = cb;
  }, []);

  return {
    enabled,
    toggle,
    setEnabled,
    isSpeaking,
    feedText,
    flush,
    cancel,
    isSupported,
    onSpeechEnd,
  };
}
