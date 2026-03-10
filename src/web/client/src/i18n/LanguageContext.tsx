/**
 * 前端 i18n Language Context
 * 基于 i18next + react-i18next，保持 useLanguage() API 向后兼容
 */

import React, { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './init';

export type Locale = 'en' | 'zh';

export function getInitialLocale(): Locale {
  return (i18n.language || 'zh') as Locale;
}

/**
 * LanguageProvider - 兼容层
 * react-i18next 的 I18nextProvider 已在 init.ts 中通过 .use(initReactI18next) 注入，
 * 所以这里只是透传 children
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * useLanguage - 保持与旧 API 完全兼容
 * 返回 { locale, setLocale, t }
 */
export function useLanguage() {
  const { t: i18nT, i18n: i18nInstance } = useTranslation();

  return {
    locale: i18nInstance.language as Locale,
    setLocale: (locale: Locale) => {
      i18nInstance.changeLanguage(locale);
      localStorage.setItem('claude-code-language', locale);
    },
    t: (key: string, params?: Record<string, string | number>): string => {
      if (params) {
        return i18nT(key, params as Record<string, unknown>);
      }
      return i18nT(key);
    },
  };
}

/**
 * 独立翻译函数（不依赖 React Context）
 * 用于 Class 组件或 Context 外部场景
 */
export function getTranslation(key: string, params?: Record<string, string | number>): string {
  if (params) {
    return i18n.t(key, params as Record<string, unknown>);
  }
  return i18n.t(key);
}
