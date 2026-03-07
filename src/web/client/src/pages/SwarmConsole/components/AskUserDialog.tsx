/**
 * AskUserDialog - E2E Agent 用户交互对话框
 *
 * 当 E2E Agent 调用 AskUserQuestion 工具时，显示此对话框让用户选择答案。
 * v4.2: 新增组件
 * v4.2.1: 修复 multiSelect 支持
 */

import React, { useState, useCallback } from 'react';
import type { AskUserDialogState } from '../types';
import styles from '../SwarmConsole.module.css';
import { useLanguage } from '../../../i18n';

interface AskUserDialogProps {
  dialog: AskUserDialogState;
  onSubmit: (requestId: string, answers: Record<string, string>, cancelled?: boolean) => void;
}

/**
 * 用户交互对话框
 */
export const AskUserDialog: React.FC<AskUserDialogProps> = ({ dialog, onSubmit }) => {
  const { t } = useLanguage();
  // 存储每个问题的答案（以 header 为 key）
  // 单选模式：存储单个选项 label
  // 多选模式：存储逗号分隔的选项 labels
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 多选模式：存储选中的选项 Set
  const [multiSelectAnswers, setMultiSelectAnswers] = useState<Record<string, Set<string>>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 处理单选选项选择
  const handleSingleSelect = useCallback((header: string, option: string) => {
    setAnswers(prev => ({
      ...prev,
      [header]: option,
    }));
    // 清除 "其他" 输入
    setOtherInputs(prev => {
      const newInputs = { ...prev };
      delete newInputs[header];
      return newInputs;
    });
  }, []);

  // 处理多选选项选择
  const handleMultiSelect = useCallback((header: string, option: string) => {
    setMultiSelectAnswers(prev => {
      const currentSet = new Set(prev[header] || []);
      if (currentSet.has(option)) {
        currentSet.delete(option);
      } else {
        currentSet.add(option);
      }
      const newSet = new Set(currentSet);

      // 同步更新 answers（逗号分隔）
      const answersValue = Array.from(newSet).join(', ');
      setAnswers(a => ({
        ...a,
        [header]: answersValue,
      }));

      return {
        ...prev,
        [header]: newSet,
      };
    });
    // 清除 "其他" 输入
    setOtherInputs(prev => {
      const newInputs = { ...prev };
      delete newInputs[header];
      return newInputs;
    });
  }, []);

  // 处理选项选择（根据模式分发）
  const handleOptionSelect = useCallback((header: string, option: string, isMultiSelect: boolean) => {
    if (isMultiSelect) {
      handleMultiSelect(header, option);
    } else {
      handleSingleSelect(header, option);
    }
  }, [handleSingleSelect, handleMultiSelect]);

  // 检查选项是否被选中（支持多选）
  const isOptionSelected = useCallback((header: string, option: string, isMultiSelect: boolean): boolean => {
    if (isMultiSelect) {
      return multiSelectAnswers[header]?.has(option) || false;
    }
    return answers[header] === option;
  }, [answers, multiSelectAnswers]);

  // 处理 "其他" 选项输入
  const handleOtherInput = useCallback((header: string, value: string) => {
    setOtherInputs(prev => ({
      ...prev,
      [header]: value,
    }));
    setAnswers(prev => ({
      ...prev,
      [header]: value, // 直接使用输入值作为答案
    }));
  }, []);

  // 提交答案
  const handleSubmit = useCallback(async () => {
    if (!dialog.requestId) return;

    // 检查是否所有问题都有答案
    const allAnswered = dialog.questions.every(q => answers[q.header]);
    if (!allAnswered) {
      alert(t('askUser.answerAllQuestions'));
      return;
    }

    setIsSubmitting(true);
    try {
      onSubmit(dialog.requestId, answers);
    } finally {
      setIsSubmitting(false);
    }
  }, [dialog.requestId, dialog.questions, answers, onSubmit]);

  // 取消
  const handleCancel = useCallback(() => {
    if (!dialog.requestId) return;
    onSubmit(dialog.requestId, {}, true);
  }, [dialog.requestId, onSubmit]);

  if (!dialog.visible || dialog.questions.length === 0) {
    return null;
  }

  return (
    <div className={styles.askUserDialogOverlay}>
      <div className={styles.askUserDialog}>
        {/* 标题栏 */}
        <div className={styles.askUserDialogHeader}>
          <span className={styles.askUserDialogIcon}>🤔</span>
          <h3>
            {dialog.workerId
              ? t('askUser.workerNeedsHelp', { id: dialog.workerId.substring(0, 8) })
              : t('askUser.agentNeedsHelp')
            }
          </h3>
        </div>

        {/* 问题列表 */}
        <div className={styles.askUserDialogContent}>
          {dialog.questions.map((question, qIndex) => (
            <div key={qIndex} className={styles.askUserQuestion}>
              <div className={styles.askUserQuestionHeader}>
                <span className={styles.askUserQuestionTag}>{question.header}</span>
              </div>
              <p className={styles.askUserQuestionText}>{question.question}</p>

              {/* 多选提示 */}
              {question.multiSelect && (
                <p className={styles.askUserMultiSelectHint}>{t('askUser.multiSelectHint')}</p>
              )}

              {/* 选项 */}
              <div className={styles.askUserOptions}>
                {question.options.map((option, oIndex) => (
                  <button
                    key={oIndex}
                    className={`${styles.askUserOption} ${isOptionSelected(question.header, option.label, question.multiSelect) ? styles.selected : ''} ${question.multiSelect ? styles.multiSelect : ''}`}
                    onClick={() => handleOptionSelect(question.header, option.label, question.multiSelect)}
                  >
                    {/* 多选模式显示复选框 */}
                    {question.multiSelect && (
                      <span className={styles.askUserOptionCheckbox}>
                        {isOptionSelected(question.header, option.label, question.multiSelect) ? '☑' : '☐'}
                      </span>
                    )}
                    <span className={styles.askUserOptionLabel}>{option.label}</span>
                    {option.description && (
                      <span className={styles.askUserOptionDesc}>{option.description}</span>
                    )}
                  </button>
                ))}

                {/* "其他" 选项 */}
                <div className={styles.askUserOtherOption}>
                  <input
                    type="text"
                    placeholder={t('askUser.otherPlaceholder')}
                    value={otherInputs[question.header] || ''}
                    onChange={(e) => handleOtherInput(question.header, e.target.value)}
                    className={`${styles.askUserOtherInput} ${otherInputs[question.header] ? styles.active : ''}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className={styles.askUserDialogActions}>
          <button
            className={styles.askUserCancelBtn}
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {t('askUser.cancel')}
          </button>
          <button
            className={styles.askUserSubmitBtn}
            onClick={handleSubmit}
            disabled={isSubmitting || dialog.questions.some(q => !answers[q.header])}
          >
            {isSubmitting ? t('askUser.submitting') : t('askUser.submit')}
          </button>
        </div>
      </div>
    </div>
  );
};
