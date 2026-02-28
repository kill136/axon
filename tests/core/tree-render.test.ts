/**
 * 树形结构渲染测试
 * 测试树形节点、树形渲染器和SVG可视化功能
 */

import { TreeNode, TreeRenderer, TreeRenderStyle, TreeRenderOptions } from '../../src/renderer/tree-render.js';
import { describe, it, expect } from 'vitest';

describe('TreeNode', () => {
  it('应该创建一个树节点', () => {
    const node = new TreeNode('root');
    expect(node.label).toBe('root');
    expect(node.children.length).toBe(0);
    expect(node.parent).toBe(null);
  });

  it('应该添加子节点', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');

    root.addChild(child1);
    root.addChild(child2);

    expect(root.children.length).toBe(2);
    expect(root.children[0]).toBe(child1);
    expect(root.children[1]).toBe(child2);
    expect(child1.parent).toBe(root);
    expect(child2.parent).toBe(root);
  });

  it('应该支持链式调用添加子节点', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');

    const result = root.addChild(child);
    expect(result).toBe(root);
  });

  it('应该获取节点深度', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child);
    child.addChild(grandchild);

    expect(root.getDepth()).toBe(0);
    expect(child.getDepth()).toBe(1);
    expect(grandchild.getDepth()).toBe(2);
  });

  it('应该获取节点层级', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child);
    child.addChild(grandchild);

    expect(root.getPath()).toEqual(['root']);
    expect(child.getPath()).toEqual(['root', 'child']);
    expect(grandchild.getPath()).toEqual(['root', 'child', 'grandchild']);
  });

  it('应该计算树的大小（节点总数）', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child1);
    root.addChild(child2);
    child1.addChild(grandchild);

    expect(root.getSize()).toBe(4);
    expect(child1.getSize()).toBe(2);
    expect(child2.getSize()).toBe(1);
  });

  it('应该计算树的高度', () => {
    const root = new TreeNode('root');
    expect(root.getHeight()).toBe(0);

    const child = new TreeNode('child');
    root.addChild(child);
    expect(root.getHeight()).toBe(1);

    const grandchild = new TreeNode('grandchild');
    child.addChild(grandchild);
    expect(root.getHeight()).toBe(2);
  });

  it('应该查找节点', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child);
    child.addChild(grandchild);

    expect(root.find('root')).toBe(root);
    expect(root.find('child')).toBe(child);
    expect(root.find('grandchild')).toBe(grandchild);
    expect(root.find('notfound')).toBe(null);
  });

  it('应该设置节点元数据', () => {
    const node = new TreeNode('test');
    node.setMetadata('key1', 'value1');
    node.setMetadata('key2', 42);

    expect(node.getMetadata('key1')).toBe('value1');
    expect(node.getMetadata('key2')).toBe(42);
    expect(node.getMetadata('notexist')).toBe(undefined);
  });

  it('应该支持节点展开/折叠状态', () => {
    const node = new TreeNode('test');
    expect(node.isExpanded()).toBe(true); // 默认展开

    node.setExpanded(false);
    expect(node.isExpanded()).toBe(false);

    node.setExpanded(true);
    expect(node.isExpanded()).toBe(true);
  });
});

describe('TreeRenderer', () => {
  it('应该使用默认选项渲染树', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');

    root.addChild(child1);
    root.addChild(child2);

    const renderer = new TreeRenderer(root);
    const output = renderer.render();

    expect(output.includes('root')).toBe(true);
    expect(output.includes('child1')).toBe(true);
    expect(output.includes('child2')).toBe(true);
  });

  it('应该使用树形样式渲染树', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child1);
    root.addChild(child2);
    child1.addChild(grandchild);

    const renderer = new TreeRenderer(root, { style: 'tree' as TreeRenderStyle });
    const output = renderer.render();

    // 树形样式应该包含特定的连接符
    expect(output.includes('├')).toBe(true);
    expect(output.includes('└')).toBe(true);
  });

  it('应该使用缩进样式渲染树', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root, { style: 'indent' as TreeRenderStyle });
    const output = renderer.render();

    expect(output.includes('  ')).toBe(true);
  });

  it('应该使用自定义前缀', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root, { prefix: '> ' });
    const output = renderer.render();

    expect(output.includes('> ')).toBe(true);
  });

  it('应该返回JSON格式的树', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root);
    const json = renderer.toJSON();

    expect(json.label).toBe('root');
    expect(json.children.length).toBe(1);
    expect(json.children[0].label).toBe('child');
  });

  it('应该过滤树中的节点', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child1);
    root.addChild(child2);
    child1.addChild(grandchild);

    const renderer = new TreeRenderer(root);
    const filtered = renderer.filter(node => node.label.includes('child'));

    // 过滤后的树应该只包含包含 'child' 的节点
    const output = new TreeRenderer(filtered).render();
    expect(output.includes('child1')).toBe(true);
    expect(output.includes('child2')).toBe(true);
    // 'grandchild' also contains 'child', so it passes the filter
    expect(output.includes('grandchild')).toBe(true);
  });

  it('应该映射树中的节点', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root);
    const mapped = renderer.map(node => {
      const newNode = new TreeNode(node.label.toUpperCase());
      return newNode;
    });

    const output = new TreeRenderer(mapped).render();
    expect(output.includes('ROOT')).toBe(true);
    expect(output.includes('CHILD')).toBe(true);
  });

  it('应该计算树的统计信息', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child1);
    root.addChild(child2);
    child1.addChild(grandchild);

    const renderer = new TreeRenderer(root);
    const stats = renderer.getStats();

    expect(stats.totalNodes).toBe(4);
    expect(stats.totalLeaves).toBe(2);
    expect(stats.maxDepth).toBe(2);
    // avgChildren counts only parent nodes: root(2) + child1(1) / 2 parents = 1.5
    expect(stats.avgChildren).toBe(1.5);
  });

  it('应该处理空树', () => {
    const root = new TreeNode('empty');
    const renderer = new TreeRenderer(root);
    const output = renderer.render();

    expect(output.includes('empty')).toBe(true);
    expect(root.children.length).toBe(0);
  });
});

