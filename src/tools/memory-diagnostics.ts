/**
 * MemoryDiagnostics 工具
 * 展示 3 套记忆系统的状态信息
 */

import * as fsModule from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getNotebookManager } from '../memory/notebook.js';
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

  description = 'Diagnose and display the status of all 3 memory systems: ' +
    '(1) Notebook, (2) LongTermStore/SQLite, (3) Session Memory.';

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
        const store = await LongTermStore.create(dbPath);
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
