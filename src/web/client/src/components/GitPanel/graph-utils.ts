/**
 * Commit Graph 布局算法
 * 实现 lane assignment 和连线计算
 */

// 颜色调色板（8色）
export const GRAPH_COLORS = [
  '#6366f1', // 紫
  '#10b981', // 绿
  '#f59e0b', // 橙
  '#ef4444', // 红
  '#0ea5e9', // 蓝
  '#ec4899', // 粉
  '#8b5cf6', // 浅紫
  '#14b8a6', // 青
];

export interface GraphNode {
  hash: string;
  lane: number;       // 此 commit 所在列
  color: number;      // 颜色索引
}

export interface GraphEdge {
  fromHash: string;
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: number;
}

export interface GraphLayout {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  maxLane: number;    // 最大列数（用于确定 SVG 宽度）
}

/**
 * 计算 commit graph 布局
 * @param commits 按时间倒序排列的 commit 列表
 * @returns GraphLayout
 */
export function computeGraphLayout(commits: Array<{hash: string; parents: string[]}>): GraphLayout {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  
  // activeLanes 映射 hash -> lane，表示某个 commit 预定使用的 lane
  const activeLanes = new Map<string, number>();
  
  // laneColors 映射 lane -> color index
  const laneColors = new Map<number, number>();
  
  let nextLane = 0;
  let nextColor = 0;
  let maxLane = 0;
  
  commits.forEach((commit, row) => {
    let currentLane: number;
    let currentColor: number;
    
    // 如果当前 commit 已经在 activeLanes 中（被之前的 commit 的 parent 引用），使用该 lane
    if (activeLanes.has(commit.hash)) {
      currentLane = activeLanes.get(commit.hash)!;
      currentColor = laneColors.get(currentLane) || 0;
      // 从 activeLanes 中移除（因为已经到达这个 commit）
      activeLanes.delete(commit.hash);
    } else {
      // 否则分配新 lane
      currentLane = nextLane++;
      currentColor = nextColor % GRAPH_COLORS.length;
      nextColor++;
      laneColors.set(currentLane, currentColor);
    }
    
    maxLane = Math.max(maxLane, currentLane);
    
    // 记录当前节点
    nodes.set(commit.hash, {
      hash: commit.hash,
      lane: currentLane,
      color: currentColor,
    });
    
    // 处理 parents
    commit.parents.forEach((parentHash, idx) => {
      let targetLane: number;
      let targetColor: number;
      
      if (activeLanes.has(parentHash)) {
        // parent 已经有预定的 lane
        targetLane = activeLanes.get(parentHash)!;
        targetColor = laneColors.get(targetLane) || currentColor;
      } else {
        // 第一个 parent 继续使用当前 lane（直线向下）
        if (idx === 0 && commit.parents.length === 1) {
          targetLane = currentLane;
          targetColor = currentColor;
        } else {
          // 其他 parent 分配新 lane
          targetLane = nextLane++;
          targetColor = nextColor % GRAPH_COLORS.length;
          nextColor++;
          laneColors.set(targetLane, targetColor);
        }
        activeLanes.set(parentHash, targetLane);
        maxLane = Math.max(maxLane, targetLane);
      }
      
      // 找到 parent 的 row（如果在当前列表中）
      const parentRow = commits.findIndex(c => c.hash === parentHash);
      
      if (parentRow !== -1) {
        // 添加边
        edges.push({
          fromHash: commit.hash,
          fromLane: currentLane,
          fromRow: row,
          toLane: targetLane,
          toRow: parentRow,
          color: currentColor,
        });
      }
    });
    
    // 如果当前 commit 没有 parent，释放其 lane
    if (commit.parents.length === 0) {
      // 这个 lane 不再使用
    }
  });
  
  return {
    nodes,
    edges,
    maxLane,
  };
}
