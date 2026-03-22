import { useState } from 'react';
import { useLanguage } from '../i18n';
import type { UserQuestion } from '../types';

interface UserQuestionDialogProps {
  question: UserQuestion;
  onAnswer: (answer: string) => void;
}

export function UserQuestionDialog({ question, onAnswer }: UserQuestionDialogProps) {
  const [answer, setAnswer] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const { t } = useLanguage();
  const questionText = question.question.trim() || t('question.missingPrompt');

  const handleOptionChange = (optionLabel: string, isMultiSelect?: boolean) => {
    if (isMultiSelect) {
      setSelectedOptions(prev =>
        prev.includes(optionLabel)
          ? prev.filter(o => o !== optionLabel)
          : [...prev, optionLabel]
      );
    } else {
      setSelectedOptions([optionLabel]);
    }
  };

  const handleSubmit = () => {
    let finalAnswer = '';
    if (question.options) {
      finalAnswer = question.multiSelect
        ? selectedOptions.join(',')
        : selectedOptions[0] || '';
    } else {
      finalAnswer = answer;
    }
    onAnswer(finalAnswer);
  };

  const handleSkip = () => {
    onAnswer('');
  };

  const isValid = question.options
    ? selectedOptions.length > 0
    : answer.trim().length > 0;

  return (
    <div className="question-dialog-overlay">
      <div className="question-dialog">
        <div className="question-header">
          <h3>❓ {question.header || t('question.defaultHeader')}</h3>
        </div>
        <div className="question-content">
          <p className="question-text">{questionText}</p>
          {question.options && (
            <div className="question-options">
              {question.options.map((opt, i) => (
                <label
                  key={i}
                  className={`question-option ${selectedOptions.includes(opt.label) ? 'selected' : ''}`}
                  onClick={() => handleOptionChange(opt.label, question.multiSelect)}
                >
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name="question-answer"
                    value={opt.label}
                    checked={selectedOptions.includes(opt.label)}
                    onChange={() => {}}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="question-option-content">
                    <div className="question-option-label">{opt.label}</div>
                    {opt.description && (
                      <div className="question-option-description">{opt.description}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
          {!question.options && (
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={t('question.placeholder')}
              autoFocus
            />
          )}
        </div>
        <div className="question-actions">
          <button onClick={handleSkip}>{t('question.skip')}</button>
          <button onClick={handleSubmit} disabled={!isValid}>{t('question.submit')}</button>
        </div>
        {question.timeout && (
          <div className="question-timeout-hint">
            {t('question.timeout', { seconds: Math.round(question.timeout / 1000) })}
          </div>
        )}
      </div>
    </div>
  );
}
