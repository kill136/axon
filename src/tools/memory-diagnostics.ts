/**
 * MemoryDiagnostics 工具
 * 展示 6 套记忆系统的状态信息
 */

import * as fsModule from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getNotebookManager } from '../memory/notebook.js';
import { getMemoryManager } from '../memory/index.js';
import { getMemoryFilePath } from '../memory/agent-memory.js';
import { LongTermStore } from '../memory/long-term-store.js';
import { estimateTokens } from '../utils/token-estimate.js';

export interface MemoryDiagnosticsInput {
  action: 'status';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function hashProjectPath(projectPath: string): string {
  return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
}

export class MemoryDiagnosticsTool extends BaseTool<MemoryDiagnosticsInput, ToolResult> {
  name = 'MemoryDiagnostics';

  description = 'Diagnose and display the status of all 6 memory systems: ' +
    '(1) Notebook, (2) LongTermStore/SQLite, (3) Session Memory, ' +
    '(4) MEMORY.md scopes, (5) LinkMemory, (6) MemoryManager/KV.';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status'], description: 'Action: status' },
      },
      required: ['action'],
    };
  }

  async execute(_input: MemoryDiagnosticsInput): Promise<ToolResult> {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const projectDir = process.cwd();
    const rows: string[] = [];

    // 1. Notebook
    try {
      const nb = getNotebookManager();
      if (nb) {
        const stats = nb.getStats();
        rows.push('| **Notebook/experience.md** | ' + (stats.experience.exists ? '✅' : '❌') + ' | ' + stats.experience.tokens + ' tokens | ' + stats.experience.path + ' |');
        rows.push('| **Notebook/project.md** | ' + (stats.project.exists ? '✅' : '❌') + ' | ' + stats.project.tokens + ' tokens | ' + stats.project.path + ' |');
      } else {
        rows.push('| **Notebook** | ⚠️ not initialized | - | - |');
      }
    } catch (e) {
      rows.push('| **Notebook** | ❌ error | ' + String(e) + ' | - |');
    }

    // 2. LongTermStore
    try {
      const projectHash = hashProjectPath(projectDir);
      const dbPath = path.join(claudeDir, 'memory', 'projects', projectHash, 'ltm.sqlite');
      if (fsModule.existsSync(dbPath)) {
        const store = new LongTermStore(dbPath);
        const stats = store.getStats();
        store.close();
        rows.push('| **LongTermStore (SQLite)** | ✅ | ' + stats.totalFiles + ' files, ' + stats.totalChunks + ' chunks | ' + formatBytes(stats.dbSizeBytes) + ' |');
      } else {
        rows.push('| **LongTermStore (SQLite)** | ❌ not found | - | ' + dbPath + ' |');
      }
    } catch (e) {
      rows.push('| **LongTermStore (SQLite)** | ❌ error | ' + String(e) + ' | - |');
    }

    // 3. Session Memory
    try {
      const sessionId = process.env.CLAUDE_CODE_SESSION_ID || 'unknown';
      const memBaseDir = path.join(claudeDir, 'projects');
      let found = false;
      if (fsModule.existsSync(memBaseDir)) {
        const pDirs = fsModule.readdirSync(memBaseDir);
        for (const pDir of pDirs) {
          const sf = path.join(memBaseDir, pDir, sessionId, 'session-memory', 'summary.md');
          if (fsModule.existsSync(sf)) {
            const stat = fsModule.statSync(sf);
            const fc = fsModule.readFileSync(sf, 'utf-8');
            const tokens = estimateTokens(fc);
            rows.push('| **Session Memory** | ✅ | ' + tokens + ' tokens | ' + formatBytes(stat.size) + ' |');
            found = true;
            break;
          }
        }
      }
      if (!found) {
        rows.push('| **Session Memory** | ❌ not found | - | session: ' + sessionId + ' |');
      }
    } catch (e) {
      rows.push('| **Session Memory** | ❌ error | ' + String(e) + ' | - |');
    }

    // 4. MEMORY.md
    const memScopes: Array<{ label: string; scope: 'user' | 'project' | 'local' }> = [
      { label: 'User', scope: 'user' },
      { label: 'Project', scope: 'project' },
      { label: 'Local', scope: 'local' },
    ];
    for (const { label, scope } of memScopes) {
      try {
        const fp = getMemoryFilePath('default', scope);
        if (fsModule.existsSync(fp)) {
          const fc = fsModule.readFileSync(fp, 'utf-8');
          const lc = fc.split('\n').length;
          rows.push('| **MEMORY.md (' + label + ')** | ✅ | ' + lc + ' lines | ' + fp + ' |');
        } else {
          rows.push('| **MEMORY.md (' + label + ')** | ❌ not found | - | ' + fp + ' |');
        }
      } catch (e) {
        rows.push('| **MEMORY.md (' + label + ')** | ❌ error | ' + String(e) + ' | - |');
      }
    }

    // 5. LinkMemory
    try {
      const lf: Array<[string, string]> = [
        ['Project', path.join(projectDir, '.claude', 'memory', 'links.json')],
        ['Global', path.join(claudeDir, 'memory', 'links.json')],
      ];
      for (const [label, lp] of lf) {
        if (fsModule.existsSync(lp)) {
          const stat = fsModule.statSync(lp);
          rows.push('| **LinkMemory (' + label + ')** | ✅ | - | ' + formatBytes(stat.size) + ' |');
        } else {
          rows.push('| **LinkMemory (' + label + ')** | ❌ not found | - | ' + lp + ' |');
        }
      }
    } catch (e) {
      rows.push('| **LinkMemory** | ❌ error | ' + String(e) + ' | - |');
    }

    // 6. MemoryManager
    try {
      const mm = getMemoryManager(projectDir);
      const all = mm.list();
      const gl = mm.list('global');
      const pr = mm.list('project');
      rows.push('| **MemoryManager (KV)** | ✅ | ' + all.length + ' entries (global: ' + gl.length + ', project: ' + pr.length + ') | - |');
    } catch (e) {
      rows.push('| **MemoryManager (KV)** | ❌ error | ' + String(e) + ' | - |');
    }

    const out = [
      '## Memory System Diagnostics',
      '',
      '**Project:** `' + projectDir + '`',
      '**Session:** `' + (process.env.CLAUDE_CODE_SESSION_ID || 'unknown') + '`',
      '',
      '| System | Status | Details | Size/Path |',
      '|--------|--------|---------|-----------|',
      ...rows,
    ];

    return this.success(out.join('\n'));
  }
}