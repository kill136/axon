/**
 * 官方 Claude Code 源码同步分析器
 *
 * 用于分析官方源码与本项目的差异，生成同步报告
 */

import * as fs from 'fs';
import * as path from 'path';

interface ToolInfo {
  name: string;
  foundInOfficial: boolean;
  foundInProject: boolean;
  officialContext: string[];
  projectPath?: string;
}

interface ModuleInfo {
  name: string;
  category: string;
  officialPatterns: string[];
  projectPaths: string[];
  syncStatus: 'synced' | 'partial' | 'missing' | 'extra';
}

interface AnalysisReport {
  timestamp: string;
  officialVersion: string;
  tools: ToolInfo[];
  modules: ModuleInfo[];
  summary: {
    totalOfficialTools: number;
    totalProjectTools: number;
    missingTools: string[];
    extraTools: string[];
    partiallyImplemented: string[];
  };
}

// 已知的官方工具列表（从 sdk-tools.d.ts 提取）
const OFFICIAL_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'Task',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'NotebookEdit',
  'Mcp',
  'TaskStop',
  'ExitPlanMode',
  'AskUserQuestion',
  'BashOutput',
  'EnterPlanMode',
  'Skill',
  'SlashCommand',
  'Tmux',
];

// 官方源码中的模块分类
const OFFICIAL_MODULES = {
  'core': ['client', 'session', 'loop', 'conversation'],
  'tools': OFFICIAL_TOOLS.map(t => t.toLowerCase()),
  'ui': ['ink', 'components', 'hooks', 'autocomplete'],
  'auth': ['oauth', 'apikey', 'token'],
  'config': ['settings', 'config', 'env'],
  'context': ['context', 'memory', 'summarization'],
  'hooks': ['hooks', 'lifecycle'],
  'mcp': ['mcp', 'server', 'client'],
  'permissions': ['permissions', 'sandbox', 'security'],
  'session': ['session', 'persistence', 'resume'],
  'streaming': ['streaming', 'sse', 'message'],
  'agents': ['agent', 'subagent', 'task'],
  'git': ['git', 'github', 'pr'],
  'search': ['ripgrep', 'glob', 'grep'],
  'parser': ['parser', 'treesitter', 'lsp'],
  'telemetry': ['telemetry', 'metrics', 'logging'],
  'web': ['webfetch', 'websearch', 'fetch'],
  'plan': ['plan', 'planmode'],
  'skills': ['skills', 'commands'],
  'plugins': ['plugins', 'extensions'],
  'updater': ['updater', 'version'],
};

