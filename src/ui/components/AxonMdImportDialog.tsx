/**
 * AXON.md 导入审批对话框
 * v2.1.6 改进版
 *
 * 功能：
 * - 显示待导入的 AXON.md 文件列表
 * - 清晰的路径预览和层级显示
 * - 文件内容预览
 * - 双重确认机制（首次确认 + 详情确认）
 * - 验证和错误提示
 * - 支持批量审批或逐个审批
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../../i18n/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * AXON.md 文件来源类型
 */
export type AxonMdSource =
  | 'project'      // 项目根目录 AXON.md
  | 'project-dir'  // .axon/AXON.md
  | 'local'        // CLAUDE.local.md
  | 'user-global'  // ~/.axon/AXON.md
  | 'rules'        // .axon/rules/*.md
  | 'external';    // 外部引用的文件

/**
 * AXON.md 文件信息
 */
export interface AxonMdFile {
  /** 文件路径 */
  path: string;
  /** 文件来源 */
  source: AxonMdSource;
  /** 文件是否存在 */
  exists: boolean;
  /** 文件大小 (bytes) */
  size?: number;
  /** 文件修改时间 */
  modifiedAt?: Date;
  /** 文件内容预览 (前几行) */
  preview?: string;
  /** 是否已被信任/批准 */
  approved?: boolean;
  /** 验证错误 */
  validationError?: string;
  /** 包含的子文件 (@include 引用) */
  includes?: string[];
}

/**
 * 对话框审批结果
 */
export interface AxonMdApprovalResult {
  /** 是否批准导入 */
  approved: boolean;
  /** 批准的文件列表 */
  approvedFiles: string[];
  /** 拒绝的文件列表 */
  rejectedFiles: string[];
  /** 是否记住选择 */
  remember: boolean;
  /** 记住的作用域 */
  rememberScope?: 'session' | 'always';
}

export interface AxonMdImportDialogProps {
  /** 待审批的 AXON.md 文件列表 */
  files: AxonMdFile[];
  /** 工作目录 */
  cwd: string;
  /** 审批完成回调 */
  onComplete: (result: AxonMdApprovalResult) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 是否显示详细模式 */
  showDetails?: boolean;
  /** 自定义标题 */
  title?: string;
}

/**
 * 获取来源的显示名称和颜色
 */
