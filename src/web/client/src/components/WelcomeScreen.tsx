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

const PROJECT_TEMPLATES: QuickTemplate[] = [
  { icon: '🔍', labelKey: 'welcome.template.analyze', promptKey: 'welcome.template.analyze.prompt' },
  { icon: '🐛', labelKey: 'welcome.template.fix', promptKey: 'welcome.template.fix.prompt' },
  { icon: '📝', labelKey: 'welcome.template.review', promptKey: 'welcome.template.review.prompt' },
  { icon: '✨', labelKey: 'welcome.template.refactor', promptKey: 'welcome.template.refactor.prompt' },
  { icon: '🧪', labelKey: 'welcome.template.test', promptKey: 'welcome.template.test.prompt' },
  { icon: '📖', labelKey: 'welcome.template.explain', promptKey: 'welcome.template.explain.prompt' },
];

const EMPTY_TEMPLATES: QuickTemplate[] = [
  { icon: '🚀', labelKey: 'welcome.template.todoApp', promptKey: 'welcome.template.todoApp.prompt' },
  { icon: '🌐', labelKey: 'welcome.template.api', promptKey: 'welcome.template.api.prompt' },
  { icon: '📊', labelKey: 'welcome.template.dashboard', promptKey: 'welcome.template.dashboard.prompt' },
  { icon: '🤖', labelKey: 'welcome.template.cli', promptKey: 'welcome.template.cli.prompt' },
];

export function WelcomeScreen({ onBlueprintCreated: _onBlueprintCreated, onQuickPrompt, onOpenFolder }: WelcomeScreenProps) {
  const { state: projectState } = useProject();
  const { t } = useLanguage();

  const hasProject = !!projectState.currentProject;
  const isEmptyProject = hasProject && projectState.currentProject?.isEmpty === true;
  const hasBlueprint = projectState.currentProject?.hasBlueprint === true;

  const templates = isEmptyProject && !hasBlueprint ? EMPTY_TEMPLATES : PROJECT_TEMPLATES;

  const handleTemplateClick = (tpl: QuickTemplate) => {
    if (onQuickPrompt) {
      onQuickPrompt(t(tpl.promptKey));
    }
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
        </>
      )}

      {/* Quick templates - 仅在有项目时显示 */}
      {hasProject && (
        <div className="welcome-templates">
          {templates.map((tpl) => (
            <button
              key={tpl.labelKey}
              className="welcome-template-btn"
              onClick={() => handleTemplateClick(tpl)}
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
