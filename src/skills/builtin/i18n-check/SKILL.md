---
name: i18n-check
description: 检查 Axon Web UI 前端国际化（i18n）完整性。扫描所有组件文件，检查硬编码中文、缺失翻译 key、en/zh key 不同步、t() 调用错误等问题。Use this skill whenever the user mentions 多语言问题、翻译漏了、i18n、国际化检查、hardcoded Chinese、translation missing，even if they just say "翻译有问题" or "中英文混了"。
---

# 前端国际化完整性检查

## 项目 i18n 架构
- **框架**: i18next + react-i18next
- **翻译文件位置**: `src/web/client/src/i18n/locales/{en,zh}/*.ts`
- **分组**: chat, code, common, customize, nav, notebook, settings, swarm, system, welcome
- **入口**: `src/web/client/src/i18n/index.ts`
- **Hook**: `useLanguage()` → 返回 `{ t, locale, setLocale }`

## 检查项

### 1. 硬编码中文扫描
在 `src/web/client/src/` 下的 `.tsx` 和 `.ts` 文件中搜索中文字符：
```
Grep pattern: [\u4e00-\u9fff]{2,}
Exclude: i18n/locales/, *.test.*, node_modules
```
每个匹配需要判断：
- 是否在 JSX 返回值中（需要翻译）
- 是否在注释/console.log 中（不需要翻译）
- 是否是语言选择器显示名（如 "中文" 不应翻译，这是国际化标准）

### 2. en/zh Key 同步检查
读取 en/ 和 zh/ 下的每组翻译文件，对比 key 列表：
- en 有但 zh 没有 → 中文翻译缺失
- zh 有但 en 没有 → 多余的中文 key（可能是旧的）

### 3. t() 调用有效性
搜索所有 `t('` 调用，提取 key，检查是否在翻译文件中存在：
```
Grep pattern: t\(['"]([^'"]+)['"]\)
```

### 4. 常见反模式
- `t('nav.chat') === '聊天'` 来检测语言 → 应改用 `locale` 变量
- 组件外的常量直接用翻译值 → 应改用 `labelKey` 模式
- `getTranslation(getInitialLocale())` 把 locale 当 key → bug
- 模板字面量中的 `${t(...)}` → 注意在脚本处理时不被求值

## 输出格式
按组件文件组织报告：
```
## ComponentName.tsx
- [硬编码] 第 42 行: "保存成功"
- [缺失key] 第 88 行: t('settings.unknown_key')
```

## 已知例外（不需要修复）
- `BlueprintDetailContent.tsx` 中的代码分析动态模板（~17处）
- 测试文件中的中文（不影响 UI）
- 语言选择器的 "中文"/"English" 显示名
