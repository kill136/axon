import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  useState,
  useRef,
  type ReactNode,
  type Dispatch,
} from 'react';
import FolderBrowserDialog from '../components/swarm/FolderBrowserDialog';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 项目信息接口
 */
export interface Project {
  /** 项目唯一标识 */
  id: string;
  /** 项目名称 */
  name: string;
  /** 项目路径 */
  path: string;
  /** 最后打开时间 */
  lastOpenedAt?: string;
  /** 项目是否为空（无源代码文件）*/
  isEmpty?: boolean;
  /** 是否已有蓝图文件 */
  hasBlueprint?: boolean;
}

/**
 * 蓝图基本信息
 */
export interface BlueprintInfo {
  id: string;
  name: string;
  version: string;
}

/**
 * 项目 Context 状态
 */
export interface ProjectState {
  /** 当前选中的项目 */
  currentProject: Project | null;
  /** 最近项目列表 */
  recentProjects: Project[];
  /** 当前项目关联的蓝图 */
  currentBlueprint: BlueprintInfo | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 是否初始化完成 */
  initialized: boolean;
}

/**
 * Action 类型
 */
type ProjectAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_RECENT_PROJECTS'; payload: Project[] }
  | { type: 'SET_CURRENT_PROJECT'; payload: Project | null }
  | { type: 'SET_CURRENT_BLUEPRINT'; payload: BlueprintInfo | null }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'REMOVE_PROJECT'; payload: string }
  | { type: 'SET_INITIALIZED'; payload: boolean }
  | { type: 'OPEN_PROJECT_SUCCESS'; payload: { project: Project; blueprint: BlueprintInfo | null } };

/**
 * Context 值类型
 */
export interface ProjectContextValue {
  state: ProjectState;
  dispatch: Dispatch<ProjectAction>;
  /** 切换到指定项目 */
  switchProject: (project: Project) => Promise<void>;
  /** 打开文件夹选择对话框并打开选中的项目 */
  openFolder: () => Promise<Project | null>;
  /** 移除项目 */
  removeProject: (projectId: string) => Promise<void>;
  /** 刷新项目列表 */
  refreshProjects: () => Promise<void>;
  /** 获取当前工作目录项目 */
  getCurrentProject: () => Promise<Project | null>;
}

// ============================================================================
// 常量
// ============================================================================

const LOCAL_STORAGE_KEY = 'claude-code-current-project';
const PROJECT_CHANGE_EVENT = 'project-changed';

// ============================================================================
// Reducer
// ============================================================================

const initialState: ProjectState = {
  currentProject: null,
  recentProjects: [],
  currentBlueprint: null,
  loading: false,
  error: null,
  initialized: false,
};

function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };

    case 'SET_RECENT_PROJECTS':
      // 过滤掉无效的项目条目
      return { ...state, recentProjects: (action.payload || []).filter(p => p && p.id) };

    case 'SET_CURRENT_PROJECT':
      return { ...state, currentProject: action.payload };

    case 'SET_CURRENT_BLUEPRINT':
      return { ...state, currentBlueprint: action.payload };

    case 'ADD_PROJECT': {
      // 检查 payload 有效性
      if (!action.payload || !action.payload.id) {
        console.warn('[ProjectContext] ADD_PROJECT: 无效的 payload', action.payload);
        return state;
      }
      // 过滤掉无效的项目条目
      const validProjects = state.recentProjects.filter(p => p && p.id);
      const exists = validProjects.some(p => p.id === action.payload.id);
      if (exists) {
        // 更新现有项目并移到列表开头
        const filtered = validProjects.filter(p => p.id !== action.payload.id);
        return {
          ...state,
          recentProjects: [action.payload, ...filtered],
        };
      }
      return {
        ...state,
        recentProjects: [action.payload, ...validProjects],
      };
    }

    case 'REMOVE_PROJECT': {
      const filtered = state.recentProjects.filter(p => p && p.id && p.id !== action.payload);
      const shouldClearCurrent = state.currentProject?.id === action.payload;
      return {
        ...state,
        recentProjects: filtered,
        currentProject: shouldClearCurrent ? null : state.currentProject,
        currentBlueprint: shouldClearCurrent ? null : state.currentBlueprint,
      };
    }

    case 'SET_INITIALIZED':
      return { ...state, initialized: action.payload };

    case 'OPEN_PROJECT_SUCCESS':
      return {
        ...state,
        currentProject: action.payload.project,
        currentBlueprint: action.payload.blueprint,
        loading: false,
        error: null,
      };

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

