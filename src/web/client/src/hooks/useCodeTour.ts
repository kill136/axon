/**
 * useCodeTour Hook
 * 自动生成代码导游步骤，逐步导航文件结构
 * 从 BlueprintDetailContent.tsx 提取的 AI 代码导游逻辑
 */

import { useState, useCallback, useRef } from 'react';
import * as Monaco from 'monaco-editor';
import { aiTourApi, TourStep } from '../api/ai-editor';
import { extractJSDocForLine, formatJSDocBrief } from '../utils/jsdocParser';

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
// 工具函数
// ============================================================================

/**
 * 拆分驼峰命名为可读文本
 */
function splitCamelCase(str: string): string {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim()
    .toLowerCase();
}

/**
 * 根据命名推断代码职责
 */
function inferPurposeFromName(name: string): string {
  // 常见命名模式
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    // 动作类
    [/^handle(\w+)$/, (m) => `处理 ${splitCamelCase(m[1])} 事件`],
    [/^on(\w+)$/, (m) => `响应 ${splitCamelCase(m[1])} 事件`],
    [/^get(\w+)$/, (m) => `获取 ${splitCamelCase(m[1])}`],
    [/^set(\w+)$/, (m) => `设置 ${splitCamelCase(m[1])}`],
    [/^fetch(\w+)$/, (m) => `请求 ${splitCamelCase(m[1])} 数据`],
    [/^load(\w+)$/, (m) => `加载 ${splitCamelCase(m[1])}`],
    [/^save(\w+)$/, (m) => `保存 ${splitCamelCase(m[1])}`],
    [/^create(\w+)$/, (m) => `创建 ${splitCamelCase(m[1])}`],
    [/^update(\w+)$/, (m) => `更新 ${splitCamelCase(m[1])}`],
    [/^delete(\w+)$/, (m) => `删除 ${splitCamelCase(m[1])}`],
    [/^remove(\w+)$/, (m) => `移除 ${splitCamelCase(m[1])}`],
    [/^add(\w+)$/, (m) => `添加 ${splitCamelCase(m[1])}`],
    [/^init(\w*)$/, (m) => m[1] ? `初始化 ${splitCamelCase(m[1])}` : '执行初始化'],
    [/^parse(\w+)$/, (m) => `解析 ${splitCamelCase(m[1])}`],
    [/^format(\w+)$/, (m) => `格式化 ${splitCamelCase(m[1])}`],
    [/^validate(\w+)$/, (m) => `验证 ${splitCamelCase(m[1])}`],
    [/^check(\w+)$/, (m) => `检查 ${splitCamelCase(m[1])}`],
    [/^is(\w+)$/, (m) => `判断是否 ${splitCamelCase(m[1])}`],
    [/^has(\w+)$/, (m) => `判断是否有 ${splitCamelCase(m[1])}`],
    [/^can(\w+)$/, (m) => `判断能否 ${splitCamelCase(m[1])}`],
    [/^should(\w+)$/, (m) => `判断是否应该 ${splitCamelCase(m[1])}`],
    [/^render(\w*)$/, (m) => m[1] ? `渲染 ${splitCamelCase(m[1])}` : '执行渲染'],
    [/^use(\w+)$/, (m) => `${splitCamelCase(m[1])} Hook`],
    [/^with(\w+)$/, (m) => `附加 ${splitCamelCase(m[1])} 能力的高阶组件`],
    // 角色类后缀
    [/(\w+)Manager$/, (m) => `${splitCamelCase(m[1])} 管理器`],
    [/(\w+)Service$/, (m) => `${splitCamelCase(m[1])} 服务`],
    [/(\w+)Controller$/, (m) => `${splitCamelCase(m[1])} 控制器`],
    [/(\w+)Handler$/, (m) => `${splitCamelCase(m[1])} 处理器`],
    [/(\w+)Provider$/, (m) => `${splitCamelCase(m[1])} 提供者`],
    [/(\w+)Factory$/, (m) => `${splitCamelCase(m[1])} 工厂`],
    [/(\w+)Builder$/, (m) => `${splitCamelCase(m[1])} 构建器`],
    [/(\w+)Helper$/, (m) => `${splitCamelCase(m[1])} 辅助工具`],
    [/(\w+)Util(?:s)?$/, (m) => `${splitCamelCase(m[1])} 工具函数`],
    [/(\w+)Coordinator$/, (m) => `${splitCamelCase(m[1])} 协调器，负责多组件间的协作调度`],
    [/(\w+)Registry$/, (m) => `${splitCamelCase(m[1])} 注册表`],
    [/(\w+)Pool$/, (m) => `${splitCamelCase(m[1])} 池`],
    [/(\w+)Queue$/, (m) => `${splitCamelCase(m[1])} 队列`],
    [/(\w+)Cache$/, (m) => `${splitCamelCase(m[1])} 缓存`],
    [/(\w+)Store$/, (m) => `${splitCamelCase(m[1])} 状态存储`],
    [/(\w+)Context$/, (m) => `${splitCamelCase(m[1])} 上下文`],
    [/(\w+)Reducer$/, (m) => `${splitCamelCase(m[1])} 状态管理 Reducer`],
    [/(\w+)Middleware$/, (m) => `${splitCamelCase(m[1])} 中间件`],
    [/(\w+)Plugin$/, (m) => `${splitCamelCase(m[1])} 插件`],
    [/(\w+)Adapter$/, (m) => `${splitCamelCase(m[1])} 适配器`],
    [/(\w+)Wrapper$/, (m) => `${splitCamelCase(m[1])} 包装器`],
    [/(\w+)Listener$/, (m) => `${splitCamelCase(m[1])} 监听器`],
    [/(\w+)Observer$/, (m) => `${splitCamelCase(m[1])} 观察者`],
    [/(\w+)Emitter$/, (m) => `${splitCamelCase(m[1])} 事件发射器`],
    [/(\w+)Client$/, (m) => `${splitCamelCase(m[1])} 客户端`],
    [/(\w+)Server$/, (m) => `${splitCamelCase(m[1])} 服务端`],
    [/(\w+)Api$/, (m) => `${splitCamelCase(m[1])} API 接口`],
    [/(\w+)Route(?:r)?$/, (m) => `${splitCamelCase(m[1])} 路由`],
    [/(\w+)Component$/, (m) => `${splitCamelCase(m[1])} 组件`],
    [/(\w+)View$/, (m) => `${splitCamelCase(m[1])} 视图`],
    [/(\w+)Page$/, (m) => `${splitCamelCase(m[1])} 页面`],
    [/(\w+)Modal$/, (m) => `${splitCamelCase(m[1])} 弹窗`],
    [/(\w+)Dialog$/, (m) => `${splitCamelCase(m[1])} 对话框`],
    [/(\w+)Form$/, (m) => `${splitCamelCase(m[1])} 表单`],
    [/(\w+)List$/, (m) => `${splitCamelCase(m[1])} 列表`],
    [/(\w+)Table$/, (m) => `${splitCamelCase(m[1])} 表格`],
    [/(\w+)Panel$/, (m) => `${splitCamelCase(m[1])} 面板`],
    [/(\w+)Card$/, (m) => `${splitCamelCase(m[1])} 卡片`],
    [/(\w+)Button$/, (m) => `${splitCamelCase(m[1])} 按钮`],
    [/(\w+)Input$/, (m) => `${splitCamelCase(m[1])} 输入框`],
    [/(\w+)Select$/, (m) => `${splitCamelCase(m[1])} 选择器`],
  ];

  for (const [pattern, generator] of patterns) {
    const match = name.match(pattern);
    if (match) {
      return generator(match);
    }
  }

  return '';
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
   * 生成智能描述：优先使用 JSDoc，否则分析代码结构
   */
  const generateSmartDescription = useCallback((
    type: 'class' | 'function' | 'component',
    name: string,
    lineNum: number,
    content: string
  ): string => {
    // 1. 优先从 JSDoc 获取描述
    const jsdoc = extractJSDocForLine(content, lineNum, filePath || undefined);
    if (jsdoc && jsdoc.description) {
      return formatJSDocBrief(jsdoc);
    }

    // 2. 根据代码结构分析
    const lines = content.split('\n');

    if (type === 'class') {
      // 分析类的结构
      const classStartLine = lineNum - 1;
      let braceCount = 0;
      let started = false;
      let methodCount = 0;
      let propertyCount = 0;
      const methods: string[] = [];
      let extendsClass = '';
      let implementsInterfaces: string[] = [];

      // 解析 extends 和 implements
      const classDecl = lines[classStartLine];
      const extendsMatch = classDecl.match(/extends\s+(\w+)/);
      const implementsMatch = classDecl.match(/implements\s+([\w\s,]+)/);
      if (extendsMatch) extendsClass = extendsMatch[1];
      if (implementsMatch) {
        implementsInterfaces = implementsMatch[1].split(',').map(s => s.trim());
      }

      for (let i = classStartLine; i < Math.min(classStartLine + 200, lines.length); i++) {
        const line = lines[i];
        if (line.includes('{')) { braceCount++; started = true; }
        if (line.includes('}')) braceCount--;
        if (started && braceCount === 0) break;

        // 识别方法
        const methodMatch = line.match(/^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:async)?\s*(\w+)\s*\(/);
        if (methodMatch && methodMatch[1] !== 'constructor') {
          methodCount++;
          if (methods.length < 3) methods.push(methodMatch[1]);
        }

        // 识别属性
        const propMatch = line.match(/^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:readonly)?\s*(\w+)\s*[?:]?\s*[:=]/);
        if (propMatch && !line.includes('(')) {
          propertyCount++;
        }
      }

      // 根据分析结果生成描述
      const parts: string[] = [];

      // 基于类名推断职责
      const nameDesc = inferPurposeFromName(name);
      if (nameDesc) {
        parts.push(nameDesc);
      }

      if (extendsClass) {
        parts.push(`继承自 ${extendsClass}`);
      }
      if (implementsInterfaces.length > 0) {
        parts.push(`实现 ${implementsInterfaces.join(', ')} 接口`);
      }
      if (methodCount > 0) {
        parts.push(`包含 ${methodCount} 个方法` + (methods.length > 0 ? `（${methods.join(', ')} 等）` : ''));
      }
      if (propertyCount > 0) {
        parts.push(`${propertyCount} 个属性`);
      }

      return parts.length > 0 ? parts.join('，') + '。' : `类 ${name}`;
    }

    if (type === 'function' || type === 'component') {
      // 分析函数/组件结构
      const funcStartLine = lineNum - 1;
      const funcDecl = lines[funcStartLine];

      // 提取参数
      const paramsMatch = funcDecl.match(/\(([^)]*)\)/);
      const params = paramsMatch ? paramsMatch[1].split(',').filter(p => p.trim()).map(p => {
        const nameMatch = p.trim().match(/^(\w+)/);
        return nameMatch ? nameMatch[1] : '';
      }).filter(Boolean) : [];

      // 提取返回类型
      const returnMatch = funcDecl.match(/\):\s*([^{]+)/);
      const returnType = returnMatch ? returnMatch[1].trim() : '';

      // 检查是否是 async
      const isAsync = funcDecl.includes('async');

      const parts: string[] = [];

      // 基于函数名推断职责
      const nameDesc = inferPurposeFromName(name);
      if (nameDesc) {
        parts.push(nameDesc);
      }

      if (type === 'component') {
        // 分析组件使用的 hooks
        let braceCount = 0;
        let started = false;
        const hooks: string[] = [];
        for (let i = funcStartLine; i < Math.min(funcStartLine + 100, lines.length); i++) {
          const line = lines[i];
          if (line.includes('{')) { braceCount++; started = true; }
          if (line.includes('}')) braceCount--;
          if (started && braceCount === 0) break;

          const hookMatch = line.match(/use(\w+)\s*\(/);
          if (hookMatch && !hooks.includes(hookMatch[1]) && hooks.length < 3) {
            hooks.push('use' + hookMatch[1]);
          }
        }

        if (hooks.length > 0) {
          parts.push(`使用 ${hooks.join(', ')}`);
        }
      }

      if (isAsync) {
        parts.push('异步执行');
      }
      if (params.length > 0) {
        parts.push(`接收参数: ${params.slice(0, 3).join(', ')}${params.length > 3 ? ' 等' : ''}`);
      }
      if (returnType && returnType !== 'void') {
        parts.push(`返回 ${returnType}`);
      }

      return parts.length > 0 ? parts.join('，') + '。' : `${type === 'component' ? '组件' : '函数'} ${name}`;
    }

    return `${name}`;
  }, [filePath]);

  /**
   * 本地生成导游步骤（作为 AI 调用失败时的 fallback）
   */
  const generateLocalTourSteps = useCallback((content: string): TourStep[] => {
    const steps: TourStep[] = [];
    const lines = content.split('\n');

    // 解析导入区域
    let importEndLine = 0;
    const importSources: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const importMatch = lines[i].match(/^import\s.*from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        importEndLine = i + 1;
        const source = importMatch[1];
        if (!source.startsWith('.') && !source.startsWith('@/') && importSources.length < 5) {
          importSources.push(source.split('/')[0]);
        }
      }
    }
    if (importEndLine > 0) {
      const uniqueSources = [...new Set(importSources)];
      steps.push({
        type: 'block',
        name: '导入声明',
        line: 1,
        endLine: importEndLine,
        description: uniqueSources.length > 0
          ? `引入 ${uniqueSources.join(', ')} 等外部依赖。`
          : '引入本地模块依赖。',
        importance: 'medium',
      });
    }

    // 解析类定义
    const classMatches = content.matchAll(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g);
    for (const match of classMatches) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      steps.push({
        type: 'class',
        name: match[1],
        line: lineNum,
        description: generateSmartDescription('class', match[1], lineNum, content),
        importance: 'high',
      });
    }

    // 解析函数定义
    const funcMatches = content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g);
    for (const match of funcMatches) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      steps.push({
        type: 'function',
        name: match[1],
        line: lineNum,
        description: generateSmartDescription('function', match[1], lineNum, content),
        importance: 'high',
      });
    }

    // 解析 React 组件
    const componentMatches = content.matchAll(/(?:export\s+)?const\s+(\w+):\s*React\.FC/g);
    for (const match of componentMatches) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      steps.push({
        type: 'function',
        name: match[1],
        line: lineNum,
        description: generateSmartDescription('component', match[1], lineNum, content),
        importance: 'high',
      });
    }

    steps.sort((a, b) => a.line - b.line);
    return steps;
  }, [generateSmartDescription]);

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
        console.log('[Tour] AI 接口未返回结果，使用本地分析');
        steps = generateLocalTourSteps(content);
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
      console.error('生成导游失败:', err);
      // 失败时尝试本地分析
      try {
        const localSteps = generateLocalTourSteps(content);
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
  }, [filePath, content, editorRef, generateLocalTourSteps]);

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
