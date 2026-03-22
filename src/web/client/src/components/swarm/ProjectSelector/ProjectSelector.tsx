import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../../../i18n';
import { useProject, type Project } from '../../../contexts/ProjectContext';
import styles from './ProjectSelector.module.css';

// Re-export Project for other modules
export type { Project } from '../../../contexts/ProjectContext';

/**
 * ProjectSelector 组件属性
 */
export interface ProjectSelectorProps {
  /** 请求打开文件夹回调 */
  onOpenFolder?: () => void;
  /** 创建作品回调（AI 帮我做） */
  onCreateApp?: () => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * 项目/作品选择器
 *
 * 从 ProjectContext 获取数据，不自己 fetch。
 */
export default function ProjectSelector({
  onOpenFolder,
  onCreateApp,
  className = '',
}: ProjectSelectorProps) {
  const { t } = useLanguage();
  const { state: { currentProject, recentProjects, loading }, switchProject, removeProject } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const displayName = currentProject?.name || t('projectSelector.noProject');
  const displayIcon = currentProject?.icon || (currentProject ? '📁' : '📂');

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const close = () => setIsOpen(false);

  const handleOpenProject = (project: Project) => {
    switchProject(project);
    close();
  };

  const handleRemoveProject = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    removeProject(project.id);
  };

  return (
    <div className={`${styles.selector} ${className}`} ref={selectorRef}>
      {/* 当前选中 */}
      <button
        className={`${styles.currentProject} ${isOpen ? styles.open : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className={styles.projectInfo}>
          <span className={styles.projectIcon}>{displayIcon}</span>
          <span className={`${styles.projectName} ${!currentProject ? styles.noProject : ''}`}>
            {displayName}
          </span>
        </div>
        <span className={`${styles.arrow} ${isOpen ? styles.open : ''}`}>▲</span>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className={styles.dropdown} role="listbox">

          {/* AI 帮我做 + 打开文件夹 */}
          <div className={styles.actionRow}>
            <button className={styles.actionButton} onClick={() => { onCreateApp?.(); close(); }}>
              <span className={styles.actionIcon}>✨</span>
              <span>{t('projectSelector.createApp')}</span>
            </button>
            <button className={styles.actionButton} onClick={() => { onOpenFolder?.(); close(); }}>
              <span className={styles.actionIcon}>📂</span>
              <span>{t('projectSelector.openFolder')}</span>
            </button>
          </div>

          <div className={styles.divider} />

          {/* 最近打开 */}
          <div className={styles.dropdownHeader}>{t('projectSelector.recentProjects')}</div>
          <div className={styles.projectList}>
            {loading ? (
              <div className={styles.loading}>
                <div className={styles.spinner} />
                <span>{t('projectSelector.loading')}</span>
              </div>
            ) : recentProjects.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📂</div>
                <p>{t('projectSelector.noRecentProjects')}</p>
                <p className={styles.emptyHint}>{t('projectSelector.noRecentProjectsHint')}</p>
              </div>
            ) : (
              recentProjects.map((project) => (
                <div
                  key={project.id}
                  className={`${styles.projectItem} ${
                    currentProject?.id === project.id ? styles.active : ''
                  }`}
                  onClick={() => handleOpenProject(project)}
                  role="option"
                  aria-selected={currentProject?.id === project.id}
                >
                  <span className={styles.projectItemIcon}>{project.icon || '📁'}</span>
                  <div className={styles.projectItemInfo}>
                    <div className={styles.projectItemNameRow}>
                      <span className={styles.projectItemName}>{project.name}</span>
                      {project.hasBlueprint && (
                        <span className={styles.blueprintTag}>{t('projectSelector.blueprint')}</span>
                      )}
                    </div>
                    <span className={styles.projectItemPath}>{project.path}</span>
                  </div>
                  <button
                    className={styles.removeButton}
                    onClick={(e) => handleRemoveProject(e, project)}
                    title={t('projectSelector.removeFromList')}
                    aria-label={t('projectSelector.removeProject', { name: project.name })}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
