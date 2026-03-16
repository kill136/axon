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
  projects: Array<{ name: string; gitRemote?: string; role?: string }>;
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
  messageType: 'query' | 'task' | 'notify' | 'response';
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

// ===== Main Component =====

interface NetworkPanelProps {
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

export default function NetworkPanel({ addMessageHandler }: NetworkPanelProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
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
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  // Manual connect
  const [manualEndpoint, setManualEndpoint] = useState('');
  const [manualConnecting, setManualConnecting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch data
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [statusRes, auditRes] = await Promise.all([
          fetch('/api/network/status'),
          fetch('/api/network/audit?limit=500'),
        ]);
        const s = await statusRes.json();
        const a = await auditRes.json();
        setStatus(s);
        setAuditLog(a);
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetchAll();
    const interval = setInterval(fetchAll, 5000); // 有 WebSocket 实时推送后降低轮询频率
    return () => clearInterval(interval);
  }, []);

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
  }, [auditLog, selectedContact]);

  // Mark as read when selecting a contact
  useEffect(() => {
    if (selectedContact && auditLog.length > 0) {
      setReadMap(prev => ({ ...prev, [selectedContact]: Date.now() }));
    }
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

  // Build contacts list
  const contacts: ContactItem[] = useMemo(() => {
    const items: ContactItem[] = [];

    // Agents
    for (const agent of agents) {
      if (agent.agentId === myId) continue; // skip self
      const msgs = conversationMap.get(agent.agentId) || [];
      const lastMsg = msgs[msgs.length - 1];
      const lastRead = readMap[agent.agentId] || 0;
      const unread = msgs.filter(m => m.timestamp > lastRead && m.direction === 'inbound').length;
      items.push({ type: 'agent', agent, lastMessage: lastMsg, unread });
    }

    // Groups
    for (const group of groups) {
      const key = `group:${group.id}`;
      const lastRead = readMap[key] || 0;
      // Group messages = messages from any member
      const memberMsgs: AuditLogEntry[] = [];
      for (const memberId of group.members) {
        const msgs = conversationMap.get(memberId) || [];
        memberMsgs.push(...msgs);
      }
      memberMsgs.sort((a, b) => a.timestamp - b.timestamp);
      const lastMsg = memberMsgs[memberMsgs.length - 1];
      const unread = memberMsgs.filter(m => m.timestamp > lastRead && m.direction === 'inbound').length;
      items.push({ type: 'group', group, lastMessage: lastMsg, unread });
    }

    // Sort by last activity desc
    items.sort((a, b) => {
      const aTime = a.lastMessage?.timestamp || (a.type === 'agent' ? a.agent.discoveredAt : a.group.createdAt);
      const bTime = b.lastMessage?.timestamp || (b.type === 'agent' ? b.agent.discoveredAt : b.group.createdAt);
      return bTime - aTime;
    });

    return items;
  }, [agents, groups, conversationMap, readMap, myId]);

  // Filter contacts
  const filteredContacts = useMemo(() => {
    if (!searchQuery) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(c => {
      if (c.type === 'agent') return c.agent.name.toLowerCase().includes(q);
      return c.group.name.toLowerCase().includes(q);
    });
  }, [contacts, searchQuery]);

  // Get messages for current chat
  const currentMessages = useMemo(() => {
    if (!selectedContact) return [];
    if (selectedContact.startsWith('group:')) {
      const groupId = selectedContact.slice(6);
      const group = groups.find(g => g.id === groupId);
      if (!group) return [];
      const msgs: AuditLogEntry[] = [];
      for (const memberId of group.members) {
        const m = conversationMap.get(memberId) || [];
        msgs.push(...m);
      }
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      return msgs;
    }
    return conversationMap.get(selectedContact) || [];
  }, [selectedContact, conversationMap, groups]);

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

  // Send message
  const doSend = async (method: string, params?: unknown) => {
    if (!selectedContact || selectedContact.startsWith('group:')) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/network/send', {
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
    doSend('agent.chat', { message: messageText.trim() });
    setMessageText('');
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
            const preview = contact.lastMessage
              ? (contact.lastMessage.messageType === 'chat'
                ? contact.lastMessage.summary.slice(0, 50)
                : `${contact.lastMessage.method}: ${contact.lastMessage.summary}`.slice(0, 50))
              : contact.type === 'agent'
                ? contact.agent.endpoint
                : t('network.group.memberCount', { count: contact.group.members.length });

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
                {selectedGroup && (
                  <button className={styles.iconBtn} onClick={() => handleDeleteGroup(selectedGroup.id)} title={t('network.group.delete')}>
                    <CloseIcon />
                  </button>
                )}
                {selectedAgent && (
                  <button className={styles.iconBtn} onClick={() => setShowProfile(!showProfile)} title={t('network.agentProfile')}>
                    <InfoIcon />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.chatMessages}>
              {currentMessages.length === 0 ? (
                <div className={styles.emptyChatState}>
                  <div className={styles.emptyChatIcon}>
                    <NetworkIcon />
                  </div>
                  <p>{t('network.noMessages')}</p>
                  <p className={styles.emptyChatHint}>{t('network.noMessagesHint')}</p>
                </div>
              ) : (
                <div className={styles.messageList}>
                  {currentMessages.map(entry => (
                    <MessageBubble key={entry.id} entry={entry} myId={myId} agents={agents} t={t} />
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Input area — only for agent (not group broadcast for now) */}
            {selectedAgent && (
              <div className={styles.inputArea}>
                <div className={styles.quickActions}>
                  <button className={styles.quickBtn} onClick={handlePing} disabled={sending}>
                    {t('network.quickPing')}
                  </button>
                  <button className={styles.quickBtn} onClick={() => setShowToolDialog(true)} disabled={sending}>
                    {t('network.quickCallTool')}
                  </button>
                  <button className={styles.quickBtn} onClick={() => setShowDelegateDialog(true)} disabled={sending}>
                    {t('network.quickDelegate')}
                  </button>
                </div>
                {sendError && (
                  <div className={styles.sendError}>{sendError}</div>
                )}
                <div className={styles.inputRow}>
                  <textarea
                    ref={inputRef}
                    className={styles.messageInput}
                    placeholder={t('network.messageInput')}
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
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
            )}
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

function MessageBubble({ entry, myId, agents, t }: {
  entry: AuditLogEntry;
  myId: string;
  agents: DiscoveredAgent[];
  t: (key: string) => string;
}) {
  const isOutbound = entry.direction === 'outbound';
  const otherId = isOutbound ? entry.toAgentId : entry.fromAgentId;
  const otherName = isOutbound ? entry.toName : entry.fromName;
  const [expanded, setExpanded] = useState(false);

  // Determine card type
  const isTask = entry.method.includes('delegateTask') || entry.method.includes('task.');
  const isPing = entry.method === 'agent.ping';
  const isCallTool = entry.method === 'agent.callTool';
  const isProgress = entry.method === 'agent.progress';
  const isNotify = entry.messageType === 'notify';
  const isResponse = entry.messageType === 'response';
  const isChat = entry.messageType === 'chat';

  // Parse payload for rich display
  let parsedPayload: any = null;
  if (entry.payload) {
    try { parsedPayload = JSON.parse(entry.payload); } catch { /* ignore */ }
  }

  // Extract useful fields from payload
  const params = parsedPayload?.params;
  const result = parsedPayload?.result;

  return (
    <div className={`${styles.bubble} ${isOutbound ? styles.bubbleOut : styles.bubbleIn}`}>
      {!isOutbound && (
        <div className={styles.bubbleAvatar} style={{ background: getAvatarColor(otherId) }}>
          {getInitials(otherName)}
        </div>
      )}
      <div className={styles.bubbleContent}>
        {!isOutbound && <div className={styles.bubbleSender}>{otherName}</div>}
        {isChat ? (
          /* Chat message — clean text bubble, no method tags */
          <div className={`${styles.bubbleCard} ${styles.chatBubble}`}>
            <div className={styles.chatText}>{entry.summary || params?.message || parsedPayload?.params?.message || ''}</div>
          </div>
        ) : (
          <div
            className={`${styles.bubbleCard} ${!entry.success ? styles.bubbleError : ''} ${isTask || isProgress ? styles.bubbleTask : ''}`}
            onClick={() => setExpanded(!expanded)}
          >
            {/* Method tag */}
            <div className={styles.bubbleMethod}>
              <span className={styles.methodTag}>{entry.method}</span>
              {isResponse && <span className={styles.methodTag} style={{ opacity: 0.5 }}>response</span>}
              {!entry.success && <span className={styles.errorDot} />}
            </div>

            {/* ===== Rich content by type ===== */}

            {/* Ping */}
            {isPing && !isResponse && (
              <div className={styles.bubbleText}>Ping</div>
            )}
            {isPing && isResponse && result?.pong && (
              <div className={styles.bubbleText}>Pong! {result?.timestamp && `(${Date.now() - result.timestamp}ms)`}</div>
            )}
            {/* Response to ping from audit log that has result */}
            {isResponse && parsedPayload?.result?.pong && !isPing && (
              <div className={styles.bubbleText}>Pong! {parsedPayload.result?.timestamp && `(${Date.now() - parsedPayload.result.timestamp}ms)`}</div>
            )}

            {/* CallTool — outbound request */}
            {isCallTool && params?.toolName && (
              <div className={styles.richContent}>
                <div className={styles.bubbleText}>
                  Tool: <code>{params.toolName}</code>
                </div>
                {params.toolInput && (
                  <div className={styles.paramBlock}>
                    <div className={styles.paramLabel}>Input</div>
                    <pre className={styles.paramValue}>{compactJson(params.toolInput, 300)}</pre>
                  </div>
                )}
              </div>
            )}

            {/* CallTool — inbound request (someone calls our tool) */}
            {isCallTool && !params?.toolName && parsedPayload?.method === 'agent.callTool' && parsedPayload?.params && (
              <div className={styles.richContent}>
                <div className={styles.bubbleText}>
                  Tool: <code>{parsedPayload.params.toolName}</code>
                </div>
                {parsedPayload.params.toolInput && (
                  <div className={styles.paramBlock}>
                    <div className={styles.paramLabel}>Input</div>
                    <pre className={styles.paramValue}>{compactJson(parsedPayload.params.toolInput, 300)}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Response with tool result */}
            {isResponse && result?.toolName && (
              <div className={styles.richContent}>
                <div className={styles.bubbleText}>
                  Tool: <code>{result.toolName}</code> — result
                </div>
                {result.result && (
                  <div className={styles.paramBlock}>
                    <div className={styles.paramLabel}>Output</div>
                    <pre className={styles.paramValue}>{compactJson(result.result, 500)}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Response with generic result (not tool, not ping, not bare ack) */}
            {isResponse && result && !result?.toolName && !result?.pong
              && !(Object.keys(result).length === 1 && result?.received === true) && (
              <div className={styles.richContent}>
                <div className={styles.paramBlock}>
                  <div className={styles.paramLabel}>Result</div>
                  <pre className={styles.paramValue}>{compactJson(result, 500)}</pre>
                </div>
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
                {/* If this is a response to delegate, show the accepted status */}
                {isResponse && result?.status && (
                  <div className={styles.progressStatus} data-status={result.status}>
                    {result.status === 'accepted' ? 'Accepted' : result.status}
                    {result.message && ` — ${truncateStr(result.message, 100)}`}
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
                  {params?.result && (
                    <div className={styles.paramBlock}>
                      <div className={styles.paramLabel}>Result</div>
                      <pre className={styles.paramValue}>{truncateStr(params.result, 500)}</pre>
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
            {!isPing && !isCallTool && !isTask && !isProgress && !isResponse
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
        <div className={styles.bubbleTime}>{formatFullTime(entry.timestamp)}</div>
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
            <div className={styles.tagGroup}>
              {identity.projects.map(p => (
                <span key={p.name} className={styles.tag}>{p.name}</span>
              ))}
            </div>
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
