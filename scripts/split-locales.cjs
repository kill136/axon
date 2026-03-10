/**
 * 拆分 locales.ts 到模块化翻译文件
 * 运行: node scripts/split-locales.js
 */
const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('src/web/client/src/i18n/locales.ts', 'utf-8');

// 定义分组映射：哪些 key 前缀归到哪个模块文件
const groupMap = {
  // common.ts - 通用文本
  common: ['common', 'error', 'app', 'placeholder', 'context', 'time', 'checkmark', 'breathingLight', 'splitPanes', 'thinking', 'compact'],
  // settings.ts - 设置页面
  settings: ['settings', 'apiConfig', 'embedding', 'permissions', 'modePresets', 'hooks', 'system', 'importExport', 'plugins', 'mcp', 'proxy', 'perception'],
  // auth.ts - 认证
  auth: ['auth', 'axonCloud', 'permission'],
  // chat.ts - 对话相关
  chat: ['message', 'question', 'input', 'welcome', 'setupWizard', 'session', 'sessionSearch', 'rewind', 'slashCommand', 'snippets', 'sidebar', 'artifacts'],
  // git.ts - Git 面板
  git: ['git'],
  // code.ts - 代码浏览器
  code: ['codeEditor', 'codeView', 'semanticMap', 'searchPanel', 'compactChat', 'fileTree', 'bdc', 'codeBrowser'],
  // swarm.ts - 蜂群/蓝图/多智能体
  swarm: ['swarm', 'agentChat', 'agentExplorer', 'archGraph', 'blueprint', 'impact', 'swarmConsole'],
  // nav.ts - 导航和 UI
  nav: ['nav', 'customize', 'debug', 'terminal', 'logs'],
  // cli.ts - CLI 相关
  cli: ['cli', 'schedule'],
};

// 解析 en 和 zh 翻译对象
function parseSection(content, startMarker) {
  const start = content.indexOf(startMarker);
  if (start === -1) return {};

  // 找到这个对象的结束位置（匹配 }; ）
  let braceCount = 0;
  let i = content.indexOf('{', start);
  const objStart = i;
  for (; i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) break;
    }
  }
  const objContent = content.substring(objStart + 1, i);

  // 逐行解析 key-value
  const result = {};
  const lines = objContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // 匹配 'key': 'value', 或 'key': "value",
    const m = trimmed.match(/^'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/);
    if (m) {
      result[m[1]] = m[2];
      continue;
    }
    // 也匹配 "key": "value"
    const m2 = trimmed.match(/^'([^']+)':\s*"((?:[^"\\]|\\.)*)",?\s*$/);
    if (m2) {
      result[m2[1]] = m2[2];
    }
  }
  return result;
}

const en = parseSection(content, 'const en: Translations = {');
const zh = parseSection(content, 'const zh: Translations = {');

console.log('Parsed en keys:', Object.keys(en).length);
console.log('Parsed zh keys:', Object.keys(zh).length);

// 反向映射：prefix -> group
const prefixToGroup = {};
for (const [group, prefixes] of Object.entries(groupMap)) {
  for (const prefix of prefixes) {
    prefixToGroup[prefix] = group;
  }
}

// 按 group 分组
function groupKeys(translations) {
  const groups = {};
  const ungrouped = {};

  for (const [key, value] of Object.entries(translations)) {
    const prefix = key.split('.')[0];
    const group = prefixToGroup[prefix];
    if (group) {
      if (!groups[group]) groups[group] = {};
      groups[group][key] = value;
    } else {
      ungrouped[key] = value;
      console.warn('Ungrouped key:', key);
    }
  }

  return { groups, ungrouped };
}

const enGrouped = groupKeys(en);
const zhGrouped = groupKeys(zh);

