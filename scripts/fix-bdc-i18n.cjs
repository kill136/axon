/**
 * 批量修复 BlueprintDetailContent.tsx 中的硬编码中文
 * 同时更新 en/code.ts 和 zh/code.ts 翻译文件
 */
const fs = require('fs');

const bdcFile = 'src/web/client/src/components/swarm/BlueprintDetailPanel/BlueprintDetailContent.tsx';
const enFile = 'src/web/client/src/i18n/locales/en/code.ts';
const zhFile = 'src/web/client/src/i18n/locales/zh/code.ts';

let content = fs.readFileSync(bdcFile, 'utf-8');

// 定义替换映射：[原文, 替换后, en翻译, zh翻译]
const replacements = [
  // ===== 状态文本映射 =====
  [
    `const statusTexts: Record<string, string> = {\n    draft: '草稿', review: '审核中', approved: '已批准',\n    executing: '执行中', completed: '已完成', paused: '已暂停', modified: '已修改',\n    rejected: '已拒绝', failed: '失败',\n  };`,
    `const statusTexts: Record<string, string> = {\n    draft: t('bdc.status.draft'), review: t('bdc.status.review'), approved: t('bdc.status.approved'),\n    executing: t('bdc.status.executing'), completed: t('bdc.status.completed'), paused: t('bdc.status.paused'), modified: t('bdc.status.modified'),\n    rejected: t('bdc.status.rejected'), failed: t('bdc.status.failed'),\n  };`
  ],
  // ===== 错误消息 =====
  [`'AI 生成架构图失败'`, `t('bdc.archGenFailed')`],
  [`'批准蓝图失败'`, `t('bdc.approveFailed')`],
  [`'拒绝蓝图失败'`, `t('bdc.rejectFailed')`],
  [`'执行蓝图失败'`, `t('bdc.executeFailed')`],
  [`'暂停执行失败'`, `t('bdc.pauseFailed')`],
  [`'恢复执行失败'`, `t('bdc.resumeFailed')`],
  [`'完成执行失败'`, `t('bdc.completeFailed')`],
  [`'删除蓝图失败'`, `t('bdc.deleteFailed')`],
  [`'请输入拒绝原因:'`, `t('bdc.rejectReasonPrompt')`],

  // ===== 按钮标签 =====
  [`label: '删除',`, `label: t('bdc.actionDelete'),`],
  [`label: '批准',`, `label: t('bdc.actionApprove'),`],
  [`label: '拒绝',`, `label: t('bdc.actionReject'),`],
  [`label: '开始执行',`, `label: t('bdc.actionStartExecution'),`],
  [`label: '暂停',`, `label: t('bdc.actionPause'),`],
  [`label: '完成',`, `label: t('bdc.actionComplete'),`],
  [`label: '恢复',`, `label: t('bdc.actionResume'),`],

  // ===== UI 文本 =====
  [`'📖 关闭详情'`, `t('bdc.closeSyntaxDetail')`],
  [`'📖 语法详情'`, `t('bdc.openSyntaxDetail')`],
  [`'🗺️ 关闭地图'`, `t('bdc.closeMap')`],
  [`'🗺️ 小地图'`, `t('bdc.openMap')`],
  [`'📖 只读'`, `t('bdc.readonlyMode')`],
  [`'✏️ 编辑'`, `t('bdc.editMode')`],
  [`'保存中...'`, `t('bdc.saving')`],
  [`'💾 保存'`, `t('bdc.save')`],
  [`'思考中...'`, `t('bdc.aiThinking')`],
  [`'提问'`, `t('bdc.askButton')`],
  [`'这段代码有什么作用？'`, `t('bdc.askSample1')`],
  [`'怎么优化这段代码？'`, `t('bdc.askSample2')`],
  [`'这段代码有什么问题？'`, `t('bdc.askSample3')`],
  [`'保存文件'`, `t('bdc.saveFileTitle')`],
  [`'跳转到定义'`, `t('bdc.goToDefinitionTitle')`],
  [`'🤖 问 AI 关于这段代码'`, `t('bdc.askAIAboutCode')`],
  [`'📖 新手模式'`, `t('bdc.beginnerMode')`],
  [`'💡 专家模式'`, `t('bdc.expertMode')`],
  [`'未选择'`, `t('bdc.notSelected')`],

  // ===== 代码符号类型 =====
  [`'🏛️ 类'`, `t('bdc.symbolClass')`],
  [`'🔧 函数'`, `t('bdc.symbolFunction')`],
  [`'📦 代码块'`, `t('bdc.symbolBlock')`],
  [`'📄 文件'`, `t('bdc.symbolFile')`],

  // ===== 大纲类型标签 =====
  [`'类定义 - 封装数据和行为的蓝图'`, `t('bdc.outline.class')`],
  [`'接口 - 定义对象的形状和契约'`, `t('bdc.outline.interface')`],
  [`'类型别名 - 为类型定义一个新名称'`, `t('bdc.outline.typeAlias')`],
  [`'函数 - 可重用的代码块'`, `t('bdc.outline.function')`],
  [`'方法 - 类中的函数成员'`, `t('bdc.outline.method')`],
  [`'属性 - 类中的数据成员'`, `t('bdc.outline.property')`],
  [`'常量 - 不可变的值'`, `t('bdc.outline.constant')`],
  [`'变量 - 可变的值'`, `t('bdc.outline.variable')`],

  // ===== 编辑器标签 =====
  [`'代码编辑'`, `t('bdc.codeEditTab')`],
  [`'分析'`, `t('bdc.analysisTab')`],

  // ===== 类型标签映射 =====
  [`'类'`, `t('bdc.kindClass')`, true],  // 只替换独立出现的
  [`'接口'`, `t('bdc.kindInterface')`, true],
  [`'类型'`, `t('bdc.kindType')`, true],
  [`'方法'`, `t('bdc.kindMethod')`, true],
  [`'常量'`, `t('bdc.kindConstant')`, true],
  [`'变量'`, `t('bdc.kindVariable')`, true],
  [`'简单'`, `t('bdc.complexitySimple')`],
  [`'中等'`, `t('bdc.complexityMedium')`],
  [`'复杂'`, `t('bdc.complexityComplex')`],

  // ===== 目录/文件标签 =====
  [`'目录'`, `t('bdc.directory')`, true],

  // ===== 缓存提示 =====
  [`' · ⚡缓存'`, `' · ⚡' + t('bdc.cached')`],
  [`' · 分析中...'`, `' · ' + t('bdc.analyzing')`],

  // ===== AI 错误信息 （模板字符串不好替换，先手动标记）=====
];

