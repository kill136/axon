import React from 'react';
import { useLanguage } from '../../i18n';

interface RegressionResultData {
  passed: boolean;
  failureReason?: string;
  failedTests?: string[];
  recommendations?: string[];
  duration?: number;
  newTests?: { total: number; passed: number; failed: number };
  regressionTests?: { total: number; passed: number; failed: number };
}

interface RegressionResultCardProps {
  data: RegressionResultData;
  onRollback?: () => void;
}

export const RegressionResultCard: React.FC<RegressionResultCardProps> = ({ data, onRollback }) => {
  const { t } = useLanguage();
  const title = data.passed ? t('regression.passed') : t('regression.failed');
  const statusColor = data.passed ? 'text-green-400' : 'text-red-400';
  const borderColor = data.passed ? 'border-green-500/20 bg-green-500/10' : 'border-red-500/20 bg-red-500/10';

  return (
    <div className={`rounded-lg border p-4 my-4 ${borderColor}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-lg font-semibold ${statusColor}`}>🧪 {title}</h3>
        {data.duration !== undefined && (
          <span className="text-xs text-gray-400">{Math.round(data.duration / 1000)}s</span>
        )}
      </div>

      {data.failureReason && (
        <div className="text-sm text-gray-300 mb-3">
          {t('regression.failureReason')}: {data.failureReason}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
        <div className="bg-black/20 rounded p-2">
          {t('regression.newTests')}: {data.newTests?.passed || 0}/{data.newTests?.total || 0}
        </div>
        <div className="bg-black/20 rounded p-2">
          {t('regression.regressionTests')}: {data.regressionTests?.passed || 0}/{data.regressionTests?.total || 0}
        </div>
      </div>

      {(data.failedTests || []).length > 0 && (
        <div className="mt-3 text-sm text-gray-300">
          <div className="font-medium text-gray-200 mb-1">{t('regression.failedTestsTitle')}</div>
          <ul className="list-disc list-inside text-xs text-gray-400 max-h-28 overflow-y-auto">
            {(data.failedTests || []).slice(0, 6).map((test, i) => (
              <li key={i}>{test}</li>
            ))}
          </ul>
        </div>
      )}

      {(data.recommendations || []).length > 0 && (
        <div className="mt-3 text-sm text-gray-300">
          <div className="font-medium text-gray-200 mb-1">{t('regression.recommendations')}</div>
          <ul className="list-disc list-inside text-xs text-gray-400">
            {(data.recommendations || []).map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {!data.passed && onRollback && (
        <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onRollback}
            className="text-xs px-3 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-200 rounded border border-red-900/50"
          >
            {t('regression.rollback')}
          </button>
        </div>
      )}
    </div>
  );
};
