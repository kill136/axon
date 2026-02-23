/**
 * DebugPanel - 探针调试面板
 * 查看当前 agent 的系统提示词和发送给 API 的原始消息体
 * 支持普通会话和蜂群模式（LeadAgent / Worker / E2E Agent）
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import './DebugPanel.css';
import { useLanguage } from '../i18n';

interface DebugData {
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
  model: string;
  messageCount: number;
}

interface AgentInfo {
  agentType: string;
  id: string;
  label: string;
  taskId?: string;
}

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** 发送 WebSocket 消息的函数 */
  send: (msg: any) => void;
  /** 注册消息处理器 */
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  /** 蜂群模式：当前蓝图 ID（传入则启用 Agent 选择器） */
  blueprintId?: string;
}

type DebugTab = 'system_prompt' | 'messages' | 'tools';

export function DebugPanel({ isOpen, onClose, send, addMessageHandler, blueprintId }: DebugPanelProps) {
  const { t } = useLanguage();
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DebugTab>('system_prompt');
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [searchText, setSearchText] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  // 蜂群模式状态
  const [agentList, setAgentList] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>(''); // 'session' | 'lead' | 'worker:xxx'
  const isSwarmMode = !!blueprintId;

  // 请求数据的统一方法
  const requestDebugData = useCallback(() => {
    setLoading(true);

    if (isSwarmMode && selectedAgent && selectedAgent !== 'session') {
      // 蜂群模式：请求指定 Agent 的调试信息
      const parts = selectedAgent.split(':');
      const agentType = parts[0]; // 'lead' | 'worker' | 'e2e'
      const workerId = parts.length > 1 ? parts.slice(1).join(':') : undefined;

      send({
        type: 'swarm:debug_agent',
        payload: { blueprintId, agentType, workerId },
      });
    } else {
      // 普通会话模式
      send({ type: 'debug_get_messages' });
    }
  }, [isSwarmMode, selectedAgent, blueprintId, send]);

  // 监听响应消息
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'debug_messages_response') {
        setDebugData(msg.payload);
        setLoading(false);
      }
      if (msg.type === 'swarm:debug_agent_response') {
        setDebugData(msg.payload);
        setLoading(false);
      }
      if (msg.type === 'swarm:debug_agent_list_response') {
        setAgentList(msg.payload.agents || []);
        // 如果还没有选中 Agent，默认选中第一个
        if (!selectedAgent && msg.payload.agents?.length > 0) {
          setSelectedAgent(msg.payload.agents[0].agentType === 'worker'
            ? `worker:${msg.payload.agents[0].id}`
            : msg.payload.agents[0].agentType);
        }
      }
    });

    return unsubscribe;
  }, [isOpen, addMessageHandler, selectedAgent]);

  // 打开面板时自动请求数据
  useEffect(() => {
    if (isOpen) {
      if (isSwarmMode) {
        // 蜂群模式：先获取活跃 Agent 列表
        send({
          type: 'swarm:debug_agent_list',
          payload: { blueprintId },
        });
      }
      requestDebugData();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切换 Agent 时重新请求数据
  useEffect(() => {
    if (isOpen && selectedAgent) {
      requestDebugData();
    }
  }, [selectedAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  // 刷新数据
  const handleRefresh = () => {
    if (isSwarmMode) {
      // 同时刷新 Agent 列表
      send({
        type: 'swarm:debug_agent_list',
        payload: { blueprintId },
      });
    }
    requestDebugData();
  };

  // 复制到剪贴板
  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      // 简单的复制成功反馈
    });
  };

  // 切换消息展开/收起
  const toggleMessage = (index: number) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // 全部展开/收起
  const toggleAll = () => {
    if (!debugData) return;
    if (expandedMessages.size === debugData.messages.length) {
      setExpandedMessages(new Set());
    } else {
      setExpandedMessages(new Set(debugData.messages.map((_, i) => i)));
    }
  };

  // 点击遮罩关闭
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const formatJson = (obj: unknown): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // 获取消息角色的显示名称
  const getRoleLabel = (msg: any): string => {
    if (msg.role === 'user') return 'USER';
    if (msg.role === 'assistant') return 'ASSISTANT';
    if (msg.role === 'system') return 'SYSTEM';
    return String(msg.role || 'UNKNOWN').toUpperCase();
  };

  // 获取消息的简要描述
  const getMessageSummary = (msg: any): string => {
    if (!msg.content) return '(empty)';
    if (typeof msg.content === 'string') {
      return msg.content.slice(0, 120) + (msg.content.length > 120 ? '...' : '');
    }
    if (Array.isArray(msg.content)) {
      const types = msg.content.map((c: any) => {
        if (c.type === 'text') return `text(${(c.text || '').slice(0, 40)}...)`;
        if (c.type === 'tool_use') return `tool_use(${c.name})`;
        if (c.type === 'tool_result') return `tool_result(${c.tool_use_id?.slice(0, 8)})`;
        if (c.type === 'thinking') return 'thinking';
        return c.type || 'unknown';
      });
      return types.join(', ');
    }
    return JSON.stringify(msg.content).slice(0, 120);
  };

  // 获取消息内容块数量
  const getContentBlockCount = (msg: any): number => {
    if (Array.isArray(msg.content)) return msg.content.length;
    if (msg.content) return 1;
    return 0;
  };

  // 计算文本的 token 数（粗略估算）
  const estimateTokens = (text: string): number => {
    return Math.ceil(text.length / 4);
  };

  // 过滤消息
  const filteredMessages = debugData?.messages.filter((msg: any) => {
    if (!searchText) return true;
    const json = JSON.stringify(msg).toLowerCase();
    return json.includes(searchText.toLowerCase());
  }) || [];

  // 获取当前选中 Agent 的显示名称
  const getSelectedAgentLabel = (): string => {
    if (!isSwarmMode || selectedAgent === 'session') return '';
    const agent = agentList.find(a => {
      if (a.agentType === 'worker') return `worker:${a.id}` === selectedAgent;
      return a.agentType === selectedAgent;
    });
    return agent?.label || selectedAgent;
  };

  return (
    <div className="debug-panel-overlay" onClick={handleOverlayClick}>
      <div className="debug-panel" ref={panelRef}>
        <div className="debug-panel-header">
          <div className="debug-panel-title">
            <span className="debug-icon">&#x1F50D;</span>
            <h2>{t('debug.title')}</h2>
            {debugData && (
              <span className="debug-model-badge">{debugData.model}</span>
            )}
            {isSwarmMode && getSelectedAgentLabel() && (
              <span className="debug-agent-badge">{getSelectedAgentLabel()}</span>
            )}
          </div>
          <div className="debug-panel-actions">
            <button className="debug-refresh-btn" onClick={handleRefresh} disabled={loading} title={t('debug.refresh')}>
              {loading ? '...' : '\u21BB'}
            </button>
            <button className="debug-close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>

        {/* Agent 选择器（仅蜂群模式） */}
        {isSwarmMode && (
          <div className="debug-agent-selector">
            <span className="debug-agent-selector-label">{t('debug.agent')}</span>
            <select
              className="debug-agent-select"
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option value="session">{t('debug.sessionDefault')}</option>
              {agentList.map((agent) => {
                const value = agent.agentType === 'worker'
                  ? `worker:${agent.id}`
                  : agent.agentType;
                return (
                  <option key={value} value={value}>
                    {agent.label}
                    {agent.taskId ? ` [${agent.taskId}]` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div className="debug-panel-tabs">
          <button
            className={`debug-tab ${activeTab === 'system_prompt' ? 'active' : ''}`}
            onClick={() => setActiveTab('system_prompt')}
          >
            {t('debug.systemPrompt')}
            {debugData && (
              <span className="debug-tab-badge">~{estimateTokens(debugData.systemPrompt).toLocaleString()} tokens</span>
            )}
          </button>
          <button
            className={`debug-tab ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('messages')}
          >
            {t('debug.messages')}
            {debugData && (
              <span className="debug-tab-badge">{debugData.messageCount}</span>
            )}
          </button>
          <button
            className={`debug-tab ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            {t('debug.tools')}
            {debugData && (
              <span className="debug-tab-badge">{debugData.tools.length}</span>
            )}
          </button>
        </div>

        <div className="debug-panel-content">
          {loading && !debugData ? (
            <div className="debug-loading">{t('common.loading')}</div>
          ) : !debugData ? (
            <div className="debug-empty">{t('debug.noData')}</div>
          ) : (
            <>
              {/* System Prompt Tab */}
              {activeTab === 'system_prompt' && (
                <div className="debug-section">
                  <div className="debug-section-header">
                    <span>{t('debug.systemPromptInfo', { tokens: estimateTokens(debugData.systemPrompt).toLocaleString(), chars: debugData.systemPrompt.length.toLocaleString() })}</span>
                    <button
                      className="debug-copy-btn"
                      onClick={() => handleCopy(debugData.systemPrompt)}
                    >
                      {t('debug.copy')}
                    </button>
                  </div>
                  <pre className="debug-code-block">{debugData.systemPrompt}</pre>
                </div>
              )}

              {/* Messages Tab */}
              {activeTab === 'messages' && (
                <div className="debug-section">
                  <div className="debug-section-header">
                    <span>{t('debug.messageCount', { count: filteredMessages.length })}</span>
                    <div className="debug-section-actions">
                      <input
                        className="debug-search-input"
                        type="text"
                        placeholder={t('debug.searchMessages')}
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                      />
                      <button className="debug-toggle-all-btn" onClick={toggleAll}>
                        {expandedMessages.size === debugData.messages.length ? t('debug.collapseAll') : t('debug.expandAll')}
                      </button>
                      <button
                        className="debug-copy-btn"
                        onClick={() => handleCopy(formatJson(debugData.messages))}
                      >
                        {t('debug.copyAll')}
                      </button>
                    </div>
                  </div>
                  <div className="debug-messages-list">
                    {filteredMessages.map((msg: any, index: number) => {
                      const role = getRoleLabel(msg);
                      const isExpanded = expandedMessages.has(index);
                      const blockCount = getContentBlockCount(msg);

                      return (
                        <div key={index} className={`debug-message-item debug-role-${role.toLowerCase()}`}>
                          <div
                            className="debug-message-header"
                            onClick={() => toggleMessage(index)}
                          >
                            <span className="debug-expand-icon">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                            <span className={`debug-role-badge debug-role-${role.toLowerCase()}`}>
                              {role}
                            </span>
                            <span className="debug-message-index">#{index}</span>
                            <span className="debug-message-summary">
                              {getMessageSummary(msg)}
                            </span>
                            <span className="debug-block-count">{t('debug.blocks', { count: blockCount })}</span>
                          </div>
                          {isExpanded && (
                            <div className="debug-message-body">
                              <button
                                className="debug-copy-btn debug-copy-single"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(formatJson(msg));
                                }}
                              >
                                {t('debug.copy')}
                              </button>
                              <pre className="debug-code-block">{formatJson(msg)}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tools Tab */}
              {activeTab === 'tools' && (
                <div className="debug-section">
                  <div className="debug-section-header">
                    <span>{t('debug.toolCount', { count: debugData.tools.length })}</span>
                    <button
                      className="debug-copy-btn"
                      onClick={() => handleCopy(formatJson(debugData.tools))}
                    >
                      {t('debug.copyAll')}
                    </button>
                  </div>
                  <div className="debug-tools-list">
                    {debugData.tools.map((tool: any, index: number) => (
                      <div key={index} className="debug-tool-item">
                        <div className="debug-tool-name">{tool.name || `Tool #${index}`}</div>
                        <div className="debug-tool-desc">{tool.description?.slice(0, 100) || ''}</div>
                        <details className="debug-tool-details">
                          <summary>{t('debug.viewDefinition')}</summary>
                          <pre className="debug-code-block">{formatJson(tool)}</pre>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default DebugPanel;
