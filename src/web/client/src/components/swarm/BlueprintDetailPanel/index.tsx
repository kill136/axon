import React, { useState, useEffect } from 'react';
import styles from './BlueprintDetailPanel.module.css';
import { FadeIn } from '../common/FadeIn';
import { blueprintApi } from '../../../api/blueprint';

/**
 * 业务流程类型
 */
interface BusinessProcess {
  id: string;
  name: string;
  description: string;
  type: 'as-is' | 'to-be';
  steps: ProcessStep[];
  actors: string[];
  inputs: string[];
  outputs: string[];
}

interface ProcessStep {
  id: string;
  order: number;
  name: string;
  description: string;
  actor: string;
}

/**
 * 系统模块类型
 */
interface SystemModule {
  id: string;
  name: string;
  description: string;
  type: 'frontend' | 'backend' | 'database' | 'service' | 'infrastructure' | 'shared' | 'other';
  responsibilities: string[];
  techStack?: string[];
  rootPath?: string;
  dependencies?: string[];
}

/**
 * 非功能性要求类型
 */
interface NonFunctionalRequirement {
  id: string;
  category: 'performance' | 'security' | 'scalability' | 'availability' | 'maintainability' | 'usability' | 'other';
  name: string;
  description: string;
  priority: 'must' | 'should' | 'could' | 'wont';
  metric?: string;
}

/**
 * UI 设计图类型
 */
interface DesignImage {
  id: string;
  name: string;
  description?: string;
  imageData: string;  // base64 data URL
  style: 'modern' | 'minimal' | 'corporate' | 'creative';
  createdAt: string;
  isAccepted?: boolean;  // 是否被接受为验收标准
}

/**
 * 技术栈类型
 */
interface TechStack {
  language?: string;
  framework?: string;
  database?: string;
  styling?: string;
  testing?: string;
  [key: string]: string | undefined;
}

/**
 * 蓝图详情数据类型
 */
interface BlueprintDetail {
  id: string;
  name: string;
  description: string;
  version: string;
  status: 'draft' | 'review' | 'approved' | 'executing' | 'completed' | 'paused' | 'modified' | 'failed' | 'cancelled';
  businessProcesses: BusinessProcess[];
  modules: SystemModule[];
  nfrs: NonFunctionalRequirement[];
  designImages?: DesignImage[];  // UI 设计图
  // 需求驱动蓝图的字段
  requirements?: string[];
  techStack?: TechStack;
  constraints?: string[];
  brief?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  source?: 'requirement' | 'codebase';  // 蓝图来源
}

interface BlueprintDetailPanelProps {
  blueprintId: string;
  onClose: () => void;
  /** 跳转到蜂群页面，传递蓝图 ID */
  onNavigateToSwarm?: (blueprintId: string) => void;
  /** 蓝图状态变更后的刷新回调，用于同步列表 */
  onRefresh?: () => void;
  /** 蓝图删除后的回调 */
  onDeleted?: () => void;
}

/**
 * BlueprintDetailPanel - 蓝图详情面板组件
 *
 * 功能：
 * - 从右侧滑入的详情面板
 * - 显示蓝图的完整信息
 * - 支持展开/折叠业务流程、系统模块、NFR
 * - 提供操作按钮（批准、拒绝、启动执行、删除）
 */
