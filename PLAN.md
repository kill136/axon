# 前端多语言迁移计划：引入 i18next + react-i18next

## 问题诊断

### 现状
前端 (`src/web/client/src/i18n/`) 使用自定义的 `LanguageContext + useLanguage + locales.ts` 方案，后端 (`src/i18n/`) 已经用了 i18next + 类型安全的 `LocaleKeys`。

### 根因
1. **660+ 处硬编码中文字符串**散落在 23 个组件中（虽然组件导入了 `useLanguage`，但没有对所有 UI 文本调用 `t()`）
2. **15 个组件完全没接入多语言**
3. **locales.ts 中英文 key 不同步**：zh 缺 22 个 key，en 缺 5 个 key
4. **无编译期检查**：`Translations` 类型是 `[key: string]: string`，任何 key 都合法
5. **单文件 3780 行**翻译表，难以维护

## 方案设计

### 核心改造：用 i18next 替换自定义实现

**保持 API 兼容**：组件端继续用 `const { t } = useLanguage()`，只是底层换成 i18next。

### 改动范围

#### Phase 1：基础设施（i18n 核心）

**1.1 安装 react-i18next**
```bash
npm install react-i18next
```

**1.2 拆分翻译文件**

把 `locales.ts`（3780 行）拆成模块化的 namespace 文件：

```
src/web/client/src/i18n/
├── index.ts              # 导出接口（保持兼容）
├── init.ts               # i18next 初始化配置
├── LanguageContext.tsx    # 改为薄包装层，底层用 react-i18next
└── locales/
    ├── en/
    │   ├── index.ts       # 聚合导出
    │   ├── common.ts      # 通用文本（按钮、状态等）
    │   ├── settings.ts    # 设置页
    │   ├── git.ts         # Git 面板
    │   ├── code.ts        # 代码浏览器
    │   ├── swarm.ts       # 蜂群/蓝图
    │   ├── terminal.ts    # 终端
    │   └── ...            # 按模块继续拆
    └── zh/
        ├── index.ts
        ├── common.ts
        ├── settings.ts
        └── ...            # 结构与 en/ 完全一致
```

**1.3 类型安全**

沿用后端已验证的模式：
```typescript
// locales/en/index.ts
const en = { ... } as const;
export type WebLocaleKeys = keyof typeof en;
export default en;

// locales/zh/index.ts
import type { WebLocaleKeys } from '../en';
const zh: Record<WebLocaleKeys, string> = { ... };
```

这样 `t('不存在的key')` 会在编译期报错。

**1.4 i18next 初始化**

```typescript
// init.ts
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import zh from './locales/zh';

i18next
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: localStorage.getItem('claude-code-language') || 'zh',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18next;
```

**1.5 LanguageContext.tsx 改造**

改为 i18next 的薄包装，保持 `useLanguage()` API 不变：

```typescript
import { useTranslation } from 'react-i18next';
import i18next from './init';
import type { WebLocaleKeys } from './locales/en';

export type Locale = 'en' | 'zh';

export function useLanguage() {
  const { t, i18n } = useTranslation();
  return {
    locale: i18n.language as Locale,
    setLocale: (locale: Locale) => {
      i18n.changeLanguage(locale);
      localStorage.setItem('claude-code-language', locale);
    },
    t: t as (key: WebLocaleKeys, params?: Record<string, string | number>) => string,
  };
}

// 非 Hook 场景
export function getTranslation(key: WebLocaleKeys, params?: Record<string, string | number>): string {
  return i18next.t(key, params as any);
}

export function getInitialLocale(): Locale {
  return (i18next.language || 'zh') as Locale;
}

// LanguageProvider 简化为空壳（react-i18next 自带 Provider）
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

#### Phase 2：补全翻译 & 消除硬编码

**2.1 同步 en/zh key**

- 补齐 zh 缺失的 22 个 key（archGraph.*, agentExplorer.*）
- 补齐 en 缺失的 5 个 key（codeEditor.*）

**2.2 消除 23 个组件中的 660+ 处硬编码中文**

按优先级排序（用户最常见的组件优先）：

| 优先级 | 组件 | 硬编码数 | 说明 |
|--------|------|---------|------|
| P0 | BlueprintDetailContent.tsx | 480+ | 代码浏览器主组件 |
| P0 | Message.tsx | 26 | 对话消息，核心组件 |
| P0 | TerminalPanel.tsx | 20 | 终端面板 |
| P1 | StatusView.tsx | 22 | Git 状态 |
| P1 | ArchitectureFlowGraph.tsx | 28 | 架构图 |
| P1 | BranchesView.tsx | 17 | Git 分支 |
| P1 | CallGraphViz*.tsx | 22 | 调用图 |
| P1 | LogsView.tsx | 10 | 日志 |
| P2 | 其余 15 个 | ~55 | 低频组件 |

**2.3 接入 15 个未接入的组件**

大部分是小组件（CliSpinner, FadeIn, ProgressBar 等），中文主要在注释中，实际 UI 文本很少。按需接入。

#### Phase 3：防止再犯（CI/编译检查）

**3.1 ESLint 规则**（可选但推荐）

添加自定义 ESLint 规则或使用 `eslint-plugin-i18next`，检测 JSX 中的裸中文字符串。

**3.2 类型检查自动防护**

Phase 1 的 `WebLocaleKeys` 类型已经解决了"引用不存在的 key"问题。

## 执行顺序

1. **Phase 1**：改 i18n 核心（~5 个文件），安装 react-i18next，拆分 locales
2. **Phase 2**：逐组件消除硬编码，添加翻译 key
3. **Phase 3**：加 ESLint 检查（可选）

## 风险评估

- **API 兼容性**：`useLanguage()` 接口完全保持不变，组件无感知
- **react-i18next 与现有 React 18 兼容**：完全兼容
- **i18next 已在 package.json 中**：无需新增核心依赖
- **翻译文件拆分**：纯重构，不影响运行时行为
- **最大风险**：Phase 2 的 660+ 处硬编码替换量大，需逐文件仔细处理

## 不做的事

- 不引入懒加载翻译（项目体量不需要）
- 不引入翻译管理平台（开源项目，手动维护即可）
- 不改后端 i18n（已经是 i18next，无需动）
- 不改 CLI UI 的 i18n（Ink 组件体系独立）