const ProjectContext = createContext<ProjectContextValue | null>(null);

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 localStorage 恢复上次选中的项目
 */
function loadSavedProject(): Project | null {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as Project;
    }
  } catch (error) {
    console.error('[ProjectContext] 从 localStorage 加载项目失败:', error);
  }
  return null;
}

/**
 * 保存当前项目到 localStorage
 */
function saveProjectToStorage(project: Project | null): void {
  try {
    if (project) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(project));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch (error) {
    console.error('[ProjectContext] 保存项目到 localStorage 失败:', error);
  }
}

/**
 * 发送项目切换全局事件
 */
function emitProjectChangeEvent(project: Project | null, blueprint: BlueprintInfo | null): void {
  const event = new CustomEvent(PROJECT_CHANGE_EVENT, {
    detail: { project, blueprint },
  });
  window.dispatchEvent(event);
}

// ============================================================================
// Provider 组件
// ============================================================================

export interface ProjectProviderProps {
  children: ReactNode;
}

export function ProjectProvider({ children }: ProjectProviderProps) {
  const [state, dispatch] = useReducer(projectReducer, initialState);
  
  // FolderBrowserDialog 状态
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  // 用于存储 Promise 的 resolve/reject 回调
  const folderBrowserPromiseRef = useRef<{
    resolve: (path: string | null) => void;
    reject: (error: Error) => void;
  } | null>(null);

  // ========================================
  // API 调用
  // ========================================

  /**
   * 获取最近项目列表
   */
  const fetchRecentProjects = useCallback(async (): Promise<Project[]> => {
    const response = await fetch('/api/blueprint/projects');
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '获取项目列表失败');
    }
    return result.data || [];
  }, []);

  /**
   * 打开项目（调用后端 API）
   */
  const openProjectApi = useCallback(async (projectPath: string): Promise<{
    project: Project;
    blueprint: BlueprintInfo | null;
  }> => {
    const response = await fetch('/api/blueprint/projects/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectPath }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '打开项目失败');
    }
    // 后端返回格式：data: { id, path, name, lastOpenedAt, blueprint }
    // 项目数据直接在 data 上，不是 data.project
    const { blueprint, ...projectData } = result.data || {};
    if (!projectData || !projectData.id) {
      throw new Error('服务器返回的项目数据无效');
    }
    return {
      project: projectData as Project,
      blueprint: blueprint || null,
    };
  }, []);

  /**
   * 浏览文件夹（调用系统对话框，如果系统对话框不可用则回退到 Web 端目录浏览器）
   */
  const browseFolder = useCallback(async (): Promise<string | null> => {
    const response = await fetch('/api/blueprint/projects/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '打开文件夹选择对话框失败');
    }
    
    // 检查是否需要回退到 Web 端目录浏览器
    if (result.data?.noGui) {
      console.log('[ProjectContext] 系统对话框不可用，使用 Web 端目录浏览器');
      // 返回一个 Promise，通过 FolderBrowserDialog 的回调来 resolve
      return new Promise((resolve, reject) => {
        folderBrowserPromiseRef.current = { resolve, reject };
        setShowFolderBrowser(true);
      });
    }
    
    if (result.data?.cancelled) {
      return null;
    }
    return result.data?.path || null;
  }, []);

  /**
   * 移除项目（调用后端 API）
   */
  const removeProjectApi = useCallback(async (projectId: string): Promise<void> => {
    const response = await fetch(`/api/blueprint/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '移除项目失败');
    }
  }, []);

  /**
   * 获取当前工作目录项目
   */
  const fetchCurrentProject = useCallback(async (): Promise<Project | null> => {
    const response = await fetch('/api/blueprint/projects/current');
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '获取当前项目失败');
    }
    return result.data || null;
  }, []);

  // ========================================
  // 对外暴露的方法
  // ========================================

  /**
   * 刷新项目列表
   */
  const refreshProjects = useCallback(async (): Promise<void> => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const projects = await fetchRecentProjects();
      dispatch({ type: 'SET_RECENT_PROJECTS', payload: projects });
    } catch (error: any) {
      console.error('[ProjectContext] 刷新项目列表失败:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [fetchRecentProjects]);

  /**
   * 切换项目
   */
  const switchProject = useCallback(async (project: Project): Promise<void> => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const { project: openedProject, blueprint } = await openProjectApi(project.path);

      dispatch({
        type: 'OPEN_PROJECT_SUCCESS',
        payload: { project: openedProject, blueprint },
      });

      // 更新项目列表（将项目移到开头）
      dispatch({ type: 'ADD_PROJECT', payload: openedProject });

      // 保存到 localStorage
      saveProjectToStorage(openedProject);

      // 发送全局事件
      emitProjectChangeEvent(openedProject, blueprint);
    } catch (error: any) {
      console.error('[ProjectContext] 切换项目失败:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [openProjectApi]);

  /**
   * 打开文件夹
   */
  const openFolder = useCallback(async (): Promise<Project | null> => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // 调用系统文件夹选择对话框
      const selectedPath = await browseFolder();
      if (!selectedPath) {
        dispatch({ type: 'SET_LOADING', payload: false });
        return null;
      }

      // 打开选中的项目
      const { project, blueprint } = await openProjectApi(selectedPath);

      dispatch({
        type: 'OPEN_PROJECT_SUCCESS',
        payload: { project, blueprint },
      });

      // 更新项目列表
      dispatch({ type: 'ADD_PROJECT', payload: project });

      // 保存到 localStorage
      saveProjectToStorage(project);

      // 发送全局事件
      emitProjectChangeEvent(project, blueprint);

      return project;
    } catch (error: any) {
      console.error('[ProjectContext] 打开文件夹失败:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [browseFolder, openProjectApi]);

  /**
   * 移除项目
   */
  const removeProject = useCallback(async (projectId: string): Promise<void> => {
    try {
      await removeProjectApi(projectId);
      dispatch({ type: 'REMOVE_PROJECT', payload: projectId });

      // 如果移除的是当前项目，清除 localStorage
      if (state.currentProject?.id === projectId) {
        saveProjectToStorage(null);
        emitProjectChangeEvent(null, null);
      }
    } catch (error: any) {
      console.error('[ProjectContext] 移除项目失败:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
      throw error;
    }
  }, [removeProjectApi, state.currentProject?.id]);

  /**
   * 获取当前工作目录项目
   */
  const getCurrentProject = useCallback(async (): Promise<Project | null> => {
    try {
      return await fetchCurrentProject();
    } catch (error: any) {
      console.error('[ProjectContext] 获取当前项目失败:', error);
      return null;
    }
  }, [fetchCurrentProject]);

  // ========================================
  // FolderBrowserDialog 回调
  // ========================================

  /**
   * FolderBrowserDialog 确认回调
   */
  const handleFolderBrowserConfirm = useCallback((path: string) => {
    setShowFolderBrowser(false);
    if (folderBrowserPromiseRef.current) {
      folderBrowserPromiseRef.current.resolve(path);
      folderBrowserPromiseRef.current = null;
    }
  }, []);

  /**
   * FolderBrowserDialog 取消回调
   */
  const handleFolderBrowserCancel = useCallback(() => {
    setShowFolderBrowser(false);
    if (folderBrowserPromiseRef.current) {
      folderBrowserPromiseRef.current.resolve(null);
      folderBrowserPromiseRef.current = null;
    }
  }, []);

  // ========================================
  // 初始化
  // ========================================

  useEffect(() => {
    const initialize = async () => {
      dispatch({ type: 'SET_LOADING', payload: true });

      try {
        // 1. 加载最近项目列表
        const projects = await fetchRecentProjects();
        dispatch({ type: 'SET_RECENT_PROJECTS', payload: projects });

        // 2. 尝试恢复上次选中的项目
        const savedProject = loadSavedProject();
        let projectRestored = false;
        if (savedProject) {
          // 验证保存的项目是否仍在列表中
          const exists = projects.some(p => p && p.id === savedProject.id);
          if (exists) {
            // 重新打开项目以获取最新蓝图信息
            try {
              const { project, blueprint } = await openProjectApi(savedProject.path);
              dispatch({
                type: 'OPEN_PROJECT_SUCCESS',
                payload: { project, blueprint },
              });
              emitProjectChangeEvent(project, blueprint);
              projectRestored = true;
            } catch (error) {
              console.warn('[ProjectContext] 恢复保存的项目失败，使用缓存数据:', error);
              dispatch({ type: 'SET_CURRENT_PROJECT', payload: savedProject });
              projectRestored = true;
            }
          } else {
            // 保存的项目已不存在，清除
            saveProjectToStorage(null);
          }
        }

        // 3. 如果没有恢复任何项目，使用 server 的工作目录作为默认项目
        if (!projectRestored) {
          try {
            const defaultProject = await fetchCurrentProject();
            if (defaultProject) {
              dispatch({ type: 'SET_CURRENT_PROJECT', payload: defaultProject });
              dispatch({ type: 'ADD_PROJECT', payload: defaultProject });
              saveProjectToStorage(defaultProject);
              emitProjectChangeEvent(defaultProject, null);
              console.log('[ProjectContext] 使用默认工作目录:', defaultProject.path);
            }
          } catch (error) {
            console.warn('[ProjectContext] 获取默认工作目录失败:', error);
          }
        }

        dispatch({ type: 'SET_INITIALIZED', payload: true });
      } catch (error: any) {
        console.error('[ProjectContext] 初始化失败:', error);
        dispatch({ type: 'SET_ERROR', payload: error.message });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    initialize();
  }, [fetchRecentProjects, openProjectApi, fetchCurrentProject]);

  // ========================================
  // Context 值
  // ========================================

  const contextValue = useMemo<ProjectContextValue>(
    () => ({
      state,
      dispatch,
      switchProject,
      openFolder,
      removeProject,
      refreshProjects,
      getCurrentProject,
    }),
    [state, switchProject, openFolder, removeProject, refreshProjects, getCurrentProject]
  );

  return (
    <ProjectContext.Provider value={contextValue}>
      {children}
      {/* FolderBrowserDialog: 当系统原生对话框不可用时显示 */}
      <FolderBrowserDialog
        visible={showFolderBrowser}
        onConfirm={handleFolderBrowserConfirm}
        onCancel={handleFolderBrowserCancel}
      />
    </ProjectContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * 使用项目 Context 的 Hook
 */
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject 必须在 ProjectProvider 内部使用');
  }
  return context;
}

/**
 * 监听项目切换事件的 Hook
 */
export function useProjectChangeListener(
  callback: (project: Project | null, blueprint: BlueprintInfo | null) => void
): void {
  useEffect(() => {
    const handler = (event: CustomEvent<{ project: Project | null; blueprint: BlueprintInfo | null }>) => {
      callback(event.detail.project, event.detail.blueprint);
    };

    window.addEventListener(PROJECT_CHANGE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(PROJECT_CHANGE_EVENT, handler as EventListener);
    };
  }, [callback]);
}

// ============================================================================
// 导出事件名常量，供外部使用
// ============================================================================

export const PROJECT_CHANGE_EVENT_NAME = PROJECT_CHANGE_EVENT;
