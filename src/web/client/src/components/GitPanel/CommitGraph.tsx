/**
 * CommitGraph - SVG 渲染的 Git Commit 可视化图表
 * 
 * 渲染规则（对齐 IDEA）：
 * - 同列边：一条连续竖直线
 * - 跨列边：从 fromRow 出发先走 1 行进行变道（贝塞尔曲线），然后竖直走到 toRow
 * - 节点：圆点，选中时白色描边
 */

import { GraphLayout, GRAPH_COLORS } from './graph-utils';

interface CommitGraphProps {
  layout: GraphLayout;
  commits: Array<{ hash: string }>;
  selectedHash: string | null;
  rowHeight?: number;
  onCommitClick: (hash: string) => void;
}

export function CommitGraph({
  layout,
  commits,
  selectedHash,
  rowHeight = 36,
  onCommitClick,
}: CommitGraphProps) {
  const laneWidth = 16;
  const padLeft = 12;
  const svgWidth = (layout.maxLane + 1) * laneWidth + padLeft * 2;
  const svgHeight = commits.length * rowHeight;

  function laneX(lane: number): number {
    return lane * laneWidth + padLeft;
  }

  function rowY(row: number): number {
    return row * rowHeight + rowHeight / 2;
  }

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      className="git-graph-svg"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* 渲染边 */}
      {layout.edges.map((edge, idx) => {
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
        // 变道段：从 (x1, y1) 到 (x2, y1 + rowHeight) 用贝塞尔曲线
        // 竖直段：从 (x2, y1 + rowHeight) 到 (x2, y2)
        const bendY = y1 + rowHeight; // 变道在下一行完成

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
            {/* 变道段：贝塞尔曲线 */}
            <path
              d={`M ${x1},${y1} C ${x1},${bendY} ${x2},${y1} ${x2},${bendY}`}
              stroke={color}
              strokeWidth="2"
              fill="none"
            />
            {/* 竖直段 */}
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
      {commits.map((commit, row) => {
        const node = layout.nodes.get(commit.hash);
        if (!node) return null;

        const cx = laneX(node.lane);
        const cy = rowY(row);
        const color = GRAPH_COLORS[node.color % GRAPH_COLORS.length];
        const isSelected = commit.hash === selectedHash;

        return (
          <circle
            key={`n-${commit.hash}`}
            cx={cx}
            cy={cy}
            r={isSelected ? 5 : 4}
            fill={color}
            stroke={isSelected ? '#fff' : '#0f172a'}
            strokeWidth={isSelected ? 2 : 1.5}
            onClick={() => onCommitClick(commit.hash)}
            style={{ cursor: 'pointer' }}
          />
        );
      })}
    </svg>
  );
}
