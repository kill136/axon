import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../../../i18n';
import { useProject, type Project } from '../../../contexts/ProjectContext';
import styles from './ProjectSelector.module.css';

// Re-export Project for other modules
export type { Project } from '../../../contexts/ProjectContext';

/**
 * AI 作品信息（精简版，由父组件传入）
 */
export interface AppItem {
  id: string;
  name: string;
  icon: string;
  status: 'creating' | 'ready' | 'error';
  sessionId: string;
}

/**
 * ProjectSelector 组件属性
 */
export interface ProjectSelectorProps {
  /** 请求打开文件夹回调 */
  onOpenFolder?: () => void;
  /** 自定义类名 */
  className?: string;
  /** AI 作品列表 */
  apps?: AppItem[];
  /** 点击作品回调 */
  onAppSelect?: (app: AppItem) => void;
  /** 创建新作品回调 */
  onCreateApp?: () => void;
}

/**
 * 项目/作品选择器
 *
 * 从 ProjectContext 获取数据，不自己 fetch。
 */
export default function ProjectSelector({
  onOpenFolder,
  className = '',
  apps = [],
  onAppSelect,
  onCreateApp,
}: ProjectSelectorProps) {
  const { t } = useLanguage();
  const { state: { currentProject, recentProjects, loading }, switchProject, removeProject } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const activeApps = apps.filter(a => a.status === 'ready');

  const displayName = currentProject?.name || t('projectSelector.noProject');
  const displayIcon = currentProject?.icon || (currentProject ? '📁' : '✨');

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

          {/* 两个入口平级并排 */}
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

          {/* 进行中（活跃作品） */}
          {activeApps.length > 0 && (
            <>
              <div className={styles.dropdownHeader}>{t('projectSelector.activeApps')}</div>
              <div className={styles.appList}>
                {activeApps.map(app => (
                  <div
                    key={app.id}
                    className={styles.appItem}
                    onClick={() => { onAppSelect?.(app); close(); }}
                  >
                    <span className={styles.appIcon}>{app.icon}</span>
                    <span className={styles.appName}>{app.name}</span>
                    <span className={styles.appStatus}>
                      <span className={styles.statusDot} />
                      {t('projectSelector.online')}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.divider} />
            </>
          )}

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
