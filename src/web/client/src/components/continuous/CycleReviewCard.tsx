import React from 'react';
import { useLanguage } from '../../i18n';

interface CycleReviewData {
  score: number;
  summary: string;
  issues?: Array<{ category: string; severity: string; description: string; suggestion?: string }>;
  recommendations?: string[];
  rollbackSuggestion?: { recommended: boolean; targetCheckpoint?: string; reason?: string };
}

interface CycleReviewCardProps {
  data: CycleReviewData;
  onRollback?: (checkpointId?: string) => void;
}

export const CycleReviewCard: React.FC<CycleReviewCardProps> = ({ data, onRollback }) => {
  const { t } = useLanguage();
  const scoreColor = data.score >= 80 ? 'text-green-400' : data.score >= 60 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="rounded-lg border border-white/10 bg-gray-900/40 p-4 my-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-200">🔁 {t('cycleReview.title')}</h3>
        <span className={`text-sm font-mono ${scoreColor}`}>{Math.round(data.score)}/100</span>
      </div>

      <p className="text-sm text-gray-400">{data.summary}</p>

      {(data.issues || []).length > 0 && (
        <div className="mt-3 text-sm text-gray-300">
          <div className="font-medium text-gray-200 mb-1">{t('cycleReview.issuesList')}</div>
          <ul className="list-disc list-inside text-xs text-gray-400 max-h-32 overflow-y-auto">
            {(data.issues || []).map((issue, i) => (
              <li key={i}>
                [{issue.severity}] {issue.description}
                {issue.suggestion ? ` (${issue.suggestion})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data.recommendations || []).length > 0 && (
        <div className="mt-3 text-sm text-gray-300">
          <div className="font-medium text-gray-200 mb-1">{t('cycleReview.recommendations')}</div>
          <ul className="list-disc list-inside text-xs text-gray-400">
            {(data.recommendations || []).map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {data.rollbackSuggestion?.recommended && onRollback && (
        <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
          <button
            onClick={() => onRollback(data.rollbackSuggestion?.targetCheckpoint)}
            className="text-xs px-3 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-200 rounded border border-red-900/50"
          >
            {t('cycleReview.rollbackToCheckpoint')}
          </button>
        </div>
      )}
    </div>
  );
};
