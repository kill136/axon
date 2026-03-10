/**
 * 第二轮修复 BlueprintDetailContent.tsx 中的硬编码中文
 * 处理 AI 文档格式化和函数命名推断
 */
const fs = require('fs');

const bdcFile = 'src/web/client/src/components/swarm/BlueprintDetailPanel/BlueprintDetailContent.tsx';
const enFile = 'src/web/client/src/i18n/locales/en/code.ts';
const zhFile = 'src/web/client/src/i18n/locales/zh/code.ts';

let content = fs.readFileSync(bdcFile, 'utf-8');

// AI 文档格式化
const r2 = [
  // AI 文档标题
  ['`**🤖 AI 文档** ${result.fromCache ? \'*(缓存)*\' : \'\'}`', '`**🤖 ${t(\'bdc.aiDoc\')}** ${result.fromCache ? \'*(${t(\'bdc.aiDocCached\')})*\' : \'\'}`'],
  ['`\\n**参数：**`', '`\\n**${t(\'bdc.aiDocParams\')}**`'],
  ['`\\n**返回值：** ${result.returns.type} - ${result.returns.description}`', '`\\n**${t(\'bdc.aiDocReturns\')}** ${result.returns.type} - ${result.returns.description}`'],
  ['`\\n**示例：**`', '`\\n**${t(\'bdc.aiDocExamples\')}**`'],
  ['`\\n**注意：**`', '`\\n**${t(\'bdc.aiDocNotes\')}**`'],

  // 保存/错误信息
  ['`保存失败: ${err.message}`', 't(\'bdc.saveFailed\', { error: err.message })'],

  // 文件信息
  ['`${name} 文件`', 't(\'bdc.fileLabel\', { name })'],
  ["'(点击生成分析查看)'", "t('bdc.clickToAnalyze')"],
  ["'需要 AI 分析来获取详细信息'", "t('bdc.needAIAnalysis')"],
  ['`${name} 模块目录`', 't(\'bdc.moduleDirLabel\', { name })'],

  // 导入信息  
  ["'导入声明'", "t('bdc.importDeclaration')"],
  ["'引入本地模块依赖。'", "t('bdc.localModuleDeps')"],

  // 代码分析信息
  ["'异步执行'", "t('bdc.asyncExecution')"],
  ["'组件'", "t('bdc.component')", true],

  // AI 服务错误
  ["'未知错误'", "t('bdc.unknownError')", true],
  
  // → 详情见右侧面板
  ['` → 详情见右侧面板`', '` → ${t(\'bdc.detailsInPanel\')}`'],

  // 定义提示
  ['`${kindLabels[sym.kind] || sym.kind} 定义`', '`${kindLabels[sym.kind] || sym.kind} ${t(\'bdc.definition\')}`'],
];

let count = 0;
for (const [from, to] of r2) {
  if (content.includes(from)) {
    content = content.replace(from, to);
    count++;
    console.log(`✓ ${from.substring(0, 60)}`);
  } else {
    console.log(`✗ ${from.substring(0, 60)}`);
  }
}

