/**
 * Commit Graph 布局算法 (GitLens 风格)
 * 
 * 核心原则：
 * 1. 每个 commit 占据一个 lane（列）
 * 2. 第一个 parent 尽量继承当前 lane（直线向下）
 * 3. 其他 parent（merge 来源）分配新 lane
 * 4. 当 child→parent 跨多行时，中间行需要画穿越线（pass-through）
 * 5. Merge commit（多 parent）用空心圆，普通 commit 用实心圆
 */

// 颜色调色板（GitLens 风格，更饱和鲜明）
export const GRAPH_COLORS = [
  '#e15a60', // 红
  '#f5c842', // 黄
  '#6cc644', // 绿
  '#4dc5e2', // 青
  '#cd6cec', // 紫
  '#ef6e4a', // 橙
  '#e560a4', // 粉
  '#49c5b1', // 薄荷
];

export interface GraphNode {
  hash: string;
  lane: number;       // 此 commit 所在列
  color: number;      // 颜色索引
  row: number;        // 行号
  isMerge: boolean;   // 是否 merge commit（多 parent）
}

export interface GraphEdge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: number;
}

/** 每行需要的穿越线（pass-through）信息 */
export interface PassThrough {
  lane: number;
  color: number;
}

export interface GraphLayout {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  maxLane: number;
  /** 每行的穿越线列表，key = row index */
  passThroughs: Map<number, PassThrough[]>;
}

/**
 * 计算 commit graph 布局
 * @param commits 按时间倒序排列的 commit 列表（最新在前）
 */
export function computeGraphLayout(commits: Array<{hash: string; parents: string[]}>): GraphLayout {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const passThroughs = new Map<number, PassThrough[]>();
  
  // 预建 hash→row 索引
  const hashToRow = new Map<string, number>();
  commits.forEach((c, i) => hashToRow.set(c.hash, i));
  
  // lanes[i] = 第 i 列当前被哪个 hash 预定（等待该 hash 出现时占据此列）
  const lanes: (string | null)[] = [];
  
  // lane → color index
  const laneColors: number[] = [];
  let nextColor = 0;
  
  function allocLane(hash: string): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        lanes[i] = hash;
        laneColors[i] = nextColor % GRAPH_COLORS.length;
        nextColor++;
        return i;
      }
    }
    const idx = lanes.length;
    lanes.push(hash);
    laneColors[idx] = nextColor % GRAPH_COLORS.length;
    nextColor++;
    return idx;
  }
  
  function findLane(hash: string): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === hash) return i;
    }
    return -1;
  }
  
  let maxLane = 0;
  
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    const isMerge = commit.parents.length > 1;
    
    // 1. 确定当前 commit 的 lane
    let currentLane = findLane(commit.hash);
    
    if (currentLane === -1) {
      currentLane = allocLane(commit.hash);
    }
    
    const currentColor = laneColors[currentLane];
    
    // 释放当前 lane
    lanes[currentLane] = null;
    
    // 记录节点
    nodes.set(commit.hash, {
      hash: commit.hash,
      lane: currentLane,
      color: currentColor,
      row,
      isMerge,
    });
    
    maxLane = Math.max(maxLane, currentLane);
    
    // 2. 处理 parents
    commit.parents.forEach((parentHash, idx) => {
      const parentRow = hashToRow.get(parentHash);
      if (parentRow === undefined) return;
      
      let targetLane = findLane(parentHash);
      
      if (targetLane !== -1) {
        const edgeColor = laneColors[targetLane];
        edges.push({
          fromLane: currentLane,
          fromRow: row,
          toLane: targetLane,
          toRow: parentRow,
          color: edgeColor,
        });
        // 添加中间行的穿越线
        addPassThroughs(passThroughs, targetLane, edgeColor, row + 1, parentRow);
      } else {
        if (idx === 0) {
          lanes[currentLane] = parentHash;
          laneColors[currentLane] = currentColor;
          
          edges.push({
            fromLane: currentLane,
            fromRow: row,
            toLane: currentLane,
            toRow: parentRow,
            color: currentColor,
          });
          // 添加中间行的穿越线
          addPassThroughs(passThroughs, currentLane, currentColor, row + 1, parentRow);
        } else {
          const newLane = allocLane(parentHash);
          maxLane = Math.max(maxLane, newLane);
          const edgeColor = laneColors[newLane];
          
          edges.push({
            fromLane: currentLane,
            fromRow: row,
            toLane: newLane,
            toRow: parentRow,
            color: edgeColor,
          });
          // 添加中间行的穿越线（从变道完成后到 parent）
          addPassThroughs(passThroughs, newLane, edgeColor, row + 1, parentRow);
        }
      }
    });
  }
  
  return {
    nodes,
    edges,
    maxLane,
    passThroughs,
  };
}

/** 为跨越多行的边添加中间行的穿越线记录 */
function addPassThroughs(
  map: Map<number, PassThrough[]>,
  lane: number,
  color: number,
  fromRow: number,
  toRow: number
) {
  for (let r = fromRow; r < toRow; r++) {
    let list = map.get(r);
    if (!list) {
      list = [];
      map.set(r, list);
    }
    // 避免同一行同一 lane 重复
    if (!list.some(p => p.lane === lane)) {
      list.push({ lane, color });
    }
  }
}
