import { useState, useEffect } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useLanguage } from '../i18n';

interface WelcomeScreenProps {
  onBlueprintCreated?: (blueprintId: string) => void;
  onQuickPrompt?: (prompt: string) => void;
  onOpenFolder?: () => void;
}

interface QuickTemplate {
  icon: string;
  labelKey: string;
  promptKey: string;
}

// 后端返回的建议类型
interface Suggestion {
  id: string;
  icon: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  prompt: string;
  priority: number;
  category: string;
}

interface Capability {
  icon: string;
  title: string;
  titleZh: string;
  prompt: string;
}

interface FrequentTask {
  title: string;
  count: number;
  prompt: string;
}

/**
 * 空项目：直接说想做什么
 */
const EMPTY_TEMPLATES: QuickTemplate[] = [
  { icon: '🚀', labelKey: 'welcome.template.todoApp', promptKey: 'welcome.template.todoApp.prompt' },
  { icon: '🌐', labelKey: 'welcome.template.api', promptKey: 'welcome.template.api.prompt' },
  { icon: '📊', labelKey: 'welcome.template.dashboard', promptKey: 'welcome.template.dashboard.prompt' },
  { icon: '🤖', labelKey: 'welcome.template.cli', promptKey: 'welcome.template.cli.prompt' },
];

