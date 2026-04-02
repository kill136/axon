/**
 * 数据流分析 API 集成测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe.skip('Data Flow API Integration', () => {
  let testDir: string;
  let testFilePath: string;

  beforeAll(() => {
    // 创建临时测试文件
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-flow-api-test-'));
    testFilePath = path.join(testDir, 'example.ts');

    const testCode = `
export class UserService {
  private userCount: number = 0;

  addUser() {
    this.userCount++;
    console.log(\`Total users: \${this.userCount}\`);
  }

  removeUser() {
    if (this.userCount > 0) {
      this.userCount--;
    }
  }

  getUserCount(): number {
    return this.userCount;
  }

  resetCount() {
    this.userCount = 0;
  }
}

const service = new UserService();
service.addUser();
service.addUser();
const count = service.getUserCount();
service.resetCount();
`;

    fs.writeFileSync(testFilePath, testCode, 'utf-8');
  });

  afterAll(() => {
    // 清理测试文件
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('API 应该返回正确的数据流分析结果', async () => {
    const { DataFlowAnalyzer } = await import('../../src/web/server/routes/data-flow-analyzer.js');
    const analyzer = new DataFlowAnalyzer();

    const symbolId = `${testFilePath}::UserService::userCount`;
    const result = await analyzer.analyzeDataFlow(symbolId);

    expect(result.success).not.toBe(false);
    expect(result.symbolName).toBe('userCount');
    expect(result.writes).toBeDefined();
    expect(result.reads).toBeDefined();
    expect(result.dataFlowGraph).toBeDefined();

    // 验证统计信息
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.reads.length).toBeGreaterThan(0);

    // 验证数据流图结构
    expect(result.dataFlowGraph?.nodes).toBeDefined();
    expect(result.dataFlowGraph?.edges).toBeDefined();

    // 验证包含中心节点
    const centerNode = result.dataFlowGraph?.nodes.find(n => n.id === 'center');
    expect(centerNode).toBeDefined();
    expect(centerNode?.label).toBe('userCount');

    // 验证边的连接
    const totalOps = result.writes.length + result.reads.length;
    expect(result.dataFlowGraph?.edges.length).toBe(totalOps);
  });

  it('应该能够正确识别写入操作', async () => {
    const { DataFlowAnalyzer } = await import('../../src/web/server/routes/data-flow-analyzer.js');
    const analyzer = new DataFlowAnalyzer();

    const symbolId = `${testFilePath}::UserService::userCount`;
    const result = await analyzer.analyzeDataFlow(symbolId);

    // 写入操作应该包含：初始化(=0), 自增(++), 自减(--), 重置(=0)
    expect(result.writes.length).toBeGreaterThanOrEqual(4);

    // 验证写入位置有代码上下文
    result.writes.forEach(write => {
      expect(write.code).toBeTruthy();
      expect(write.line).toBeGreaterThan(0);
      expect(write.column).toBeGreaterThan(0);
    });
  });

  it('应该能够正确识别读取操作', async () => {
    const { DataFlowAnalyzer } = await import('../../src/web/server/routes/data-flow-analyzer.js');
    const analyzer = new DataFlowAnalyzer();

    const symbolId = `${testFilePath}::UserService::userCount`;
    const result = await analyzer.analyzeDataFlow(symbolId);

    // 读取操作应该包含：console.log, 比较, return 等
    expect(result.reads.length).toBeGreaterThan(0);

    // 验证读取位置有代码上下文
    result.reads.forEach(read => {
      expect(read.code).toBeTruthy();
      expect(read.line).toBeGreaterThan(0);
      expect(read.column).toBeGreaterThan(0);
    });
  });

  it('应该生成正确的数据流图', async () => {
    const { DataFlowAnalyzer } = await import('../../src/web/server/routes/data-flow-analyzer.js');
    const analyzer = new DataFlowAnalyzer();

    const symbolId = `${testFilePath}::UserService::userCount`;
    const result = await analyzer.analyzeDataFlow(symbolId);

    const graph = result.dataFlowGraph;
    expect(graph).toBeDefined();

    // 验证节点类型（注意：中心节点也算 read 类型）
    const writeNodes = graph?.nodes.filter(n => n.type === 'write') || [];
    const allReadNodes = graph?.nodes.filter(n => n.type === 'read') || [];

    expect(writeNodes.length).toBe(result.writes.length);
    // 读取节点包含中心节点，所以总数是 reads.length + 1
    expect(allReadNodes.length).toBe(result.reads.length + 1);

    // 验证边的方向：写入 -> 中心 -> 读取
    const edges = graph?.edges || [];

    edges.forEach(edge => {
      if (edge.source.startsWith('write-')) {
        expect(edge.target).toBe('center');
      } else if (edge.source === 'center') {
        expect(edge.target).toMatch(/^read-/);
      }
    });
  });

  it('应该能够处理没有读取或写入的符号', async () => {
    const unusedFilePath = path.join(testDir, 'unused.ts');
    const unusedCode = `
export class TestClass {
  private unusedProperty: string;
}
`;
    fs.writeFileSync(unusedFilePath, unusedCode, 'utf-8');

    const { DataFlowAnalyzer } = await import('../../src/web/server/routes/data-flow-analyzer.js');
    const analyzer = new DataFlowAnalyzer();

    const symbolId = `${unusedFilePath}::TestClass::unusedProperty`;
    const result = await analyzer.analyzeDataFlow(symbolId);

    // 未使用的属性应该没有读取和写入（属性声明本身可能被算作读取）
    expect(result.writes.length).toBeLessThanOrEqual(1);
    expect(result.reads.length).toBeLessThanOrEqual(1);

    // 但仍应该生成基本的数据流图
    expect(result.dataFlowGraph).toBeDefined();
    expect(result.dataFlowGraph?.nodes.some(n => n.id === 'center')).toBe(true);
  });
});