// 替换函数推断模板：这些需要用 t() 插值模式
// 模式：`处理 ${splitCamelCase(m[1])} 事件` → `${t('bdc.infer.handle', { name: splitCamelCase(m[1]) })}`
const inferPatterns = [
  ['`处理 ${splitCamelCase(m[1])} 事件`', "`${t('bdc.infer.handle', { name: splitCamelCase(m[1]) })}`"],
  ['`响应 ${splitCamelCase(m[1])} 事件`', "`${t('bdc.infer.respond', { name: splitCamelCase(m[1]) })}`"],
  ['`获取 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.get', { name: splitCamelCase(m[1]) })}`"],
  ['`设置 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.set', { name: splitCamelCase(m[1]) })}`"],
  ['`请求 ${splitCamelCase(m[1])} 数据`', "`${t('bdc.infer.fetch', { name: splitCamelCase(m[1]) })}`"],
  ['`加载 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.load', { name: splitCamelCase(m[1]) })}`"],
  ['`保存 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.save', { name: splitCamelCase(m[1]) })}`"],
  ['`创建 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.create', { name: splitCamelCase(m[1]) })}`"],
  ['`更新 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.update', { name: splitCamelCase(m[1]) })}`"],
  ['`删除 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.delete', { name: splitCamelCase(m[1]) })}`"],
  ['`移除 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.remove', { name: splitCamelCase(m[1]) })}`"],
  ['`添加 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.add', { name: splitCamelCase(m[1]) })}`"],
  ['`初始化 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.init', { name: splitCamelCase(m[1]) })}`"],
  ["'执行初始化'", "t('bdc.infer.initDefault')"],
  ['`解析 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.parse', { name: splitCamelCase(m[1]) })}`"],
  ['`格式化 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.format', { name: splitCamelCase(m[1]) })}`"],
  ['`验证 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.validate', { name: splitCamelCase(m[1]) })}`"],
  ['`检查 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.check', { name: splitCamelCase(m[1]) })}`"],
  ['`判断是否 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.is', { name: splitCamelCase(m[1]) })}`"],
  ['`判断是否有 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.has', { name: splitCamelCase(m[1]) })}`"],
  ['`判断能否 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.can', { name: splitCamelCase(m[1]) })}`"],
  ['`判断是否应该 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.should', { name: splitCamelCase(m[1]) })}`"],
  ['`渲染 ${splitCamelCase(m[1])}`', "`${t('bdc.infer.render', { name: splitCamelCase(m[1]) })}`"],
  ["'执行渲染'", "t('bdc.infer.renderDefault')"],
  ['`附加 ${splitCamelCase(m[1])} 能力的高阶组件`', "`${t('bdc.infer.withHOC', { name: splitCamelCase(m[1]) })}`"],
  // 角色后缀
  ['`${splitCamelCase(m[1])} 管理器`', "`${t('bdc.infer.manager', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 服务`', "`${t('bdc.infer.service', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 控制器`', "`${t('bdc.infer.controller', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 处理器`', "`${t('bdc.infer.handler', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 提供者`', "`${t('bdc.infer.provider', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 工厂`', "`${t('bdc.infer.factory', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 构建器`', "`${t('bdc.infer.builder', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 辅助工具`', "`${t('bdc.infer.helper', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 工具函数`', "`${t('bdc.infer.util', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 协调器，负责多组件间的协作调度`', "`${t('bdc.infer.coordinator', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 注册表`', "`${t('bdc.infer.registry', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 池`', "`${t('bdc.infer.pool', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 队列`', "`${t('bdc.infer.queue', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 缓存`', "`${t('bdc.infer.cache', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 状态存储`', "`${t('bdc.infer.store', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 上下文`', "`${t('bdc.infer.context', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 状态管理 Reducer`', "`${t('bdc.infer.reducer', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 中间件`', "`${t('bdc.infer.middleware', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 插件`', "`${t('bdc.infer.plugin', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 适配器`', "`${t('bdc.infer.adapter', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 包装器`', "`${t('bdc.infer.wrapper', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 监听器`', "`${t('bdc.infer.listener', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 观察者`', "`${t('bdc.infer.observer', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 事件发射器`', "`${t('bdc.infer.emitter', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 客户端`', "`${t('bdc.infer.client', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 服务端`', "`${t('bdc.infer.server', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} API 接口`', "`${t('bdc.infer.api', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 路由`', "`${t('bdc.infer.route', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 组件`', "`${t('bdc.infer.component', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 视图`', "`${t('bdc.infer.view', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 页面`', "`${t('bdc.infer.page', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 弹窗`', "`${t('bdc.infer.modal', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 对话框`', "`${t('bdc.infer.dialog', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 表单`', "`${t('bdc.infer.form', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 列表`', "`${t('bdc.infer.list', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 表格`', "`${t('bdc.infer.table', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 面板`', "`${t('bdc.infer.panel', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 卡片`', "`${t('bdc.infer.card', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 按钮`', "`${t('bdc.infer.button', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 输入框`', "`${t('bdc.infer.input', { name: splitCamelCase(m[1]) })}`"],
  ['`${splitCamelCase(m[1])} 选择器`', "`${t('bdc.infer.select', { name: splitCamelCase(m[1]) })}`"],
  
  // 类信息
  ['`继承自 ${extendsClass}`', "`${t('bdc.extendsClass', { name: extendsClass })}`"],
  ["')} 接口'", ")} ' + t('bdc.interfaceSuffix')"],
  ['`包含 ${methodCount} 个方法`', "`${t('bdc.methodCount', { count: methodCount })}`"],
  ["')} 等）'", ")} ' + t('bdc.etc') + ')'"],
  ['`${propertyCount} 个属性`', "`${t('bdc.propertyCount', { count: propertyCount })}`"],
  ['`类 ${name}`', "`${t('bdc.classPrefix')} ${name}`"],

  // 函数信息
  ["' 等'", "' ' + t('bdc.etc')"],
  ['`返回 ${returnType}`', "`${t('bdc.returns', { type: returnType })}`"],
  ["'函数'", "t('bdc.functionLabel')", true],
];

