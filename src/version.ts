/**
 * 版本号统一管理
 *
 * 所有版本号相关的引用都应该从这个文件导入，避免硬编码
 * 这样可以确保版本号的一致性，方便后续维护和升级
 */

/**
 * Claude Code CLI 版本号
 * @description 当前实现版本，与官方 @anthropic-ai/claude-code 对齐
 */
export const VERSION = '2.1.37';

/**
 * 完整版本标识（带 -restored 后缀）
 * @description 用于标识这是一个还原/复刻版本
 */
export const VERSION_FULL = '2.1.37-restored';

/**
 * 版本号（不带后缀）
 * @description 用于配置文件和 API 等场景
 */
export const VERSION_BASE = '2.1.37';

/**
 * 获取版本信息
 */
export function getVersionInfo() {
  return {
    version: VERSION,
    versionFull: VERSION_FULL,
    versionBase: VERSION_BASE,
    buildDate: new Date().toISOString(),
  };
}
