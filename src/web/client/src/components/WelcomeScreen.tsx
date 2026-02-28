import { useProject } from '../contexts/ProjectContext';
import { useLanguage } from '../i18n';

interface WelcomeScreenProps {
  onBlueprintCreated?: (blueprintId: string) => void;
}

export function WelcomeScreen({ onBlueprintCreated: _onBlueprintCreated }: WelcomeScreenProps) {
  const { state: projectState } = useProject();
  const { t } = useLanguage();

  // 判断项目状态
  const hasProject = !!projectState.currentProject;
  const isEmptyProject = hasProject && projectState.currentProject?.isEmpty === true;
  const hasBlueprint = projectState.currentProject?.hasBlueprint === true;

  return (
    <div className="welcome-screen">
      <img src="/logo.png" alt="Axon" className="welcome-logo" />
      <h2 className="welcome-title">Axon WebUI</h2>
      <span className="welcome-version">v2.1.20</span>

      {isEmptyProject && !hasBlueprint ? (
        // 空项目且无蓝图：引导用户在聊天框输入需求
        <>
          <p className="welcome-subtitle">
            {t('welcome.emptyProject.subtitle')}
          </p>

          {/* 快捷提示 */}
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
        // 非空项目或已有蓝图：显示 AI 对话提示
        <>
          <p className="welcome-subtitle">
            {t('welcome.project.subtitle')}
          </p>

          {/* 快捷提示 */}
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
    </div>
  );
}
