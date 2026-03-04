/**
 * AXON.md 初始化提示弹框
 * 当项目缺少 AXON.md 时弹出，提示用户创建
 */

import './InitAxonMdDialog.css';

interface InitAxonMdDialogProps {
  visible: boolean;
  projectPath: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function InitAxonMdDialog({ visible, projectPath, onConfirm, onCancel }: InitAxonMdDialogProps) {
  if (!visible) return null;

  const projectName = projectPath.split(/[/\\]/).pop() || projectPath;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div className="init-axon-md-overlay" onClick={handleBackdropClick}>
      <div className="init-axon-md-dialog">
        <div className="init-axon-md-header">
          <h3>Initialize AXON.md</h3>
        </div>
        <div className="init-axon-md-body">
          <p>
            Project <strong>{projectName}</strong> does not have an <code>AXON.md</code> file.
          </p>
          <p>
            This file defines behavioral rules and project conventions for the AI assistant.
            Create one now with the default template?
          </p>
        </div>
        <div className="init-axon-md-footer">
          <button className="init-axon-md-btn secondary" onClick={onCancel}>
            Skip
          </button>
          <button className="init-axon-md-btn primary" onClick={onConfirm}>
            Create AXON.md
          </button>
        </div>
      </div>
    </div>
  );
}
