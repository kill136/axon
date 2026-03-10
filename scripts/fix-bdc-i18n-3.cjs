// Phase 3: Replace remaining hardcoded Chinese in BDC JSX
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'web', 'client', 'src', 'components', 'swarm', 'BlueprintDetailPanel', 'BlueprintDetailContent.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

const replacements = [
  // === Code view loading/error/welcome ===
  ["<p>正在加载文件内容...</p>", "<p>{t('bdc.loadingFileContent')}</p>"],
  [">重试<", ">{t('bdc.retry')}<"],  // will need special handling - multiple occurrences
  ["<h2 className={styles.welcomeTitle}>选择文件查看代码</h2>", "<h2 className={styles.welcomeTitle}>{t('bdc.selectFileToView')}</h2>"],
  ["<p className={styles.welcomeDesc}>点击左侧文件树中的文件来查看和编辑代码</p>", "<p className={styles.welcomeDesc}>{t('bdc.clickFileToViewEdit')}</p>"],

  // === Code header buttons ===
  ["🔗 跳转", "{t('bdc.jumpToDefinition')}"],

  // === Line detail panel ===
  ["<span className={styles.lineDetailTitle}>📖 第 {lineAnalysis.lineNumber} 行</span>", "<span className={styles.lineDetailTitle}>{t('bdc.lineDetailTitle', { line: lineAnalysis.lineNumber })}</span>"],
  [">AI 分析中...</", ">{t('bdc.aiAnalyzing')}</"],
  ["<div className={styles.lineDetailSectionTitle}>语法关键字</div>", "<div className={styles.lineDetailSectionTitle}>{t('bdc.syntaxKeywords')}</div>"],
  ["<div className={styles.lineDetailSectionTitle}>🤖 AI 分析</div>", "<div className={styles.lineDetailSectionTitle}>{t('bdc.aiAnalysisSection')}</div>"],
  ["<div className={styles.paramTitle}>参数:</div>", "<div className={styles.paramTitle}>{t('bdc.paramsLabel')}</div>"],
  ["<span className={styles.returnLabel}>返回:</span>", "<span className={styles.returnLabel}>{t('bdc.returnLabel')}</span>"],
  ["<div className={styles.exampleTitle}>示例:</div>", "<div className={styles.exampleTitle}>{t('bdc.exampleLabel')}</div>"],
  ["<span>正在分析代码...</span>", "<span>{t('bdc.analyzingCode')}</span>"],

  // === Code footer ===
  ["最后修改: {new Date(fileContent.modifiedAt).toLocaleString('zh-CN')}", "{t('bdc.lastModified', { time: new Date(fileContent.modifiedAt).toLocaleString() })}"],
  ["{editedContent.split('\\n').length} 行", "{t('bdc.lineCount', { count: editedContent.split('\\n').length })}"],
  ["F12: 跳转定义 | Ctrl+S: 保存 | 右键: 问AI", "{t('bdc.shortcuts')}"],

  // === Ask AI dialog ===
  ["<span className={styles.askAITitle}>🤖 问 AI</span>", "<span className={styles.askAITitle}>{t('bdc.askAITitle')}</span>"],
  ["行 {askAI.selectedRange?.startLine} - {askAI.selectedRange?.endLine}", "{t('bdc.lineRange', { start: askAI.selectedRange?.startLine, end: askAI.selectedRange?.endLine })}"],
  ["<div className={styles.askAIAnswerLabel}>AI 回答：</div>", "<div className={styles.askAIAnswerLabel}>{t('bdc.aiAnswer')}</div>"],
  ["这段代码有什么作用？", "{t('bdc.askSample1')}"],
  ["怎么优化这段代码？", "{t('bdc.askSample2')}"],
  ["这段代码有什么问题？", "{t('bdc.askSample3')}"],

  // === Tour panel ===
  ["<span className={styles.tourTitle}>🎯 代码导游</span>", "<span className={styles.tourTitle}>{t('bdc.codeTourTitle')}</span>"],
  ["行 {tourState.steps[tourState.currentStep].line}", "{t('bdc.lineNum', { line: tourState.steps[tourState.currentStep].line })}"],
  ["<div className={styles.tourStepsTitle}>全部步骤</div>", "<div className={styles.tourStepsTitle}>{t('bdc.allSteps')}</div>"],
  ["step.type === 'function' ? '函数' :", "step.type === 'function' ? t('bdc.kindFunction') :"],
  ["step.type === 'block' ? '块' : '文件'}", "step.type === 'block' ? t('bdc.kindBlock') : t('bdc.kindFile')}"],
  ["← 上一步", "{t('bdc.prevStep')}"],
  ["下一步 →", "{t('bdc.nextStep')}"],

  // === Symbol detail panel ===
  ["<h3 className={styles.symbolSectionTitle}>类型说明</h3>", "<h3 className={styles.symbolSectionTitle}>{t('bdc.typeDescription')}</h3>"],
  ["<h3 className={styles.symbolSectionTitle}>成员 ({selectedSymbol.children.length})</h3>", "<h3 className={styles.symbolSectionTitle}>{t('bdc.members', { count: selectedSymbol.children.length })}</h3>"],
  ["<h3 className={styles.symbolSectionTitle}>位置</h3>", "<h3 className={styles.symbolSectionTitle}>{t('bdc.location')}</h3>"],
  ["<span className={styles.locationLabel}>文件:</span>", "<span className={styles.locationLabel}>{t('bdc.fileLabel')}</span>"],
  ["<span className={styles.locationLabel}>行号:</span>", "<span className={styles.locationLabel}>{t('bdc.lineLabel')}</span>"],

  // === Analysis view ===
  ["<h3 className={styles.analyzingTitle}>正在分析 {selectedPath}</h3>", "<h3 className={styles.analyzingTitle}>{t('bdc.analyzingPath', { path: selectedPath })}</h3>"],
  ["<p className={styles.analyzingHint}>AI 正在阅读代码并生成语义分析...</p>", "<p className={styles.analyzingHint}>{t('bdc.aiReadingCode')}</p>"],
  ["<p className={styles.errorText}>分析失败: {analysisError}</p>", "<p className={styles.errorText}>{t('bdc.analysisFailed', { error: analysisError })}</p>"],
  // file type in analysis
  ["{currentAnalysis.type === 'directory' ? t('bdc.directory') : '文件'}", "{currentAnalysis.type === 'directory' ? t('bdc.directory') : t('bdc.file')}"],
  ["🔄 重新分析", "{t('bdc.reanalyze')}"],

  // === Section titles in analysis ===
  ["<h3 className={styles.sectionTitle}>职责</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.responsibilities')}</h3>"],
  ["<h3 className={styles.sectionTitle}>导出</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.exports')}</h3>"],
  ["<h3 className={styles.sectionTitle}>依赖</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.dependencies')}</h3>"],
  ["<h3 className={styles.sectionTitle}>被引用 ({currentAnalysis.reverseDependencies.length})</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.referencedBy', { count: currentAnalysis.reverseDependencies.length })}</h3>"],
  ["使用: {rd.imports.join(', ')}", "{t('bdc.uses', { imports: rd.imports.join(', ') })}"],
  ["<h3 className={styles.sectionTitle}>关系图谱</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.relationshipGraph')}</h3>"],
  ["+{currentAnalysis.reverseDependencies.length - 5} 更多", "+{currentAnalysis.reverseDependencies.length - 5} {t('bdc.more')}"],
  ["<div className={styles.graphCurrentBadge}>当前文件</div>", "<div className={styles.graphCurrentBadge}>{t('bdc.currentFile')}</div>"],
  ["+{currentAnalysis.dependencies.length - 5} 更多", "+{currentAnalysis.dependencies.length - 5} {t('bdc.more')}"],
  ["<h3 className={styles.sectionTitle}>技术栈</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.techStack')}</h3>"],
  ["<h3 className={styles.sectionTitle}>关键点</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.keyPoints')}</h3>"],
  ["<h3 className={styles.sectionTitle}>子模块概览</h3>", "<h3 className={styles.sectionTitle}>{t('bdc.submoduleOverview')}</h3>"],
  ["分析时间: {new Date(currentAnalysis.analyzedAt).toLocaleString('zh-CN')}", "{t('bdc.analysisTime', { time: new Date(currentAnalysis.analyzedAt).toLocaleString() })}"],
  ["⚡ 缓存", "{t('bdc.cacheLabel')}"],
  ["✨ 新分析", "{t('bdc.freshLabel')}"],

  // === Loading directory ===
  ["<p>正在加载目录结构...</p>", "<p>{t('bdc.loadingDirectory')}</p>"],

  // === Sidebar ===
  ["<span className={styles.sidebarTitle}>资源管理器</span>", "<span className={styles.sidebarTitle}>{t('bdc.explorer')}</span>"],

  // === Tab bar ===
  ["<span className={styles.tabName}>欢迎</span>", "<span className={styles.tabName}>{t('bdc.welcomeTab')}</span>"],
  ["{taskTreeStats.completedTasks}/{taskTreeStats.totalTasks} 完成", "{t('bdc.taskProgress', { completed: taskTreeStats.completedTasks, total: taskTreeStats.totalTasks })}"],
  ["← 返回主聊天", "{t('bdc.backToChat')}"],

  // === Tooltip kind labels ===
  ["function: '函数',", "function: t('bdc.kindFunction'),"],
  ["property: '属性',", "property: t('bdc.kindProperty'),"],

  // === Tooltip layers ===
  ["<span className={styles.tooltipLayerLabel}>📝 注释</span>", "<span className={styles.tooltipLayerLabel}>{t('bdc.tooltipComment')}</span>"],
  ["<span className={styles.tooltipLayerLabel}>📖 语法 <span className={styles.beginnerBadge}>新手</span></span>", "<span className={styles.tooltipLayerLabel}>{t('bdc.tooltipSyntax')} <span className={styles.beginnerBadge}>{t('bdc.beginner')}</span></span>"],
  ["<span>AI 正在分析...</span>", "<span>{t('bdc.aiAnalyzingTooltip')}</span>"],
  ["<span className={styles.tooltipLayerLabel}>🤖 语义</span>", "<span className={styles.tooltipLayerLabel}>{t('bdc.tooltipSemantic')}</span>"],
  ["<span className={styles.tooltipMiniLabel}>参数:</span>", "<span className={styles.tooltipMiniLabel}>{t('bdc.paramsLabel')}</span>"],
  ["<span className={styles.tooltipMiniLabel}>返回:</span>", "<span className={styles.tooltipMiniLabel}>{t('bdc.returnLabel')}</span>"],
  ["<span>行 {sym.line}</span>", "<span>{t('bdc.lineNum', { line: sym.line })}</span>"],
  ["<span className={styles.tooltipFooterHint}> · 点击跳转</span>", "<span className={styles.tooltipFooterHint}> · {t('bdc.clickToJump')}</span>"],
  ["<span>正在分析...</span>", "<span>{t('bdc.analyzing')}</span>"],
  ["<span className={styles.tooltipHint}>悬停以加载语义分析</span>", "<span className={styles.tooltipHint}>{t('bdc.hoverToLoad')}</span>"],
  // file type in tooltip
  ["{analysis.type === 'directory' ? t('bdc.directory') : '文件'}", "{analysis.type === 'directory' ? t('bdc.directory') : t('bdc.file')}"],
  ["<span className={styles.tooltipSectionTitle}>职责</span>", "<span className={styles.tooltipSectionTitle}>{t('bdc.responsibilities')}</span>"],
  ["+{analysis.responsibilities.length - 3} 更多...</", "+{analysis.responsibilities.length - 3} {t('bdc.more')}...</"],
  ["<span className={styles.tooltipSectionTitle}>导出</span>", "<span className={styles.tooltipSectionTitle}>{t('bdc.exports')}</span>"],
  ["点击查看详情", "{t('bdc.clickForDetails')}"],

  // === Status bar ===
  ["操作失败", "{t('bdc.operationFailed')}"],
  ["{analysisCache.size} 已分析", "{t('bdc.analyzedCount', { count: analysisCache.size })}"],
  ["<span className={styles.statusAnalyzing}>分析中...</span>", "<span className={styles.statusAnalyzing}>{t('bdc.statusAnalyzing')}</span>"],
  ["<span className={styles.statusSaving}>保存中...</span>", "<span className={styles.statusSaving}>{t('bdc.statusSaving')}</span>"],
];

let replaced = 0;
let failed = [];

for (const [oldStr, newStr] of replacements) {
  if (content.includes(oldStr)) {
    // Count occurrences
    const count = content.split(oldStr).length - 1;
    content = content.replaceAll(oldStr, newStr);
    replaced++;
    if (count > 1) {
      console.log(`  [${count}x] ${oldStr.substring(0, 50)}`);
    }
  } else {
    failed.push(oldStr.substring(0, 60));
  }
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log(`\nReplaced: ${replaced}/${replacements.length}`);
if (failed.length > 0) {
  console.log(`\nFailed (${failed.length}):`);
  failed.forEach(f => console.log(`  - ${f}`));
}
