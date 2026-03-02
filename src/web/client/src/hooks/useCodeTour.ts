/**
 * useCodeTour Hook
 * 自动生成代码导游步骤，逐步导航文件结构
 * 从 BlueprintDetailContent.tsx 提取的 AI 代码导游逻辑
 */

import { useState, useCallback, useRef } from 'react';
import * as Monaco from 'monaco-editor';
import { aiTourApi, TourStep } from '../api/ai-editor';
import { analyzeCodeStructure } from '../utils/codeStructureAnalyzer';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseCodeTourOptions {
  filePath: string | null;
  content: string;
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor>;
}

export interface TourState {
  active: boolean;
  steps: TourStep[];
  currentStep: number;
  loading: boolean;
}

export interface UseCodeTourReturn {
  tourState: TourState;
  startTour: () => Promise<void>;
  stopTour: () => void;
  navigate: (direction: 'prev' | 'next') => void;
  goToStep: (index: number) => void;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useCodeTour(options: UseCodeTourOptions): UseCodeTourReturn {
  const { filePath, content, editorRef } = options;

  const [tourState, setTourState] = useState<TourState>({
    active: false,
    steps: [],
    currentStep: 0,
    loading: false,
  });

  /**
   * 启动代码导游
   */
  const startTour = useCallback(async () => {
    if (!filePath || !content) return;

    setTourState(prev => ({ ...prev, loading: true, active: false }));

    try {
      // 调用后端 AI 接口生成智能导游
      const response = await aiTourApi.generate(filePath, content);

      let steps: TourStep[] = [];

      if (response.success && response.data?.steps) {
        steps = response.data.steps;
      }

      // 如果 AI 接口失败或返回空，使用本地分析作为 fallback
      if (steps.length === 0) {
        console.log('[Tour] AI API returned no result, using local analysis');
        steps = analyzeCodeStructure(content, filePath);
      }

      setTourState({
        active: true,
        steps,
        currentStep: 0,
        loading: false,
      });

      // 跳转到第一步
      if (steps.length > 0 && editorRef.current) {
        editorRef.current.revealLineInCenter(steps[0].line);
        editorRef.current.setPosition({ lineNumber: steps[0].line, column: 1 });
      }
    } catch (err) {
      console.error('Failed to generate tour:', err);
      // 失败时尝试本地分析
      try {
        const localSteps = analyzeCodeStructure(content, filePath);
        if (localSteps.length > 0) {
          setTourState({
            active: true,
            steps: localSteps,
            currentStep: 0,
            loading: false,
          });
          if (editorRef.current) {
            editorRef.current.revealLineInCenter(localSteps[0].line);
            editorRef.current.setPosition({ lineNumber: localSteps[0].line, column: 1 });
          }
          return;
        }
      } catch {}
      setTourState(prev => ({ ...prev, loading: false }));
    }
  }, [filePath, content, editorRef]);

  /**
   * 停止导游
   */
  const stopTour = useCallback(() => {
    setTourState({
      active: false,
      steps: [],
      currentStep: 0,
      loading: false,
    });
  }, []);

  /**
   * 导航（上一步/下一步）
   */
  const navigate = useCallback((direction: 'prev' | 'next') => {
    if (!tourState.active || tourState.steps.length === 0) return;

    let newStep = tourState.currentStep;
    if (direction === 'next' && newStep < tourState.steps.length - 1) {
      newStep++;
    } else if (direction === 'prev' && newStep > 0) {
      newStep--;
    }

    setTourState(prev => ({ ...prev, currentStep: newStep }));

    const step = tourState.steps[newStep];
    if (step && editorRef.current) {
      editorRef.current.revealLineInCenter(step.line);
      editorRef.current.setPosition({ lineNumber: step.line, column: 1 });
    }
  }, [tourState, editorRef]);

  /**
   * 跳转到指定步骤
   */
  const goToStep = useCallback((index: number) => {
    if (!tourState.active || index < 0 || index >= tourState.steps.length) return;

    setTourState(prev => ({ ...prev, currentStep: index }));

    const step = tourState.steps[index];
    if (step && editorRef.current) {
      editorRef.current.revealLineInCenter(step.line);
      editorRef.current.setPosition({ lineNumber: step.line, column: 1 });
    }
  }, [tourState, editorRef]);

  return {
    tourState,
    startTour,
    stopTour,
    navigate,
    goToStep,
  };
}
