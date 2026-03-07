/**
 * Renderer - 渲染日志类
 * 负责计算帧之间的差异并生成渲染操作
 *
 * 从官方 Axon 源码逆向工程提取 (原名: zl1)
 */

import type { RenderOp, FrameData, RendererOptions, ScreenData, Position, Cell, IStylePool } from './types.js';

/**
 * 计算字符串在终端中占用的行数
 */
function countLines(str: string, columns: number): number {
  if (!str) return 0;
  const lines = str.split('\n');
  let count = 0;
  for (const line of lines) {
    // 每行至少占 1 行，超过列宽时会换行
    count += Math.max(1, Math.ceil(line.length / columns));
  }
  return count;
}

/**
 * 检测是否需要完全重绘
 */
function needsFullRedraw(prev: FrameData, next: FrameData): string | undefined {
  if (next.rows !== prev.rows || next.columns !== prev.columns) {
    return 'resize';
  }

  const prevOffscreen = prev.outputHeight >= prev.rows;
  const nextOffscreen = next.outputHeight >= next.rows;

  if (prevOffscreen || nextOffscreen) {
    return 'offscreen';
  }

  return undefined;
}

/**
 * 添加光标操作
 */
function addCursorOps(ops: RenderOp[], prev: FrameData, next: FrameData): RenderOp[] {
  // 处理光标可见性变化
  if (!next.cursorVisible && prev.cursorVisible) {
    ops.push({ type: 'cursorHide' });
  } else if (next.cursorVisible && !prev.cursorVisible) {
    ops.push({ type: 'cursorShow' });
  }
  return ops;
}

/**
 * 迭代两个屏幕之间的差异
 */
function* diffScreens(
  prev: ScreenData,
  next: ScreenData
): Generator<[Position, Cell | undefined, Cell | undefined]> {
  const height = Math.max(prev.height, next.height);
  const width = Math.max(prev.width, next.width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const prevCell = prev.cells[y]?.[x];
      const nextCell = next.cells[y]?.[x];

      // 如果两个单元格不同，返回差异
      if (!cellsEqual(prevCell, nextCell)) {
        yield [{ x, y }, prevCell, nextCell];
      }
    }
  }
}

/**
 * 比较两个单元格是否相等
 */
function cellsEqual(a: Cell | undefined, b: Cell | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.char === b.char &&
    a.styleId === b.styleId &&
    a.width === b.width &&
    a.hyperlink === b.hyperlink
  );
}

/**
 * 生成完全重绘的操作
 */
function getFullRedrawOps(next: FrameData, reason: string, stylePool: IStylePool): RenderOp[] {
  const ops: RenderOp[] = [];
  ops.push({ type: 'clearTerminal', reason });

  if (next.staticOutput) {
    ops.push({ type: 'stdout', content: next.staticOutput });
  }

  ops.push({ type: 'stdout', content: next.output });
  ops.push({ type: 'stdout', content: '\n' });

  return ops;
}

/**
 * 渲染日志类
 */
export class Renderer {
  private options: RendererOptions;
  private state: {
    fullStaticOutput: string;
    previousOutput: string;
  };

  constructor(options: RendererOptions) {
    this.options = options;
    this.state = {
      fullStaticOutput: '',
      previousOutput: '',
    };
  }

  /**
   * 渲染帧
   */
  render(prev: FrameData, next: FrameData): RenderOp[] {
    return this.options.ink2
      ? this.render_v2(prev, next)
      : this.render_v1(prev, next);
  }

  /**
   * V1 渲染 - 基础渲染模式
   */
  private render_v1(prev: FrameData, next: FrameData): RenderOp[] {
    if (this.options.debug) {
      return this.getRenderOpsDebug(next);
    }

    if (!this.options.isTTY) {
      return [{ type: 'stdout', content: next.staticOutput }];
    }

    const redrawReason = needsFullRedraw(prev, next);
    if (redrawReason) {
      return this.getFullRedrawOps(next, redrawReason);
    }

    // 无变化
    const hasStaticChange = next.staticOutput && next.staticOutput !== '\n';
    if (!hasStaticChange && next.output === prev.output) {
      return addCursorOps([], prev, next);
    }

    const ops: RenderOp[] = [
      ...this.getClearAndRenderStaticOps(prev, next),
      ...this.renderEfficiently(prev, next),
    ];

    return addCursorOps(ops, prev, next);
  }