// 生成文件内容
function generateFileContent(keys, lang, groupName, isEn) {
  const lines = [];
  if (isEn) {
    lines.push(`const ${groupName} = {`);
  } else {
    lines.push(`const ${groupName} = {`);
  }

  // 按 key 排序
  const sortedKeys = Object.keys(keys).sort();
  for (const key of sortedKeys) {
    const value = keys[key];
    // 如果值包含未转义的单引号，使用双引号包裹
    if (value.includes("'") && !value.includes("\\'")) {
      // 值中有裸单引号，用双引号包裹（确保值中没有双引号，否则转义）
      const escaped = value.replace(/"/g, '\\"');
      lines.push(`  '${key}': "${escaped}",`);
    } else {
      lines.push(`  '${key}': '${value}',`);
    }
  }

  lines.push('} as const;');
  lines.push('');
  if (isEn) {
    lines.push(`export type ${capitalize(groupName)}Keys = keyof typeof ${groupName};`);
  }
  lines.push(`export default ${groupName};`);
  lines.push('');

  return lines.join('\n');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// 写入文件
const enDir = 'src/web/client/src/i18n/locales/en';
const zhDir = 'src/web/client/src/i18n/locales/zh';

const allGroups = new Set([...Object.keys(enGrouped.groups), ...Object.keys(zhGrouped.groups)]);

for (const group of allGroups) {
  const enKeys = enGrouped.groups[group] || {};
  const zhKeys = zhGrouped.groups[group] || {};

  // 写 en 文件
  const enContent = generateFileContent(enKeys, 'en', group, true);
  fs.writeFileSync(path.join(enDir, `${group}.ts`), enContent);
  console.log(`Written: en/${group}.ts (${Object.keys(enKeys).length} keys)`);

  // 写 zh 文件
  const zhContent = generateFileContent(zhKeys, 'zh', group, false);
  fs.writeFileSync(path.join(zhDir, `${group}.ts`), zhContent);
  console.log(`Written: zh/${group}.ts (${Object.keys(zhKeys).length} keys)`);
}

// 生成 en/index.ts 聚合导出
const enIndexLines = [];
const importLines = [];
const spreadParts = [];
const typeUnionParts = [];

for (const group of [...allGroups].sort()) {
  importLines.push(`import ${group}, { type ${capitalize(group)}Keys } from './${group}';`);
  spreadParts.push(`  ...${group},`);
  typeUnionParts.push(`${capitalize(group)}Keys`);
}

enIndexLines.push(importLines.join('\n'));
enIndexLines.push('');
enIndexLines.push('const en = {');
enIndexLines.push(spreadParts.join('\n'));
enIndexLines.push('} as const;');
enIndexLines.push('');
enIndexLines.push(`export type WebLocaleKeys = ${typeUnionParts.join(' | ')};`);
enIndexLines.push('export default en;');
enIndexLines.push('');

fs.writeFileSync(path.join(enDir, 'index.ts'), enIndexLines.join('\n'));
console.log('Written: en/index.ts');

// 生成 zh/index.ts 聚合导出
const zhIndexLines = [];
const zhImportLines = [];
const zhSpreadParts = [];

zhIndexLines.push("import type { WebLocaleKeys } from '../en';");
zhIndexLines.push('');

for (const group of [...allGroups].sort()) {
  zhImportLines.push(`import ${group} from './${group}';`);
  zhSpreadParts.push(`  ...${group},`);
}

zhIndexLines.push(zhImportLines.join('\n'));
zhIndexLines.push('');
zhIndexLines.push('const zh: Record<WebLocaleKeys, string> = {');
zhIndexLines.push(zhSpreadParts.join('\n'));
zhIndexLines.push('};');
zhIndexLines.push('');
zhIndexLines.push('export default zh;');
zhIndexLines.push('');

fs.writeFileSync(path.join(zhDir, 'index.ts'), zhIndexLines.join('\n'));
console.log('Written: zh/index.ts');

// 统计
console.log('\n=== Summary ===');
console.log('Total groups:', allGroups.size);
console.log('Total en keys parsed:', Object.keys(en).length);
console.log('Total zh keys parsed:', Object.keys(zh).length);
if (Object.keys(enGrouped.ungrouped).length > 0) {
  console.log('Ungrouped en keys:', Object.keys(enGrouped.ungrouped));
}
if (Object.keys(zhGrouped.ungrouped).length > 0) {
  console.log('Ungrouped zh keys:', Object.keys(zhGrouped.ungrouped));
}
