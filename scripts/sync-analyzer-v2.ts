/**
 * 官方 Claude Code 源码同步分析器 V2
 *
 * 更精准地分析项目实现与官方源码的差异
 */

import * as fs from 'fs';
import * as path from 'path';

// 工具映射：官方工具名 -> 项目文件和导出名
const TOOL_MAPPING: Record<string, { projectFile: string; exportName?: string; alternative?: string }> = {
  'Bash': { projectFile: 'src/tools/bash.ts', exportName: 'BashTool' },
  'BashOutput': { projectFile: 'src/tools/bash.ts', exportName: 'BashOutputTool', alternative: '可能包含在 bash.ts 中' },
  'Read': { projectFile: 'src/tools/file.ts', exportName: 'ReadTool' },
  'Write': { projectFile: 'src/tools/file.ts', exportName: 'WriteTool' },
  'Edit': { projectFile: 'src/tools/file.ts', exportName: 'EditTool', alternative: 'src/tools/multiedit.ts' },
  'MultiEdit': { projectFile: 'src/tools/multiedit.ts', exportName: 'MultiEditTool' },
  'Glob': { projectFile: 'src/tools/search.ts', exportName: 'GlobTool', alternative: 'src/tools/file.ts' },
  'Grep': { projectFile: 'src/tools/search.ts', exportName: 'GrepTool' },
  'Task': { projectFile: 'src/tools/agent.ts', exportName: 'AgentTool', alternative: 'Task 是 Agent 的别名' },
  'WebFetch': { projectFile: 'src/tools/web.ts', exportName: 'WebFetchTool' },
  'WebSearch': { projectFile: 'src/tools/web.ts', exportName: 'WebSearchTool' },
  'TodoWrite': { projectFile: 'src/tools/todo.ts', exportName: 'TodoWriteTool' },
  'NotebookEdit': { projectFile: 'src/tools/notebook.ts', exportName: 'NotebookEditTool' },
  'Mcp': { projectFile: 'src/tools/mcp.ts', exportName: 'McpTool' },
  'TaskStop': { projectFile: 'src/tools/bash.ts', exportName: 'KillShellTool' },
  'ExitPlanMode': { projectFile: 'src/tools/planmode.ts', exportName: 'ExitPlanModeTool' },
  'EnterPlanMode': { projectFile: 'src/tools/planmode.ts', exportName: 'EnterPlanModeTool' },
  'AskUserQuestion': { projectFile: 'src/tools/ask.ts', exportName: 'AskUserQuestionTool' },
  'Skill': { projectFile: 'src/tools/skill.ts', exportName: 'SkillTool' },
  'SlashCommand': { projectFile: 'src/tools/skill.ts', exportName: 'SlashCommandTool' },
  'Tmux': { projectFile: 'src/tools/tmux.ts', exportName: 'TmuxTool' },
};