for (const [from, to] of inferPatterns) {
  if (content.includes(from)) {
    content = content.replace(from, to);
    count++;
    console.log(`✓ ${from.substring(0, 60)}`);
  } else {
    console.log(`✗ ${from.substring(0, 60)}`);
  }
}

fs.writeFileSync(bdcFile, content);
console.log(`\nReplaced ${count} more patterns`);

// 新的翻译 key
const newKeys = {
  // AI 文档
  'bdc.aiDoc': ['AI Doc', 'AI 文档'],
  'bdc.aiDocCached': ['cached', '缓存'],
  'bdc.aiDocParams': ['Parameters:', '参数：'],
  'bdc.aiDocReturns': ['Returns:', '返回值：'],
  'bdc.aiDocExamples': ['Examples:', '示例：'],
  'bdc.aiDocNotes': ['Notes:', '注意：'],
  'bdc.saveFailed': ['Save failed: {{error}}', '保存失败: {{error}}'],
  'bdc.fileLabel': ['{{name}} file', '{{name}} 文件'],
  'bdc.clickToAnalyze': ['(Click to generate analysis)', '(点击生成分析查看)'],
  'bdc.needAIAnalysis': ['AI analysis needed for details', '需要 AI 分析来获取详细信息'],
  'bdc.moduleDirLabel': ['{{name}} module directory', '{{name}} 模块目录'],
  'bdc.importDeclaration': ['Import Declaration', '导入声明'],
  'bdc.localModuleDeps': ['Imports local module dependencies.', '引入本地模块依赖。'],
  'bdc.asyncExecution': ['Async execution', '异步执行'],
  'bdc.component': ['Component', '组件'],
  'bdc.unknownError': ['Unknown error', '未知错误'],
  'bdc.detailsInPanel': ['Details in right panel', '详情见右侧面板'],
  'bdc.definition': ['definition', '定义'],
  // 函数推断
  'bdc.infer.handle': ['Handle {{name}} event', '处理 {{name}} 事件'],
  'bdc.infer.respond': ['Respond to {{name}} event', '响应 {{name}} 事件'],
  'bdc.infer.get': ['Get {{name}}', '获取 {{name}}'],
  'bdc.infer.set': ['Set {{name}}', '设置 {{name}}'],
  'bdc.infer.fetch': ['Fetch {{name}} data', '请求 {{name}} 数据'],
  'bdc.infer.load': ['Load {{name}}', '加载 {{name}}'],
  'bdc.infer.save': ['Save {{name}}', '保存 {{name}}'],
  'bdc.infer.create': ['Create {{name}}', '创建 {{name}}'],
  'bdc.infer.update': ['Update {{name}}', '更新 {{name}}'],
  'bdc.infer.delete': ['Delete {{name}}', '删除 {{name}}'],
  'bdc.infer.remove': ['Remove {{name}}', '移除 {{name}}'],
  'bdc.infer.add': ['Add {{name}}', '添加 {{name}}'],
  'bdc.infer.init': ['Initialize {{name}}', '初始化 {{name}}'],
  'bdc.infer.initDefault': ['Execute initialization', '执行初始化'],
  'bdc.infer.parse': ['Parse {{name}}', '解析 {{name}}'],
  'bdc.infer.format': ['Format {{name}}', '格式化 {{name}}'],
  'bdc.infer.validate': ['Validate {{name}}', '验证 {{name}}'],
  'bdc.infer.check': ['Check {{name}}', '检查 {{name}}'],
  'bdc.infer.is': ['Check if {{name}}', '判断是否 {{name}}'],
  'bdc.infer.has': ['Check if has {{name}}', '判断是否有 {{name}}'],
  'bdc.infer.can': ['Check if can {{name}}', '判断能否 {{name}}'],
  'bdc.infer.should': ['Check if should {{name}}', '判断是否应该 {{name}}'],
  'bdc.infer.render': ['Render {{name}}', '渲染 {{name}}'],
  'bdc.infer.renderDefault': ['Execute render', '执行渲染'],
  'bdc.infer.withHOC': ['HOC adding {{name}} capability', '附加 {{name}} 能力的高阶组件'],
  'bdc.infer.manager': ['{{name}} Manager', '{{name}} 管理器'],
  'bdc.infer.service': ['{{name}} Service', '{{name}} 服务'],
  'bdc.infer.controller': ['{{name}} Controller', '{{name}} 控制器'],
  'bdc.infer.handler': ['{{name}} Handler', '{{name}} 处理器'],
  'bdc.infer.provider': ['{{name}} Provider', '{{name}} 提供者'],
  'bdc.infer.factory': ['{{name}} Factory', '{{name}} 工厂'],
  'bdc.infer.builder': ['{{name}} Builder', '{{name}} 构建器'],
  'bdc.infer.helper': ['{{name}} Helper', '{{name}} 辅助工具'],
  'bdc.infer.util': ['{{name}} Utility', '{{name}} 工具函数'],
  'bdc.infer.coordinator': ['{{name}} Coordinator', '{{name}} 协调器，负责多组件间的协作调度'],
  'bdc.infer.registry': ['{{name}} Registry', '{{name}} 注册表'],
  'bdc.infer.pool': ['{{name}} Pool', '{{name}} 池'],
  'bdc.infer.queue': ['{{name}} Queue', '{{name}} 队列'],
  'bdc.infer.cache': ['{{name}} Cache', '{{name}} 缓存'],
  'bdc.infer.store': ['{{name}} Store', '{{name}} 状态存储'],
  'bdc.infer.context': ['{{name}} Context', '{{name}} 上下文'],
  'bdc.infer.reducer': ['{{name}} State Reducer', '{{name}} 状态管理 Reducer'],
  'bdc.infer.middleware': ['{{name}} Middleware', '{{name}} 中间件'],
  'bdc.infer.plugin': ['{{name}} Plugin', '{{name}} 插件'],
  'bdc.infer.adapter': ['{{name}} Adapter', '{{name}} 适配器'],
  'bdc.infer.wrapper': ['{{name}} Wrapper', '{{name}} 包装器'],
  'bdc.infer.listener': ['{{name}} Listener', '{{name}} 监听器'],
  'bdc.infer.observer': ['{{name}} Observer', '{{name}} 观察者'],
  'bdc.infer.emitter': ['{{name}} Event Emitter', '{{name}} 事件发射器'],
  'bdc.infer.client': ['{{name}} Client', '{{name}} 客户端'],
  'bdc.infer.server': ['{{name}} Server', '{{name}} 服务端'],
  'bdc.infer.api': ['{{name}} API', '{{name}} API 接口'],
  'bdc.infer.route': ['{{name}} Route', '{{name}} 路由'],
  'bdc.infer.component': ['{{name}} Component', '{{name}} 组件'],
  'bdc.infer.view': ['{{name}} View', '{{name}} 视图'],
  'bdc.infer.page': ['{{name}} Page', '{{name}} 页面'],
  'bdc.infer.modal': ['{{name}} Modal', '{{name}} 弹窗'],
  'bdc.infer.dialog': ['{{name}} Dialog', '{{name}} 对话框'],
  'bdc.infer.form': ['{{name}} Form', '{{name}} 表单'],
  'bdc.infer.list': ['{{name}} List', '{{name}} 列表'],
  'bdc.infer.table': ['{{name}} Table', '{{name}} 表格'],
  'bdc.infer.panel': ['{{name}} Panel', '{{name}} 面板'],
  'bdc.infer.card': ['{{name}} Card', '{{name}} 卡片'],
  'bdc.infer.button': ['{{name}} Button', '{{name}} 按钮'],
  'bdc.infer.input': ['{{name}} Input', '{{name}} 输入框'],
  'bdc.infer.select': ['{{name}} Select', '{{name}} 选择器'],
  // 类信息
  'bdc.extendsClass': ['Extends {{name}}', '继承自 {{name}}'],
  'bdc.interfaceSuffix': ['interface', '接口'],
  'bdc.methodCount': ['{{count}} methods', '{{count}} 个方法'],
  'bdc.etc': ['etc.', '等'],
  'bdc.propertyCount': ['{{count}} properties', '{{count}} 个属性'],
  'bdc.classPrefix': ['Class', '类'],
  'bdc.returns': ['Returns {{type}}', '返回 {{type}}'],
  'bdc.functionLabel': ['function', '函数'],
};

// 更新翻译文件
function addKeysToFile(filePath, keys, langIndex) {
  let fileContent = fs.readFileSync(filePath, 'utf-8');
  const insertPoint = fileContent.lastIndexOf('} as const;');
  let newEntries = '';
  for (const [key, values] of Object.entries(keys)) {
    const value = values[langIndex];
    if (fileContent.includes(`'${key}':`)) continue;
    if (value.includes("'")) {
      newEntries += `  '${key}': "${value}",\n`;
    } else {
      newEntries += `  '${key}': '${value}',\n`;
    }
  }
  if (newEntries) {
    fileContent = fileContent.substring(0, insertPoint) + newEntries + fileContent.substring(insertPoint);
    fs.writeFileSync(filePath, fileContent);
    console.log(`Added keys to ${filePath}`);
  }
}

addKeysToFile(enFile, newKeys, 0);
addKeysToFile(zhFile, newKeys, 1);
