/**
 * LSP 模块导出
 *
 * 功能特性：
 * - 支持 .lsp.json 配置文件
 * - 支持自动检测和安装 LSP 服务器
 * - 支持环境变量展开 (${VAR_NAME})
 * - 支持 ContentModified 错误自动重试
 * - 支持服务器崩溃自动重启
 */

export {
  // 核心类
  LSPServer,
  LSPServerManager,

  // 配置
  defaultLSPConfigs,

  // 初始化函数
  initializeLSPManager,
  getLSPManager,

  // LSP 服务器安装管理
  checkLSPServerInstalled,
  installLSPServer,
  getKnownLSPServers,
  getLSPServerStatus,
} from './manager.js';

export type {
  LSPServerConfig,
  LSPServerState,
  LSPDiagnostic,
  InitializeLSPOptions,
} from './manager.js';