function getSourceDisplay(source: AxonMdSource): { label: string; color: string } {
  const displays: Record<AxonMdSource, { label: string; color: string }> = {
    'project': { label: t('axonmd.source.project'), color: 'cyan' },
    'project-dir': { label: t('axonmd.source.projectDir'), color: 'cyan' },
    'local': { label: t('axonmd.source.local'), color: 'green' },
    'user-global': { label: t('axonmd.source.userGlobal'), color: 'blue' },
    'rules': { label: t('axonmd.source.rules'), color: 'magenta' },
    'external': { label: t('axonmd.source.external'), color: 'yellow' },
  };
  return displays[source] || { label: t('axonmd.source.unknown'), color: 'white' };
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 获取相对路径显示
 */
function getRelativePath(filePath: string, cwd: string): string {
  const homeDir = os.homedir();

  // 如果在项目目录内，显示相对路径
  if (filePath.startsWith(cwd)) {
    const rel = path.relative(cwd, filePath);
    return rel.startsWith('.') ? rel : `./${rel}`;
  }

  // 如果在 home 目录内，显示 ~/...
  if (filePath.startsWith(homeDir)) {
    return `~${filePath.slice(homeDir.length).replace(/\\/g, '/')}`;
  }

  return filePath;
}

/**
 * 文件项组件
 */
const FileItem: React.FC<{
  file: AxonMdFile;
  cwd: string;
  isSelected: boolean;
  showPreview: boolean;
}> = ({ file, cwd, isSelected, showPreview }) => {
  const sourceDisplay = getSourceDisplay(file.source);
  const relativePath = getRelativePath(file.path, cwd);

  return (
    <Box flexDirection="column" marginBottom={showPreview ? 1 : 0}>
      <Box>
        {/* 选中指示器 */}
        <Text color={isSelected ? 'cyan' : 'gray'}>
          {isSelected ? '>' : ' '}
        </Text>
        <Text> </Text>

        {/* 审批状态 */}
        {file.approved !== undefined && (
          <Text color={file.approved ? 'green' : 'red'}>
            {file.approved ? '[v]' : '[x]'}
          </Text>
        )}
        {file.approved === undefined && (
          <Text color="gray">[ ]</Text>
        )}
        <Text> </Text>

        {/* 来源标签 */}
        <Text color={sourceDisplay.color}>[{sourceDisplay.label}]</Text>
        <Text> </Text>

        {/* 文件路径 */}
        <Text color={file.exists ? 'white' : 'red'} bold={isSelected}>
          {relativePath}
        </Text>

        {/* 文件大小 */}
        {file.size !== undefined && (
          <Text color="gray" dimColor>
            {' '}({formatFileSize(file.size)})
          </Text>
        )}

        {/* 存在状态 */}
        {!file.exists && (
          <Text color="red"> [{t('axonmd.notFound')}]</Text>
        )}
      </Box>

      {/* 验证错误 */}
      {file.validationError && (
        <Box marginLeft={4}>
          <Text color="red">{t('axonmd.validationError', { error: file.validationError })}</Text>
        </Box>
      )}

      {/* 包含的文件 */}
      {file.includes && file.includes.length > 0 && isSelected && (
        <Box marginLeft={4} flexDirection="column">
          <Text color="gray" dimColor>{t('axonmd.includes')}</Text>
          {file.includes.slice(0, 3).map((inc, i) => (
            <Text key={i} color="gray" dimColor>  @{inc}</Text>
          ))}
          {file.includes.length > 3 && (
            <Text color="gray" dimColor>  {t('axonmd.andMore', { count: file.includes.length - 3 })}</Text>
          )}
        </Box>
      )}

      {/* 内容预览 */}
      {showPreview && file.preview && isSelected && (
        <Box
          marginLeft={4}
          marginTop={1}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          flexDirection="column"
        >
          <Text color="gray" dimColor>{t('axonmd.preview')}</Text>
          {file.preview.split('\n').slice(0, 5).map((line, i) => (
            <Text key={i} color="gray" dimColor>
              {line.length > 60 ? line.slice(0, 57) + '...' : line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * AXON.md 导入审批对话框组件
 */
export const AxonMdImportDialog: React.FC<AxonMdImportDialogProps> = ({
  files,
  cwd,
  onComplete,
  onCancel,
  showDetails = false,
  title,
}) => {
  // 当前选中的文件索引
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 是否处于详细模式
  const [detailMode, setDetailMode] = useState(showDetails);
  // 文件审批状态
  const [fileApprovals, setFileApprovals] = useState<Map<string, boolean>>(new Map());
  // 是否显示确认对话框
  const [showConfirmation, setShowConfirmation] = useState(false);
  // 记住选择
  const [rememberChoice, setRememberChoice] = useState(false);
  // 记住作用域
  const [rememberScope, setRememberScope] = useState<'session' | 'always'>('session');

  // 处理的文件列表（添加审批状态）
  const processedFiles = useMemo(() => {
    return files.map(file => ({
      ...file,
      approved: fileApprovals.get(file.path),
    }));
  }, [files, fileApprovals]);

  // 有效文件（存在且没有验证错误的）
  const validFiles = useMemo(() => {
    return processedFiles.filter(f => f.exists && !f.validationError);
  }, [processedFiles]);

  // 已批准的文件数量
  const approvedCount = useMemo(() => {
    return Array.from(fileApprovals.values()).filter(v => v).length;
  }, [fileApprovals]);

  // 处理键盘输入
  useInput(useCallback((input, key) => {
    if (showConfirmation) {
      // 确认对话框模式
      if (input === 'y' || input === 'Y' || key.return) {
        // 确认导入
        const approvedFiles = Array.from(fileApprovals.entries())
          .filter(([_, approved]) => approved)
          .map(([path]) => path);
        const rejectedFiles = files
          .map(f => f.path)
          .filter(p => !fileApprovals.get(p));

        onComplete({
          approved: approvedFiles.length > 0,
          approvedFiles,
          rejectedFiles,
          remember: rememberChoice,
          rememberScope: rememberChoice ? rememberScope : undefined,
        });
      } else if (input === 'n' || input === 'N' || key.escape) {
        setShowConfirmation(false);
      } else if (input === 'r' || input === 'R') {
        setRememberChoice(!rememberChoice);
      } else if (input === 's' || input === 'S') {
        setRememberScope(rememberScope === 'session' ? 'always' : 'session');
      }
      return;
    }

    // 主对话框模式
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(processedFiles.length - 1, prev + 1));
    } else if (key.return || input === ' ' || input === '\u3000') {
      // 切换当前文件的审批状态（v2.1.31: 支持全角空格，兼容日语 IME）
      const file = processedFiles[selectedIndex];
      if (file && file.exists && !file.validationError) {
        setFileApprovals(prev => {
          const next = new Map(prev);
          next.set(file.path, !prev.get(file.path));
          return next;
        });
      }
    } else if (input === 'a' || input === 'A') {
      // 批准所有有效文件
      setFileApprovals(prev => {
        const next = new Map(prev);
        validFiles.forEach(f => next.set(f.path, true));
        return next;
      });
    } else if (input === 'd' || input === 'D') {
      // 拒绝所有文件
      setFileApprovals(new Map());
    } else if (input === 'v' || input === 'V') {
      // 切换详细模式
      setDetailMode(!detailMode);
    } else if (input === 'c' || input === 'C') {
      // 进入确认对话框
      if (approvedCount > 0) {
        setShowConfirmation(true);
      }
    } else if (key.escape || input === 'q') {
      onCancel();
    }
  }, [
    showConfirmation, processedFiles, selectedIndex, validFiles,
    fileApprovals, approvedCount, rememberChoice, rememberScope,
    onComplete, onCancel, detailMode
  ]));

  // 确认对话框
  if (showConfirmation) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={2}
        paddingY={1}
      >
        <Box marginBottom={1}>
          <Text color="yellow" bold>{t('axonmd.confirmTitle')}</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text>
            {approvedCount !== 1 ? t('axonmd.confirmBodyPlural', { count: approvedCount }) : t('axonmd.confirmBody', { count: approvedCount })}
          </Text>
          <Text color="gray" dimColor>
            {t('axonmd.confirmHint')}
          </Text>
        </Box>

        {/* 已批准文件列表 */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">{t('axonmd.filesToImport')}</Text>
          {Array.from(fileApprovals.entries())
            .filter(([_, approved]) => approved)
            .slice(0, 5)
            .map(([filePath], i) => (
              <Text key={i} color="green">  + {getRelativePath(filePath, cwd)}</Text>
            ))}
          {approvedCount > 5 && (
            <Text color="gray">  {t('axonmd.andMoreFiles', { count: approvedCount - 5 })}</Text>
          )}
        </Box>

        {/* 记住选择选项 */}
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Box>
            <Text color={rememberChoice ? 'green' : 'gray'}>
              [{rememberChoice ? 'x' : ' '}]
            </Text>
            <Text> {t('axonmd.rememberChoice')} </Text>
            <Text color="gray" dimColor>(r)</Text>
          </Box>
          {rememberChoice && (
            <Box marginLeft={2}>
              <Text color="gray">{t('axonmd.scope')}</Text>
              <Text color="cyan">{rememberScope}</Text>
              <Text color="gray" dimColor> ({t('axonmd.toggleScope')})</Text>
            </Box>
          )}
        </Box>

        {/* 操作提示 */}
        <Box marginTop={1}>
          <Text color="green">[y]</Text>
          <Text> {t('axonmd.yesImport')} </Text>
          <Text color="gray">|</Text>
          <Text color="red"> [n]</Text>
          <Text> {t('axonmd.noGoBack')} </Text>
          <Text color="gray">|</Text>
          <Text color="gray"> [r] {t('axonmd.toggleRemember')} </Text>
          <Text color="gray">|</Text>
          <Text color="gray"> [s] {t('axonmd.toggleScopeLabel')}</Text>
        </Box>
      </Box>
    );
  }

  // 主对话框
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {title || t('axonmd.title')}
        </Text>
        {files.length > 0 && (
          <Text color="gray" dimColor>
            {' '}({t('axonmd.selected', { approved: approvedCount, total: validFiles.length })})
          </Text>
        )}
      </Box>

      {/* 说明文字 */}
      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          {t('axonmd.description')}
        </Text>
      </Box>

      {/* 文件列表 */}
      <Box flexDirection="column" marginBottom={1}>
        {processedFiles.length === 0 ? (
          <Text color="gray">{t('axonmd.noFiles')}</Text>
        ) : (
          processedFiles.map((file, index) => (
            <FileItem
              key={file.path}
              file={file}
              cwd={cwd}
              isSelected={index === selectedIndex}
              showPreview={detailMode}
            />
          ))
        )}
      </Box>

      {/* 分隔线 */}
      <Box marginY={1}>
        <Text color="gray">{'─'.repeat(50)}</Text>
      </Box>

      {/* 操作提示 */}
      <Box flexDirection="column">
        <Box>
          <Text color="gray">
            <Text color="cyan">space/enter</Text> {t('axonmd.toggle')}
            <Text> | </Text>
            <Text color="cyan">a</Text> {t('axonmd.approveAll')}
            <Text> | </Text>
            <Text color="cyan">d</Text> {t('axonmd.denyAll')}
            <Text> | </Text>
            <Text color="cyan">v</Text> {detailMode ? t('axonmd.hideDetails') : t('axonmd.showDetails')}
          </Text>
        </Box>
        <Box>
          <Text color="gray">
            <Text color="cyan">c</Text> {t('axonmd.confirm')}
            <Text> | </Text>
            <Text color="cyan">q/esc</Text> {t('axonmd.cancel')}
            <Text> | </Text>
            <Text color="cyan">j/k</Text> {t('axonmd.navigate')}
          </Text>
        </Box>
      </Box>

      {/* 警告提示 */}
      {processedFiles.some(f => f.source === 'external') && (
        <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow">
            {t('axonmd.externalWarning')}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * 扫描并收集 AXON.md 文件
 */
export function scanAxonMdFiles(cwd: string): AxonMdFile[] {
  const files: AxonMdFile[] = [];
  const homeDir = os.homedir();

  // 定义要扫描的文件路径和来源
  const scanPaths: Array<{ path: string; source: AxonMdSource }> = [
    // 项目级别
    { path: path.join(cwd, 'AXON.md'), source: 'project' },
    { path: path.join(cwd, '.axon', 'AXON.md'), source: 'project-dir' },
    { path: path.join(cwd, 'CLAUDE.local.md'), source: 'local' },
    // 用户级别
    { path: path.join(homeDir, '.axon', 'AXON.md'), source: 'user-global' },
  ];

  // 扫描主文件
  for (const { path: filePath, source } of scanPaths) {
    const exists = fs.existsSync(filePath);
    let fileInfo: AxonMdFile = {
      path: filePath,
      source,
      exists,
    };

    if (exists) {
      try {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');

        fileInfo = {
          ...fileInfo,
          size: stats.size,
          modifiedAt: stats.mtime,
          preview: content.slice(0, 500),
          includes: extractIncludes(content),
        };

        // 验证文件大小
        if (stats.size > 40 * 1024) {
          fileInfo.validationError = t('axonmd.fileTooLarge');
        }
      } catch (error) {
        fileInfo.validationError = t('axonmd.cannotRead', { error: String(error) });
      }
    }

    files.push(fileInfo);
  }

  // 扫描 .axon/rules/ 目录
  const rulesDir = path.join(cwd, '.axon', 'rules');
  if (fs.existsSync(rulesDir)) {
    try {
      const ruleFiles = fs.readdirSync(rulesDir)
        .filter(f => f.endsWith('.md'))
        .map(f => path.join(rulesDir, f));

      for (const rulePath of ruleFiles) {
        try {
          const stats = fs.statSync(rulePath);
          const content = fs.readFileSync(rulePath, 'utf-8');

          files.push({
            path: rulePath,
            source: 'rules',
            exists: true,
            size: stats.size,
            modifiedAt: stats.mtime,
            preview: content.slice(0, 500),
            includes: extractIncludes(content),
            validationError: stats.size > 40 * 1024 ? t('axonmd.fileTooLarge') : undefined,
          });
        } catch {
          files.push({
            path: rulePath,
            source: 'rules',
            exists: true,
            validationError: t('axonmd.cannotReadShort'),
          });
        }
      }
    } catch {
      // 忽略读取目录错误
    }
  }

  return files.filter(f => f.exists);
}

/**
 * 从内容中提取 @include 引用
 */
function extractIncludes(content: string): string[] {
  const includes: string[] = [];
  const regex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/gm;
  let match;

  while ((match = regex.exec(content)) !== null) {
    let includePath = match[1];
    if (includePath) {
      includePath = includePath.replace(/\\ /g, ' ');
      if (includePath.startsWith('./') || includePath.startsWith('~/') || includePath.startsWith('/')) {
        includes.push(includePath);
      }
    }
  }

  return includes;
}

export default AxonMdImportDialog;
