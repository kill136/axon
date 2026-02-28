/**
 * AXON.md 导入审批状态管理钩子
 * v2.1.6 新增
 *
 * 功能：
 * - 管理 AXON.md 文件的导入审批状态
 * - 持久化用户的审批选择
 * - 支持会话级别和永久级别的记忆
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanAxonMdFiles, type AxonMdFile, type AxonMdApprovalResult } from '../components/AxonMdImportDialog.js';

/**
 * 已审批的文件记录
 */
interface ApprovedFileRecord {
  /** 文件路径 */
  path: string;
  /** 文件内容哈希 (用于检测变更) */
  contentHash: string;
  /** 审批时间 */
  approvedAt: string;
  /** 审批作用域 */
  scope: 'session' | 'always';
}

/**
 * 审批状态存储
 */
interface ApprovalStore {
  /** 已审批的文件列表 */
  approvedFiles: ApprovedFileRecord[];
  /** 全局拒绝的目录列表 */
  rejectedDirectories: string[];
  /** 上次更新时间 */
  lastUpdated: string;
}

/**
 * 计算简单的内容哈希
 */
function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * 获取审批存储文件路径
 */
function getApprovalStorePath(): string {
  return path.join(os.homedir(), '.axon', 'claude-md-approvals.json');
}

/**
 * 加载审批存储
 */
