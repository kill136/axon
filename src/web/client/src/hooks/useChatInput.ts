/**
 * useChatInput hook
 * 从 App.tsx 提取的输入框相关逻辑
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  ChatMessage,
  ChatContent,
  Attachment,
  PermissionRequest,
  UserQuestion,
  SlashCommand,
} from '../types';
import type { Status, PermissionMode } from './useMessageHandler';
import type { Project } from '../contexts/ProjectContext';
import { useVoiceRecognition } from './useVoiceRecognition';
import type { VoiceState } from './useVoiceRecognition';

interface UseChatInputParams {
  connected: boolean;
  send: (msg: any) => void;
  model: string;
  status: Status;
  setStatus: React.Dispatch<React.SetStateAction<Status>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  currentMessageRef: React.MutableRefObject<ChatMessage | null>;
  interruptPendingRef: React.MutableRefObject<boolean>;
  currentProjectPath?: string;
  permissionRequest: PermissionRequest | null;
  setPermissionRequest: React.Dispatch<React.SetStateAction<PermissionRequest | null>>;
  userQuestion: UserQuestion | null;
  setUserQuestion: React.Dispatch<React.SetStateAction<UserQuestion | null>>;
  setPermissionMode: React.Dispatch<React.SetStateAction<PermissionMode>>;
  sessionId: string | null;
  openFolder: () => Promise<Project | null>;
}

interface UseChatInputReturn {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  attachments: Attachment[];
  showCommandPalette: boolean;
  setShowCommandPalette: React.Dispatch<React.SetStateAction<boolean>>;
  isPinned: boolean;
  togglePin: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleSend: () => Promise<void>;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveAttachment: (id: string) => void;
  handleCommandSelect: (command: SlashCommand) => void;
  handleCancel: () => void;
  handleAnswerQuestion: (answer: string) => void;
  handlePermissionRespond: (approved: boolean, remember: boolean) => void;
  handlePermissionRespondWithDestination: (response: { approved: boolean; remember: boolean; destination: string }) => void;
  handlePermissionModeChange: (mode: PermissionMode) => void;
  handleDevAction: (action: string, data?: any) => void;
  // 语音识别
  voiceState: VoiceState;
  isVoiceSupported: boolean;
  voiceTranscript: string;
  toggleVoice: () => void;
}

export function useChatInput({
  connected,
  send,
  model,
  status,
  setStatus,
  messages,
  setMessages,
  currentMessageRef,
  interruptPendingRef,
  currentProjectPath,
  permissionRequest,
  setPermissionRequest,
  userQuestion,
  setUserQuestion,
  setPermissionMode,
  sessionId,
  openFolder,
}: UseChatInputParams): UseChatInputReturn {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [isPinned, setIsPinned] = useState(true);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 语音识别 - 使用 ref 持有 handleSend，避免循环依赖
  const handleSendRef = useRef<() => Promise<void>>(async () => {});

  const { voiceState, transcript: voiceTranscript, isSupported: isVoiceSupported, startListening, stopListening } = useVoiceRecognition({
    wakeWord: 'claude',
    silenceTimeout: 2000,
    lang: 'zh-CN',
    onCommand: (text) => {
      setInput(text);
      // 用 setTimeout 确保 setInput 先完成
      setTimeout(() => { handleSendRef.current(); }, 50);
    },
  });

  const toggleVoice = useCallback(() => {
    if (voiceState === 'idle') {
      startListening();
    } else {
      stopListening();
    }
  }, [voiceState, startListening, stopListening]);

  // 会话切换时清空输入框
  useEffect(() => {
    setInput('');
    setAttachments([]);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [sessionId]);

  // 文件处理
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const MAX_FILE_SIZE = 100 * 1024 * 1024;

    files.forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`文件过大: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)，最大支持 100MB`);
        return;
      }

      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();

      if (isImage) {
        reader.onload = (event) => {
          setAttachments(prev => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: file.name,
              type: 'image',
              mimeType: file.type,
              data: event.target?.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (event) => {
          setAttachments(prev => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: file.name,
              type: 'file',
              mimeType: file.type || 'application/octet-stream',
              data: event.target?.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    });

    if (e.target) {
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  // 粘贴处理
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments(prev => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: file.name || `粘贴的图片_${new Date().toLocaleTimeString()}.png`,
              type: 'image',
              mimeType: file.type,
              data: event.target?.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  // 发送消息
  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || !connected) return;

    // 未选择项目时，弹出目录选择对话框
    let effectiveProjectPath = currentProjectPath;
    if (!effectiveProjectPath) {
      try {
        const project = await openFolder();
        if (!project) return; // 用户取消了选择
        effectiveProjectPath = project.path;
      } catch (err) {
        console.error('Failed to open folder:', err);
        return;
      }
    }

    // 如果正在处理中，先取消当前回复（插话模式）
    if (status !== 'idle') {
      // 设置插话保护标记，直到新消息的 message_start 到达前，
      // 忽略来自旧消息的 status: idle 和 message_complete 事件
      interruptPendingRef.current = true;
      send({ type: 'cancel' });
      if (currentMessageRef.current) {
        const currentMsg = currentMessageRef.current;
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== currentMsg.id);
          return [...filtered, { ...currentMsg }];
        });
        currentMessageRef.current = null;
      }
    }

    // 检测斜杠命令：不显示用户消息气泡，直接发送给后端处理
    const trimmedInput = input.trim();
    if (trimmedInput.startsWith('/') && trimmedInput.length > 1 && !trimmedInput.startsWith('//')) {
      send({
        type: 'chat',
        payload: {
          content: trimmedInput,
          projectPath: effectiveProjectPath,
        },
      });
      setInput('');
      setShowCommandPalette(false);
      setStatus('thinking');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      return;
    }

    const contentItems: ChatContent[] = [];

    attachments.forEach(att => {
      if (att.type === 'image') {
        contentItems.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mimeType,
            data: att.data.split(',')[1],
          },
          fileName: att.name,
        });
      } else {
        contentItems.push({
          type: 'text',
          text: `[附件: ${att.name}]`,
        });
      }
    });

    if (input.trim()) {
      contentItems.push({ type: 'text', text: input });
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      timestamp: Date.now(),
      content: contentItems,
      attachments: attachments.map(a => ({ name: a.name, type: a.type })),
    };

    setMessages(prev => [...prev, userMessage]);

    send({
      type: 'chat',
      payload: {
        content: input,
        attachments: attachments.map(att => ({
          name: att.name,
          type: att.type,
          mimeType: att.mimeType,
          data: att.data.includes(',') ? att.data.split(',')[1] : att.data,
        })),
        projectPath: effectiveProjectPath,
      },
    });

    setInput('');
    setAttachments([]);
    setStatus('thinking');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  // 保持 handleSendRef 最新，供语音识别回调使用
  handleSendRef.current = handleSend;

  // 命令选择：选中后直接执行命令（与官方 CLI 行为一致）
  const handleCommandSelect = (command: SlashCommand) => {
    if (!connected) return;

    // 直接发送命令给后端执行
    let effectiveProjectPath = currentProjectPath;
    if (!effectiveProjectPath) {
      // 没有项目路径时，先填入输入框让用户选择项目后手动发送
      setInput(command.name + ' ');
      setShowCommandPalette(false);
      inputRef.current?.focus();
      return;
    }

    send({
      type: 'chat',
      payload: {
        content: command.name,
        projectPath: effectiveProjectPath,
      },
    });
    setInput('');
    setShowCommandPalette(false);
    setStatus('thinking');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  // 用户问答
  const handleAnswerQuestion = (answer: string) => {
    if (userQuestion) {
      send({
        type: 'user_answer',
        payload: { requestId: userQuestion.requestId, answer },
      });
      setUserQuestion(null);
    }
  };

  // 权限响应
  const handlePermissionRespond = (approved: boolean, remember: boolean) => {
    if (permissionRequest) {
      send({
        type: 'permission_response',
        payload: {
          requestId: permissionRequest.requestId,
          approved,
          remember,
          scope: remember ? 'session' : 'once',
        },
      });
      setPermissionRequest(null);
    }
  };

  const handlePermissionRespondWithDestination = (response: { approved: boolean; remember: boolean; destination: string }) => {
    if (permissionRequest) {
      send({
        type: 'permission_response',
        payload: {
          requestId: permissionRequest.requestId,
          approved: response.approved,
          remember: response.remember,
          scope: response.remember ? (response.destination === 'session' ? 'session' : 'always') : 'once',
          destination: response.destination,
        },
      });
      setPermissionRequest(null);
    }
  };

  // 输入处理
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setShowCommandPalette(value.startsWith('/') && value.length > 0);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // 命令面板打开时，不处理 Enter——交给 SlashCommandPalette 处理
      if (showCommandPalette) return;
      e.preventDefault();
      handleSend();
    }
  };

  // 取消/停止生成
  const handleCancel = useCallback(() => {
    send({ type: 'cancel' });
    if (currentMessageRef.current) {
      const currentMsg = currentMessageRef.current;
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== currentMsg.id);
        return [...filtered, { ...currentMsg }];
      });
      currentMessageRef.current = null;
    }
    setStatus('idle');
  }, [send, currentMessageRef, setMessages, setStatus]);

  // 权限模式切换
  const handlePermissionModeChange = useCallback((mode: PermissionMode) => {
    setPermissionMode(mode);
    send({ type: 'permission_config', payload: { mode } });
  }, [send, setPermissionMode]);

  // 持续开发动作处理
  const handleDevAction = useCallback((action: string, data?: any) => {
    switch (action) {
      case 'approve':
        send({ type: 'continuous_dev:approve' });
        break;
      case 'reject':
      case 'pause':
        send({ type: 'continuous_dev:pause' });
        break;
      case 'resume':
        send({ type: 'continuous_dev:resume' });
        break;
      case 'cancel':
        send({ type: 'continuous_dev:pause' });
        break;
      case 'rollback':
        send({ type: 'continuous_dev:rollback', payload: data });
        break;
      default:
        console.warn('Unknown dev action:', action);
    }
  }, [send]);

  // 切换输入框锁定状态
  const togglePin = useCallback(() => {
    setIsPinned(prev => !prev);
  }, []);

  return {
    input,
    setInput,
    attachments,
    showCommandPalette,
    setShowCommandPalette,
    isPinned,
    togglePin,
    inputRef: inputRef as React.RefObject<HTMLTextAreaElement>,
    fileInputRef: fileInputRef as React.RefObject<HTMLInputElement>,
    handleSend,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleFileSelect,
    handleRemoveAttachment,
    handleCommandSelect,
    handleCancel,
    handleAnswerQuestion,
    handlePermissionRespond,
    handlePermissionRespondWithDestination,
    handlePermissionModeChange,
    handleDevAction,
    // 语音识别
    voiceState,
    isVoiceSupported,
    voiceTranscript,
    toggleVoice,
  };
}
