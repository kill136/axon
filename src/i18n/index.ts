/**
 * i18n 国际化模块
 * 基于 i18next，支持中英文切换
 */

import i18next from 'i18next';
import en from './locales/en.js';
import zh from './locales/zh.js';
import type { LocaleKeys } from './locales/en.js';

export type { LocaleKeys };

/**
 * 从 language 配置值解析 locale 代码
 * settings.json 的 language 字段可能是 "chinese"、"zh"、"中文" 等
 */
function resolveLocale(language?: string): string {
  if (!language) return 'en';
  const lower = language.toLowerCase().trim();
  if (lower === 'zh' || lower === 'chinese' || lower === '中文' || lower.startsWith('zh-')) {
    return 'zh';
  }
  return 'en';
}

/**
 * 从系统环境检测语言
 */
function detectSystemLocale(): string {
  const envLang = process.env.CLAUDE_CODE_LANG
    || process.env.LC_ALL
    || process.env.LC_MESSAGES
    || process.env.LANG
    || '';
  if (envLang.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

/**
 * 初始化 i18n
 * 优先级：language 参数 > 默认 en
 * 只有用户在 settings.json 中显式配置了 language 才会切换语言
 */
export async function initI18n(language?: string): Promise<void> {
  const locale = language ? resolveLocale(language) : 'en';

  await i18next.init({
    lng: locale,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // CLI 不需要 HTML 转义
    },
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
  });
}

/**
 * 翻译函数
 * 用法：t('header.connected') 或 t('header.welcomeBack', { username: 'Alice' })
 */
export function t(key: LocaleKeys, params?: Record<string, string | number>): string {
  // i18next 未初始化时 fallback 到英文原文
  if (!i18next.isInitialized) {
    const template = en[key] ?? key;
    if (!params) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? `{{${name}}}`));
  }
  return i18next.t(key, params as Record<string, unknown>);
}

/**
 * 获取当前语言
 */
export function getCurrentLocale(): string {
  return i18next.language || 'en';
}

/**
 * 切换语言
 */
export async function changeLocale(language: string): Promise<void> {
  const locale = resolveLocale(language);
  await i18next.changeLanguage(locale);
}
