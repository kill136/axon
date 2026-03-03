/**
 * Commit Graph 布局算法
 * 实现 lane assignment 和连线计算
 * 
 * 核心原则：
 * 1. 每个 commit 占据一个 lane（列）
 * 2. 第一个 parent 尽量继承当前 lane（直线向下）
 * 3. 其他 parent（merge 来源）分配新 lane
 * 4. 当 child→parent 跨多行时，中间行需要画穿越线（pass-through）
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
  row: number;        // 行号
}

export interface GraphEdge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: number;
}

export interface GraphLayout {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  maxLane: number;
}

/**
 * 计算 commit graph 布局
 * @param commits 按时间倒序排列的 commit 列表（最新在前）
 */
export function computeGraphLayout(commits: Array<{hash: string; parents: string[]}>): GraphLayout {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  
  // 预建 hash→row 索引
  const hashToRow = new Map<string, number>();
  commits.forEach((c, i) => hashToRow.set(c.hash, i));
  
  // lanes[i] = 第 i 列当前被哪个 hash 预定（等待该 hash 出现时占据此列）
  // 用数组模拟，null 表示空闲
  const lanes: (string | null)[] = [];
  
  // lane → color index
  const laneColors: number[] = [];
  let nextColor = 0;
  
  /**
   * 找到一个空闲 lane 或分配新 lane
   */
  function allocLane(hash: string): number {
    // 找空闲位置
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        lanes[i] = hash;
        laneColors[i] = nextColor % GRAPH_COLORS.length;
        nextColor++;
        return i;
      }
    }
    // 没有空闲，新建
    const idx = lanes.length;
    lanes.push(hash);
    laneColors[idx] = nextColor % GRAPH_COLORS.length;
    nextColor++;
    return idx;
  }
  
  /**
   * 找到 hash 在 lanes 中的位置，-1 表示不在
   */
  function findLane(hash: string): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === hash) return i;
    }
    return -1;
  }
  
  let maxLane = 0;
  
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    
    // 1. 确定当前 commit 的 lane
    let currentLane = findLane(commit.hash);
    
    if (currentLane === -1) {
      // 第一个 commit 或分支起点，分配新 lane
      currentLane = allocLane(commit.hash);
    }
    
    const currentColor = laneColors[currentLane];
    
    // 释放当前 lane（这个 commit 已到达）
    lanes[currentLane] = null;
    
    // 记录节点
    nodes.set(commit.hash, {
      hash: commit.hash,
      lane: currentLane,
      color: currentColor,
      row,
    });
    
    maxLane = Math.max(maxLane, currentLane);
    
    // 2. 处理 parents
    commit.parents.forEach((parentHash, idx) => {
      const parentRow = hashToRow.get(parentHash);
      if (parentRow === undefined) return; // parent 不在可视列表中
      
      let targetLane = findLane(parentHash);
      
      if (targetLane !== -1) {
        // parent 已经被其他 commit 预定了某个 lane
        // 画从当前 commit 到那个 lane 的连线
        edges.push({
          fromLane: currentLane,
          fromRow: row,
          toLane: targetLane,
          toRow: parentRow,
          color: laneColors[targetLane],
        });
      } else {
        // parent 还没被预定
        if (idx === 0) {
          // 第一个 parent：继承当前 lane（直线向下）
          lanes[currentLane] = parentHash;
          // 保持同色
          laneColors[currentLane] = currentColor;
          
          edges.push({
            fromLane: currentLane,
            fromRow: row,
            toLane: currentLane,
            toRow: parentRow,
            color: currentColor,
          });
        } else {
          // 第 2+ 个 parent（merge 来源）：分配新 lane
          const newLane = allocLane(parentHash);
          maxLane = Math.max(maxLane, newLane);
          
          edges.push({
            fromLane: currentLane,
            fromRow: row,
            toLane: newLane,
            toRow: parentRow,
            color: laneColors[newLane],
          });
        }
      }
    });
  }
  
  return {
    nodes,
    edges,
    maxLane,
  };
}