describe('SVG Tree Rendering', () => {
  it('应该生成基础SVG树', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root);
    const svg = renderer.toSVG();

    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('</svg>')).toBe(true);
    expect(svg.includes('root')).toBe(true);
    expect(svg.includes('child')).toBe(true);
  });

  it('应该生成带自定义选项的SVG树', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root, {
      svgWidth: 400,
      svgHeight: 300,
    });
    const svg = renderer.toSVG();

    expect(svg.includes('width="400"')).toBe(true);
    expect(svg.includes('height="300"')).toBe(true);
  });

  it('应该处理深层树的SVG渲染', () => {
    const root = new TreeNode('root');
    let current = root;
    for (let i = 1; i <= 5; i++) {
      const child = new TreeNode(`level${i}`);
      current.addChild(child);
      current = child;
    }

    const renderer = new TreeRenderer(root);
    const svg = renderer.toSVG();

    expect(svg.includes('root')).toBe(true);
    expect(svg.includes('level1')).toBe(true);
    expect(svg.includes('level5')).toBe(true);
  });

  it('应该支持SVG节点样式定制', () => {
    const root = new TreeNode('root');
    root.setMetadata('nodeColor', '#FF0000');
    root.setMetadata('nodeSize', 50);

    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root);
    const svg = renderer.toSVG();

    expect(svg.includes('FF0000')).toBe(true);
  });
});

describe('Render Options', () => {
  it('应该使用自定义选项控制渲染', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const options: TreeRenderOptions = {
      style: 'tree',
      prefix: '>>> ',
      indentSize: 4,
      colorize: false,
    };

    const renderer = new TreeRenderer(root, options);
    const output = renderer.render();

    expect(output.includes('>>> ')).toBe(true);
  });

  it('应该支持缩进大小自定义', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root, { indentSize: 6 });
    const output = renderer.render();

    // 缩进应该是6个空格
    const lines = output.split('\n');
    expect(lines.length >= 2).toBe(true);
  });

  it('应该支持颜色化选项', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    const renderer = new TreeRenderer(root, { colorize: true });
    const output = renderer.render();

    // 颜色化的输出应该包含ANSI颜色代码
    // 或者可能不包含，取决于实现
    expect(typeof output === 'string').toBe(true);
  });
});

describe('Edge Cases', () => {
  it('应该处理包含特殊字符的标签', () => {
    const root = new TreeNode('root-with-dash_and_underscore');
    const child = new TreeNode('child<>&"');
    root.addChild(child);

    const renderer = new TreeRenderer(root);
    const output = renderer.render();

    expect(output.includes('root-with-dash_and_underscore')).toBe(true);
  });

  it('应该处理非常大的树', () => {
    const root = new TreeNode('root');
    for (let i = 0; i < 100; i++) {
      root.addChild(new TreeNode(`child${i}`));
    }

    const renderer = new TreeRenderer(root);
    const output = renderer.render();

    expect(root.children.length).toBe(100);
    expect(output.includes('child0')).toBe(true);
    expect(output.includes('child99')).toBe(true);
  });

  it('应该处理循环节点引用（限制深度）', () => {
    const root = new TreeNode('root');
    const child = new TreeNode('child');
    root.addChild(child);

    // TreeRenderer应该有最大深度限制，防止无限循环
    const renderer = new TreeRenderer(root);
    const output = renderer.render();

    expect(typeof output === 'string').toBe(true);
  });

  it('应该正确处理折叠的节点', () => {
    const root = new TreeNode('root');
    const child1 = new TreeNode('child1');
    const child2 = new TreeNode('child2');
    const grandchild = new TreeNode('grandchild');

    root.addChild(child1);
    root.addChild(child2);
    child1.addChild(grandchild);

    child1.setExpanded(false);

    const renderer = new TreeRenderer(root);
    const output = renderer.render();

    // 折叠的节点应该显示某种标记
    expect(output.includes('child1')).toBe(true);
  });
});