// 模块映射：模块类别 -> 预期的目录和文件
const MODULE_MAPPING: Record<string, { directories: string[]; files: string[] }> = {
  'core': {
    directories: ['src/core'],
    files: ['client.ts', 'session.ts', 'loop.ts', 'conversation.ts'],
  },
  'tools': {
    directories: ['src/tools'],
    files: [],
  },
  'ui': {
    directories: ['src/ui', 'src/ui/components', 'src/ui/hooks'],
    files: [],
  },
  'auth': {
    directories: ['src/auth'],
    files: ['oauth.ts', 'apikey.ts', 'token.ts'],
  },
  'config': {
    directories: ['src/config'],
    files: ['settings.ts', 'index.ts'],
  },
  'context': {
    directories: ['src/context'],
    files: ['index.ts', 'summarization.ts'],
  },
  'hooks': {
    directories: ['src/hooks'],
    files: ['index.ts'],
  },
  'mcp': {
    directories: ['src/mcp'],
    files: ['client.ts', 'server.ts', 'index.ts'],
  },
  'permissions': {
    directories: ['src/permissions'],
    files: ['index.ts'],
  },
  'session': {
    directories: ['src/session'],
    files: ['index.ts', 'persistence.ts'],
  },
  'streaming': {
    directories: ['src/streaming'],
    files: ['message-stream.ts', 'sse.ts'],
  },
  'agents': {
    directories: ['src/agents'],
    files: [],
  },
  'git': {
    directories: ['src/git'],
    files: [],
  },
  'search': {
    directories: ['src/search'],
    files: ['ripgrep.ts'],
  },
  'parser': {
    directories: ['src/parser'],
    files: [],
  },
  'telemetry': {
    directories: ['src/telemetry'],
    files: [],
  },
  'web': {
    directories: ['src/web'],
    files: [],
  },
  'plan': {
    directories: ['src/plan'],
    files: [],
  },
  'skills': {
    directories: ['src/skills'],
    files: [],
  },
  'plugins': {
    directories: ['src/plugins'],
    files: [],
  },
  'updater': {
    directories: ['src/updater'],
    files: [],
  },
  'chrome': {
    directories: ['src/chrome', 'src/chrome-mcp'],
    files: [],
  },
  'notifications': {
    directories: ['src/notifications'],
    files: [],
  },
  'sandbox': {
    directories: ['src/sandbox'],
    files: [],
  },
  'security': {
    directories: ['src/security'],
    files: [],
  },
  'memory': {
    directories: ['src/memory'],
    files: [],
  },
};

interface ToolAnalysis {
  name: string;
  officialExists: boolean;
  projectExists: boolean;
  projectFile?: string;
  projectExports: string[];
  implementationStatus: 'full' | 'partial' | 'missing' | 'extra';
  notes: string;
}

interface ModuleAnalysis {
  name: string;
  directories: { path: string; exists: boolean; fileCount: number }[];
  status: 'full' | 'partial' | 'missing';
}

interface FunctionComparison {
  officialFunctions: string[];
  projectFunctions: string[];
  missing: string[];
  extra: string[];
}

