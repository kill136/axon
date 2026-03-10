/**
 * i18next 初始化配置
 * 前端 Web UI 使用 i18next + react-i18next
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import zh from './locales/zh';

// 从 localStorage 读取用户偏好语言
function getStoredLocale(): string {
  try {
    const stored = localStorage.getItem('claude-code-language');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // SSR 或 localStorage 不可用
  }
  return 'zh';
}

i18next
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: getStoredLocale(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React 已自动转义
    },
  });

export default i18next;