// 需要添加到翻译文件的新 key
const newKeys = {
  // 状态
  'bdc.status.draft': ['Draft', '草稿'],
  'bdc.status.review': ['In Review', '审核中'],
  'bdc.status.approved': ['Approved', '已批准'],
  'bdc.status.executing': ['Executing', '执行中'],
  'bdc.status.completed': ['Completed', '已完成'],
  'bdc.status.paused': ['Paused', '已暂停'],
  'bdc.status.modified': ['Modified', '已修改'],
  'bdc.status.rejected': ['Rejected', '已拒绝'],
  'bdc.status.failed': ['Failed', '失败'],
  // 错误
  'bdc.archGenFailed': ['AI architecture diagram generation failed', 'AI 生成架构图失败'],
  'bdc.approveFailed': ['Failed to approve blueprint', '批准蓝图失败'],
  'bdc.rejectFailed': ['Failed to reject blueprint', '拒绝蓝图失败'],
  'bdc.executeFailed': ['Failed to execute blueprint', '执行蓝图失败'],
  'bdc.pauseFailed': ['Failed to pause execution', '暂停执行失败'],
  'bdc.resumeFailed': ['Failed to resume execution', '恢复执行失败'],
  'bdc.completeFailed': ['Failed to complete execution', '完成执行失败'],
  'bdc.deleteFailed': ['Failed to delete blueprint', '删除蓝图失败'],
  'bdc.rejectReasonPrompt': ['Enter rejection reason:', '请输入拒绝原因:'],
  // 按钮
  'bdc.actionDelete': ['Delete', '删除'],
  'bdc.actionApprove': ['Approve', '批准'],
  'bdc.actionReject': ['Reject', '拒绝'],
  'bdc.actionStartExecution': ['Start Execution', '开始执行'],
  'bdc.actionPause': ['Pause', '暂停'],
  'bdc.actionComplete': ['Complete', '完成'],
  'bdc.actionResume': ['Resume', '恢复'],
  // UI
  'bdc.closeSyntaxDetail': ['Close Syntax Detail', '📖 关闭详情'],
  'bdc.openSyntaxDetail': ['Syntax Detail', '📖 语法详情'],
  'bdc.closeMap': ['Close Minimap', '🗺️ 关闭地图'],
  'bdc.openMap': ['Minimap', '🗺️ 小地图'],
  'bdc.readonlyMode': ['Read-only', '📖 只读'],
  'bdc.editMode': ['Edit', '✏️ 编辑'],
  'bdc.saving': ['Saving...', '保存中...'],
  'bdc.save': ['Save', '💾 保存'],
  'bdc.aiThinking': ['Thinking...', '思考中...'],
  'bdc.askButton': ['Ask', '提问'],
  'bdc.askSample1': ['What does this code do?', '这段代码有什么作用？'],
  'bdc.askSample2': ['How to optimize this code?', '怎么优化这段代码？'],
  'bdc.askSample3': ['What issues does this code have?', '这段代码有什么问题？'],
  'bdc.saveFileTitle': ['Save File', '保存文件'],
  'bdc.goToDefinitionTitle': ['Go to Definition', '跳转到定义'],
  'bdc.askAIAboutCode': ['Ask AI about this code', '🤖 问 AI 关于这段代码'],
  'bdc.beginnerMode': ['Beginner Mode', '📖 新手模式'],
  'bdc.expertMode': ['Expert Mode', '💡 专家模式'],
  'bdc.notSelected': ['Not Selected', '未选择'],
  // 符号类型
  'bdc.symbolClass': ['Class', '🏛️ 类'],
  'bdc.symbolFunction': ['Function', '🔧 函数'],
  'bdc.symbolBlock': ['Block', '📦 代码块'],
  'bdc.symbolFile': ['File', '📄 文件'],
  // 大纲
  'bdc.outline.class': ['Class - A blueprint that encapsulates data and behavior', '类定义 - 封装数据和行为的蓝图'],
  'bdc.outline.interface': ['Interface - Defines the shape and contract of an object', '接口 - 定义对象的形状和契约'],
  'bdc.outline.typeAlias': ['Type Alias - Defines a new name for a type', '类型别名 - 为类型定义一个新名称'],
  'bdc.outline.function': ['Function - A reusable block of code', '函数 - 可重用的代码块'],
  'bdc.outline.method': ['Method - A function member of a class', '方法 - 类中的函数成员'],
  'bdc.outline.property': ['Property - A data member of a class', '属性 - 类中的数据成员'],
  'bdc.outline.constant': ['Constant - An immutable value', '常量 - 不可变的值'],
  'bdc.outline.variable': ['Variable - A mutable value', '变量 - 可变的值'],
  // 编辑器
  'bdc.codeEditTab': ['Code Edit', '代码编辑'],
  'bdc.analysisTab': ['Analysis', '分析'],
  'bdc.kindClass': ['Class', '类'],
  'bdc.kindInterface': ['Interface', '接口'],
  'bdc.kindType': ['Type', '类型'],
  'bdc.kindMethod': ['Method', '方法'],
  'bdc.kindConstant': ['Constant', '常量'],
  'bdc.kindVariable': ['Variable', '变量'],
  'bdc.complexitySimple': ['Simple', '简单'],
  'bdc.complexityMedium': ['Medium', '中等'],
  'bdc.complexityComplex': ['Complex', '复杂'],
  'bdc.directory': ['Directory', '目录'],
  'bdc.cached': ['cached', '缓存'],
  'bdc.analyzing': ['Analyzing...', '分析中...'],
};

