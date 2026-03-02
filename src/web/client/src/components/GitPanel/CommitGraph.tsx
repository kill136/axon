/**
 * CommitGraph - SVG 渲染的 Git Commit 可视化图表
 * 使用 graph-utils 的布局算法渲染节点和边
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
  const svgWidth = (layout.maxLane + 1) * 20 + 20; // 每列 20px，左右各 10px 边距
  const svgHeight = commits.length * rowHeight;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      className="git-graph-svg"
      style={{ display: 'block' }}
    >
      {/* 先渲染所有边（edges），这样节点会在线条上方 */}
      {layout.edges.map((edge, idx) => {
        const x1 = edge.fromLane * 20 + 20;
        const y1 = edge.fromRow * rowHeight + rowHeight / 2;
        const x2 = edge.toLane * 20 + 20;
        const y2 = edge.toRow * rowHeight + rowHeight / 2;

        const color = GRAPH_COLORS[edge.color % GRAPH_COLORS.length];

        // 如果在同一列，用直线
        if (edge.fromLane === edge.toLane) {
          return (
            <line
              key={`edge-${idx}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth="2"
              fill="none"
            />
          );
        }

        // 否则用三次贝塞尔曲线
        const midY = (y1 + y2) / 2;
        const pathD = `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;

        return (
          <path
            key={`edge-${idx}`}
            d={pathD}
            stroke={color}
            strokeWidth="2"
            fill="none"
          />
        );
      })}

      {/* 后渲染所有节点（nodes），确保在线条上方 */}
      {commits.map((commit, row) => {
        const node = layout.nodes.get(commit.hash);
        if (!node) return null;

        const cx = node.lane * 20 + 20;
        const cy = row * rowHeight + rowHeight / 2;
        const color = GRAPH_COLORS[node.color % GRAPH_COLORS.length];

        const isSelected = commit.hash === selectedHash;

        return (
          <circle
            key={`node-${commit.hash}`}
            cx={cx}
            cy={cy}
            r="4"
            fill={color}
            stroke={isSelected ? 'white' : undefined}
            strokeWidth={isSelected ? '2' : undefined}
            onClick={() => onCommitClick(commit.hash)}
            style={{ cursor: 'pointer' }}
          />
        );
      })}
    </svg>
  );
}
