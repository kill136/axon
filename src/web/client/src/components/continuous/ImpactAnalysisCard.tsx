import React, { useState } from 'react';
import { useLanguage } from '../../i18n';

interface ImpactAnalysisData {
  risk: {
    overallLevel: 'low' | 'medium' | 'high' | 'critical';
    breakingChanges: number;
    highRiskFiles: number;
    summary: string;
  };
  impact: {
    additions: Array<{ path: string }>;
    modifications: Array<{ path: string }>;
    deletions: Array<{ path: string }>;
    byModule: Array<{ moduleName: string }>;
    interfaceChanges: Array<{ interfaceName: string; breakingChange: boolean }>;
  };
  safetyBoundary: {
    allowedPaths: Array<{ path: string; operations: Array<'read' | 'write' | 'delete'> }>;
    readOnlyPaths: string[];
    forbiddenPaths: Array<{ path: string; reason: string }>;
    requireReviewPaths: Array<{ path: string; reason: string }>;
  };
  regressionScope: {
    mustRun: Array<{ testPath: string }>;
    shouldRun: Array<{ testPath: string }>;
    estimatedDuration: number;
  };
  recommendations: string[];
}

interface ImpactAnalysisCardProps {
  data: ImpactAnalysisData;
  onApprove: () => void;
  onReject: () => void;
}

export const ImpactAnalysisCard: React.FC<ImpactAnalysisCardProps> = ({ 
  data, 
  onApprove, 
  onReject 
}) => {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const riskLevel = data.risk?.overallLevel || 'low';
  const impactedFiles = [
    ...(data.impact?.additions || []),
    ...(data.impact?.modifications || []),
    ...(data.impact?.deletions || []),
  ];

  const riskColor = {
    low: 'text-green-500',
    medium: 'text-yellow-500',
    high: 'text-red-500',
    critical: 'text-red-400'
  };

  const riskBg = {
    low: 'bg-green-500/10 border-green-500/20',
    medium: 'bg-yellow-500/10 border-yellow-500/20',
    high: 'bg-red-500/10 border-red-500/20',
    critical: 'bg-red-600/15 border-red-600/30'
  };

  return (
    <div className={`rounded-lg border p-4 my-4 ${riskBg[riskLevel]}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            📊 {t('impact.title')}
            <span className={`text-xs px-2 py-0.5 rounded-full border ${riskBg[riskLevel]} ${riskColor[riskLevel]}`}>
              {riskLevel.toUpperCase()} {t('impact.risk')}
            </span>
          </h3>
          <p className="text-sm text-gray-400 mt-1">{data.risk?.summary || t('impact.noSummary')}</p>
        </div>
      </div>

      <div className="space-y-3 mt-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-black/20 p-2 rounded">
            <div className="text-gray-500 text-xs mb-1">{t('impact.affectedModules')}</div>
            <div className="font-mono">{data.impact?.byModule?.length || 0} {t('impact.countUnit')}</div>
          </div>
          <div className="bg-black/20 p-2 rounded">
            <div className="text-gray-500 text-xs mb-1">{t('impact.affectedFiles')}</div>
            <div className="font-mono">{impactedFiles.length} {t('impact.filesUnit')}</div>
          </div>
          <div className="bg-black/20 p-2 rounded">
            <div className="text-gray-500 text-xs mb-1">{t('impact.breakingChanges')}</div>
            <div className="font-mono">{data.risk?.breakingChanges || 0} {t('impact.countUnit')}</div>
          </div>
          <div className="bg-black/20 p-2 rounded">
            <div className="text-gray-500 text-xs mb-1">{t('impact.regressionEstimate')}</div>
            <div className="font-mono">{Math.round(data.regressionScope?.estimatedDuration || 0)} {t('impact.seconds')}</div>
          </div>
        </div>

        {expanded && (
          <div className="space-y-3 text-sm border-t border-white/10 pt-3 mt-3">
            <div>
              <h4 className="font-medium mb-1 text-gray-300">{t('impact.safetyBoundary')}</h4>
              <ul className="list-disc list-inside text-gray-400 font-mono text-xs max-h-32 overflow-y-auto">
                {(data.safetyBoundary?.allowedPaths || []).map((entry, i) => (
                  <li key={i}>
                    {entry.path} ({entry.operations.join(', ')})
                  </li>
                ))}
              </ul>
            </div>
            
            {(data.safetyBoundary?.forbiddenPaths || []).length > 0 && (
              <div>
                <h4 className="font-medium mb-1 text-red-400">{t('impact.forbiddenPaths')}</h4>
                <ul className="list-disc list-inside text-gray-400 font-mono text-xs max-h-32 overflow-y-auto">
                  {(data.safetyBoundary?.forbiddenPaths || []).map((entry, i) => (
                    <li key={i}>{entry.path} - {entry.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {(data.safetyBoundary?.readOnlyPaths || []).length > 0 && (
              <div>
                <h4 className="font-medium mb-1 text-yellow-400">{t('impact.readOnlyPaths')}</h4>
                <ul className="list-disc list-inside text-gray-400 font-mono text-xs max-h-24 overflow-y-auto">
                  {(data.safetyBoundary?.readOnlyPaths || []).map((entry, i) => (
                    <li key={i}>{entry}</li>
                  ))}
                </ul>
              </div>
            )}

            {(data.safetyBoundary?.requireReviewPaths || []).length > 0 && (
              <div>
                <h4 className="font-medium mb-1 text-yellow-400">{t('impact.requireReview')}</h4>
                <ul className="list-disc list-inside text-gray-400 font-mono text-xs max-h-24 overflow-y-auto">
                  {(data.safetyBoundary?.requireReviewPaths || []).map((entry, i) => (
                    <li key={i}>{entry.path} - {entry.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button 
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors w-full text-center py-1"
        >
          {expanded ? t('impact.collapseDetails') : t('impact.viewFullReport')}
        </button>

        {(data.recommendations || []).length > 0 && (
          <div className="text-sm text-gray-400 border-t border-white/10 pt-3">
            <div className="text-gray-300 font-medium mb-1">{t('impact.recommendations')}</div>
            <ul className="list-disc list-inside space-y-1">
              {(data.recommendations || []).map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3 mt-4 pt-3 border-t border-white/10">
          <button
            onClick={onApprove}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-md transition-colors text-sm font-medium"
          >
            {t('impact.approve')}
          </button>
          <button
            onClick={onReject}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-md transition-colors text-sm font-medium"
          >
            {t('impact.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