// 执行替换
let replacedCount = 0;
for (const [from, to] of replacements) {
  if (content.includes(from)) {
    content = content.replaceAll(from, to);
    replacedCount++;
    console.log(`✓ Replaced: ${from.substring(0, 50)}...`);
  } else {
    console.log(`✗ Not found: ${from.substring(0, 50)}...`);
  }
}

fs.writeFileSync(bdcFile, content);
console.log(`\nReplaced ${replacedCount} patterns in BlueprintDetailContent.tsx`);

// 更新翻译文件
function addKeysToFile(filePath, keys, langIndex) {
  let fileContent = fs.readFileSync(filePath, 'utf-8');
  const insertPoint = fileContent.lastIndexOf('} as const;');
  if (insertPoint === -1) {
    console.error('Cannot find insertion point in', filePath);
    return;
  }
  
  let newEntries = '';
  for (const [key, values] of Object.entries(keys)) {
    const value = values[langIndex];
    // Check if key already exists
    if (fileContent.includes(`'${key}':`)) {
      continue;
    }
    // Escape quotes properly
    if (value.includes("'")) {
      newEntries += `  '${key}': "${value}",\n`;
    } else {
      newEntries += `  '${key}': '${value}',\n`;
    }
  }
  
  if (newEntries) {
    fileContent = fileContent.substring(0, insertPoint) + newEntries + fileContent.substring(insertPoint);
    fs.writeFileSync(filePath, fileContent);
    console.log(`Added ${newEntries.split('\n').filter(l => l.trim()).length} keys to ${filePath}`);
  }
}

addKeysToFile(enFile, newKeys, 0);
addKeysToFile(zhFile, newKeys, 1);