class SyncAnalyzerV2 {
  private projectRoot: string;
  private officialCode: string = '';

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async run() {
    console.log('🚀 Claude Code 同步分析器 V2\n');
    console.log('='.repeat(60));

    // 加载官方源码
    const officialPath = path.join(this.projectRoot, 'node_modules/@anthropic-ai/claude-code/cli.js');
    this.officialCode = fs.readFileSync(officialPath, 'utf8');

    // 提取版本
    const versionMatch = this.officialCode.match(/Version:\s*([\d.]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    console.log(`\n📦 官方版本: ${version}`);
    console.log(`📊 官方源码: ${(this.officialCode.length / 1024 / 1024).toFixed(2)} MB\n`);

    // 分析工具
    console.log('=' .repeat(60));
    console.log('📋 工具分析');
    console.log('=' .repeat(60));
    const tools = this.analyzeTools();
    this.printToolsTable(tools);

    // 分析模块
    console.log('\n' + '='.repeat(60));
    console.log('📁 模块分析');
    console.log('='.repeat(60));
    const modules = this.analyzeModules();
    this.printModulesTable(modules);

    // 分析官方源码中的特定功能
    console.log('\n' + '='.repeat(60));
    console.log('🔍 官方特性分析');
    console.log('='.repeat(60));
    await this.analyzeOfficialFeatures();

    // 生成同步建议
    console.log('\n' + '='.repeat(60));
    console.log('💡 同步建议');
    console.log('='.repeat(60));
    this.generateSyncPlan(tools, modules);

    // 保存详细报告
    await this.saveDetailedReport(tools, modules);
  }

  private analyzeTools(): ToolAnalysis[] {
    const results: ToolAnalysis[] = [];

    for (const [toolName, mapping] of Object.entries(TOOL_MAPPING)) {
      const projectFilePath = path.join(this.projectRoot, mapping.projectFile);
      const projectExists = fs.existsSync(projectFilePath);

      let projectExports: string[] = [];
      if (projectExists) {
        const content = fs.readFileSync(projectFilePath, 'utf8');
        // 提取导出的类和函数
        const exportMatches = content.match(/export\s+(class|function|const)\s+(\w+)/g) || [];
        projectExports = exportMatches.map(m => m.replace(/export\s+(class|function|const)\s+/, ''));

        // 检查是否有工具定义
        const hasToolDef = content.includes(`name: '${toolName}'`) ||
                          content.includes(`name: "${toolName}"`) ||
                          content.includes(`'${toolName}'`) ||
                          content.toLowerCase().includes(toolName.toLowerCase());
      }

      // 检查官方是否存在
      const officialExists = this.officialCode.includes(`"${toolName}"`) ||
                            this.officialCode.includes(`'${toolName}'`) ||
                            this.officialCode.includes(`=${toolName}`) ||
                            new RegExp(`\\b${toolName}\\b`).test(this.officialCode);

      let implementationStatus: ToolAnalysis['implementationStatus'] = 'missing';
      if (projectExists && officialExists) {
        implementationStatus = projectExports.length > 0 ? 'full' : 'partial';
      } else if (projectExists && !officialExists) {
        implementationStatus = 'extra';
      } else if (!projectExists && officialExists) {
        implementationStatus = 'missing';
      }

      results.push({
        name: toolName,
        officialExists,
        projectExists,
        projectFile: projectExists ? mapping.projectFile : undefined,
        projectExports,
        implementationStatus,
        notes: mapping.alternative || '',
      });
    }

    return results;
  }

  private analyzeModules(): ModuleAnalysis[] {
    const results: ModuleAnalysis[] = [];

    for (const [moduleName, mapping] of Object.entries(MODULE_MAPPING)) {
      const directories: ModuleAnalysis['directories'] = [];

      for (const dir of mapping.directories) {
        const fullPath = path.join(this.projectRoot, dir);
        const exists = fs.existsSync(fullPath);
        let fileCount = 0;

        if (exists) {
          try {
            const files = fs.readdirSync(fullPath, { recursive: true }) as string[];
            fileCount = files.filter(f =>
              typeof f === 'string' &&
              (f.endsWith('.ts') || f.endsWith('.tsx'))
            ).length;
          } catch (e) {
            // ignore
          }
        }

        directories.push({ path: dir, exists, fileCount });
      }

      const existingDirs = directories.filter(d => d.exists);
      let status: ModuleAnalysis['status'] = 'missing';
      if (existingDirs.length === directories.length) {
        status = 'full';
      } else if (existingDirs.length > 0) {
        status = 'partial';
      }

      results.push({ name: moduleName, directories, status });
    }

    return results;
  }

  private async analyzeOfficialFeatures() {
    // 分析官方源码中的关键特性

    // 1. 分析 subagent 类型
    console.log('\n📌 Subagent 类型:');
    const subagentTypes = this.extractSubagentTypes();
    subagentTypes.forEach(t => console.log(`   - ${t}`));

    // 2. 分析权限模式
    console.log('\n📌 权限模式:');
    const permModes = this.extractPermissionModes();
    permModes.forEach(m => console.log(`   - ${m}`));

    // 3. 分析配置选项
    console.log('\n📌 配置选项:');
    const configOptions = this.extractConfigOptions();
    configOptions.slice(0, 15).forEach(c => console.log(`   - ${c}`));

    // 4. 分析命令行选项
    console.log('\n📌 CLI 选项:');
    const cliOptions = this.extractCLIOptions();
    cliOptions.slice(0, 15).forEach(o => console.log(`   - ${o}`));

    // 5. 分析 hook 类型
    console.log('\n📌 Hook 类型:');
    const hookTypes = this.extractHookTypes();
    hookTypes.forEach(h => console.log(`   - ${h}`));
  }

  private extractSubagentTypes(): string[] {
    const matches = this.officialCode.match(/subagent_type[:\s]*["']([^"']+)["']/gi) || [];
    const types = matches.map(m => {
      const match = m.match(/["']([^"']+)["']/);
      return match ? match[1] : '';
    }).filter(Boolean);
    return [...new Set(types)];
  }

  private extractPermissionModes(): string[] {
    const patterns = ['bypassPermissions', 'acceptEdits', 'plan', 'dangerMode'];
    return patterns.filter(p => this.officialCode.includes(p));
  }

  private extractConfigOptions(): string[] {
    const matches = this.officialCode.match(/CLAUDE_[A-Z_]+/g) || [];
    return [...new Set(matches)].sort();
  }

  private extractCLIOptions(): string[] {
    const matches = this.officialCode.match(/--[a-z-]+/g) || [];
    return [...new Set(matches)].sort();
  }

  private extractHookTypes(): string[] {
    const hookPatterns = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionStart'];
    return hookPatterns.filter(h =>
      this.officialCode.toLowerCase().includes(h.toLowerCase())
    );
  }

  private printToolsTable(tools: ToolAnalysis[]) {
    console.log('\n| 工具 | 官方 | 项目 | 状态 | 文件 |');
    console.log('|------|------|------|------|------|');

    const statusIcons = {
      'full': '✅',
      'partial': '⚠️',
      'missing': '❌',
      'extra': '➕',
    };

    for (const tool of tools) {
      const status = statusIcons[tool.implementationStatus];
      console.log(`| ${tool.name.padEnd(15)} | ${tool.officialExists ? '✓' : '✗'} | ${tool.projectExists ? '✓' : '✗'} | ${status} | ${tool.projectFile || '-'} |`);
    }

    // 统计
    const full = tools.filter(t => t.implementationStatus === 'full').length;
    const partial = tools.filter(t => t.implementationStatus === 'partial').length;
    const missing = tools.filter(t => t.implementationStatus === 'missing').length;
    const extra = tools.filter(t => t.implementationStatus === 'extra').length;

    console.log(`\n📊 统计: ✅完整 ${full} | ⚠️部分 ${partial} | ❌缺失 ${missing} | ➕额外 ${extra}`);
  }

  private printModulesTable(modules: ModuleAnalysis[]) {
    console.log('\n| 模块 | 状态 | 目录 | 文件数 |');
    console.log('|------|------|------|--------|');

    const statusIcons = {
      'full': '✅',
      'partial': '⚠️',
      'missing': '❌',
    };

    for (const mod of modules) {
      const existingDirs = mod.directories.filter(d => d.exists);
      const totalFiles = mod.directories.reduce((sum, d) => sum + d.fileCount, 0);
      console.log(`| ${mod.name.padEnd(12)} | ${statusIcons[mod.status]} | ${existingDirs.length}/${mod.directories.length} | ${totalFiles} |`);
    }
  }

  private generateSyncPlan(tools: ToolAnalysis[], modules: ModuleAnalysis[]) {
    const missingTools = tools.filter(t => t.implementationStatus === 'missing');
    const partialTools = tools.filter(t => t.implementationStatus === 'partial');
    const missingModules = modules.filter(m => m.status === 'missing');

    if (missingTools.length > 0) {
      console.log('\n🔴 需要实现的工具:');
      for (const tool of missingTools) {
        console.log(`   - ${tool.name}: 创建 ${TOOL_MAPPING[tool.name]?.projectFile}`);
      }
    }

    if (partialTools.length > 0) {
      console.log('\n🟡 需要完善的工具:');
      for (const tool of partialTools) {
        console.log(`   - ${tool.name}: 检查 ${tool.projectFile} 的实现`);
      }
    }

    if (missingModules.length > 0) {
      console.log('\n🔴 需要创建的模块:');
      for (const mod of missingModules) {
        console.log(`   - ${mod.name}: 创建 ${mod.directories.map(d => d.path).join(', ')}`);
      }
    }

    console.log('\n📋 建议的同步顺序:');
    console.log('   1. 核心工具 (Bash, Read, Write, Edit)');
    console.log('   2. 搜索工具 (Glob, Grep)');
    console.log('   3. 网络工具 (WebFetch, WebSearch)');
    console.log('   4. 辅助工具 (TodoWrite, NotebookEdit)');
    console.log('   5. 高级工具 (Task, PlanMode, Skill)');
  }

  private async saveDetailedReport(tools: ToolAnalysis[], modules: ModuleAnalysis[]) {
    const report = {
      timestamp: new Date().toISOString(),
      version: '2.1.4',
      tools,
      modules,
      officialFeatures: {
        subagentTypes: this.extractSubagentTypes(),
        permissionModes: this.extractPermissionModes(),
        configOptions: this.extractConfigOptions(),
        cliOptions: this.extractCLIOptions(),
        hookTypes: this.extractHookTypes(),
      },
    };

    const reportPath = path.join(this.projectRoot, 'SYNC_ANALYSIS.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 详细报告已保存: ${reportPath}`);

    // 生成 Markdown 报告
    const mdContent = this.generateMarkdownReport(report);
    const mdPath = path.join(this.projectRoot, 'SYNC_ANALYSIS.md');
    fs.writeFileSync(mdPath, mdContent);
    console.log(`📄 Markdown 报告: ${mdPath}`);
  }

  private generateMarkdownReport(report: any): string {
    return `# Claude Code 同步分析报告

**生成时间**: ${report.timestamp}
**官方版本**: ${report.version}

## 工具实现状态

| 工具 | 官方 | 项目 | 状态 | 项目文件 |
|------|------|------|------|----------|
${report.tools.map((t: ToolAnalysis) => {
  const status = t.implementationStatus === 'full' ? '✅' :
                 t.implementationStatus === 'partial' ? '⚠️' :
                 t.implementationStatus === 'missing' ? '❌' : '➕';
  return `| ${t.name} | ${t.officialExists ? '✓' : '✗'} | ${t.projectExists ? '✓' : '✗'} | ${status} | ${t.projectFile || '-'} |`;
}).join('\n')}

## 模块实现状态

| 模块 | 状态 | 目录数 | 文件数 |
|------|------|--------|--------|
${report.modules.map((m: ModuleAnalysis) => {
  const status = m.status === 'full' ? '✅' :
                 m.status === 'partial' ? '⚠️' : '❌';
  const existingDirs = m.directories.filter((d: any) => d.exists).length;
  const totalFiles = m.directories.reduce((sum: number, d: any) => sum + d.fileCount, 0);
  return `| ${m.name} | ${status} | ${existingDirs}/${m.directories.length} | ${totalFiles} |`;
}).join('\n')}

## 官方特性

### Subagent 类型
${report.officialFeatures.subagentTypes.map((t: string) => `- ${t}`).join('\n')}

### 权限模式
${report.officialFeatures.permissionModes.map((m: string) => `- ${m}`).join('\n')}

### Hook 类型
${report.officialFeatures.hookTypes.map((h: string) => `- ${h}`).join('\n')}

### 环境变量
${report.officialFeatures.configOptions.slice(0, 20).map((c: string) => `- ${c}`).join('\n')}

### CLI 选项
${report.officialFeatures.cliOptions.slice(0, 20).map((o: string) => `- ${o}`).join('\n')}

## 同步优先级

1. **P0 - 核心工具**: Bash, Read, Write, Edit
2. **P1 - 搜索工具**: Glob, Grep
3. **P2 - 网络工具**: WebFetch, WebSearch
4. **P3 - 辅助工具**: TodoWrite, NotebookEdit
5. **P4 - 高级工具**: Task, PlanMode, Skill

## 下一步行动

1. 对比每个工具的输入参数 schema
2. 验证工具的返回格式与官方一致
3. 检查 prompt 描述与官方一致
4. 运行集成测试验证功能
`;
  }
}

// 运行分析器
const analyzer = new SyncAnalyzerV2(process.cwd());
analyzer.run().catch(console.error);
