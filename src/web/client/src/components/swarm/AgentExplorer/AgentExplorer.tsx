import React, { useState, useEffect } from 'react';
import styles from './AgentExplorer.module.css';

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
        throw new Error('获取 Agent 列表失败');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || '获取 Agent 列表失败');
      }

      setAgents(data.data);

      // 默认选中第一个 agent
      if (data.data.length > 0) {
        setSelectedAgent(data.data[0]);
      }
    } catch (err: any) {
      setError(err.message || '未知错误');
    } finally {
      setLoading(false);
    }
  };

  // 将 agents 分类
  const categorizeAgents = (): AgentCategory[] => {
    const categories: AgentCategory[] = [
      {
        name: '代码探索',
        icon: '🔍',
        agents: agents.filter(a => a.agentType === 'Explore' || a.agentType === 'code-analyzer'),
      },
      {
        name: '任务执行',
        icon: '⚙️',
        agents: agents.filter(a =>
          a.agentType === 'general-purpose' ||
          a.agentType === 'blueprint-worker'
        ),
      },
      {
        name: '规划设计',
        icon: '📐',
        agents: agents.filter(a => a.agentType === 'Plan'),
      },
      {
        name: '文档助手',
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
          <p>正在加载 Agents...</p>
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
            重试
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
              <h2 className={styles.sectionTitle}>📋 描述</h2>
              <p className={styles.description}>{selectedAgent.description}</p>
            </div>

            {/* 何时使用 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>🎯 何时使用</h2>
              <p className={styles.whenToUse}>{selectedAgent.whenToUse}</p>
            </div>

            {/* 可用工具 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>🛠️ 可用工具</h2>
              <div className={styles.toolList}>
                {selectedAgent.tools.map((tool, i) => (
                  <span key={i} className={styles.toolBadge}>
                    {tool === '*' ? '全部工具' : tool}
                  </span>
                ))}
              </div>
            </div>

            {/* 特性 */}
            {selectedAgent.features && selectedAgent.features.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>✨ 特性</h2>
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
                <h2 className={styles.sectionTitle}>📊 彻底程度级别</h2>
                <div className={styles.levelList}>
                  {selectedAgent.thoroughnessLevels.map((level, i) => (
                    <div key={i} className={styles.levelItem}>
                      <code>{level}</code>
                      <span className={styles.levelDesc}>
                        {level === 'quick' && '基础搜索，快速返回结果'}
                        {level === 'medium' && '中等深度探索'}
                        {level === 'very thorough' && '全面深入分析'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 使用示例 */}
            {selectedAgent.examples && selectedAgent.examples.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>💡 使用示例</h2>
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
              <h2 className={styles.sectionTitle}>💻 代码示例</h2>
              <div className={styles.codeExample}>
                <pre className={styles.codeBlock}>
                  <code>{generateCodeExample(selectedAgent)}</code>
                </pre>
              </div>
            </div>

            {/* 元信息 */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>ℹ️ 元信息</h2>
              <div className={styles.metaInfo}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Agent 类型:</span>
                  <code className={styles.metaValue}>{selectedAgent.agentType}</code>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>访问父上下文:</span>
                  <code className={styles.metaValue}>
                    {selectedAgent.forkContext ? 'true' : 'false'}
                  </code>
                </div>
                {selectedAgent.permissionMode && (
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>权限模式:</span>
                    <code className={styles.metaValue}>{selectedAgent.permissionMode}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.welcomePanel}>
            <h2 className={styles.welcomeTitle}>Agent 浏览器</h2>
            <p className={styles.welcomeText}>
              选择左侧的 Agent 查看详细信息
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
  const example = agent.examples?.[0] || '执行任务';

  switch (agent.agentType) {
    case 'Explore':
      return `// 使用 Explore Agent 搜索代码
const result = await executeAgent({
  subagent_type: "Explore",
  description: "查找 API 端点",
  prompt: "${example}",
  model: "haiku" // 快速模型
});`;

    case 'general-purpose':
      return `// 使用 General Purpose Agent 执行多步骤任务
const result = await executeAgent({
  subagent_type: "general-purpose",
  description: "研究问题",
  prompt: "${example}",
});`;

    case 'Plan':
      return `// 使用 Plan Agent 设计实现方案
const result = await executeAgent({
  subagent_type: "Plan",
  description: "规划实现",
  prompt: "${example}",
});`;

    case 'code-analyzer':
      return `// 使用 Code Analyzer Agent 分析代码
const result = await executeAgent({
  subagent_type: "code-analyzer",
  description: "分析文件",
  prompt: "分析 src/core/client.ts 的导出和依赖",
  model: "opus" // 使用 Opus 以获得最佳分析质量
});`;

    case 'blueprint-worker':
      return `// Blueprint Worker Agent（仅供 Queen Agent 调用）
const result = await executeAgent({
  subagent_type: "blueprint-worker",
  description: "实现功能",
  prompt: "使用 TDD 方式实现用户认证模块",
});`;

    case 'claude-code-guide':
      return `// 使用 Axon Guide 查询文档
const result = await executeAgent({
  subagent_type: "claude-code-guide",
  description: "查询文档",
  prompt: "如何配置 MCP 服务器？",
});`;

    default:
      return `// 使用 ${agent.agentType} Agent
const result = await executeAgent({
  subagent_type: "${agent.agentType}",
  description: "执行任务",
  prompt: "${example}",
});`;
  }
}

export default AgentExplorer;
