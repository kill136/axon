/**
 * CommitGraph - GitLens 风格的行内 SVG Commit Graph
 * 
 * 每一行渲染一个 commit 的 graph cell：
 * - 穿越线（pass-through）：竖直彩色线
 * - 节点：merge commit 空心圆 ⊙，普通 commit 实心圆 ●
 * - 连接线：parent 在同列走直线，跨列走贝塞尔曲线
 */

import { useMemo } from 'react';
import { GraphLayout, GraphNode, GRAPH_COLORS, PassThrough } from './graph-utils';

interface CommitGraphCellProps {
  layout: GraphLayout;
  commitHash: string;
  row: number;
  rowHeight: number;
  isSelected: boolean;
  laneWidth: number;
  padLeft: number;
}

/**
 * 单行的 graph cell，渲染在 commit 行左侧
 */
export function CommitGraphCell({
  layout,
  commitHash,
  row,
  rowHeight,
  isSelected,
  laneWidth,
  padLeft,
}: CommitGraphCellProps) {
  const node = layout.nodes.get(commitHash);
  if (!node) return null;

  const svgWidth = (layout.maxLane + 1) * laneWidth + padLeft * 2;
  const midY = rowHeight / 2;

  function laneX(lane: number): number {
    return lane * laneWidth + padLeft;
  }

  // 当前行的穿越线
  const rowPassThroughs = layout.passThroughs.get(row) || [];
  
  // 找出所有从当前行出发的边（fromRow === row）
  const outEdges = useMemo(() => {
    return layout.edges.filter(e => e.fromRow === row);
  }, [layout.edges, row]);

  // 找出所有到达当前行的边（toRow === row）
  const inEdges = useMemo(() => {
    return layout.edges.filter(e => e.toRow === row);
  }, [layout.edges, row]);

  const nodeColor = GRAPH_COLORS[node.color % GRAPH_COLORS.length];

  return (
    <svg
      width={svgWidth}
      height={rowHeight}
      className="git-graph-cell-svg"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* 1. 穿越线（竖直线穿过整行） */}
      {rowPassThroughs.map((pt, i) => {
        const x = laneX(pt.lane);
        const color = GRAPH_COLORS[pt.color % GRAPH_COLORS.length];
        return (
          <line
            key={`pt-${i}`}
            x1={x} y1={0}
            x2={x} y2={rowHeight}
            stroke={color}
            strokeWidth="2"
            opacity={0.7}
          />
        );
      })}

      {/* 2. 出边：从节点向下连接 */}
      {outEdges.map((edge, idx) => {
        const x1 = laneX(edge.fromLane);
        const color = GRAPH_COLORS[edge.color % GRAPH_COLORS.length];

        if (edge.fromLane === edge.toLane) {
          // 同列：从节点中心到行底
          return (
            <line
              key={`out-${idx}`}
              x1={x1} y1={midY}
              x2={x1} y2={rowHeight}
              stroke={color}
              strokeWidth="2"
            />
          );
        }

        // 跨列：从节点中心向下开始变道
        const x2 = laneX(edge.toLane);
        // 一行内完成变道：贝塞尔曲线从节点到行底偏移列
        return (
          <path
            key={`out-${idx}`}
            d={`M ${x1},${midY} C ${x1},${rowHeight} ${x2},${midY} ${x2},${rowHeight}`}
            stroke={color}
            strokeWidth="2"
            fill="none"
          />
        );
      })}

      {/* 3. 入边：从行顶连接到节点 */}
      {inEdges.map((edge, idx) => {
        const x2 = laneX(edge.toLane);
        const color = GRAPH_COLORS[edge.color % GRAPH_COLORS.length];

        if (edge.fromLane === edge.toLane) {
          // 同列：从行顶到节点中心
          return (
            <line
              key={`in-${idx}`}
              x1={x2} y1={0}
              x2={x2} y2={midY}
              stroke={color}
              strokeWidth="2"
            />
          );
        }

        // 跨列：从行顶变道到节点
        const x1 = laneX(edge.fromLane);
        return (
          <path
            key={`in-${idx}`}
            d={`M ${x1},${0} C ${x1},${midY} ${x2},${0} ${x2},${midY}`}
            stroke={color}
            strokeWidth="2"
            fill="none"
          />
        );
      })}

      {/* 4. 节点圆圈 */}
      {node.isMerge ? (
        // Merge commit：空心圆 ⊙
        <circle
          cx={laneX(node.lane)}
          cy={midY}
          r={isSelected ? 5.5 : 4.5}
          fill="var(--bg-primary, #0d1117)"
          stroke={nodeColor}
          strokeWidth={isSelected ? 3 : 2.5}
          style={{ cursor: 'pointer' }}
        />
      ) : (
        // 普通 commit：实心圆 ●
        <circle
          cx={laneX(node.lane)}
          cy={midY}
          r={isSelected ? 5 : 4}
          fill={nodeColor}
          stroke={isSelected ? '#fff' : 'var(--bg-primary, #0d1117)'}
          strokeWidth={isSelected ? 2 : 1.5}
          style={{ cursor: 'pointer' }}
        />
      )}
    </svg>
  );
}

/**
 * 兼容旧接口的完整 graph（不再使用，保留以防引用）
 */
export function CommitGraph({
  layout,
  commits,
  selectedHash,
  rowHeight = 36,
  onCommitClick,
  startIndex = 0,
  endIndex,
}: {
  layout: GraphLayout;
  commits: Array<{ hash: string }>;
  selectedHash: string | null;
  rowHeight?: number;
  onCommitClick: (hash: string) => void;
  startIndex?: number;
  endIndex?: number;
}) {
  const end = endIndex ?? commits.length;
  const laneWidth = 16;
  const padLeft = 12;

  return (
    <div style={{ position: 'relative' }}>
      {commits.slice(startIndex, end).map((commit, i) => {
        const row = startIndex + i;
        return (
          <div key={commit.hash} onClick={() => onCommitClick(commit.hash)}>
            <CommitGraphCell
              layout={layout}
              commitHash={commit.hash}
              row={row}
              rowHeight={rowHeight}
              isSelected={commit.hash === selectedHash}
              laneWidth={laneWidth}
              padLeft={padLeft}
            />
          </div>
        );
      })}
    </div>
  );
}
