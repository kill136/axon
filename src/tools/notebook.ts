/**
 * NotebookEdit 工具
 * 编辑 Jupyter Notebook 单元格
 *
 * 功能特性：
 * - 支持 replace, insert, delete 三种编辑模式
 * - 自动清理单元格输出（code 类型）
 * - Jupyter notebook 格式验证
 * - 增强的错误处理和路径验证
 * - 保留单元格元数据
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from './base.js';
import type { NotebookEditInput, ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import { fromMsysPath } from '../utils/platform.js';

interface NotebookCell {
  id?: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[]; // 官方使用字符串，但 Jupyter 规范允许两种格式
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface NotebookContent {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export class NotebookEditTool extends BaseTool<NotebookEditInput, ToolResult> {
  name = 'NotebookEdit';
  description = 'Replace the contents of a specific cell in a Jupyter notebook.';

  /**
   * 获取详细的工具提示词
   * 官方 Axon 的 prompt 方法实现
   */
  async prompt(): Promise<string> {
    return 'Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.';
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        notebook_path: {
          type: 'string',
          description: 'The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)',
        },
        cell_id: {
          type: 'string',
          description: 'The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.',
        },
        new_source: {
          type: 'string',
          description: 'The new source for the cell',
        },
        cell_type: {
          type: 'string',
          enum: ['code', 'markdown'],
          description: 'The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.',
        },
        edit_mode: {
          type: 'string',
          enum: ['replace', 'insert', 'delete'],
          description: 'The type of edit to make (replace, insert, delete). Defaults to replace.',
        },
      },
      required: ['notebook_path', 'new_source'],
    };
  }

  async execute(input: NotebookEditInput): Promise<ToolResult> {
    const { notebook_path: rawNotebookPath, cell_id, new_source, cell_type, edit_mode = 'replace' } = input;
    const notebook_path = fromMsysPath(rawNotebookPath);

    try {
      // 验证路径是否为绝对路径
      if (!path.isAbsolute(notebook_path)) {
        return {
          success: false,
          error: `notebook_path must be an absolute path, got: ${notebook_path}`,
        };
      }

      // 检查文件是否存在
      if (!fs.existsSync(notebook_path)) {
        return {
          success: false,
          error: t('notebook.notFound', { path: notebook_path }),
        };
      }

      // 检查是否是文件（不是目录）
      const stats = fs.statSync(notebook_path);
      if (!stats.isFile()) {
        return {
          success: false,
          error: t('notebook.notFile', { path: notebook_path }),
        };
      }

      // 检查文件扩展名
      if (!notebook_path.endsWith('.ipynb')) {
        return {
          success: false,
          error: t('notebook.invalidExt', { ext: path.extname(notebook_path) }),
        };
      }

      // 读取并解析 notebook
      const content = fs.readFileSync(notebook_path, 'utf-8');
      let notebook: NotebookContent;

      try {
        notebook = JSON.parse(content);
      } catch (parseError) {
        return {
          success: false,
          error: t('notebook.parseError', { error: parseError instanceof Error ? parseError.message : String(parseError) }),
        };
      }

      // 验证 notebook 格式
      const validationError = this.validateNotebookFormat(notebook);
      if (validationError) {
        return { success: false, error: validationError };
      }

      // 找到目标单元格索引
      // 官方行为：未指定 cell_id 时，cellIndex 默认为 0
      let cellIndex: number;
      if (!cell_id) {
        cellIndex = 0;
      } else {
        cellIndex = this.findCellIndex(notebook.cells, cell_id);

        // 如果按 ID 找不到，对于非 insert 模式报错
        if (cellIndex === -1) {
          if (edit_mode !== 'insert') {
            return {
              success: false,
              error: t('notebook.cellNotFoundById', { id: cell_id, count: String(notebook.cells.length) }),
            };
          }
          // insert 模式下找不到 cell_id，也应该报错（与官方行为一致）
          return {
            success: false,
            error: t('notebook.cellNotFound', { id: cell_id }),
          };
        }

        // insert 模式：在找到的单元格之后插入
        if (edit_mode === 'insert') {
          cellIndex = cellIndex + 1;
        }
      }

      // delete 模式必须指定 cell_id
      if (edit_mode === 'delete' && !cell_id) {
        return {
          success: false,
          error: t('notebook.cellIdRequired'),
        };
      }

      // 执行编辑操作
      let resultMessage = '';
      let actualEditMode = edit_mode;
      let generatedCellId: string | undefined;

      // 特殊处理：如果 replace 的索引超出范围，自动转为 insert
      if (actualEditMode === 'replace' && cellIndex >= notebook.cells.length) {
        actualEditMode = 'insert';
        if (!cell_type) {
          // 如果没有指定 cell_type，默认为 code
          input.cell_type = 'code';
        }
      }

      switch (actualEditMode) {
        case 'replace': {
          if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
            return {
              success: false,
              error: t('notebook.cellOutOfRange', { index: String(cellIndex), count: String(notebook.cells.length) }),
            };
          }

          const cell = notebook.cells[cellIndex];
          const oldType = cell.cell_type;

          // 更新源代码（官方使用字符串，而非数组）
          cell.source = new_source;

          // 如果指定了 cell_type，更新类型
          if (cell_type) {
            cell.cell_type = cell_type;
          }

          // 清除输出（对于 code 单元格）
          this.clearCellOutputs(cell);

          // 保留原有的 cell ID（如果存在）
          generatedCellId = cell.id;

          resultMessage = `Replaced cell ${cellIndex}${oldType !== cell.cell_type ? ` (changed type from ${oldType} to ${cell.cell_type})` : ''}`;
          break;
        }

        case 'insert': {
          const finalCellType = cell_type || 'code';

          const newCell: NotebookCell = {
            cell_type: finalCellType,
            source: new_source,
            metadata: {},
          };

          // 初始化 code 单元格的输出
          if (finalCellType === 'code') {
            newCell.outputs = [];
            newCell.execution_count = null;
          }

          // 只在 nbformat 4.5+ 生成 ID
          if (
            notebook.nbformat > 4 ||
            (notebook.nbformat === 4 && notebook.nbformat_minor >= 5)
          ) {
            newCell.id = this.generateCellId();
            generatedCellId = newCell.id;
          }

          // 确定插入位置
          // cellIndex 现在总是有效值（>= 0），因为在前面已经验证过了
          notebook.cells.splice(cellIndex, 0, newCell);

          resultMessage = `Inserted new ${finalCellType} cell at position ${cellIndex}`;
          break;
        }

        case 'delete': {
          if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
            return {
              success: false,
              error: t('notebook.cellOutOfRange', { index: String(cellIndex), count: String(notebook.cells.length) }),
            };
          }

          const deletedCell = notebook.cells[cellIndex];
          notebook.cells.splice(cellIndex, 1);

          resultMessage = `Deleted ${deletedCell.cell_type} cell at position ${cellIndex} (${notebook.cells.length} cells remaining)`;
          break;
        }

        default:
          return {
            success: false,
            error: t('notebook.invalidEditMode', { mode: edit_mode }),
          };
      }

      // 写回文件（使用美化的 JSON 格式，与官方一致：缩进 1 空格）
      fs.writeFileSync(notebook_path, JSON.stringify(notebook, null, 1) + '\n', 'utf-8');

      return {
        success: true,
        output: `${resultMessage} in ${path.basename(notebook_path)}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: t('notebook.editError', { error: errorMessage }),
      };
    }
  }

  /**
   * 验证 Jupyter notebook 格式
   */
  private validateNotebookFormat(notebook: any): string | null {
    // 检查必需字段
    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return t('notebook.invalidStructure', { detail: 'missing or invalid cells array' });
    }

    if (typeof notebook.nbformat !== 'number') {
      return t('notebook.invalidStructure', { detail: 'missing or invalid nbformat' });
    }

    if (typeof notebook.nbformat_minor !== 'number') {
      return t('notebook.invalidStructure', { detail: 'missing or invalid nbformat_minor' });
    }

    // 验证 nbformat 版本（支持 v4.x）
    if (notebook.nbformat < 4) {
      return `Unsupported notebook format version: ${notebook.nbformat}.${notebook.nbformat_minor} (only v4.x is supported)`;
    }

    if (notebook.nbformat > 4) {
      // 警告但不阻止（未来版本可能兼容）
      console.warn(`Warning: Notebook format v${notebook.nbformat}.${notebook.nbformat_minor} is newer than expected (v4.x)`);
    }

    // 验证 metadata
    if (!notebook.metadata || typeof notebook.metadata !== 'object') {
      return t('notebook.invalidStructure', { detail: 'missing or invalid metadata' });
    }

    // 验证每个单元格的基本结构
    for (let i = 0; i < notebook.cells.length; i++) {
      const cell = notebook.cells[i];

      if (!cell.cell_type || typeof cell.cell_type !== 'string') {
        return `Invalid cell at index ${i}: missing or invalid cell_type`;
      }

      if (!['code', 'markdown', 'raw'].includes(cell.cell_type)) {
        return `Invalid cell at index ${i}: unknown cell_type '${cell.cell_type}'`;
      }

      if (cell.source === undefined) {
        return `Invalid cell at index ${i}: missing source`;
      }

      // code 单元格必须有 outputs 和 execution_count
      if (cell.cell_type === 'code') {
        if (!Array.isArray(cell.outputs)) {
          // 自动修复：添加空输出数组
          cell.outputs = [];
        }
        if (cell.execution_count === undefined) {
          cell.execution_count = null;
        }
      }
    }

    return null;
  }

  /**
   * 查找单元格索引
   * 支持按 ID 或数字索引查找
   */
  private findCellIndex(cells: NotebookCell[], cellId: string): number {
    // 首先尝试按 ID 精确匹配
    const indexById = cells.findIndex((c) => c.id === cellId);
    if (indexById !== -1) {
      return indexById;
    }

    // 尝试解析为数字索引
    const numIndex = parseInt(cellId, 10);
    if (!isNaN(numIndex)) {
      // 支持负数索引（从末尾开始）
      if (numIndex < 0) {
        const positiveIndex = cells.length + numIndex;
        if (positiveIndex >= 0 && positiveIndex < cells.length) {
          return positiveIndex;
        }
      } else if (numIndex >= 0 && numIndex < cells.length) {
        return numIndex;
      }
    }

    return -1;
  }

  /**
   * 清除单元格输出
   * 仅对 code 类型的单元格生效
   */
  private clearCellOutputs(cell: NotebookCell): void {
    if (cell.cell_type === 'code') {
      cell.outputs = [];
      cell.execution_count = null;
    }
  }

  /**
   * 生成唯一的单元格 ID
   * 格式：8位随机字母数字字符串
   */
  private generateCellId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }
}
