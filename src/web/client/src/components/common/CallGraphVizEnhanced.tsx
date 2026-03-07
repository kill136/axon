/**
 * 增强版调用图可视化组件
 * 功能：
 * - LSP+AI混合分析结果展示
 * - 循环依赖高亮
 * - 节点过滤（类型、模块）
 * - 导出PNG/SVG
 * - 搜索节点
 * - 缩略图导航
 * - 路径高亮
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import styles from './CallGraphVizEnhanced.module.css';
import { useLanguage } from '../../i18n';

// 符号分类函数（简化版，前端使用）
interface SymbolClassification {
  canHaveCallGraph: boolean;
}

function classifySymbolForGraph(type: string): SymbolClassification {
  const typeLower = (type || '').toLowerCase();

  // 可执行符号
  if (typeLower.includes('function') ||
      typeLower.includes('method') ||
      typeLower.includes('constructor') ||
      typeLower.includes('arrow')) {
    return { canHaveCallGraph: true };
  }

  // 静态符号（不应出现在调用图中）
  if (typeLower.includes('interface') ||
      typeLower.includes('type') ||
      typeLower.includes('property') ||
      typeLower.includes('variable') ||
      typeLower.includes('enum') ||
      typeLower.includes('namespace')) {
    return { canHaveCallGraph: false };
  }

  // 默认允许（向后兼容）
  return { canHaveCallGraph: true };
}

// 类型定义
export interface CallGraphNode {
  id: string;
  name: string;
  type: 'function' | 'method' | 'constructor' | 'arrow';
  moduleId: string;
  className?: string;
  signature?: string;
}

export interface CallGraphEdge {
  source: string;
  target: string;
  type: 'direct' | 'method' | 'callback' | 'dynamic';
  count: number;
}

export interface CallGraphData {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
  cycles?: string[][]; // 循环依赖
  callChains?: string[][]; // 调用链（从入口到目标符号）
  entryPoints?: Array<{ id: string; name: string; moduleId: string }>; // 入口点
}

export interface CallGraphVizEnhancedProps {
  data: CallGraphData;
  height?: number;
  onNodeClick?: (node: CallGraphNode) => void;
  centerNodeId?: string;
}

export const CallGraphVizEnhanced: React.FC<CallGraphVizEnhancedProps> = ({
  data,
  height = 500,
  onNodeClick,
  centerNodeId,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  // 过滤器状态
  const [nodeTypeFilter, setNodeTypeFilter] = useState<Set<string>>(new Set(['function', 'method', 'constructor']));
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // 路径高亮
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // 过滤数据
  const filteredData = React.useMemo(() => {
    let nodes = data.nodes.filter(n => {
      // ✅ 新增：符号类型过滤（最优先）
      const classification = classifySymbolForGraph(n.type);
      if (!classification.canHaveCallGraph) {
        console.log(`[CallGraph] Filtered out static symbol: ${n.name} (${n.type})`);
        return false; // 移除 interface/type/property 节点
      }

      // 类型过滤
      if (!nodeTypeFilter.has(n.type)) return false;
      // 模块过滤
      if (moduleFilter && !n.moduleId.includes(moduleFilter)) return false;
      // 搜索过滤
      if (searchQuery && !n.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = data.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    return { nodes, edges, cycles: data.cycles };
  }, [data, nodeTypeFilter, moduleFilter, searchQuery]);

  // 过滤统计信息
  const filterStats = React.useMemo(() => {
    const total = data.nodes.length;
    const filtered = filteredData.nodes.length;
    const removed = total - filtered;

    // 统计被移除的静态符号
    const staticSymbols = data.nodes.filter(n => {
      const classification = classifySymbolForGraph(n.type);
      return !classification.canHaveCallGraph;
    });

    return {
      total,
      filtered,
      removed,
      staticSymbolsCount: staticSymbols.length,
      staticSymbols: staticSymbols.map(n => `${n.name} (${n.type})`),
    };
  }, [data.nodes, filteredData.nodes]);

  // 检查节点是否在循环中
  const isNodeInCycle = useCallback((nodeId: string): boolean => {
    if (!data.cycles) return false;
    return data.cycles.some(cycle => cycle.includes(nodeId));
  }, [data.cycles]);

  // 检查边是否在循环中
  const isEdgeInCycle = useCallback((source: string, target: string): boolean => {
    if (!data.cycles) return false;
    for (const cycle of data.cycles) {
      for (let i = 0; i < cycle.length - 1; i++) {
        if (cycle[i] === source && cycle[i + 1] === target) {
          return true;
        }
      }
    }
    return false;
  }, [data.cycles]);

  // 导出PNG
  const exportToPNG = () => {
    if (!svgRef.current) return;

    const svgElement = svgRef.current;
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const bbox = svgElement.getBBox();
    canvas.width = bbox.width + 40;
    canvas.height = bbox.height + 40;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 20, 20);

      const link = document.createElement('a');
      link.download = `call-graph-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  // 导出SVG
  const exportToSVG = () => {
    if (!svgRef.current) return;

    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `call-graph-${Date.now()}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 高亮从sourceId到targetId的路径
  const highlightPath = useCallback((sourceId: string, targetId: string) => {
    // BFS 找最短路径
    const queue: [string, string[]][] = [[sourceId, [sourceId]]];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const [current, path] = queue.shift()!;

      if (current === targetId) {
        setHighlightedPath(path);
        return;
      }

      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of filteredData.edges) {
        if (edge.source === current && !visited.has(edge.target)) {
          queue.push([edge.target, [...path, edge.target]]);
        }
      }
    }

    setHighlightedPath([]);
  }, [filteredData.edges]);

  useEffect(() => {
    if (!filteredData || filteredData.nodes.length === 0) {
      setError(t('callGraphEnhanced.noData'));
      setLoading(false);
      return;
    }

    try {
      renderGraph();
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('callGraphEnhanced.renderFailed'));
      setLoading(false);
    }
  }, [filteredData, centerNodeId, highlightedPath]);

  const renderGraph = () => {
    if (!svgRef.current || !containerRef.current) return;
    if (!(window as any).d3) {
      throw new Error(t('callGraphEnhanced.d3NotLoaded'));
    }

    const d3 = (window as any).d3;
    const container = containerRef.current;
    const width = container.clientWidth;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: any) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);
    const g = svg.append('g');

    // 准备数据
    const nodes = filteredData.nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
      inCycle: isNodeInCycle(n.id),
    }));

    const links = filteredData.edges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
      count: e.count,
      inCycle: isEdgeInCycle(e.source, e.target),
    }));

    // 力导向模拟
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50));

    // 定义箭头
    svg.append('defs')
      .selectAll('marker')
      .data(['normal', 'cycle', 'highlight'])
      .join('marker')
      .attr('id', (d: string) => `arrowhead-${d}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', (d: string) => {
        if (d === 'cycle') return '#ff4444';
        if (d === 'highlight') return '#ffd700';
        return '#666';
      });

    // 渲染边
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', (d: any) => {
        const classes = ['call-graph-link'];
        if (d.inCycle) classes.push('cycle');
        if (d.type === 'callback') classes.push('callback');
        if (d.type === 'dynamic') classes.push('dynamic');

        // 路径高亮
        const sourceIdx = highlightedPath.indexOf(d.source.id || d.source);
        if (sourceIdx >= 0 && highlightedPath[sourceIdx + 1] === (d.target.id || d.target)) {
          classes.push('highlighted');
        }

        return classes.join(' ');
      })
      .attr('stroke', (d: any) => d.inCycle ? '#ff4444' : '#666')
      .attr('stroke-width', (d: any) => Math.min(1 + d.count * 0.5, 5))
      .attr('marker-end', (d: any) => {
        const sourceIdx = highlightedPath.indexOf(d.source.id || d.source);
        const isHighlighted = sourceIdx >= 0 && highlightedPath[sourceIdx + 1] === (d.target.id || d.target);
        if (isHighlighted) return 'url(#arrowhead-highlight)';
        if (d.inCycle) return 'url(#arrowhead-cycle)';
        return 'url(#arrowhead-normal)';
      });

    // 渲染节点
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', (d: any) => {
        const classes = ['call-graph-node'];
        if (d.type) classes.push(d.type);
        if (d.id === centerNodeId) classes.push('center');
        if (d.id === selectedNode) classes.push('selected');
        if (d.inCycle) classes.push('in-cycle');
        if (highlightedPath.includes(d.id)) classes.push('in-path');
        return classes.join(' ');
      })
      .call(d3.drag()
        .on('start', (event: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        })
        .on('drag', (event: any) => {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
        })
        .on('end', (event: any) => {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
        })
      )
      .on('click', (event: any, d: any) => {
        event.stopPropagation();
        setSelectedNode(d.id);
        onNodeClick?.(d);
      })
      .on('dblclick', (event: any, d: any) => {
        event.stopPropagation();
        if (selectedNode && selectedNode !== d.id) {
          highlightPath(selectedNode, d.id);
        }
      });

    // 节点圆形
    node.append('circle')
      .attr('r', (d: any) => {
        if (d.id === centerNodeId) return 14;
        if (d.inCycle) return 12;
        if (d.type === 'constructor') return 10;
        return 8;
      })
      .attr('fill', (d: any) => {
        if (d.id === centerNodeId) return '#ff4444';
        if (d.inCycle) return '#ff8800';
        if (d.type === 'function') return '#0084ff';
        if (d.type === 'method') return '#16a34a';
        return '#f59e0b';
      });

    // 循环标记
    node.filter((d: any) => d.inCycle)
      .append('text')
      .attr('class', 'cycle-badge')
      .attr('x', 12)
      .attr('y', -8)
      .text('⚠');

    // 节点标签
    node.append('text')
      .text((d: any) => d.className ? `${d.className}.${d.name}` : d.name)
      .attr('dx', 14)
      .attr('dy', 4);

    // Tooltip
    node.append('title')
      .text((d: any) => {
        let text = `${d.name}\n${t('callGraphEnhanced.type')}: ${d.type}\n${t('callGraphEnhanced.module')}: ${d.moduleId}`;
        if (d.className) text += `\n${t('callGraphEnhanced.class')}: ${d.className}`;
        if (d.inCycle) text += `\n${t('callGraphEnhanced.inCycleDependency')}`;
        return text;
      });

    // 更新位置
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // 自动缩放
    setTimeout(() => {
      const bounds = g.node()?.getBBox();
      if (bounds) {
        const scale = Math.min(0.9, width / bounds.width, height / bounds.height);
        const tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
        const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
      }
    }, 1000);
  };

  if (loading) {
    return (
      <div className={styles.container} style={{ height }}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>{t('callGraphEnhanced.rendering')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container} style={{ height }}>
        <div className={styles.error}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // 空状态处理
  if (filteredData.nodes.length === 0) {
    return (
      <div className={styles.container} style={{ height }}>
        <div className={styles.emptyState}>
          <p>{t('callGraphEnhanced.noExecutableSymbols')}</p>
          <p>{t('callGraphEnhanced.onlyFunctionsAndMethods')}</p>
          {filterStats.staticSymbolsCount > 0 && (
            <>
              <p>{t('callGraphEnhanced.filteredStaticSymbols', { count: filterStats.staticSymbolsCount })}</p>
              <div className={styles.staticSymbolsList}>
                {filterStats.staticSymbols.slice(0, 5).map((s, i) => (
                  <div key={i}>{s}</div>
                ))}
                {filterStats.staticSymbols.length > 5 && (
                  <div>{t('callGraphEnhanced.andMore', { count: filterStats.staticSymbols.length - 5 })}</div>
                )}
              </div>
            </>
          )}
          <p className={styles.suggestion}>
            {t('callGraphEnhanced.suggestAlternativeView')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} style={{ height }}>
      {/* 工具栏 */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {/* 工具栏提示 */}
          <div className={styles.toolbarHint}>
            {t('callGraphEnhanced.toolbarHint')}
          </div>

          {/* 搜索 */}
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t('callGraphEnhanced.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />

          {/* 过滤器 */}
          <div className={styles.filterGroup}>
            {['function', 'method', 'constructor'].map(type => (
              <label key={type} className={styles.filterCheckbox}>
                <input
                  type="checkbox"
                  checked={nodeTypeFilter.has(type)}
                  onChange={e => {
                    const newSet = new Set(nodeTypeFilter);
                    if (e.target.checked) {
                      newSet.add(type);
                    } else {
                      newSet.delete(type);
                    }
                    setNodeTypeFilter(newSet);
                  }}
                />
                <span>{type}</span>
              </label>
            ))}
          </div>

          {/* 模块过滤 */}
          <input
            type="text"
            className={styles.moduleInput}
            placeholder={t('callGraphEnhanced.moduleFilterPlaceholder')}
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
          />
        </div>

        <div className={styles.toolbarRight}>
          {/* 循环依赖提示 */}
          {data.cycles && data.cycles.length > 0 && (
            <div className={styles.cycleWarning}>
              {t('callGraphEnhanced.cycleDependencies', { count: data.cycles.length })}
            </div>
          )}

          {/* 导出按钮 */}
          <button className={styles.toolbarBtn} onClick={exportToPNG} title={t('callGraphEnhanced.exportPNG')}>
            📷 PNG
          </button>
          <button className={styles.toolbarBtn} onClick={exportToSVG} title={t('callGraphEnhanced.exportSVG')}>
            🎨 SVG
          </button>

          {/* 调用链按钮 */}
          {data.callChains && data.callChains.length > 0 && (
            <button
              className={styles.toolbarBtn}
              onClick={() => {
                // 高亮第一条调用链
                if (data.callChains && data.callChains[0]) {
                  setHighlightedPath(data.callChains[0]);
                }
              }}
              title={t('callGraphEnhanced.showCallChains', { count: data.callChains.length })}
            >
              📊 {t('callGraphEnhanced.callChains')}
            </button>
          )}

          {/* 清除高亮 */}
          {highlightedPath.length > 0 && (
            <button
              className={styles.toolbarBtn}
              onClick={() => setHighlightedPath([])}
              title={t('callGraphEnhanced.clearPathHighlight')}
            >
              ✕ {t('callGraphEnhanced.clearPath')}
            </button>
          )}
        </div>
      </div>

      {/* 过滤信息提示 */}
      {filterStats.staticSymbolsCount > 0 && (
        <div className={styles.filterInfo}>
          {t('callGraphEnhanced.filteredStaticInfo', { count: filterStats.staticSymbolsCount })}
        </div>
      )}

      {/* 图谱画布 */}
      <div className={styles.canvas} ref={containerRef}>
        <svg ref={svgRef}></svg>
      </div>

      {/* 提示 */}
      <div className={styles.hint}>
        {t('callGraphEnhanced.hint')}
      </div>

      {/* 统计信息 */}
      <div className={styles.stats}>
        <span>{t('callGraphEnhanced.nodes')}: {filteredData.nodes.length}</span>
        <span>{t('callGraphEnhanced.edges')}: {filteredData.edges.length}</span>
        {data.cycles && <span className={styles.cycleCount}>{t('callGraphEnhanced.cycles')}: {data.cycles.length}</span>}
        {data.entryPoints && data.entryPoints.length > 0 && (
          <span title={data.entryPoints.map(e => e.name).join(', ')}>
            {t('callGraphEnhanced.entryPoints')}: {data.entryPoints.length}
          </span>
        )}
        {data.callChains && data.callChains.length > 0 && (
          <span>{t('callGraphEnhanced.callChainsLabel')}: {data.callChains.length}</span>
        )}
      </div>
    </div>
  );
};

export default CallGraphVizEnhanced;
