/**
 * CommitGraph - SVG 渲染的 Git Commit 可视化图表
 * 
 * 支持虚拟化：只渲染 startIndex ~ endIndex 范围内的节点和边
 * 
 * 渲染规则（对齐 IDEA）：
 * - 同列边：一条连续竖直线
 * - 跨列边：从 fromRow 出发先走 1 行进行变道（贝塞尔曲线），然后竖直走到 toRow
 * - 节点：圆点，选中时白色描边
 */

import { useMemo } from 'react';
import { GraphLayout, GRAPH_COLORS } from './graph-utils';

interface CommitGraphProps {
  layout: GraphLayout;
  commits: Array<{ hash: string }>;
  selectedHash: string | null;
  rowHeight?: number;
  onCommitClick: (hash: string) => void;
  startIndex?: number;
  endIndex?: number;
}

export function CommitGraph({
  layout,
  commits,
  selectedHash,
  rowHeight = 36,
  onCommitClick,
  startIndex = 0,
  endIndex = commits.length,
}: CommitGraphProps) {
  const laneWidth = 16;
  const padLeft = 12;
  const svgWidth = (layout.maxLane + 1) * laneWidth + padLeft * 2;
  const totalHeight = commits.length * rowHeight;

  function laneX(lane: number): number {
    return lane * laneWidth + padLeft;
  }

  function rowY(row: number): number {
    return row * rowHeight + rowHeight / 2;
  }

  // 过滤出可见范围内的边和节点
  const visibleEdges = useMemo(() => {
    return layout.edges.filter(edge => {
      // 边的任一端在可见范围内，或者边跨越可见范围
      const minRow = Math.min(edge.fromRow, edge.toRow);
      const maxRow = Math.max(edge.fromRow, edge.toRow);
      return maxRow >= startIndex && minRow <= endIndex;
    });
  }, [layout.edges, startIndex, endIndex]);

  const visibleNodes = useMemo(() => {
    const nodes: Array<{ hash: string; row: number }> = [];
    for (let i = startIndex; i < endIndex && i < commits.length; i++) {
      nodes.push({ hash: commits[i].hash, row: i });
    }
    return nodes;
  }, [commits, startIndex, endIndex]);

  return (
    <svg
      width={svgWidth}
      height={totalHeight}
      className="git-graph-svg"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* 渲染边 */}
      {visibleEdges.map((edge, idx) => {
        const x1 = laneX(edge.fromLane);
        const y1 = rowY(edge.fromRow);
        const x2 = laneX(edge.toLane);
        const y2 = rowY(edge.toRow);
        const color = GRAPH_COLORS[edge.color % GRAPH_COLORS.length];

        if (edge.fromLane === edge.toLane) {
          // 同列：直线
          return (
            <line
              key={`e-${idx}`}
              x1={x1} y1={y1}
              x2={x2} y2={y2}
              stroke={color}
              strokeWidth="2"
            />
          );
        }

        // 跨列：先变道到目标列（1行内完成），再竖直走到 parent
        const bendY = y1 + rowHeight;

        if (bendY >= y2) {
          // parent 就在下一行或更近，直接一条贝塞尔
          const midY = (y1 + y2) / 2;
          return (
            <path
              key={`e-${idx}`}
              d={`M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`}
              stroke={color}
              strokeWidth="2"
              fill="none"
            />
          );
        }

        // 变道 + 竖直线
        return (
          <g key={`e-${idx}`}>
            <path
              d={`M ${x1},${y1} C ${x1},${bendY} ${x2},${y1} ${x2},${bendY}`}
              stroke={color}
              strokeWidth="2"
              fill="none"
            />
            <line
              x1={x2} y1={bendY}
              x2={x2} y2={y2}
              stroke={color}
              strokeWidth="2"
            />
          </g>
        );
      })}

      {/* 渲染节点 */}
      {visibleNodes.map(({ hash, row }) => {
        const node = layout.nodes.get(hash);
        if (!node) return null;

        const cx = laneX(node.lane);
        const cy = rowY(row);
        const color = GRAPH_COLORS[node.color % GRAPH_COLORS.length];
        const isSelected = hash === selectedHash;

        return (
          <circle
            key={`n-${hash}`}
            cx={cx}
            cy={cy}
            r={isSelected ? 5 : 4}
            fill={color}
            stroke={isSelected ? '#fff' : '#0f172a'}
            strokeWidth={isSelected ? 2 : 1.5}
            onClick={() => onCommitClick(hash)}
            style={{ cursor: 'pointer' }}
          />
        );
      })}
    </svg>
  );
}