  /**
   * V2 渲染 - 增量渲染模式（官方 ink2）
   * 只更新变化的部分，使用 blit 技术
   */
  private render_v2(prev: FrameData, next: FrameData): RenderOp[] {
    // 屏幕为空
    if (next.screen.height === 0 || next.screen.width === 0) {
      if (prev.screen.height > 0) {
        return getFullRedrawOps(next, 'clear', this.options.stylePool);
      }
      return [];
    }

    // 视口变化
    if (
      next.viewport.height < prev.viewport.height ||
      (prev.viewport.width !== 0 && next.viewport.width !== prev.viewport.width)
    ) {
      return getFullRedrawOps(next, 'resize', this.options.stylePool);
    }

    // 检查是否需要完全重绘
    const prevCursorOffscreen = prev.cursor.y >= prev.screen.height;
    const screenGrew = next.screen.height > prev.screen.height;
    const prevOverflowed = prev.screen.height > prev.viewport.height;
    const nextFits = next.screen.height < prev.viewport.height;

    if (prevOverflowed && nextFits && !screenGrew) {
      return getFullRedrawOps(next, 'offscreen', this.options.stylePool);
    }

    // 检查是否有离屏修改
    if (
      prev.screen.height >= prev.viewport.height &&
      prev.screen.height > 0 &&
      prevCursorOffscreen &&
      !screenGrew
    ) {
      const scrollOffset = prev.screen.height - prev.viewport.height + 1;
      const hasDiffsAboveViewport = [...diffScreens(prev.screen, next.screen)]
        .some(([pos]) => pos.y < scrollOffset);

      if (hasDiffsAboveViewport) {
        return getFullRedrawOps(next, 'offscreen', this.options.stylePool);
      }
    }

    // 增量渲染
    const ops: RenderOp[] = [];
    const heightDelta = Math.max(next.screen.height, 1) - Math.max(prev.screen.height, 1);
    const screenShrank = heightDelta < 0;
    const screenGrown = heightDelta > 0;

    // 屏幕缩小时清除多余行
    if (screenShrank) {
      const linesToClear = prev.screen.height - next.screen.height;
      if (linesToClear > prev.viewport.height) {
        return getFullRedrawOps(next, 'offscreen', this.options.stylePool);
      }
      ops.push({ type: 'clear', count: linesToClear });
      ops.push({ type: 'cursorMove', x: 0, y: -1 });
    }

    // 处理差异
    let currentStyles: number[] = [];
    let currentHyperlink: string | undefined;
    let currentRow = -1;

    for (const [pos, prevCell, nextCell] of diffScreens(prev.screen, next.screen)) {
      // 跳过新增行（如果屏幕增长）
      if (screenGrown && pos.y >= prev.screen.height) {
        continue;
      }

      // 跳过宽字符的第二部分
      if (nextCell && (nextCell.width === 2 || nextCell.width === 3)) {
        continue;
      }
      if (prevCell && (prevCell.width === 2 || prevCell.width === 3) && !nextCell) {
        continue;
      }

      // v2.1.69: 跨行时重置超链接状态（终端 OSC 8 不跨行持续）
      if (pos.y !== currentRow) {
        if (currentHyperlink) {
          ops.push({ type: 'hyperlink', uri: '' });
          currentHyperlink = undefined;
        }
        currentRow = pos.y;
      }

      // 移动光标
      ops.push({ type: 'cursorMove', x: pos.x, y: pos.y });

      if (nextCell) {
        // 更新样式
        const newStyles = this.options.stylePool.get(nextCell.styleId);
        if (!arraysEqual(currentStyles, newStyles)) {
          const diff = getStyleDiff(currentStyles, newStyles);
          if (diff.length > 0) {
            ops.push({ type: 'style', codes: diff });
          }
          currentStyles = newStyles;
        }

        // 更新超链接
        if (nextCell.hyperlink !== currentHyperlink) {
          if (nextCell.hyperlink) {
            ops.push({ type: 'hyperlink', uri: nextCell.hyperlink });
          } else {
            ops.push({ type: 'hyperlink', uri: '' });
          }
          currentHyperlink = nextCell.hyperlink;
        }

        // 输出字符
        ops.push({ type: 'stdout', content: nextCell.char });
      } else if (prevCell) {
        // 清除字符（用空格覆盖）
        if (currentStyles.length > 0) {
          ops.push({ type: 'style', codes: [0] });  // 重置样式
          currentStyles = [];
        }
        ops.push({ type: 'stdout', content: ' ' });
      }
    }

    // 重置样式
    if (currentStyles.length > 0) {
      const resetCodes = getStyleDiff(currentStyles, []);
      if (resetCodes.length > 0) {
        ops.push({ type: 'style', codes: resetCodes });
      }
    }

    // 重置超链接
    if (currentHyperlink !== undefined) {
      ops.push({ type: 'hyperlink', uri: '' });
    }

    // 处理新增行
    if (screenGrown) {
      // 输出新行（v2.1.69: 正确处理跨行超链接）
      for (let y = prev.screen.height; y < next.screen.height; y++) {
        ops.push({ type: 'carriageReturn' });
        ops.push({ type: 'stdout', content: '\n' });

        const row = next.screen.cells[y];
        if (row) {
          let lineHyperlink: string | undefined;
          let lineStyles: number[] = [];

          for (const cell of row) {
            if (!cell || cell.width === 3) continue;

            // 处理样式
            const cellStyles = this.options.stylePool.get(cell.styleId);
            if (!arraysEqual(lineStyles, cellStyles)) {
              const diff = getStyleDiff(lineStyles, cellStyles);
              if (diff.length > 0) {
                ops.push({ type: 'style', codes: diff });
              }
              lineStyles = cellStyles;
            }

            // 处理超链接
            if (cell.hyperlink !== lineHyperlink) {
              if (cell.hyperlink) {
                ops.push({ type: 'hyperlink', uri: cell.hyperlink });
              } else {
                ops.push({ type: 'hyperlink', uri: '' });
              }
              lineHyperlink = cell.hyperlink;
            }

            ops.push({ type: 'stdout', content: cell.char });
          }

          // 行尾关闭超链接和样式
          if (lineHyperlink) {
            ops.push({ type: 'hyperlink', uri: '' });
          }
          if (lineStyles.length > 0) {
            ops.push({ type: 'style', codes: [0] });
          }
        }
      }
    }

    // 移动光标到正确位置
    if (next.cursor.y >= next.screen.height) {
      // 光标在屏幕外，需要滚动
      const scrollAmount = next.cursor.y - next.screen.height + 1;
      ops.push({ type: 'carriageReturn' });
      for (let i = 0; i < scrollAmount; i++) {
        ops.push({ type: 'stdout', content: '\n' });
      }
    }

    return addCursorOps(ops, prev, next);
  }