export const BlueprintDetailPanel: React.FC<BlueprintDetailPanelProps> = ({
  blueprintId,
  onClose,
  onNavigateToSwarm,
  onRefresh,
  onDeleted,
}) => {
  const [blueprint, setBlueprint] = useState<BlueprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    requirements: true,
    techStack: true,
    constraints: true,
    brief: false,          // 项目简介默认折叠（内容较长）
    asIsProcesses: true,
    toBeProcesses: true,
    modules: true,
    nfrs: true,
    designImages: true,
  });

  // 设计图预览模态框状态
  const [previewImage, setPreviewImage] = useState<DesignImage | null>(null);

  // 获取蓝图详情
  useEffect(() => {
    fetchBlueprint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprintId]);

  // 切换展开/折叠
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // 处理操作按钮点击
  const handleAction = async (action: string) => {
    console.log(`[BlueprintDetailPanel] Action: ${action}, Blueprint: ${blueprintId}`);

    try {
      switch (action) {
        case 'approve':
          await blueprintApi.approveBlueprint(blueprintId, 'admin');
          console.log('[BlueprintDetailPanel] 蓝图已批准');
          // 重新加载蓝图详情
          await fetchBlueprint();
          // 通知父组件刷新列表，确保状态同步
          onRefresh?.();
          break;

        case 'reject':
          const reason = prompt('请输入拒绝原因:');
          if (reason) {
            await blueprintApi.rejectBlueprint(blueprintId, reason);
            console.log('[BlueprintDetailPanel] 蓝图已拒绝');
            await fetchBlueprint();
            // 通知父组件刷新列表，确保状态同步
            onRefresh?.();
          }
          break;

        case 'submit-review':
          if (confirm('确定要提交审核吗？提交后将无法再编辑蓝图。')) {
            try {
              const result = await blueprintApi.submitForReview(blueprintId);
              console.log('[BlueprintDetailPanel] 蓝图已提交审核');
              await fetchBlueprint();
              // 通知父组件刷新列表，确保状态同步
              onRefresh?.();
              // 显示成功提示（包含警告信息）
              if (result.warnings && result.warnings.length > 0) {
                alert(`✅ 蓝图已成功提交审核\n\n⚠️ 警告信息：\n${result.warnings.join('\n')}`);
              } else {
                alert('✅ 蓝图已成功提交审核');
              }
            } catch (submitError) {
              // 提交审核失败时显示详细错误
              const errorMessage = submitError instanceof Error ? submitError.message : String(submitError);
              console.error('[BlueprintDetailPanel] 提交审核失败:', errorMessage);
              alert(`❌ 提交审核失败\n\n${errorMessage}\n\n请检查蓝图配置后重试。`);
            }
          }
          break;

        case 'start-execution':
          if (confirm('确定要启动执行吗？')) {
            try {
              await blueprintApi.startExecution(blueprintId);
              console.log('[BlueprintDetailPanel] 执行已启动');
              // 通知父组件刷新列表，确保状态同步
              onRefresh?.();
              // 跳转到蜂群页面并传递蓝图 ID
              onNavigateToSwarm?.(blueprintId);
            } catch (error) {
              // startExecution API 失败时，也跳转到蜂群页面让用户手动操作
              console.warn('[BlueprintDetailPanel] startExecution API 调用失败:', error);
              onNavigateToSwarm?.(blueprintId);
            }
          }
          break;

        case 'delete':
          if (confirm('确定要删除这个蓝图吗？此操作不可撤销。')) {
            try {
              await blueprintApi.deleteBlueprint(blueprintId);
              console.log('[BlueprintDetailPanel] 蓝图已删除');
              // 通知父组件处理删除后的状态（清除选中、刷新列表）
              onDeleted?.();
              onClose();
            } catch (error) {
              console.error('[BlueprintDetailPanel] 删除失败:', error);
              alert(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`);
            }
          }
          break;

        default:
          console.warn(`[BlueprintDetailPanel] 未知操作: ${action}`);
      }
    } catch (error) {
      console.error(`[BlueprintDetailPanel] 操作失败:`, error);
      alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 获取蓝图详情（需要定义在 handleAction 之前，因为 handleAction 会调用它）
  const fetchBlueprint = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/blueprint/blueprints/${blueprintId}`);
      if (!response.ok) {
        throw new Error('获取蓝图详情失败');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || '获取蓝图详情失败');
      }

      setBlueprint(data.data);
    } catch (err: any) {
      setError(err.message || '未知错误');
    } finally {
      setLoading(false);
    }
  };

  // 状态映射
  const statusTexts: Record<string, string> = {
    draft: '草稿',
    review: '审核中',
    approved: '已批准',
    executing: '执行中',
    completed: '已完成',
    paused: '已暂停',
    modified: '已修改',
    failed: '已失败',
    cancelled: '已取消',
  };

  const priorityTexts: Record<string, string> = {
    must: '必须',
    should: '应该',
    could: '可以',
    wont: '不会',
  };

  const categoryTexts: Record<string, string> = {
    performance: '性能',
    security: '安全',
    scalability: '可扩展性',
    availability: '可用性',
    maintainability: '可维护性',
    usability: '可用性',
    other: '其他',
  };

  // 设计风格映射
  const styleTexts: Record<string, string> = {
    modern: '现代',
    minimal: '极简',
    corporate: '企业',
    creative: '创意',
  };

  // 渲染加载状态
  if (loading) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>加载中...</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}></div>
          <p>正在加载蓝图详情...</p>
        </div>
      </div>
    );
  }

  // 渲染错误状态
  if (error || !blueprint) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>加载失败</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.errorContainer}>
          <p className={styles.errorText}>
            {error || '蓝图不存在'}
          </p>
        </div>
      </div>
    );
  }

  // 分组业务流程
  const asIsProcesses = blueprint.businessProcesses.filter(p => p.type === 'as-is');
  const toBeProcesses = blueprint.businessProcesses.filter(p => p.type === 'to-be');

  return (
    <div className={styles.panel}>
      {/* 头部 */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{blueprint.name}</h2>
          <span className={`${styles.statusBadge} ${styles[blueprint.status]}`}>
            {statusTexts[blueprint.status]}
          </span>
        </div>
        <button className={styles.closeButton} onClick={onClose} title="关闭">
          ✕
        </button>
      </div>

      {/* 滚动内容区 */}
      <div className={styles.content}>
        {/* 基本信息 */}
        <FadeIn>
          <section className={styles.section}>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>版本</span>
                <span className={styles.infoValue}>{blueprint.version}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>创建时间</span>
                <span className={styles.infoValue}>
                  {new Date(blueprint.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              {blueprint.approvedBy && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>批准人</span>
                  <span className={styles.infoValue}>{blueprint.approvedBy}</span>
                </div>
              )}
            </div>
            <p className={styles.description}>{blueprint.description}</p>
          </section>
        </FadeIn>

        {/* 需求列表 */}
        {blueprint.requirements && blueprint.requirements.length > 0 && (
          <FadeIn delay={100}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('requirements')}
              >
                <span className={styles.sectionIcon}>📋</span>
                <h3 className={styles.sectionTitle}>
                  需求列表 ({blueprint.requirements.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.requirements ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.requirements && (
                <div className={styles.sectionContent}>
                  <ol className={styles.requirementList}>
                    {blueprint.requirements.map((req, i) => (
                      <li key={i} className={styles.requirementItem}>{req}</li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* 技术栈 */}
        {blueprint.techStack && Object.keys(blueprint.techStack).length > 0 && (
          <FadeIn delay={150}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('techStack')}
              >
                <span className={styles.sectionIcon}>🛠️</span>
                <h3 className={styles.sectionTitle}>技术栈</h3>
                <span className={styles.expandIcon}>
                  {expandedSections.techStack ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.techStack && (
                <div className={styles.sectionContent}>
                  <div className={styles.techStackGrid}>
                    {Object.entries(blueprint.techStack)
                      .filter(([, v]) => v)
                      .map(([key, value]) => (
                        <div key={key} className={styles.techStackItem}>
                          <span className={styles.techStackLabel}>{key}</span>
                          <span className={styles.techStackValue}>{value}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* 约束条件 */}
        {blueprint.constraints && blueprint.constraints.length > 0 && (
          <FadeIn delay={200}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('constraints')}
              >
                <span className={styles.sectionIcon}>⚠️</span>
                <h3 className={styles.sectionTitle}>
                  约束条件 ({blueprint.constraints.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.constraints ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.constraints && (
                <div className={styles.sectionContent}>
                  <ul className={styles.constraintList}>
                    {blueprint.constraints.map((c, i) => (
                      <li key={i} className={styles.constraintItem}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* 项目简介 */}
        {blueprint.brief && (
          <FadeIn delay={250}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('brief')}
              >
                <span className={styles.sectionIcon}>📖</span>
                <h3 className={styles.sectionTitle}>项目简介</h3>
                <span className={styles.expandIcon}>
                  {expandedSections.brief ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.brief && (
                <div className={styles.sectionContent}>
                  <pre className={styles.briefContent}>{blueprint.brief}</pre>
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* As-Is 业务流程 */}
        {asIsProcesses.length > 0 && (
          <FadeIn delay={100}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('asIsProcesses')}
              >
                <span className={styles.sectionIcon}>📊</span>
                <h3 className={styles.sectionTitle}>
                  As-Is 业务流程 ({asIsProcesses.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.asIsProcesses ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.asIsProcesses && (
                <div className={styles.sectionContent}>
                  {asIsProcesses.map(process => (
                    <div key={process.id} className={styles.processCard}>
                      <h4 className={styles.processName}>{process.name}</h4>
                      <p className={styles.processDesc}>{process.description}</p>
                      <div className={styles.processMeta}>
                        <span>步骤: {process.steps.length}</span>
                        <span>参与者: {process.actors.join(', ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* To-Be 业务流程 */}
        {toBeProcesses.length > 0 && (
          <FadeIn delay={200}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('toBeProcesses')}
              >
                <span className={styles.sectionIcon}>📊</span>
                <h3 className={styles.sectionTitle}>
                  To-Be 业务流程 ({toBeProcesses.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.toBeProcesses ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.toBeProcesses && (
                <div className={styles.sectionContent}>
                  {toBeProcesses.map(process => (
                    <div key={process.id} className={styles.processCard}>
                      <h4 className={styles.processName}>{process.name}</h4>
                      <p className={styles.processDesc}>{process.description}</p>
                      <div className={styles.processMeta}>
                        <span>步骤: {process.steps.length}</span>
                        <span>参与者: {process.actors.join(', ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* 系统模块 */}
        {blueprint.modules.length > 0 && (
          <FadeIn delay={300}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('modules')}
              >
                <span className={styles.sectionIcon}>🧩</span>
                <h3 className={styles.sectionTitle}>
                  系统模块 ({blueprint.modules.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.modules ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.modules && (
                <div className={styles.sectionContent}>
                  {blueprint.modules.map(module => (
                    <div key={module.id} className={styles.moduleCard}>
                      <div className={styles.moduleHeader}>
                        <h4 className={styles.moduleName}>{module.name}</h4>
                        <span className={styles.moduleType}>{module.type}</span>
                      </div>
                      {module.rootPath && (
                        <div className={styles.moduleRootPath}>
                          <span className={styles.moduleSectionTitle}>路径:</span>
                          <code>{module.rootPath}</code>
                        </div>
                      )}
                      <p className={styles.moduleDesc}>{module.description}</p>
                      {module.responsibilities.length > 0 && (
                        <div className={styles.moduleSection}>
                          <span className={styles.moduleSectionTitle}>职责:</span>
                          <ul className={styles.moduleList}>
                            {module.responsibilities.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {module.techStack && module.techStack.length > 0 && (
                        <div className={styles.moduleTechStack}>
                          <span className={styles.moduleSectionTitle}>技术栈:</span>
                          <div className={styles.techTags}>
                            {module.techStack.map((tech, i) => (
                              <span key={i} className={styles.techTag}>{tech}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {module.dependencies && module.dependencies.length > 0 && (
                        <div className={styles.moduleSection}>
                          <span className={styles.moduleSectionTitle}>
                            依赖: {module.dependencies.length} 个模块
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* 非功能性要求 */}
        {blueprint.nfrs.length > 0 && (
          <FadeIn delay={400}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('nfrs')}
              >
                <span className={styles.sectionIcon}>🎯</span>
                <h3 className={styles.sectionTitle}>
                  非功能性要求 ({blueprint.nfrs.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.nfrs ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.nfrs && (
                <div className={styles.sectionContent}>
                  {blueprint.nfrs.map(nfr => (
                    <div key={nfr.id} className={styles.nfrCard}>
                      <div className={styles.nfrHeader}>
                        <h4 className={styles.nfrName}>{nfr.name}</h4>
                        <div className={styles.nfrTags}>
                          <span className={styles.nfrCategory}>
                            {categoryTexts[nfr.category]}
                          </span>
                          <span className={`${styles.nfrPriority} ${styles[nfr.priority]}`}>
                            {priorityTexts[nfr.priority]}
                          </span>
                        </div>
                      </div>
                      <p className={styles.nfrDesc}>{nfr.description}</p>
                      {nfr.metric && (
                        <div className={styles.nfrMetric}>
                          <span className={styles.metricLabel}>指标:</span>
                          <span className={styles.metricValue}>{nfr.metric}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </FadeIn>
        )}

        {/* UI 设计图 */}
        {blueprint.designImages && blueprint.designImages.length > 0 && (
          <FadeIn delay={500}>
            <section className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection('designImages')}
              >
                <span className={styles.sectionIcon}>🎨</span>
                <h3 className={styles.sectionTitle}>
                  UI 设计图 ({blueprint.designImages.length})
                </h3>
                <span className={styles.expandIcon}>
                  {expandedSections.designImages ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.designImages && (
                <div className={styles.sectionContent}>
                  <div className={styles.designImageGrid}>
                    {blueprint.designImages.map(img => (
                      <div
                        key={img.id}
                        className={`${styles.designImageCard} ${img.isAccepted ? styles.accepted : ''}`}
                        onClick={() => setPreviewImage(img)}
                      >
                        <div className={styles.designImageWrapper}>
                          <img
                            src={img.imageData}
                            alt={img.name}
                            className={styles.designImageThumb}
                          />
                          {img.isAccepted && (
                            <div className={styles.acceptedBadge}>
                              ✓ 验收标准
                            </div>
                          )}
                        </div>
                        <div className={styles.designImageInfo}>
                          <h4 className={styles.designImageName}>{img.name}</h4>
                          <div className={styles.designImageMeta}>
                            <span className={styles.designImageStyle}>
                              {styleTexts[img.style] || img.style}
                            </span>
                            <span className={styles.designImageDate}>
                              {new Date(img.createdAt).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                          {img.description && (
                            <p className={styles.designImageDesc}>{img.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </FadeIn>
        )}
      </div>

      {/* 设计图预览模态框 */}
      {previewImage && (
        <div className={styles.imageModal} onClick={() => setPreviewImage(null)}>
          <div className={styles.imageModalContent} onClick={e => e.stopPropagation()}>
            <button
              className={styles.imageModalClose}
              onClick={() => setPreviewImage(null)}
            >
              ✕
            </button>
            <img
              src={previewImage.imageData}
              alt={previewImage.name}
              className={styles.imageModalImage}
            />
            <div className={styles.imageModalInfo}>
              <h3 className={styles.imageModalTitle}>{previewImage.name}</h3>
              <div className={styles.imageModalMeta}>
                <span className={styles.imageModalStyle}>
                  风格: {styleTexts[previewImage.style] || previewImage.style}
                </span>
                {previewImage.isAccepted && (
                  <span className={styles.imageModalAccepted}>
                    ✓ 已设为验收标准
                  </span>
                )}
              </div>
              {previewImage.description && (
                <p className={styles.imageModalDesc}>{previewImage.description}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 底部操作按钮 */}
      <div className={styles.footer}>
        {/* draft 状态：提交审核 + 删除 */}
        {blueprint.status === 'draft' && (
          <>
            <button
              className={`${styles.footerButton} ${styles.submit}`}
              onClick={() => handleAction('submit-review')}
            >
              提交审核
            </button>
            <button
              className={`${styles.footerButton} ${styles.delete}`}
              onClick={() => handleAction('delete')}
            >
              删除
            </button>
          </>
        )}

        {/* review 状态：批准 + 拒绝 + 删除 */}
        {blueprint.status === 'review' && (
          <>
            <button
              className={`${styles.footerButton} ${styles.approve}`}
              onClick={() => handleAction('approve')}
            >
              批准
            </button>
            <button
              className={`${styles.footerButton} ${styles.reject}`}
              onClick={() => handleAction('reject')}
            >
              拒绝
            </button>
            <button
              className={`${styles.footerButton} ${styles.delete}`}
              onClick={() => handleAction('delete')}
            >
              删除
            </button>
          </>
        )}

        {/* approved 状态：启动执行（仅对需求生成的蓝图显示） */}
        {blueprint.status === 'approved' && blueprint.source !== 'codebase' && (
          <button
            className={`${styles.footerButton} ${styles.start}`}
            onClick={() => handleAction('start-execution')}
          >
            启动执行
          </button>
        )}

        {/* approved 状态且从代码生成：显示说明 */}
        {blueprint.status === 'approved' && blueprint.source === 'codebase' && (
          <div className={styles.infoMessage}>
            此蓝图从现有代码生成，作为项目文档和后续开发的基础
          </div>
        )}

        {/* failed 状态：显示失败提示 + 删除 */}
        {blueprint.status === 'failed' && (
          <>
            <div className={styles.infoMessage}>
              执行失败，可以删除后重新创建蓝图
            </div>
            <button
              className={`${styles.footerButton} ${styles.delete}`}
              onClick={() => handleAction('delete')}
            >
              删除
            </button>
          </>
        )}

        {/* cancelled 状态：显示取消提示 + 删除 */}
        {blueprint.status === 'cancelled' && (
          <button
            className={`${styles.footerButton} ${styles.delete}`}
            onClick={() => handleAction('delete')}
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
};

export default BlueprintDetailPanel;

// 同时导出内容组件
export { BlueprintDetailContent } from './BlueprintDetailContent';