class SyncAnalyzer {
  private officialCode: string = '';
  private projectRoot: string;
  private officialPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.officialPath = path.join(projectRoot, 'node_modules/@anthropic-ai/claude-code/cli.js');
  }

  async analyze(): Promise<AnalysisReport> {
    console.log('📊 开始分析官方源码与项目差异...\n');

    // 读取官方源码
    this.officialCode = fs.readFileSync(this.officialPath, 'utf8');
    console.log(`📦 官方源码大小: ${(this.officialCode.length / 1024 / 1024).toFixed(2)} MB`);

    // 提取版本号
    const versionMatch = this.officialCode.match(/Version:\s*([\d.]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    console.log(`📌 官方版本: ${version}\n`);

    // 分析工具
    const tools = await this.analyzeTools();

    // 分析模块
    const modules = await this.analyzeModules();

    // 生成摘要
    const summary = this.generateSummary(tools, modules);

    return {
      timestamp: new Date().toISOString(),
      officialVersion: version,
      tools,
      modules,
      summary,
    };
  }

  private async analyzeTools(): Promise<ToolInfo[]> {
    console.log('🔧 分析工具实现...');
    const tools: ToolInfo[] = [];

    for (const toolName of OFFICIAL_TOOLS) {
      const regex = new RegExp(`.{0,100}${toolName}.{0,100}`, 'g');
      const matches = this.officialCode.match(regex) || [];
      const uniqueContexts = [...new Set(matches.map(m => m.trim()))].slice(0, 5);

      // 检查项目中是否有对应实现
      const projectPath = this.findProjectTool(toolName);

      tools.push({
        name: toolName,
        foundInOfficial: matches.length > 0,
        foundInProject: projectPath !== undefined,
        officialContext: uniqueContexts,
        projectPath,
      });
    }

    return tools;
  }

  private findProjectTool(toolName: string): string | undefined {
    const possiblePaths = [
      `src/tools/${toolName.toLowerCase()}.ts`,
      `src/tools/${toolName.toLowerCase()}/index.ts`,
      `src/tools/${this.kebabCase(toolName)}.ts`,
      `src/tools/${this.kebabCase(toolName)}/index.ts`,
    ];

    for (const p of possiblePaths) {
      const fullPath = path.join(this.projectRoot, p);
      if (fs.existsSync(fullPath)) {
        return p;
      }
    }

    // 搜索 src/tools 目录
    const toolsDir = path.join(this.projectRoot, 'src/tools');
    if (fs.existsSync(toolsDir)) {
      const files = fs.readdirSync(toolsDir, { recursive: true }) as string[];
      for (const file of files) {
        if (file.toString().toLowerCase().includes(toolName.toLowerCase()) &&
            (file.toString().endsWith('.ts') || file.toString().endsWith('.tsx'))) {
          return `src/tools/${file}`;
        }
      }
    }

    return undefined;
  }

  private async analyzeModules(): Promise<ModuleInfo[]> {
    console.log('📁 分析模块实现...');
    const modules: ModuleInfo[] = [];

    for (const [category, patterns] of Object.entries(OFFICIAL_MODULES)) {
      const officialPatterns: string[] = [];
      const projectPaths: string[] = [];

      // 在官方源码中搜索模式
      for (const pattern of patterns) {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(this.officialCode)) {
          officialPatterns.push(pattern);
        }
      }

      // 在项目中搜索对应目录/文件
      const srcPath = path.join(this.projectRoot, 'src');
      if (fs.existsSync(srcPath)) {
        this.findMatchingPaths(srcPath, patterns, projectPaths);
      }

      let syncStatus: ModuleInfo['syncStatus'] = 'missing';
      if (projectPaths.length > 0 && officialPatterns.length > 0) {
        syncStatus = projectPaths.length >= officialPatterns.length ? 'synced' : 'partial';
      } else if (projectPaths.length > 0 && officialPatterns.length === 0) {
        syncStatus = 'extra';
      }

      modules.push({
        name: category,
        category,
        officialPatterns,
        projectPaths: projectPaths.slice(0, 10), // 限制数量
        syncStatus,
      });
    }

    return modules;
  }

  private findMatchingPaths(dir: string, patterns: string[], results: string[], depth = 0): void {
    if (depth > 3) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.projectRoot, fullPath);

        if (entry.isDirectory()) {
          if (patterns.some(p => entry.name.toLowerCase().includes(p.toLowerCase()))) {
            results.push(relativePath);
          }
          this.findMatchingPaths(fullPath, patterns, results, depth + 1);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (patterns.some(p => entry.name.toLowerCase().includes(p.toLowerCase()))) {
            results.push(relativePath);
          }
        }
      }
    } catch (e) {
      // 忽略权限错误
    }
  }

  private generateSummary(tools: ToolInfo[], modules: ModuleInfo[]) {
    const missingTools = tools.filter(t => t.foundInOfficial && !t.foundInProject).map(t => t.name);
    const extraTools = tools.filter(t => !t.foundInOfficial && t.foundInProject).map(t => t.name);
    const partiallyImplemented = modules.filter(m => m.syncStatus === 'partial').map(m => m.name);

    return {
      totalOfficialTools: OFFICIAL_TOOLS.length,
      totalProjectTools: tools.filter(t => t.foundInProject).length,
      missingTools,
      extraTools,
      partiallyImplemented,
    };
  }

  private kebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  generateReport(report: AnalysisReport): string {
    let output = `# 官方 Claude Code 同步分析报告

**生成时间**: ${report.timestamp}
**官方版本**: ${report.officialVersion}

## 📊 摘要

| 指标 | 值 |
|------|-----|
| 官方工具总数 | ${report.summary.totalOfficialTools} |
| 项目已实现工具数 | ${report.summary.totalProjectTools} |
| 缺失工具数 | ${report.summary.missingTools.length} |
| 额外工具数 | ${report.summary.extraTools.length} |

## 🔧 工具对比

| 工具名称 | 官方有 | 项目有 | 项目路径 | 状态 |
|----------|--------|--------|----------|------|
`;

    for (const tool of report.tools) {
      const status = tool.foundInOfficial && tool.foundInProject ? '✅' :
                     tool.foundInOfficial && !tool.foundInProject ? '❌ 缺失' :
                     !tool.foundInOfficial && tool.foundInProject ? '➕ 额外' : '❓';
      output += `| ${tool.name} | ${tool.foundInOfficial ? '✓' : '✗'} | ${tool.foundInProject ? '✓' : '✗'} | ${tool.projectPath || '-'} | ${status} |\n`;
    }

    output += `
## 📁 模块对比

| 模块 | 同步状态 | 官方模式数 | 项目路径数 |
|------|----------|------------|------------|
`;

    for (const mod of report.modules) {
      const statusIcon = mod.syncStatus === 'synced' ? '✅' :
                         mod.syncStatus === 'partial' ? '⚠️' :
                         mod.syncStatus === 'missing' ? '❌' : '➕';
      output += `| ${mod.name} | ${statusIcon} ${mod.syncStatus} | ${mod.officialPatterns.length} | ${mod.projectPaths.length} |\n`;
    }

    if (report.summary.missingTools.length > 0) {
      output += `
## ❌ 缺失的工具

${report.summary.missingTools.map(t => `- ${t}`).join('\n')}
`;
    }

    if (report.summary.partiallyImplemented.length > 0) {
      output += `
## ⚠️ 部分实现的模块

${report.summary.partiallyImplemented.map(m => `- ${m}`).join('\n')}
`;
    }

    output += `
## 🔍 官方源码关键发现

以下是从官方源码中提取的一些关键上下文：

`;

    for (const tool of report.tools.slice(0, 10)) {
      if (tool.officialContext.length > 0) {
        output += `### ${tool.name}\n\`\`\`\n${tool.officialContext.slice(0, 2).join('\n')}\n\`\`\`\n\n`;
      }
    }

    return output;
  }
}

