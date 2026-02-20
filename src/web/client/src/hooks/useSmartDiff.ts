/**
 * useSmartDiff Hook
 * 实现语义 Diff 分析功能：分析代码改动的语义影响，显示风险等级
 */

import { useState, useCallback, useRef } from 'react';
import { aiSmartDiffApi, type SmartDiffChange } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseSmartDiffOptions {
  filePath: string | null;
  content: string;
  originalContent: string;
  language: string;
  modified: boolean;
}

export interface SmartDiffAnalysis {
  summary: string;
  impact: 'safe' | 'warning' | 'danger';
  changes: SmartDiffChange[];
  warnings: string[];
}

export interface UseSmartDiffReturn {
  state: {
    visible: boolean;
    loading: boolean;
    analysis: SmartDiffAnalysis | null;
  };
  analyze: () => Promise<void>;
  close: () => void;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useSmartDiff(options: UseSmartDiffOptions): UseSmartDiffReturn {
  const { filePath, content, originalContent, language, modified } = options;

  // 状态
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<SmartDiffAnalysis | null>(null);

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const contentRef = useRef(content);
  const originalContentRef = useRef(originalContent);
  const languageRef = useRef(language);
  const modifiedRef = useRef(modified);

  // 更新 ref
  filePathRef.current = filePath;
  contentRef.current = content;
  originalContentRef.current = originalContent;
  languageRef.current = language;
  modifiedRef.current = modified;

  /**
   * 分析代码改动
   */
  const analyze = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    const currentContent = contentRef.current;
    const currentOriginalContent = originalContentRef.current;
    const currentLanguage = languageRef.current;
    const isModified = modifiedRef.current;

    // 如果文件未修改，不做任何事
    if (!isModified || !currentFilePath) {
      console.log('[useSmartDiff] 文件未修改或文件路径为空，跳过分析');
      return;
    }

    setLoading(true);
    setAnalysis(null);
    setVisible(true);

    try {
      const response = await aiSmartDiffApi.analyze({
        filePath: currentFilePath,
        language: currentLanguage,
        originalContent: currentOriginalContent,
        modifiedContent: currentContent,
      });

      if (response.success && response.analysis) {
        console.log(`[useSmartDiff] 分析完成，影响等级: ${response.analysis.impact}${response.fromCache ? ' (缓存)' : ''}`);
        setAnalysis(response.analysis);
      } else {
        console.error('[useSmartDiff] 分析失败:', response.error);
        alert(`语义 Diff 分析失败: ${response.error || '未知错误'}`);
        setVisible(false);
      }
    } catch (error: any) {
      console.error('[useSmartDiff] 分析异常:', error);
      alert(`语义 Diff 分析异常: ${error.message || '未知错误'}`);
      setVisible(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 关闭对话框
   */
  const close = useCallback(() => {
    setVisible(false);
    setLoading(false);
    setAnalysis(null);
  }, []);

  return {
    state: {
      visible,
      loading,
      analysis,
    },
    analyze,
    close,
  };
}
