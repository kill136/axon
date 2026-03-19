/**
 * NetworkPanel — Agent IM (WeChat-style)
 *
 * Three-column layout:
 * - Left: Contact list (agents + groups)
 * - Center: Chat window (message bubbles)
 * - Right: Agent profile (collapsible)
 *
 * Three states:
 * 1. Not enabled → Centered onboarding
 * 2. Enabled, no agents → Scanning animation
 * 3. Normal → IM layout
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLanguage } from '../../i18n';
import styles from './NetworkPanel.module.css';

// ===== Types =====

interface AgentIdentity {
  agentId: string;
  publicKey: string;
  name: string;
  owner: { name: string; publicKey: string };
  ownerCertificate: string;
  projects: Array<{ name: string; description?: string; gitRemote?: string; role?: string }>;
  capabilities: string[];
  exposedTools: string[];
  endpoint: string;
  version: string;
  protocolVersion: string;
  startedAt: number;
}

interface DiscoveredAgent {
  agentId: string;
  name: string;
  ownerFingerprint: string;
  projects: string[];
  endpoint: string;
  discoveredAt: number;
  lastSeenAt: number;
  trustLevel: 'self' | 'same-owner' | 'known' | 'unknown';
  online: boolean;
  identity?: AgentIdentity;
}

interface AuditLogEntry {
  id: string;
  timestamp: number;
  direction: 'inbound' | 'outbound';
  fromAgentId: string;
  fromName: string;
  toAgentId: string;
  toName: string;
  messageType: 'query' | 'task' | 'notify' | 'response' | 'chat';
  method: string;
  summary: string;
  success: boolean;
  error?: string;
  taskId?: string;
  payload?: string;
}

interface AgentGroup {
  id: string;
  name: string;
  avatarSeed?: string;
  members: string[];
  createdAt: number;
  lastActivity: number;
}

/** 聊天消息（来自 chat_messages 表） */
interface ChatMessage {
  id: string;
  conversationId: string;
  fromAgentId: string;
  fromName: string;
  text: string;
  replyTo?: { id: string; text: string };
  timestamp: number;
  status: 'sending' | 'sent' | 'delivered' | 'failed';
}

/** 会话摘要 */
interface ConversationSummary {
  id: string;
  lastMessage?: ChatMessage;
  unreadCount: number;
}

interface NetworkStatus {
  enabled: boolean;
  identity: AgentIdentity | null;
  agents: DiscoveredAgent[];
  groups: AgentGroup[];
  port: number;
  addresses?: string[];
}

// Contact item = agent or group
type ContactItem =
  | { type: 'agent'; agent: DiscoveredAgent; lastMessage?: AuditLogEntry; unread: number }
  | { type: 'group'; group: AgentGroup; lastMessage?: AuditLogEntry; unread: number };

// ===== Helpers =====

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'now';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getAgentIdForEntry(entry: AuditLogEntry, myId: string): string {
  return entry.direction === 'outbound' ? entry.toAgentId : entry.fromAgentId;
}

// ===== SVG Icons =====

const NetworkIcon = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <circle cx="32" cy="16" r="5" fill="currentColor" opacity="0.9" />
    <circle cx="16" cy="44" r="5" fill="currentColor" opacity="0.7" />
    <circle cx="48" cy="44" r="5" fill="currentColor" opacity="0.7" />
    <line x1="32" y1="21" x2="16" y2="39" stroke="currentColor" strokeWidth="2" opacity="0.5" />
    <line x1="32" y1="21" x2="48" y2="39" stroke="currentColor" strokeWidth="2" opacity="0.5" />
    <line x1="16" y1="44" x2="48" y2="44" stroke="currentColor" strokeWidth="2" opacity="0.3" />
  </svg>
);

const ScanIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
    <circle cx="24" cy="24" r="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
    <circle cx="24" cy="24" r="4" fill="currentColor" opacity="0.8" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GroupIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M10 9c1.7 0 3 1.3 4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M8 7v4M8 5.5v0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="3" cy="8" r="1.5" fill="currentColor" />
    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    <circle cx="13" cy="8" r="1.5" fill="currentColor" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 4h10M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4 4v7a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ReplyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M5 4L2 7l3 3M2 7h7a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SearchMsgIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2" />
    <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DoubleCheckIcon = () => (
  <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
    <path d="M1 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ===== Main Component =====

interface NetworkPanelProps {
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

export default function NetworkPanel({ addMessageHandler }: NetworkPanelProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [selectedContact, setSelectedContact] = useState<string | null>(null); // agentId or group:groupId
  const [showProfile, setShowProfile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [readMap, setReadMap] = useState<Record<string, number>>({}); // contactId -> lastReadTimestamp
  // Send state
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Dialogs
  const [showToolDialog, setShowToolDialog] = useState(false);
  const [showDelegateDialog, setShowDelegateDialog] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [toolName, setToolName] = useState('');
  const [toolParams, setToolParams] = useState('{}');
  const [delegateDesc, setDelegateDesc] = useState('');
  const [delegateContext, setDelegateContext] = useState('');
  const [groupName, setGroupName] = useState('');
  // More menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Reply quote
  const [replyTo, setReplyTo] = useState<AuditLogEntry | null>(null);
  // Message search within conversation
  const [chatSearch, setChatSearch] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: AuditLogEntry } | null>(null);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  // Manual connect
  const [manualEndpoint, setManualEndpoint] = useState('');
  const [manualConnecting, setManualConnecting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch data (只在 network enabled 时轮询)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchAll = async () => {
      try {
        const statusRes = await fetch('/api/network/status');
        const s = await statusRes.json();
        setStatus(s);

        // 只在 network enabled 时才拉取详细数据
        if (s.enabled) {
          const [auditRes, convRes] = await Promise.all([
            fetch('/api/network/audit?limit=500'),
            fetch('/api/network/conversations'),
          ]);
          const a = await auditRes.json();
          const c = await convRes.json();
          setAuditLog(a);
          setConversationSummaries(Array.isArray(c) ? c : []);
        }
      } catch (err) {
        console.warn('[NetworkPanel] fetch error:', err instanceof Error ? err.message : err);
      }
      setLoading(false);
    };

    fetchAll();
    // 只在 enabled 时才开启轮询
    if (status?.enabled) {
      interval = setInterval(fetchAll, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [status?.enabled]);

  // 通过 WebSocket 实时接收 network 事件（消息、Agent 变化、任务执行状态）
  useEffect(() => {
    if (!addMessageHandler) return;
    const unsub = addMessageHandler((msg: any) => {
      const { type, payload } = msg;
      switch (type) {
        case 'network:message': {
          // 新审计日志条目 → 追加到列表
          setAuditLog(prev => [...prev, payload]);
          break;
        }
        case 'network:agent_found':
        case 'network:agent_updated': {
          // Agent 上线/更新 → 更新 status.agents
          setStatus(prev => {
            if (!prev) return prev;
            const agents = prev.agents.filter(a => a.agentId !== payload.agentId);
            agents.push(payload);
            return { ...prev, agents };
          });
          break;
        }
        case 'network:agent_lost': {
          // Agent 离线 → 标记为 offline
          setStatus(prev => {
            if (!prev) return prev;
            const agents = prev.agents.map(a =>
              a.agentId === payload.agentId ? { ...a, online: false } : a
            );
            return { ...prev, agents };
          });
          break;
        }
        case 'network:task_executing': {
          // 本地委派任务执行状态变化 → 构造虚拟审计日志条目展示
          const taskEntry: AuditLogEntry = {
            id: `task-${payload.taskId}-${payload.status}`,
            timestamp: Date.now(),
            direction: 'inbound',
            fromAgentId: '',
            fromName: payload.fromName || 'Agent',
            toAgentId: '',
            toName: 'self',
            messageType: 'task',
            method: `task.${payload.status}`,
            summary: payload.status === 'failed'
              ? `Task failed: ${payload.error || payload.description}`
              : payload.status === 'completed'
              ? `Task completed: ${(payload.result || '').slice(0, 80)}`
              : `Task ${payload.status}: ${payload.description}`,
            success: payload.status !== 'failed',
            taskId: payload.taskId,
          };
          setAuditLog(prev => [...prev, taskEntry]);
          break;
        }
        case 'network:chat_message': {
          // 实时聊天消息 → 追加到对应会话
          const chatMsg = payload as ChatMessage;
          setChatMessages(prev => {
            const newMap = new Map(prev);
            const convMsgs = newMap.get(chatMsg.conversationId) || [];
            // 去重
            if (!convMsgs.some(m => m.id === chatMsg.id)) {
              newMap.set(chatMsg.conversationId, [...convMsgs, chatMsg]);
            }
            return newMap;
          });
          // 同时更新会话摘要
          setConversationSummaries(prev => {
            const idx = prev.findIndex(c => c.id === chatMsg.conversationId);
            const updated: ConversationSummary = {
              id: chatMsg.conversationId,
              lastMessage: chatMsg,
              unreadCount: 0,
            };
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            return [updated, ...prev];
          });
          break;
        }
      }
    });
    return unsub;
  }, [addMessageHandler]);

  // Scan timeout: after 15s without finding agents, show stable "no agents" state
  const isEnabled = status?.enabled ?? false;
  const otherAgents = (status?.agents || []).filter(a => a.agentId !== status?.identity?.agentId);
  const [scanTimedOut, setScanTimedOut] = useState(false);
  const [scanKey, setScanKey] = useState(0); // increment to restart scan timer
  useEffect(() => {
    if (isEnabled && otherAgents.length === 0) {
      setScanTimedOut(false);
      const timer = setTimeout(() => setScanTimedOut(true), 15_000);
      return () => clearTimeout(timer);
    } else {
      setScanTimedOut(false);
    }
  }, [isEnabled, otherAgents.length, scanKey]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [auditLog, chatMessages, selectedContact]);

  // Mark as read when selecting a contact
  useEffect(() => {
    if (selectedContact && auditLog.length > 0) {
      setReadMap(prev => ({ ...prev, [selectedContact]: Date.now() }));
    }
  }, [selectedContact]);

  // 按需加载选中会话的聊天消息
  useEffect(() => {
    if (!selectedContact) return;
    const conversationId = selectedContact.startsWith('group:')
      ? selectedContact  // 已经是 group:xxx 格式
      : `dm:${selectedContact}`; // 私聊用 dm:agentId
    // 如果已有缓存消息则不重复拉取
    if (chatMessages.has(conversationId) && chatMessages.get(conversationId)!.length > 0) return;
    fetch(`/api/network/messages?conversationId=${encodeURIComponent(conversationId)}&limit=200`)
      .then(r => r.json())
      .then((msgs: ChatMessage[]) => {
        if (Array.isArray(msgs) && msgs.length > 0) {
          setChatMessages(prev => {
            const newMap = new Map(prev);
            newMap.set(conversationId, msgs);
            return newMap;
          });
        }
      })
      .catch(() => {});
  }, [selectedContact]);

  const myId = status?.identity?.agentId || '';
  const agents = status?.agents || [];
  const groups = status?.groups || [];

  // Build conversation map
  const conversationMap = useMemo(() => {
    const map = new Map<string, AuditLogEntry[]>();
    for (const entry of auditLog) {
      const otherId = getAgentIdForEntry(entry, myId);
      if (!otherId || otherId === myId) continue;
      if (!map.has(otherId)) map.set(otherId, []);
      map.get(otherId)!.push(entry);
    }
    // Sort each conversation by time ascending
    for (const [, msgs] of map) {
      msgs.sort((a, b) => a.timestamp - b.timestamp);
    }
    return map;
  }, [auditLog, myId]);

  // 构建 conversationSummary 索引（conversationId → summary）
  const summaryMap = useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const s of conversationSummaries) {
      map.set(s.id, s);
    }
    return map;
  }, [conversationSummaries]);

  // 工具函数：从 ChatMessage 转为 AuditLogEntry（用于联系人列表的 lastMessage 兼容）
  const chatMsgToAuditEntry = useCallback((msg: ChatMessage): AuditLogEntry => ({
    id: msg.id,
    timestamp: msg.timestamp,
    direction: msg.fromAgentId === myId ? 'outbound' : 'inbound',
    fromAgentId: msg.fromAgentId,
    fromName: msg.fromName,
    toAgentId: '',
    toName: '',
    messageType: 'chat',
    method: 'agent.chat',
    summary: msg.text.slice(0, 120),
    success: true,
  }), [myId]);

  // Build contacts list
  const contacts: ContactItem[] = useMemo(() => {
    const items: ContactItem[] = [];

    // Agents (private chat)
    for (const agent of agents) {
      if (agent.agentId === myId) continue;
      const convId = `dm:${agent.agentId}`;
      const summary = summaryMap.get(convId);
      const lastMsg = summary?.lastMessage ? chatMsgToAuditEntry(summary.lastMessage) : undefined;
      // 从 chatMessages 计算未读（简单方式：lastRead 之后的入站消息数）
      const lastRead = readMap[agent.agentId] || 0;
      const cachedMsgs = chatMessages.get(convId) || [];
      const unread = cachedMsgs.filter(m => m.timestamp > lastRead && m.fromAgentId !== myId).length;
      items.push({ type: 'agent', agent, lastMessage: lastMsg, unread });
    }

    // Groups
    for (const group of groups) {
      const key = `group:${group.id}`;
      const summary = summaryMap.get(key);
      const lastMsg = summary?.lastMessage ? chatMsgToAuditEntry(summary.lastMessage) : undefined;
      const lastRead = readMap[key] || 0;
      const cachedMsgs = chatMessages.get(key) || [];
      const unread = cachedMsgs.filter(m => m.timestamp > lastRead && m.fromAgentId !== myId).length;
      items.push({ type: 'group', group, lastMessage: lastMsg, unread });
    }

    // Sort by last activity desc
    items.sort((a, b) => {
      const aTime = a.lastMessage?.timestamp || (a.type === 'agent' ? a.agent.discoveredAt : a.group.createdAt);
      const bTime = b.lastMessage?.timestamp || (b.type === 'agent' ? b.agent.discoveredAt : b.group.createdAt);
      return bTime - aTime;
    });

    return items;
  }, [agents, groups, summaryMap, chatMessages, readMap, myId, chatMsgToAuditEntry]);

  // Filter contacts
  const filteredContacts = useMemo(() => {
    if (!searchQuery) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(c => {
      if (c.type === 'agent') return c.agent.name.toLowerCase().includes(q);
      return c.group.name.toLowerCase().includes(q);
    });
  }, [contacts, searchQuery]);

  // Get chat messages for current conversation
  const currentChatMessages = useMemo((): ChatMessage[] => {
    if (!selectedContact) return [];
    const conversationId = selectedContact.startsWith('group:')
      ? selectedContact
      : `dm:${selectedContact}`;
    return chatMessages.get(conversationId) || [];
  }, [selectedContact, chatMessages]);

  // Get audit log messages for current chat (for non-chat entries like tool calls, tasks)
  const currentMessages = useMemo(() => {
    if (!selectedContact) return [];
    if (selectedContact.startsWith('group:')) {
      const groupId = selectedContact.slice(6);
      const group = groups.find(g => g.id === groupId);
      if (!group) return [];
      const msgs: AuditLogEntry[] = [];
      for (const memberId of group.members) {
        const m = conversationMap.get(memberId) || [];
        msgs.push(...m.filter(msg => getGroupIdFromPayload(msg) === groupId));
      }
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      return msgs;
    }
    return (conversationMap.get(selectedContact) || []).filter(msg => !getGroupIdFromPayload(msg));
  }, [selectedContact, conversationMap, groups]);

  // 合并显示：优先使用 chatMessages，如果没有则 fallback 到 auditLog
  const displayMessages = useMemo(() => {
    // 如果有 chatMessages，直接用（更干净的数据源）
    if (currentChatMessages.length > 0) {
      let msgs = currentChatMessages.map(chatMsgToAuditEntry);
      if (chatSearch.trim()) {
        const q = chatSearch.toLowerCase();
        msgs = msgs.filter(m => m.summary?.toLowerCase().includes(q));
      }
      return msgs;
    }
    // Fallback 到审计日志
    if (!chatSearch.trim()) return currentMessages;
    const q = chatSearch.toLowerCase();
    return currentMessages.filter(m =>
      m.summary?.toLowerCase().includes(q) || m.method?.toLowerCase().includes(q)
    );
  }, [currentChatMessages, currentMessages, chatSearch, chatMsgToAuditEntry]);

  // Current selected agent/group info
  const selectedAgent = agents.find(a => a.agentId === selectedContact);
  const selectedGroup = selectedContact?.startsWith('group:')
    ? groups.find(g => g.id === selectedContact!.slice(6))
    : null;
  const chatName = selectedAgent?.name || selectedGroup?.name || '';
  const chatOnline = selectedAgent?.online;

  // Toggle network
  const toggleNetwork = async (enabled: boolean) => {
    setToggling(true);
    try {
      const res = await fetch('/api/network/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh
        const statusRes = await fetch('/api/network/status');
        setStatus(await statusRes.json());
      }
    } catch { /* ignore */ }
    setToggling(false);
  };

  // Send message — supports both agent and group
  const doSend = async (method: string, params?: unknown) => {
    if (!selectedContact) return;
    setSending(true);
    setSendError(null);
    try {
      const isGroup = selectedContact.startsWith('group:');
      const res = isGroup
        ? await fetch('/api/network/group-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: selectedContact.slice(6), method, params }),
          })
        : await fetch('/api/network/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: selectedContact, method, params }),
          });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setSendError(data.error || `Failed (${res.status})`);
        // Auto-clear error after 5 seconds
        setTimeout(() => setSendError(null), 5000);
      }
      // Refresh audit
      const auditRes = await fetch('/api/network/audit?limit=500');
      setAuditLog(await auditRes.json());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setSendError(msg);
      setTimeout(() => setSendError(null), 5000);
    }
    setSending(false);
  };

  const handleSendMessage = () => {
    if (!messageText.trim()) return;
    const params: Record<string, unknown> = { message: messageText.trim() };
    if (replyTo) {
      params.replyTo = { id: replyTo.id, summary: replyTo.summary?.slice(0, 100) || '' };
    }
    doSend('agent.chat', params);
    setMessageText('');
    setReplyTo(null);
  };

  const handleClearChat = async () => {
    if (!selectedContact) return;
    const isGroup = selectedContact.startsWith('group:');

    // 清除 chat_messages
    const conversationId = isGroup ? selectedContact : `dm:${selectedContact}`;
    await fetch(`/api/network/messages?conversationId=${encodeURIComponent(conversationId)}`, { method: 'DELETE' }).catch(() => {});

    // 也清除审计日志（兼容旧数据）
    if (isGroup) {
      const groupId = selectedContact.slice(6);
      const group = groups.find(g => g.id === groupId);
      if (group) {
        for (const memberId of group.members) {
          await fetch(`/api/network/audit?agentId=${memberId}`, { method: 'DELETE' });
        }
      }
    } else {
      await fetch(`/api/network/audit?agentId=${selectedContact}`, { method: 'DELETE' });
    }

    // 清除前端缓存
    setChatMessages(prev => {
      const newMap = new Map(prev);
      newMap.delete(conversationId);
      return newMap;
    });

    const auditRes = await fetch('/api/network/audit?limit=500');
    setAuditLog(await auditRes.json());
    setShowMoreMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePing = () => doSend('agent.ping');
  const handleTrust = async (agentId: string, trust: boolean) => {
    await fetch('/api/network/trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, trust }),
    });
    const statusRes = await fetch('/api/network/status');
    setStatus(await statusRes.json());
  };
  const handleKick = async (agentId: string) => {
    await fetch('/api/network/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    setSelectedContact(null);
    const statusRes = await fetch('/api/network/status');
    setStatus(await statusRes.json());
  };

  const handleManualConnect = async () => {
    if (!manualEndpoint.trim()) return;
    setManualConnecting(true);
    setManualError(null);
    try {
      const res = await fetch('/api/network/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: manualEndpoint.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setManualError(data.error || `Failed (${res.status})`);
      } else {
        setManualEndpoint('');
        // Refresh status
        const statusRes = await fetch('/api/network/status');
        setStatus(await statusRes.json());
      }
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Connection failed');
    }
    setManualConnecting(false);
  };

  const handleCallTool = () => {
    try {
      const params = JSON.parse(toolParams);
      doSend('agent.callTool', { toolName, toolInput: params });
    } catch {
      doSend('agent.callTool', { toolName, toolInput: {} });
    }
    setShowToolDialog(false);
    setToolName('');
    setToolParams('{}');
  };

  const handleDelegate = () => {
    doSend('agent.delegateTask', { description: delegateDesc, context: delegateContext });
    setShowDelegateDialog(false);
    setDelegateDesc('');
    setDelegateContext('');
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || groupMembers.length === 0) return;
    await fetch('/api/network/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, members: groupMembers }),
    });
    setShowGroupDialog(false);
    setGroupName('');
    setGroupMembers([]);
    const statusRes = await fetch('/api/network/status');
    setStatus(await statusRes.json());
  };

  const handleDeleteGroup = async (groupId: string) => {
    await fetch(`/api/network/groups/${groupId}`, { method: 'DELETE' });
    if (selectedContact === `group:${groupId}`) setSelectedContact(null);
    const statusRes = await fetch('/api/network/status');
    setStatus(await statusRes.json());
  };

  // ===== Render =====

  if (loading) {
    return <div className={styles.loadingState}>{t('network.loading')}</div>;
  }

  // State 1: Not Enabled
  if (!status?.enabled) {
    return (
      <div className={styles.onboardingContainer}>
        <div className={styles.onboardingContent}>
          <div className={styles.onboardingIcon}><NetworkIcon /></div>
          <h2 className={styles.onboardingTitle}>{t('network.title')}</h2>
          <p className={styles.onboardingDesc}>{t('network.onboardingDesc')}</p>
          <button
            className={`${styles.toggleBtn} ${toggling ? styles.toggleBtnLoading : ''}`}
            onClick={() => toggleNetwork(true)}
            disabled={toggling}
          >
            {toggling ? t('network.enabling') : t('network.enable')}
          </button>
        </div>
      </div>
    );
  }

  // State 2: Enabled, no agents
  if (agents.length === 0 || (agents.length === 1 && agents[0].agentId === myId)) {
    return (
      <div className={styles.panel}>
        <div className={styles.identityBanner}>
          <div className={styles.identityLeft}>
            <div className={styles.statusDot + ' ' + styles.dotOnline} />
            <div>
              <div className={styles.identityName}>{status.identity?.name}</div>
              <div className={styles.identityDetail}>
                Port {status.port} · {status.identity?.exposedTools?.length || 0} tools
              </div>
            </div>
          </div>
          <button className={styles.disableBtn} onClick={() => toggleNetwork(false)} disabled={toggling}>
            {toggling ? t('network.disabling') : t('network.disable')}
          </button>
        </div>
        <div className={styles.scanningContainer}>
          {scanTimedOut ? (
            <>
              <div className={styles.scanningIcon}><NetworkIcon /></div>
              <h3 className={styles.scanningTitle}>{t('network.noAgentsFound')}</h3>
              <p className={styles.scanningHint}>{t('network.scanTimeoutHint')}</p>
              <button
                className={styles.retryBtn}
                onClick={() => setScanKey(k => k + 1)}
              >
                {t('network.rescan')}
              </button>
              <div className={styles.manualConnect}>
                <p className={styles.manualConnectLabel}>{t('network.manualConnect')}</p>
                <div className={styles.manualConnectRow}>
                  <input
                    className={styles.manualConnectInput}
                    placeholder="192.168.1.100:7860"
                    value={manualEndpoint}
                    onChange={e => setManualEndpoint(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleManualConnect()}
                    disabled={manualConnecting}
                  />
                  <button
                    className={styles.retryBtn}
                    onClick={handleManualConnect}
                    disabled={!manualEndpoint.trim() || manualConnecting}
                  >
                    {manualConnecting ? '...' : t('network.connect')}
                  </button>
                </div>
                {manualError && <p className={styles.manualConnectError}>{manualError}</p>}
              </div>
            </>
          ) : (
            <>
              <div className={styles.scanningAnimation}><ScanIcon /></div>
              <h3 className={styles.scanningTitle}>{t('network.scanning')}</h3>
              <p className={styles.scanningHint}>{t('network.scanningHint')}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // State 3: Normal — IM Layout
  return (
    <div className={styles.imLayout}>
      {/* Left: Contact List */}
      <div className={styles.contactPanel}>
        <div className={styles.contactHeader}>
          <div className={styles.contactHeaderLeft}>
            <div className={styles.statusDot + ' ' + styles.dotOnline} />
            <span className={styles.contactHeaderName}>{status.identity?.name}</span>
          </div>
          <button className={styles.iconBtn} onClick={() => setShowGroupDialog(true)} title={t('network.group.create')}>
            <PlusIcon />
          </button>
        </div>

        <div className={styles.searchBox}>
          <input
            className={styles.searchInput}
            placeholder={t('network.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className={styles.searchClear} onClick={() => setSearchQuery('')}><CloseIcon /></button>
          )}
        </div>

        <div className={styles.contactList}>
          {filteredContacts.map(contact => {
            const id = contact.type === 'agent' ? contact.agent.agentId : `group:${contact.group.id}`;
            const name = contact.type === 'agent' ? contact.agent.name : contact.group.name;
            const isOnline = contact.type === 'agent' ? contact.agent.online : true;
            const isActive = selectedContact === id;
            let preview: string;
            if (contact.lastMessage) {
              // Try extracting chat text from payload first
              let parsed: any = null;
              try { parsed = contact.lastMessage.payload ? JSON.parse(contact.lastMessage.payload) : null; } catch { /* */ }
              const chatText = extractChatText(contact.lastMessage, parsed);
              preview = chatText ? chatText.slice(0, 60) : (
                contact.lastMessage.summary && contact.lastMessage.summary !== `Request: ${contact.lastMessage.method}`
                  ? contact.lastMessage.summary.slice(0, 60)
                  : contact.lastMessage.method.slice(0, 60)
              );
            } else {
              preview = contact.type === 'agent'
                ? contact.agent.endpoint
                : t('network.group.memberCount', { count: contact.group.members.length });
            }

            return (
              <button
                key={id}
                className={`${styles.contactItem} ${isActive ? styles.contactActive : ''}`}
                onClick={() => {
                  setSelectedContact(id);
                  setReadMap(prev => ({ ...prev, [id]: Date.now() }));
                }}
              >
                <div className={styles.avatarWrapper}>
                  <div
                    className={styles.avatar}
                    style={{ background: getAvatarColor(id) }}
                  >
                    {contact.type === 'group' ? <GroupIcon /> : getInitials(name)}
                  </div>
                  {contact.type === 'agent' && (
                    <div className={`${styles.statusIndicator} ${isOnline ? styles.indicatorOnline : styles.indicatorOffline}`} />
                  )}
                </div>
                <div className={styles.contactInfo}>
                  <div className={styles.contactRow}>
                    <span className={styles.contactName}>{name}</span>
                    {contact.lastMessage && (
                      <span className={styles.contactTime}>{formatTime(contact.lastMessage.timestamp)}</span>
                    )}
                  </div>
                  <div className={styles.contactRow}>
                    <span className={styles.contactPreview}>{preview}</span>
                    {contact.unread > 0 && (
                      <span className={styles.unreadBadge}>{contact.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {filteredContacts.length === 0 && (
            <div className={styles.emptyContacts}>{t('network.noAgentsFound')}</div>
          )}
        </div>
      </div>

      {/* Center: Chat Window */}
      <div className={styles.chatPanel}>
        {selectedContact ? (
          <>
            {/* Chat Header */}
            <div className={styles.chatHeader}>
              <div className={styles.chatHeaderLeft}>
                {selectedAgent && (
                  <div className={`${styles.statusDot} ${chatOnline ? styles.dotOnline : styles.dotOffline}`} />
                )}
                <span className={styles.chatHeaderName}>{chatName}</span>
                {selectedAgent && (
                  <TrustBadge level={selectedAgent.trustLevel} t={t} />
                )}
                {selectedGroup && (
                  <span className={styles.memberCount}>
                    {t('network.group.memberCount', { count: selectedGroup.members.length })}
                  </span>
                )}
              </div>
              <div className={styles.chatHeaderRight}>
                <button className={styles.iconBtn} onClick={() => { setShowChatSearch(!showChatSearch); setChatSearch(''); }} title={t('network.searchMessages')}>
                  <SearchMsgIcon />
                </button>
                {selectedAgent && (
                  <button className={styles.iconBtn} onClick={() => setShowProfile(!showProfile)} title={t('network.agentProfile')}>
                    <InfoIcon />
                  </button>
                )}
                <div className={styles.moreMenuWrapper}>
                  <button className={styles.iconBtn} onClick={() => setShowMoreMenu(!showMoreMenu)} title={t('network.more')}>
                    <MoreIcon />
                  </button>
                  {showMoreMenu && (
                    <div className={styles.moreMenu} onMouseLeave={() => setShowMoreMenu(false)}>
                      <button className={styles.moreMenuItem} onClick={handleClearChat}>
                        <TrashIcon /> {t('network.clearChat')}
                      </button>
                      {selectedGroup && (
                        <button className={styles.moreMenuItem} onClick={() => { handleDeleteGroup(selectedGroup.id); setShowMoreMenu(false); }}>
                          <CloseIcon /> {t('network.group.delete')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Chat search bar (toggled) */}
            {showChatSearch && (
              <div className={styles.chatSearchBar}>
                <SearchMsgIcon />
                <input
                  className={styles.chatSearchInput}
                  placeholder={t('network.searchMessages')}
                  value={chatSearch}
                  onChange={e => setChatSearch(e.target.value)}
                  autoFocus
                />
                {chatSearch && (
                  <span className={styles.chatSearchCount}>
                    {displayMessages.length} / {currentMessages.length}
                  </span>
                )}
                <button className={styles.iconBtn} onClick={() => { setShowChatSearch(false); setChatSearch(''); }}>
                  <CloseIcon />
                </button>
              </div>
            )}

            {/* Messages */}
            <div className={styles.chatMessages} onClick={() => { setShowMoreMenu(false); setContextMenu(null); }}>
              {displayMessages.length === 0 ? (
                <div className={styles.emptyChatState}>
                  <div className={styles.emptyChatIcon}>
                    <NetworkIcon />
                  </div>
                  <p>{chatSearch ? t('network.noSearchResults') : t('network.noMessages')}</p>
                  <p className={styles.emptyChatHint}>{chatSearch ? '' : t('network.noMessagesHint')}</p>
                </div>
              ) : (
                <div className={styles.messageList}>
                  {groupCollapsibleMessages(displayMessages).map((item, idx) =>
                    item.type === 'collapsed' ? (
                      <CollapsedMessages key={`collapsed-${idx}`} entries={item.entries} t={t} />
                    ) : (
                      <MessageBubble
                        key={item.entry.id}
                        entry={item.entry}
                        myId={myId}
                        agents={agents}
                        t={t}
                        isGroupChat={!!selectedGroup}
                        onReply={(entry) => { setReplyTo(entry); inputRef.current?.focus(); }}
                        onContextMenu={(e, entry) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, entry });
                        }}
                      />
                    )
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Context menu */}
            {contextMenu && (
              <div
                className={styles.contextMenu}
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onMouseLeave={() => setContextMenu(null)}
              >
                <button className={styles.contextMenuItem} onClick={() => {
                  setReplyTo(contextMenu.entry);
                  setContextMenu(null);
                  inputRef.current?.focus();
                }}>
                  <ReplyIcon /> {t('network.reply')}
                </button>
                <button className={styles.contextMenuItem} onClick={() => {
                  const text = contextMenu.entry.summary || '';
                  navigator.clipboard.writeText(text);
                  setContextMenu(null);
                }}>
                  {t('network.copy')}
                </button>
              </div>
            )}

            {/* Input area — works for both agent and group */}
            <div className={styles.inputArea}>
              <div className={styles.quickActions}>
                <button className={styles.quickBtn} onClick={handlePing} disabled={sending} title="Ping">
                  Ping
                </button>
                <button className={styles.quickBtn} onClick={() => setShowToolDialog(true)} disabled={sending} title={t('network.quickCallTool')}>
                  {t('network.quickCallTool')}
                </button>
                <button className={styles.quickBtn} onClick={() => setShowDelegateDialog(true)} disabled={sending} title={t('network.quickDelegate')}>
                  {t('network.quickDelegate')}
                </button>
              </div>
              {sendError && (
                <div className={styles.sendError}>{sendError}</div>
              )}
              {/* Reply preview */}
              {replyTo && (
                <div className={styles.replyPreview}>
                  <div className={styles.replyPreviewBar} />
                  <div className={styles.replyPreviewContent}>
                    <span className={styles.replyPreviewName}>
                      {replyTo.direction === 'outbound' ? t('network.you') : replyTo.fromName}
                    </span>
                    <span className={styles.replyPreviewText}>{replyTo.summary?.slice(0, 80)}</span>
                  </div>
                  <button className={styles.iconBtn} onClick={() => setReplyTo(null)}>
                    <CloseIcon />
                  </button>
                </div>
              )}
              <div className={styles.inputRow}>
                <textarea
                  ref={inputRef}
                  className={styles.messageInput}
                  placeholder={t('network.messageInput')}
                  value={messageText}
                  onChange={e => {
                    setMessageText(e.target.value);
                    // Auto-resize textarea
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button
                  className={styles.sendBtn}
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() || sending}
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyChatState}>
            <div className={styles.emptyChatIcon}><NetworkIcon /></div>
            <p>{t('network.selectAgent')}</p>
            <p className={styles.emptyChatHint}>{t('network.selectAgentHint')}</p>
          </div>
        )}
      </div>

      {/* Right: Agent Profile (collapsible) */}
      {showProfile && selectedAgent && (
        <AgentProfilePanel
          agent={selectedAgent}
          t={t}
          onClose={() => setShowProfile(false)}
          onTrust={(trust) => handleTrust(selectedAgent.agentId, trust)}
          onKick={() => handleKick(selectedAgent.agentId)}
        />
      )}

      {/* Dialogs */}
      {showToolDialog && (
        <Dialog title={t('network.toolDialog.title')} onClose={() => setShowToolDialog(false)}>
          <div className={styles.dialogBody}>
            <label className={styles.dialogLabel}>{t('network.toolDialog.toolName')}</label>
            {selectedAgent?.identity?.exposedTools?.length ? (
              <select className={styles.dialogSelect} value={toolName} onChange={e => setToolName(e.target.value)}>
                <option value="">--</option>
                {selectedAgent.identity.exposedTools.map(tool => (
                  <option key={tool} value={tool}>{tool}</option>
                ))}
              </select>
            ) : (
              <input className={styles.dialogInput} value={toolName} onChange={e => setToolName(e.target.value)} placeholder="Read" />
            )}
            <label className={styles.dialogLabel}>{t('network.toolDialog.params')}</label>
            <textarea className={styles.dialogTextarea} value={toolParams} onChange={e => setToolParams(e.target.value)} rows={4} />
            <button className={styles.dialogBtn} onClick={handleCallTool} disabled={!toolName}>{t('network.send')}</button>
          </div>
        </Dialog>
      )}

      {showDelegateDialog && (
        <Dialog title={t('network.delegateDialog.title')} onClose={() => setShowDelegateDialog(false)}>
          <div className={styles.dialogBody}>
            <label className={styles.dialogLabel}>{t('network.delegateDialog.desc')}</label>
            <textarea className={styles.dialogTextarea} value={delegateDesc} onChange={e => setDelegateDesc(e.target.value)} rows={3} placeholder="Run all tests..." />
            <label className={styles.dialogLabel}>{t('network.delegateDialog.context')}</label>
            <textarea className={styles.dialogTextarea} value={delegateContext} onChange={e => setDelegateContext(e.target.value)} rows={3} placeholder="Recent changes in src/..." />
            <button className={styles.dialogBtn} onClick={handleDelegate} disabled={!delegateDesc.trim()}>{t('network.send')}</button>
          </div>
        </Dialog>
      )}

      {showGroupDialog && (
        <Dialog title={t('network.group.create')} onClose={() => setShowGroupDialog(false)}>
          <div className={styles.dialogBody}>
            <label className={styles.dialogLabel}>{t('network.group.name')}</label>
            <input className={styles.dialogInput} value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="My Team" />
            <label className={styles.dialogLabel}>{t('network.group.selectMembers')}</label>
            <div className={styles.memberSelector}>
              {agents.filter(a => a.agentId !== myId).map(agent => (
                <label key={agent.agentId} className={styles.memberOption}>
                  <input
                    type="checkbox"
                    checked={groupMembers.includes(agent.agentId)}
                    onChange={e => {
                      if (e.target.checked) {
                        setGroupMembers(prev => [...prev, agent.agentId]);
                      } else {
                        setGroupMembers(prev => prev.filter(id => id !== agent.agentId));
                      }
                    }}
                  />
                  <div className={styles.avatar} style={{ background: getAvatarColor(agent.agentId), width: 24, height: 24, fontSize: 11 }}>
                    {getInitials(agent.name)}
                  </div>
                  <span>{agent.name}</span>
                  <div className={`${styles.statusDot} ${agent.online ? styles.dotOnline : styles.dotOffline}`} style={{ width: 6, height: 6 }} />
                </label>
              ))}
            </div>
            <button className={styles.dialogBtn} onClick={handleCreateGroup} disabled={!groupName.trim() || groupMembers.length === 0}>
              {t('network.group.create')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ===== Sub Components =====

function TrustBadge({ level, t }: { level: string; t: (key: string) => string }) {
  const cls = level === 'self' ? styles.trustSelf
    : level === 'same-owner' ? styles.trustSameOwner
    : level === 'known' ? styles.trustKnown
    : styles.trustUnknown;
  const label = t(`network.trustLevel.${level === 'same-owner' ? 'sameOwner' : level}`);
  return <span className={`${styles.trustBadge} ${cls}`}>{label}</span>;
}

/**
 * Check if a message is a "system/protocol" message that can be collapsed.
 * These are simple ack responses, ping/pong pairs, and bare response confirmations
 * that add noise to the chat without meaningful content.
 */
export function isCollapsibleSystemMessage(entry: AuditLogEntry): boolean {
  // ALL response messages are collapsible — they are protocol-level ack,
  // not user-facing content. The meaningful content is in the original request.
  if (entry.messageType === 'response') {
    return true;
  }
  // Outbound ping request
  if (entry.method === 'agent.ping' && entry.messageType !== 'response') {
    return true;
  }
  // agent.getIdentity, agent.listTools — protocol handshake
  if (entry.method === 'agent.getIdentity' || entry.method === 'agent.listTools') {
    return true;
  }
  return false;
}

/**
 * Find the last non-system message for contact preview.
 * Falls back to the last message if all are system messages.
 */
function findLastMeaningfulMessage(msgs: AuditLogEntry[]): AuditLogEntry | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (!isCollapsibleSystemMessage(msgs[i])) return msgs[i];
  }
  return msgs[msgs.length - 1]; // fallback
}

/**
 * Summarize a group of collapsed system messages into a short label.
 */
export function summarizeCollapsedMessages(entries: AuditLogEntry[]): string {
  const pings = entries.filter(e => e.method === 'agent.ping').length;
  const acks = entries.filter(e => e.messageType === 'response').length;
  const parts: string[] = [];
  if (pings > 0) parts.push(`${pings} ping`);
  if (acks > 0) parts.push(`${acks > 1 ? acks + ' ' : ''}ack`);
  if (parts.length === 0) parts.push(`${entries.length} system`);
  return parts.join(' · ');
}

/**
 * Group consecutive collapsible messages in a message list.
 * Returns an array of { type: 'message', entry } | { type: 'collapsed', entries }.
 */
export type RenderItem =
  | { type: 'message'; entry: AuditLogEntry }
  | { type: 'collapsed'; entries: AuditLogEntry[] };

export function groupCollapsibleMessages(messages: AuditLogEntry[]): RenderItem[] {
  const result: RenderItem[] = [];
  let collapsibleBuf: AuditLogEntry[] = [];

  const flushBuf = () => {
    if (collapsibleBuf.length === 0) return;
    if (collapsibleBuf.length === 1) {
      // Single collapsible message — still show it collapsed for consistency
      result.push({ type: 'collapsed', entries: [...collapsibleBuf] });
    } else {
      result.push({ type: 'collapsed', entries: [...collapsibleBuf] });
    }
    collapsibleBuf = [];
  };

  for (const entry of messages) {
    if (isCollapsibleSystemMessage(entry)) {
      collapsibleBuf.push(entry);
    } else {
      flushBuf();
      result.push({ type: 'message', entry });
    }
  }
  flushBuf();
  return result;
}

/**
 * Collapsed system messages indicator — like Feishu "read receipt" style divider.
 */
function CollapsedMessages({ entries, t }: { entries: AuditLogEntry[]; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeCollapsedMessages(entries);
  const time = formatFullTime(entries[entries.length - 1].timestamp);

  return (
    <div className={styles.collapsedGroup}>
      <div className={styles.collapsedDivider} onClick={() => setExpanded(!expanded)}>
        <span className={styles.collapsedLine} />
        <span className={styles.collapsedLabel}>
          {summary} · {time} {expanded ? '▲' : '▼'}
        </span>
        <span className={styles.collapsedLine} />
      </div>
      {expanded && (
        <div className={styles.collapsedExpanded}>
          {entries.map(e => (
            <div key={e.id} className={styles.collapsedEntry}>
              <span className={styles.collapsedEntryDir}>{e.direction === 'outbound' ? '→' : '←'}</span>
              <span className={styles.collapsedEntryMethod}>{e.method}</span>
              {e.messageType === 'response' && <span className={styles.collapsedEntryAck}>✓</span>}
              <span className={styles.collapsedEntryTime}>{formatFullTime(e.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Truncate a string for display, adding ellipsis if needed
 */
function truncateStr(s: string, maxLen: number): string {
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/**
 * Render a JSON-like value as a compact preview
 */
function compactJson(value: unknown, maxLen = 200): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return truncateStr(value, maxLen);
  try {
    const s = JSON.stringify(value);
    return truncateStr(s, maxLen);
  } catch {
    return String(value);
  }
}

/**
 * Extract _groupId from a message payload.
 * Returns the groupId string if present, or null if this is a private message.
 */
function getGroupIdFromPayload(entry: AuditLogEntry): string | null {
  if (!entry.payload) return null;
  try {
    const parsed = JSON.parse(entry.payload);
    return parsed?.params?._groupId || null;
  } catch {
    return null;
  }
}

/**
 * Extract human-readable chat text from an audit log entry.
 * Returns the text if this is a conversational message, null otherwise.
 *
 * Handles multiple payload structures:
 * - messageType === 'chat' with summary
 * - Full AgentMessage: { jsonrpc, method, params: { message/content }, _meta }
 * - Simplified: { params: { message/content } }
 */
export function extractChatText(entry: AuditLogEntry, parsedPayload: any): string | null {
  // 1. messageType === 'chat' — backend already classified it
  if (entry.messageType === 'chat') {
    if (entry.summary && entry.summary !== `Request: ${entry.method}`) {
      return entry.summary;
    }
  }
  // 2. params.message or params.content — check parsedPayload.params (AgentMessage format)
  //    Payload structure: { jsonrpc, id, method, params: { message/content }, _meta }
  const params = parsedPayload?.params;
  if (params && typeof params === 'object') {
    if (typeof params.message === 'string' && params.message.trim()) return params.message;
    if (typeof params.content === 'string' && params.content.trim()) return params.content;
  }
  // 3. Top-level message/content (simplified payloads or result objects)
  if (parsedPayload && typeof parsedPayload === 'object') {
    if (typeof parsedPayload.message === 'string' && parsedPayload.message.trim()) return parsedPayload.message;
    if (typeof parsedPayload.content === 'string' && parsedPayload.content.trim()) return parsedPayload.content;
    // 4. result.message or result.content (response payloads: { result: { message: "..." } })
    const result = parsedPayload.result;
    if (result && typeof result === 'object') {
      if (typeof result.message === 'string' && result.message.trim()) return result.message;
      if (typeof result.content === 'string' && result.content.trim()) return result.content;
    }
  }
  // 5. For methods that look like chat (agent.message, agent.chat, etc), try summary as last resort
  if (entry.method?.includes('message') || entry.method?.includes('chat')) {
    if (entry.summary && entry.summary !== `Request: ${entry.method}`) {
      return entry.summary;
    }
  }
  return null;
}

function MessageBubble({ entry, myId, agents, t, isGroupChat, onReply, onContextMenu }: {
  entry: AuditLogEntry;
  myId: string;
  agents: DiscoveredAgent[];
  t: (key: string) => string;
  isGroupChat?: boolean;
  onReply?: (entry: AuditLogEntry) => void;
  onContextMenu?: (e: React.MouseEvent, entry: AuditLogEntry) => void;
}) {
  const isOutbound = entry.direction === 'outbound';
  const otherId = isOutbound ? entry.toAgentId : entry.fromAgentId;
  const otherName = isOutbound ? entry.toName : entry.fromName;
  // 群聊中所有入站消息显示发送者名字
  const senderName = isGroupChat ? entry.fromName : otherName;
  const [expanded, setExpanded] = useState(false);

  // Parse payload for rich display
  let parsedPayload: any = null;
  if (entry.payload) {
    try { parsedPayload = JSON.parse(entry.payload); } catch { /* ignore */ }
  }
  const params = parsedPayload?.params;

  // Try to extract chat text — if found, render as clean chat bubble
  const chatText = extractChatText(entry, parsedPayload);

  // Check for replyTo in params
  const replyToData = parsedPayload?.params?.replyTo as { id?: string; summary?: string } | undefined;

  // Determine card type (only matters for non-chat messages)
  const isTask = entry.method.includes('delegateTask') || entry.method.includes('task.');
  const isCallTool = entry.method === 'agent.callTool';
  const isProgress = entry.method === 'agent.progress';
  const isNotify = entry.messageType === 'notify';

  return (
    <div
      className={`${styles.bubble} ${isOutbound ? styles.bubbleOut : styles.bubbleIn}`}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, entry) : undefined}
    >
      {!isOutbound && (
        <div className={styles.bubbleAvatar} style={{ background: getAvatarColor(isGroupChat ? entry.fromAgentId || otherId : otherId) }}>
          {getInitials(senderName)}
        </div>
      )}
      <div className={styles.bubbleContent}>
        {!isOutbound && <div className={styles.bubbleSender}>{senderName}</div>}
        {chatText ? (
          /* Chat message — clean text bubble, no method tags */
          <div className={`${styles.bubbleCard} ${styles.chatBubble}`}>
            {/* Reply quote */}
            {replyToData?.summary && (
              <div className={styles.replyQuote}>
                <div className={styles.replyQuoteBar} />
                <span className={styles.replyQuoteText}>{replyToData.summary}</span>
              </div>
            )}
            <div className={styles.chatText}>{chatText}</div>
          </div>
        ) : (
          <div
            className={`${styles.bubbleCard} ${!entry.success ? styles.bubbleError : ''} ${isTask || isProgress ? styles.bubbleTask : ''}`}
            onClick={() => setExpanded(!expanded)}
          >
            {/* Method tag */}
            <div className={styles.bubbleMethod}>
              <span className={styles.methodTag}>{entry.method}</span>
              {!entry.success && <span className={styles.errorDot} />}
            </div>

            {/* ===== Rich content by type ===== */}

            {/* CallTool */}
            {isCallTool && (params?.toolName || parsedPayload?.params?.toolName) && (
              <div className={styles.richContent}>
                <div className={styles.bubbleText}>
                  Tool: <code>{params?.toolName || parsedPayload?.params?.toolName}</code>
                </div>
                {(params?.toolInput || parsedPayload?.params?.toolInput) && (
                  <div className={styles.paramBlock}>
                    <div className={styles.paramLabel}>Input</div>
                    <pre className={styles.paramValue}>{compactJson(params?.toolInput || parsedPayload?.params?.toolInput, 300)}</pre>
                  </div>
                )}
              </div>
            )}

            {/* DelegateTask */}
            {isTask && !isProgress && (
              <div className={styles.richContent}>
                <div className={styles.taskCard}>
                  <div className={styles.taskTitle}>
                    {params?.description || parsedPayload?.params?.description || entry.summary}
                  </div>
                  {entry.taskId && <div className={styles.taskIdLabel}>Task: {entry.taskId.slice(0, 8)}</div>}
                </div>
                {(params?.context || parsedPayload?.params?.context) && (
                  <div className={styles.paramBlock}>
                    <div className={styles.paramLabel}>Context</div>
                    <pre className={styles.paramValue}>{truncateStr(params?.context || parsedPayload?.params?.context, 300)}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Progress notification */}
            {isProgress && (
              <div className={styles.richContent}>
                <div className={styles.progressInfo}>
                  {entry.taskId && <div className={styles.taskIdLabel}>Task: {entry.taskId.slice(0, 8)}</div>}
                  {params?.status && (
                    <div className={styles.progressStatus} data-status={params.status}>
                      {params.status}
                    </div>
                  )}
                  {params?.description && (
                    <div className={styles.bubbleText}>{params.description}</div>
                  )}
                  {params?.message && (
                    <div className={styles.bubbleText} style={{ opacity: 0.8 }}>{params.message}</div>
                  )}
                  {typeof params?.progress === 'number' && (
                    <div className={styles.progressBarContainer}>
                      <div className={styles.progressBar} style={{ width: `${Math.min(100, params.progress)}%` }} />
                      <span className={styles.progressPercent}>{params.progress}%</span>
                    </div>
                  )}
                  {params?.error && (
                    <div className={styles.bubbleErrorText}>{params.error}</div>
                  )}
                </div>
              </div>
            )}

            {/* Notify with message */}
            {isNotify && !isProgress && !isTask && params?.message && (
              <div className={styles.bubbleText}>{params.message}</div>
            )}

            {/* Fallback: nothing rendered above → show summary */}
            {!isCallTool && !isTask && !isProgress
              && !(isNotify && params?.message) && (
              <div className={styles.bubbleText}>{entry.summary}</div>
            )}

            {entry.error && (
              <div className={styles.bubbleErrorText}>{entry.error}</div>
            )}

            {/* Expand hint */}
            {entry.payload && (
              <div className={styles.expandHint}>
                {expanded ? '▲ collapse' : '▼ details'}
              </div>
            )}

            {/* Expanded: show raw payload */}
            {expanded && entry.payload && (
              <pre className={styles.bubblePayload}>{JSON.stringify(parsedPayload, null, 2)}</pre>
            )}
          </div>
        )}
        <div className={styles.bubbleFooter}>
          <span className={styles.bubbleTime}>{formatFullTime(entry.timestamp)}</span>
          {isOutbound && (
            <span className={styles.deliveryStatus}>
              {!entry.success ? (
                <span className={styles.deliveryFailed}>!</span>
              ) : entry.messageType === 'chat' ? (
                <DoubleCheckIcon />
              ) : (
                <CheckIcon />
              )}
            </span>
          )}
          {onReply && chatText && (
            <button className={styles.replyBtn} onClick={() => onReply(entry)} title="Reply">
              <ReplyIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentProfilePanel({ agent, t, onClose, onTrust, onKick }: {
  agent: DiscoveredAgent;
  t: (key: string) => string;
  onClose: () => void;
  onTrust: (trust: boolean) => void;
  onKick: () => void;
}) {
  const identity = agent.identity;
  return (
    <div className={styles.profilePanel}>
      <div className={styles.profileHeader}>
        <span className={styles.profileTitle}>{t('network.agentProfile')}</span>
        <button className={styles.iconBtn} onClick={onClose}><CloseIcon /></button>
      </div>
      <div className={styles.profileBody}>
        {/* Big avatar */}
        <div className={styles.profileAvatarSection}>
          <div className={styles.profileAvatar} style={{ background: getAvatarColor(agent.agentId) }}>
            {getInitials(agent.name)}
          </div>
          <div className={styles.profileName}>{agent.name}</div>
          <div className={styles.profileStatus}>
            <div className={`${styles.statusDot} ${agent.online ? styles.dotOnline : styles.dotOffline}`} />
            <span>{agent.online ? t('network.online') : t('network.offline')}</span>
          </div>
          <TrustBadge level={agent.trustLevel} t={t} />
        </div>

        <div className={styles.profileDivider} />

        {/* Details */}
        <ProfileRow label="Agent ID" value={agent.agentId.slice(0, 16) + '...'} mono />
        <ProfileRow label="Endpoint" value={agent.endpoint} mono />
        {identity?.version && <ProfileRow label="Version" value={identity.version} />}
        {identity?.protocolVersion && <ProfileRow label="Protocol" value={identity.protocolVersion} />}
        <ProfileRow label={t('network.lastSeen')} value={formatTime(agent.lastSeenAt)} />

        {/* Projects */}
        {identity?.projects && identity.projects.length > 0 && (
          <>
            <div className={styles.profileDivider} />
            <div className={styles.profileSectionTitle}>{t('network.projects')}</div>
            {identity.projects.map(p => (
              <div key={p.name} className={styles.projectItem}>
                <span className={styles.tag}>{p.name}</span>
                {p.description && (
                  <div className={styles.projectDesc}>{p.description}</div>
                )}
              </div>
            ))}
          </>
        )}

        {/* Tools */}
        {identity?.exposedTools && identity.exposedTools.length > 0 && (
          <>
            <div className={styles.profileDivider} />
            <div className={styles.profileSectionTitle}>{t('network.tools')} ({identity.exposedTools.length})</div>
            <div className={styles.tagGroup}>
              {identity.exposedTools.slice(0, 20).map(tool => (
                <span key={tool} className={styles.tagTool}>{tool}</span>
              ))}
              {identity.exposedTools.length > 20 && (
                <span className={styles.tagDim}>+{identity.exposedTools.length - 20}</span>
              )}
            </div>
          </>
        )}

        <div className={styles.profileDivider} />

        {/* Actions */}
        <div className={styles.profileActions}>
          {agent.trustLevel === 'unknown' ? (
            <button className={styles.actionBtnPrimary} onClick={() => onTrust(true)}>{t('network.trust')}</button>
          ) : agent.trustLevel !== 'self' && agent.trustLevel !== 'same-owner' ? (
            <button className={styles.actionBtnMuted} onClick={() => onTrust(false)}>{t('network.untrust')}</button>
          ) : null}
          {agent.trustLevel !== 'self' && (
            <button className={styles.actionBtnDanger} onClick={onKick}>{t('network.kick')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.profileRow}>
      <span className={styles.profileRowLabel}>{label}</span>
      <span className={`${styles.profileRowValue} ${mono ? styles.mono : ''}`}>{value}</span>
    </div>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={styles.dialogContent} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <h3>{title}</h3>
          <button className={styles.iconBtn} onClick={onClose}><CloseIcon /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