function loadApprovalStore(): ApprovalStore {
  const storePath = getApprovalStorePath();

  try {
    if (fs.existsSync(storePath)) {
      const content = fs.readFileSync(storePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // 忽略加载错误
  }

  return {
    approvedFiles: [],
    rejectedDirectories: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * 保存审批存储
 */
function saveApprovalStore(store: ApprovalStore): void {
  const storePath = getApprovalStorePath();
  const storeDir = path.dirname(storePath);

  try {
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    store.lastUpdated = new Date().toISOString();
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  } catch (error) {
    console.warn('[AxonMd] Failed to save approval store:', error);
  }
}

/**
 * AXON.md 导入状态
 */
export interface AxonMdImportState {
  /** 待审批的文件列表 */
  pendingFiles: AxonMdFile[];
  /** 已审批的文件列表 */
  approvedFiles: AxonMdFile[];
  /** 是否需要显示审批对话框 */
  needsApproval: boolean;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * AXON.md 导入审批钩子
 */
export function useAxonMdImport(cwd: string) {
  // 状态
  const [state, setState] = useState<AxonMdImportState>({
    pendingFiles: [],
    approvedFiles: [],
    needsApproval: false,
    loading: true,
  });

  // 会话级别的审批记录
  const [sessionApprovals, setSessionApprovals] = useState<Set<string>>(new Set());

  // 持久化的审批存储
  const [persistentStore, setPersistentStore] = useState<ApprovalStore>(() => loadApprovalStore());

  /**
   * 检查文件是否已被审批
   */
  const isFileApproved = useCallback((file: AxonMdFile): boolean => {
    // 检查会话级别审批
    if (sessionApprovals.has(file.path)) {
      return true;
    }

    // 检查持久化审批
    const approvedRecord = persistentStore.approvedFiles.find(r => r.path === file.path);
    if (approvedRecord) {
      // 检查文件是否有变更
      if (file.preview) {
        const currentHash = simpleHash(file.preview);
        if (approvedRecord.contentHash === currentHash) {
          return true;
        }
        // 文件内容已变更，需要重新审批
        return false;
      }
      return true;
    }

    // 检查目录是否被全局拒绝
    if (persistentStore.rejectedDirectories.some(dir => file.path.startsWith(dir))) {
      return false;
    }

    return false;
  }, [sessionApprovals, persistentStore]);

  /**
   * 扫描并更新文件状态
   */
  const scanFiles = useCallback(() => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const allFiles = scanAxonMdFiles(cwd);
      const pending: AxonMdFile[] = [];
      const approved: AxonMdFile[] = [];

      for (const file of allFiles) {
        if (isFileApproved(file)) {
          approved.push({ ...file, approved: true });
        } else {
          pending.push({ ...file, approved: false });
        }
      }

      setState({
        pendingFiles: pending,
        approvedFiles: approved,
        needsApproval: pending.length > 0,
        loading: false,
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: `Failed to scan AXON.md files: ${error}`,
      }));
    }
  }, [cwd, isFileApproved]);

  /**
   * 处理审批结果
   */
  const handleApprovalResult = useCallback((result: AxonMdApprovalResult) => {
    // 更新会话级别审批
    const newSessionApprovals = new Set(sessionApprovals);
    for (const filePath of result.approvedFiles) {
      newSessionApprovals.add(filePath);
    }
    setSessionApprovals(newSessionApprovals);

    // 如果选择记住，更新持久化存储
    if (result.remember && result.rememberScope === 'always') {
      const newStore = { ...persistentStore };

      for (const filePath of result.approvedFiles) {
        const file = state.pendingFiles.find(f => f.path === filePath);
        if (file) {
          // 移除旧记录
          newStore.approvedFiles = newStore.approvedFiles.filter(r => r.path !== filePath);
          // 添加新记录
          newStore.approvedFiles.push({
            path: filePath,
            contentHash: file.preview ? simpleHash(file.preview) : '',
            approvedAt: new Date().toISOString(),
            scope: 'always',
          });
        }
      }

      setPersistentStore(newStore);
      saveApprovalStore(newStore);
    }

    // 重新扫描文件状态
    scanFiles();
  }, [sessionApprovals, persistentStore, state.pendingFiles, scanFiles]);

  /**
   * 重置所有审批
   */
  const resetApprovals = useCallback(() => {
    setSessionApprovals(new Set());
    const newStore: ApprovalStore = {
      approvedFiles: [],
      rejectedDirectories: [],
      lastUpdated: new Date().toISOString(),
    };
    setPersistentStore(newStore);
    saveApprovalStore(newStore);
    scanFiles();
  }, [scanFiles]);

  /**
   * 跳过审批（信任所有文件）
   */
  const skipApproval = useCallback(() => {
    const allPaths = state.pendingFiles.map(f => f.path);
    const newSessionApprovals = new Set([...sessionApprovals, ...allPaths]);
    setSessionApprovals(newSessionApprovals);
    scanFiles();
  }, [state.pendingFiles, sessionApprovals, scanFiles]);

  // 初始扫描
  useEffect(() => {
    scanFiles();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  // 计算汇总信息
  const summary = useMemo(() => ({
    totalFiles: state.pendingFiles.length + state.approvedFiles.length,
    pendingCount: state.pendingFiles.length,
    approvedCount: state.approvedFiles.length,
    hasExternalFiles: state.pendingFiles.some(f => f.source === 'external'),
  }), [state]);

  return {
    ...state,
    summary,
    scanFiles,
    handleApprovalResult,
    resetApprovals,
    skipApproval,
    isFileApproved,
  };
}

/**
 * 获取所有已审批的 AXON.md 文件内容
 */
export function getApprovedAxonMdContent(cwd: string): string[] {
  const store = loadApprovalStore();
  const contents: string[] = [];

  // 扫描所有文件
  const allFiles = scanAxonMdFiles(cwd);

  for (const file of allFiles) {
    // 检查是否在审批列表中
    const isApproved = store.approvedFiles.some(r => r.path === file.path);

    // 对于本地文件和项目文件，默认信任
    const isTrustedSource = file.source === 'project' || file.source === 'project-dir' || file.source === 'local';

    if ((isApproved || isTrustedSource) && file.exists) {
      try {
        const content = fs.readFileSync(file.path, 'utf-8');
        contents.push(content);
      } catch {
        // 忽略读取错误
      }
    }
  }

  return contents;
}

export default useAxonMdImport;