export function WelcomeScreen({ onBlueprintCreated: _onBlueprintCreated, onQuickPrompt, onOpenFolder }: WelcomeScreenProps) {
  const { state: projectState } = useProject();
  const { t, locale } = useLanguage();
  const isZh = locale === 'zh';

  const hasProject = !!projectState.currentProject;
  const isEmptyProject = hasProject && projectState.currentProject?.isEmpty === true;
  const hasBlueprint = projectState.currentProject?.hasBlueprint === true;

  // 主动建议数据
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [frequentTasks, setFrequentTasks] = useState<FrequentTask[]>([]);

  // 当有项目且不是空项目时，请求建议
  useEffect(() => {
    if (!hasProject || isEmptyProject) {
      setSuggestions([]);
      setCapabilities([]);
      setFrequentTasks([]);
      return;
    }

    const projectPath = projectState.currentProject?.path;
    if (!projectPath) return;

    const controller = new AbortController();
    fetch(`/api/project-suggestions?projectPath=${encodeURIComponent(projectPath)}`, {
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(data => {
        setSuggestions(data.suggestions || []);
        setCapabilities(data.capabilities || []);
        setFrequentTasks(data.frequentTasks || []);
      })
      .catch(() => {
        // 静默失败，不影响体验
      });

    return () => controller.abort();
  }, [hasProject, isEmptyProject, projectState.currentProject?.path]);

  const handlePromptClick = (prompt: string) => {
    onQuickPrompt?.(prompt);
  };

  return (
    <div className="welcome-screen">
      <img src="/logo.png" alt="Axon" className="welcome-logo" />
      <h2 className="welcome-title">Axon</h2>
      <span className="welcome-version">v{__APP_VERSION__}</span>

      {!hasProject ? (
        <>
          <p className="welcome-subtitle">
            {t('welcome.noProject.subtitle')}
          </p>

          <button className="welcome-open-folder-btn" onClick={onOpenFolder}>
            <span className="welcome-open-folder-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5.5A2.5 2.5 0 015.5 3h3.672a1.5 1.5 0 011.06.44L11.354 4.56a1.5 1.5 0 001.06.44H18.5A2.5 2.5 0 0121 7.5v10a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5v-12z" />
                <path d="M12 10v6M9 13h6" />
              </svg>
            </span>
            <span className="welcome-open-folder-text">{t('welcome.noProject.openFolder')}</span>
            <span className="welcome-open-folder-desc">{t('welcome.noProject.openFolderDesc')}</span>
          </button>

          <div className="welcome-hints">
            <div className="welcome-hint-item hint-item-1">
              <span className="hint-icon">📂</span>
              <span className="hint-text">{t('welcome.noProject.hint1')}</span>
            </div>
            <div className="welcome-hint-item hint-item-2">
              <span className="hint-icon">💬</span>
              <span className="hint-text">{t('welcome.noProject.hint2')}</span>
            </div>
            <div className="welcome-hint-item hint-item-3">
              <span className="hint-icon">🚀</span>
              <span className="hint-text">{t('welcome.noProject.hint3')}</span>
            </div>
          </div>
        </>
      ) : isEmptyProject && !hasBlueprint ? (
        <>
          <p className="welcome-subtitle">
            {t('welcome.emptyProject.subtitle')}
          </p>

          <div className="welcome-hints">
            <div className="welcome-hint-item hint-item-1">
              <span className="hint-icon">💡</span>
              <span className="hint-text">{t('welcome.emptyProject.hint1')}</span>
            </div>
            <div className="welcome-hint-item hint-item-2">
              <span className="hint-icon">📋</span>
              <span className="hint-text">{t('welcome.emptyProject.hint2')}</span>
            </div>
            <div className="welcome-hint-item hint-item-3">
              <span className="hint-icon">🚀</span>
              <span className="hint-text">{t('welcome.emptyProject.hint3')}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="welcome-subtitle">
            {t('welcome.project.subtitle')}
          </p>

          {/* 主动建议区域 — 基于项目状态 */}
          {suggestions.length > 0 && (
            <div className="welcome-suggestions">
              <div className="welcome-section-label">
                {isZh ? '当前状态' : 'Right Now'}
              </div>
              <div className="welcome-suggestion-list">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    className="welcome-suggestion-btn"
                    onClick={() => handlePromptClick(s.prompt)}
                    title={isZh ? s.descriptionZh : s.description}
                  >
                    <span className="suggestion-icon">{s.icon}</span>
                    <span className="suggestion-text">{isZh ? s.titleZh : s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 常用任务区域 */}
          {frequentTasks.length > 0 && (
            <div className="welcome-suggestions">
              <div className="welcome-section-label">
                {isZh ? '常用操作' : 'Frequent'}
              </div>
              <div className="welcome-suggestion-list">
                {frequentTasks.map(ft => (
                  <button
                    key={ft.title}
                    className="welcome-suggestion-btn"
                    onClick={() => handlePromptClick(ft.prompt)}
                  >
                    <span className="suggestion-icon">🔄</span>
                    <span className="suggestion-text">{ft.title}</span>
                    <span className="suggestion-count">x{ft.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 能力发现区域 */}
          {capabilities.length > 0 && (
            <div className="welcome-suggestions">
              <div className="welcome-section-label">
                {isZh ? '我能帮你' : 'I Can Help With'}
              </div>
              <div className="welcome-suggestion-list">
                {capabilities.map((cap, i) => (
                  <button
                    key={i}
                    className="welcome-template-btn"
                    onClick={() => handlePromptClick(cap.prompt)}
                  >
                    <span className="template-icon">{cap.icon}</span>
                    <span className="template-label">{isZh ? cap.titleZh : cap.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 无建议时的回退提示 */}
          {suggestions.length === 0 && capabilities.length === 0 && (
            <div className="welcome-hints">
              <div className="welcome-hint-item hint-item-1">
                <span className="hint-icon">💡</span>
                <span className="hint-text">{t('welcome.project.hint1')}</span>
              </div>
              <div className="welcome-hint-item hint-item-2">
                <span className="hint-icon">🔍</span>
                <span className="hint-text">{t('welcome.project.hint2')}</span>
              </div>
              <div className="welcome-hint-item hint-item-3">
                <span className="hint-icon">📎</span>
                <span className="hint-text">{t('welcome.project.hint3')}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Quick templates - 仅在空项目时显示 */}
      {hasProject && isEmptyProject && !hasBlueprint && (
        <div className="welcome-templates">
          {EMPTY_TEMPLATES.map((tpl) => (
            <button
              key={tpl.labelKey}
              className="welcome-template-btn"
              onClick={() => onQuickPrompt?.(t(tpl.promptKey))}
              title={t(tpl.promptKey)}
            >
              <span className="template-icon">{tpl.icon}</span>
              <span className="template-label">{t(tpl.labelKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