// 深度分析官方源码中的具体函数
class DeepAnalyzer {
  private officialCode: string = '';
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const officialPath = path.join(projectRoot, 'node_modules/@anthropic-ai/claude-code/cli.js');
    this.officialCode = fs.readFileSync(officialPath, 'utf8');
  }

  // 提取官方源码中的所有导出函数名
  extractExportedFunctions(): string[] {
    const patterns = [
      /export\s+(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /export\s+const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
      /export\s+class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ];

    const functions: string[] = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(this.officialCode)) !== null) {
        functions.push(match[1]);
      }
    }

    return [...new Set(functions)].sort();
  }

  // 提取特定模块的代码片段
  extractModuleCode(moduleName: string, contextSize = 500): string[] {
    const results: string[] = [];
    const regex = new RegExp(`[\\s\\S]{0,${contextSize}}${moduleName}[\\s\\S]{0,${contextSize}}`, 'gi');
    const matches = this.officialCode.match(regex) || [];

    return [...new Set(matches)].slice(0, 5);
  }

  // 分析工具的具体实现
  analyzeToolImplementation(toolName: string): {
    inputSchema: any;
    description: string;
    contexts: string[];
  } {
    const contexts = this.extractModuleCode(toolName, 300);

    // 尝试提取描述
    let description = '';
    const descMatch = this.officialCode.match(new RegExp(`${toolName}[^}]*description[:\s]*["'\`]([^"'\`]+)["'\`]`, 'i'));
    if (descMatch) {
      description = descMatch[1];
    }

    return {
      inputSchema: null, // 需要进一步解析
      description,
      contexts: contexts.slice(0, 3),
    };
  }
}

// 主函数
async function main() {
  const projectRoot = process.cwd();

  console.log('🚀 Claude Code 同步分析器\n');
  console.log('=' .repeat(50));

  const analyzer = new SyncAnalyzer(projectRoot);
  const report = await analyzer.analyze();

  // 生成报告
  const reportContent = analyzer.generateReport(report);

  // 保存报告
  const reportPath = path.join(projectRoot, 'SYNC_REPORT.md');
  fs.writeFileSync(reportPath, reportContent);
  console.log(`\n✅ 报告已保存到: ${reportPath}`);

  // 打印摘要
  console.log('\n📊 快速摘要:');
  console.log(`   官方工具: ${report.summary.totalOfficialTools}`);
  console.log(`   已实现: ${report.summary.totalProjectTools}`);
  console.log(`   缺失: ${report.summary.missingTools.length}`);
  if (report.summary.missingTools.length > 0) {
    console.log(`   缺失列表: ${report.summary.missingTools.join(', ')}`);
  }

  // 深度分析
  console.log('\n🔍 开始深度分析...');
  const deepAnalyzer = new DeepAnalyzer(projectRoot);

  // 为每个工具生成详细分析
  const toolAnalysis: Record<string, any> = {};
  for (const tool of OFFICIAL_TOOLS.slice(0, 5)) { // 先分析前5个
    toolAnalysis[tool] = deepAnalyzer.analyzeToolImplementation(tool);
  }

  // 保存详细分析
  const detailPath = path.join(projectRoot, 'SYNC_DETAIL.json');
  fs.writeFileSync(detailPath, JSON.stringify({
    report,
    toolAnalysis,
  }, null, 2));
  console.log(`   详细分析已保存到: ${detailPath}`);
}

main().catch(console.error);