  /**
   * Debug 模式渲染
   */
  private getRenderOpsDebug(next: FrameData): RenderOp[] {
    if (next.staticOutput && next.staticOutput !== '\n') {
      this.state.fullStaticOutput += next.staticOutput;
    }
    return [
      { type: 'stdout', content: this.state.fullStaticOutput },
      { type: 'stdout', content: next.output },
    ];
  }

  /**
   * 完全重绘
   */
  private getFullRedrawOps(next: FrameData, reason: string): RenderOp[] {
    if (next.staticOutput && next.staticOutput !== '\n') {
      this.state.fullStaticOutput += next.staticOutput;
    }
    this.state.previousOutput = next.output + '\n';

    return [
      { type: 'clearTerminal', reason },
      { type: 'stdout', content: this.state.fullStaticOutput },
      { type: 'stdout', content: next.output },
      { type: 'stdout', content: '\n' },
    ];
  }

  /**
   * 高效渲染（仅清除需要的行）
   */
  private renderEfficiently(prev: FrameData, next: FrameData): RenderOp[] {
    const newOutput = next.output + '\n';

    if (newOutput === this.state.previousOutput) {
      return [];
    }

    const linesToClear = this.state.previousOutput
      ? countLines(this.state.previousOutput, prev.columns)
      : 0;

    this.state.previousOutput = newOutput;

    const ops: RenderOp[] = [];
    ops.push({ type: 'clear', count: linesToClear });
    ops.push({ type: 'stdout', content: next.output });
    ops.push({ type: 'stdout', content: '\n' });

    return ops;
  }

  /**
   * 清除并渲染静态输出
   */
  private getClearAndRenderStaticOps(prev: FrameData, next: FrameData): RenderOp[] {
    if (!next.staticOutput || next.staticOutput === '\n') {
      return [];
    }

    this.state.fullStaticOutput += next.staticOutput;

    const linesToClear = this.state.previousOutput
      ? countLines(this.state.previousOutput, prev.columns)
      : 0;

    this.state.previousOutput = '';

    return [
      { type: 'clear', count: linesToClear },
      { type: 'stdout', content: next.staticOutput },
    ];
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state.previousOutput = '';
  }
}

/**
 * 比较两个数组是否相等
 */
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 计算样式差异
 * 只返回实际变化的样式代码，优化渲染性能
 */
function getStyleDiff(prev: number[], next: number[]): number[] {
  if (next.length === 0 && prev.length > 0) {
    return [0];  // 重置所有样式
  }

  // 只返回实际变化的样式
  const diff: number[] = [];
  const maxLen = Math.max(prev.length, next.length);
  for (let i = 0; i < maxLen; i++) {
    if ((prev[i] ?? 0) !== (next[i] ?? 0)) {
      diff.push(next[i] ?? 0);
    }
  }
  return diff.length > 0 ? diff : next;
}
