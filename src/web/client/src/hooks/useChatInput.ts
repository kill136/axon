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
  handleSend: () => void;
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
}: UseChatInputParams): UseChatInputReturn {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || !connected) return;

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
        projectPath: currentProjectPath,
      },
    });

    setInput('');
    setAttachments([]);
    setStatus('thinking');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  // 命令选择
  const handleCommandSelect = (command: SlashCommand) => {
    setInput(command.name + ' ');
    setShowCommandPalette(false);
    inputRef.current?.focus();
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
        console.warn('未知的开发动作:', action);
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
  };
}
