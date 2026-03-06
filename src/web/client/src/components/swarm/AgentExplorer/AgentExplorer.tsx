import React, { useState, useEffect } from 'react';
import styles from './AgentExplorer.module.css';
import { useLanguage } from '../../../i18n';

/**
 * Agent 元数据类型
 */
interface AgentMetadata {
  agentType: string;
  displayName: string;
  description: string;
  whenToUse: string;
  tools: string[];
  forkContext: boolean;
  permissionMode?: string;
  defaultModel?: string;
  examples?: string[];
  thoroughnessLevels?: string[];
  features?: string[];
}

/**
 * Agent 分类信息
 */
interface AgentCategory {
  name: string;
  icon: string;
  agents: AgentMetadata[];
  defaultExpanded?: boolean;
}

/**
 * AgentExplorer 组件
 *
 * 功能：
 * - 左侧显示 agent 分类列表（默认折叠）
 * - 右侧显示选中 agent 的详细信息
 * - 包含使用示例和代码片段
 */
export const AgentExplorer: React.FC = () => {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<AgentMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentMetadata | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // 加载 agents 数据
  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/agents');
      if (!response.ok) {
        throw new Error(t('agentExplorer.fetchFailed'));
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || t('agentExplorer.fetchFailed'));
      }

      setAgents(data.data);

      // 默认选中第一个 agent
      if (data.data.length > 0) {
        setSelectedAgent(data.data[0]);
      }
    } catch (err: any) {
      setError(err.message || t('agentExplorer.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  // 将 agents 分类
  const categorizeAgents = (): AgentCategory[] => {
    const categories: AgentCategory[] = [
      {
        name: t('agentExplorer.category.codeExploration'),
        icon: '🔍',
        agents: agents.filter(a => a.agentType === 'Explore' || a.agentType === 'code-analyzer'),
      },
      {
        name: t('agentExplorer.category.taskExecution'),
        icon: '⚙️',
        agents: agents.filter(a =>
          a.agentType === 'general-purpose' ||
          a.agentType === 'blueprint-worker'
        ),
      },
      {
        name: t('agentExplorer.category.planDesign'),
        icon: '📐',
        agents: agents.filter(a => a.agentType === 'Plan'),
      },
      {
        name: t('agentExplorer.category.docAssistant'),
        icon: '📚',
        agents: agents.filter(a => a.agentType === 'claude-code-guide'),
      },
    ];

    return categories.filter(c => c.agents.length > 0);
  };

  // 切换分类展开状态
  const toggleCategory = (categoryName: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  // 选中 agent
  const selectAgent = (agent: AgentMetadata) => {
    setSelectedAgent(agent);
  };

  // 渲染加载状态
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}></div>
          <p>{t('agentExplorer.loading')}</p>
        </div>
      </div>
    );
  }

  // 渲染错误状态
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorContainer}>
          <p className={styles.errorText}>{error}</p>
          <button className={styles.retryButton} onClick={fetchAgents}>
            {t('agentExplorer.retry')}
          </button>
        </div>
      </div>
    );
  }

  const categories = categorizeAgents();

  return (
    <div className={styles.container}>
      {/* 左侧 Agent 列表 */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2 className={styles.sidebarTitle}>Agents</h2>
          <span className={styles.agentCount}>{agents.length}</span>
        </div>
        <div className={styles.sidebarContent}>
          {categories.map(category => (
            <div key={category.name} className={styles.category}>
              <button
                className={styles.categoryHeader}
                onClick={() => toggleCategory(category.name)}
              >
                <span className={styles.categoryIcon}>
                  {expandedCategories.has(category.name) ? '▼' : '▶'}
                </span>
                <span className={styles.categoryEmoji}>{category.icon}</span>
                <span className={styles.categoryName}>{category.name}</span>
                <span className={styles.categoryBadge}>{category.agents.length}</span>
              </button>

              {/* 默认折叠，点击后展开 */}
              {expandedCategories.has(category.name) && (
                <div className={styles.agentList}>
                  {category.agents.map(agent => (
                    <div
                      key={agent.agentType}
                      className={`${styles.agentItem} ${
                        selectedAgent?.agentType === agent.agentType ? styles.selected : ''
                      }`}
                      onClick={() => selectAgent(agent)}
                    >
                      <span className={styles.agentIcon}>🤖</span>
                      <div className={styles.agentInfo}>
                        <div className={styles.agentName}>{agent.displayName}</div>
                        {agent.defaultModel && (
                          <div className={styles.agentModel}>{agent.defaultModel}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧 Agent 详情 */}
      <div className={styles.mainPanel}>
        {selectedAgent ? (
          <div className={styles.agentDetail}>
            {/* 头部 */}
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>
                <span className={styles.detailIcon}>🤖</span>
                <h1>{selectedAgent.displayName}</h1>
                {selectedAgent.defaultModel && (
                  <span className={styles.modelBadge}>{selectedAgent.defaultModel}</span>
                )}
              </div>
            </div>

            {/* 描述 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>📋 {t('agentExplorer.section.description')}</h2>
              <p className={styles.description}>{selectedAgent.description}</p>
            </div>

            {/* 何时使用 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>🎯 {t('agentExplorer.section.whenToUse')}</h2>
              <p className={styles.whenToUse}>{selectedAgent.whenToUse}</p>
            </div>

            {/* 可用工具 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>🛠️ {t('agentExplorer.section.availableTools')}</h2>
              <div className={styles.toolList}>
                {selectedAgent.tools.map((tool, i) => (
                  <span key={i} className={styles.toolBadge}>
                    {tool === '*' ? t('agentExplorer.allTools') : tool}
                  </span>
                ))}
              </div>
            </div>

            {/* 特性 */}
            {selectedAgent.features && selectedAgent.features.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>✨ {t('agentExplorer.section.features')}</h2>
                <ul className={styles.featureList}>
                  {selectedAgent.features.map((feature, i) => (
                    <li key={i}>{feature}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 彻底程度级别（仅 Explore Agent） */}
            {selectedAgent.thoroughnessLevels && selectedAgent.thoroughnessLevels.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>📊 {t('agentExplorer.section.thoroughnessLevels')}</h2>
                <div className={styles.levelList}>
                  {selectedAgent.thoroughnessLevels.map((level, i) => (
                    <div key={i} className={styles.levelItem}>
                      <code>{level}</code>
                      <span className={styles.levelDesc}>
                        {level === 'quick' && t('agentExplorer.level.quick')}
                        {level === 'medium' && t('agentExplorer.level.medium')}
                        {level === 'very thorough' && t('agentExplorer.level.veryThorough')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 使用示例 */}
            {selectedAgent.examples && selectedAgent.examples.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>💡 {t('agentExplorer.section.examples')}</h2>
                <div className={styles.exampleList}>
                  {selectedAgent.examples.map((example, i) => (
                    <div key={i} className={styles.exampleItem}>
                      <div className={styles.exampleNumber}>{i + 1}</div>
                      <div className={styles.exampleText}>{example}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 代码示例 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>💻 {t('agentExplorer.section.codeExample')}</h2>
              <div className={styles.codeExample}>
                <pre className={styles.codeBlock}>
                  <code>{generateCodeExample(selectedAgent)}</code>
                </pre>
              </div>
            </div>

            {/* 元信息 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>ℹ️ {t('agentExplorer.section.metaInfo')}</h2>
              <div className={styles.metaInfo}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>{t('agentExplorer.meta.agentType')}:</span>
                  <code className={styles.metaValue}>{selectedAgent.agentType}</code>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>{t('agentExplorer.meta.forkContext')}:</span>
                  <code className={styles.metaValue}>
                    {selectedAgent.forkContext ? 'true' : 'false'}
                  </code>
                </div>
                {selectedAgent.permissionMode && (
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>{t('agentExplorer.meta.permissionMode')}:</span>
                    <code className={styles.metaValue}>{selectedAgent.permissionMode}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.welcomePanel}>
            <h2 className={styles.welcomeTitle}>{t('agentExplorer.welcomeTitle')}</h2>
            <p className={styles.welcomeText}>
              {t('agentExplorer.welcomeText')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 生成代码示例
 */
function generateCodeExample(agent: AgentMetadata): string {
  const example = agent.examples?.[0] || 'Execute task';

  switch (agent.agentType) {
    case 'Explore':
      return `// Use Explore Agent to search code
const result = await executeAgent({
  subagent_type: "Explore",
  description: "Find API endpoints",
  prompt: "${example}",
  model: "haiku" // Fast model
});`;

    case 'general-purpose':
      return `// Use General Purpose Agent for multi-step tasks
const result = await executeAgent({
  subagent_type: "general-purpose",
  description: "Research problem",
  prompt: "${example}",
});`;

    case 'Plan':
      return `// Use Plan Agent to design implementation
const result = await executeAgent({
  subagent_type: "Plan",
  description: "Plan implementation",
  prompt: "${example}",
});`;

    case 'code-analyzer':
      return `// Use Code Analyzer Agent to analyze code
const result = await executeAgent({
  subagent_type: "code-analyzer",
  description: "Analyze file",
  prompt: "Analyze exports and dependencies of src/core/client.ts",
  model: "opus" // Use Opus for best analysis quality
});`;

    case 'blueprint-worker':
      return `// Blueprint Worker Agent (called by Queen Agent only)
const result = await executeAgent({
  subagent_type: "blueprint-worker",
  description: "Implement feature",
  prompt: "Implement user auth module using TDD",
});`;

    case 'claude-code-guide':
      return `// Use Axon Guide to query docs
const result = await executeAgent({
  subagent_type: "claude-code-guide",
  description: "Query docs",
  prompt: "How to configure MCP servers?",
});`;

    default:
      return `// Use ${agent.agentType} Agent
const result = await executeAgent({
  subagent_type: "${agent.agentType}",
  description: "Execute task",
  prompt: "${example}",
});`;
  }
}

export default AgentExplorer;
