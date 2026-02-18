import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { DatabaseToolInput, QueryResult, ColumnInfo } from '../database/types.js';
import { connectionManager } from '../database/index.js';

// 格式化查询结果为 ASCII 表格
function formatTable(result: QueryResult, truncated?: boolean, displayRows?: number): string {
  const { columns, rows, rowCount, duration, command, affectedRows } = result;

  let header = `查询完成 | 行数: ${rowCount} | 耗时: ${duration}ms`;
  if (command) header += ` | 命令: ${command}`;

  // 非 SELECT 语句
  if (columns.length === 0 || rows.length === 0) {
    if (affectedRows !== undefined) {
      header += ` | 影响行数: ${affectedRows}`;
    }
    return header;
  }

  // 计算每列最大宽度
  const widths: number[] = columns.map(c => c.length);
  for (const row of rows) {
    for (let i = 0; i < columns.length; i++) {
      const val = String(row[columns[i]] ?? 'NULL');
      if (val.length > widths[i]) widths[i] = val.length;
    }
  }

  // 构建表头
  const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
  const headerRow = columns.map((c, i) => ` ${c.padEnd(widths[i])} `).join('|');
  const lines: string[] = [header, '', ` ${headerRow}`, `-${sep}-`];

  // 构建数据行
  for (const row of rows) {
    const rowStr = columns.map((c, i) => {
      const val = String(row[c] ?? 'NULL');
      return ` ${val.padEnd(widths[i])} `;
    }).join('|');
    lines.push(` ${rowStr}`);
  }

  if (truncated && displayRows !== undefined) {
    lines.push('');
    lines.push(`（显示前 ${displayRows} 行，共 ${rowCount} 行）`);
  }

  return lines.join('\n');
}

// 格式化列描述
function formatColumns(cols: ColumnInfo[]): string {
  if (cols.length === 0) return '（无列信息）';
  const widths = [4, 4, 8]; // name, type, nullable 最小宽度
  for (const c of cols) {
    if (c.name.length > widths[0]) widths[0] = c.name.length;
    if (c.type.length > widths[1]) widths[1] = c.type.length;
  }
  const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
  const headerRow = [' ' + 'name'.padEnd(widths[0]) + ' ', ' ' + 'type'.padEnd(widths[1]) + ' ', ' nullable '].join('|');
  const lines = [` ${headerRow}`, `-${sep}-`];
  for (const c of cols) {
    const row = [
      ' ' + c.name.padEnd(widths[0]) + ' ',
      ' ' + c.type.padEnd(widths[1]) + ' ',
      ' ' + (c.nullable === undefined ? '?' : c.nullable ? 'YES' : 'NO').padEnd(8) + ' ',
    ].join('|');
    lines.push(` ${row}`);
  }
  return lines.join('\n');
}

export class DatabaseTool extends BaseTool<DatabaseToolInput, ToolResult> {
  name = 'Database';
  description = `数据库客户端工具，支持 PostgreSQL、MySQL、SQLite、Redis、MongoDB。

支持的操作：
- connect: 建立数据库连接（需要 connection 名称和连接参数）
- disconnect: 断开连接
- query: 执行 SQL/命令查询
- list_connections: 列出所有活跃连接
- list_databases: 列出数据库
- list_tables: 列出表/集合
- describe_table: 描述表结构

连接示例：
  { "action": "connect", "connection": "mydb", "type": "sqlite", "connectionString": "/path/to/db.sqlite" }
  { "action": "connect", "connection": "pg", "type": "postgres", "connectionString": "postgresql://user:pass@host:5432/db" }

查询示例：
  { "action": "query", "connection": "mydb", "sql": "SELECT * FROM users LIMIT 10" }
  { "action": "query", "connection": "redis1", "sql": "GET mykey" }
  { "action": "query", "connection": "mongo1", "sql": "{\\"collection\\":\\"users\\",\\"find\\":{},\\"limit\\":10}" }
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['connect', 'disconnect', 'query', 'list_connections', 'list_databases', 'list_tables', 'describe_table'],
          description: '要执行的操作',
        },
        connection: {
          type: 'string',
          description: '连接名称（用于标识连接）',
        },
        connectionString: {
          type: 'string',
          description: '数据库连接字符串（connect 时使用）',
        },
        type: {
          type: 'string',
          enum: ['postgres', 'mysql', 'sqlite', 'redis', 'mongo'],
          description: '数据库类型',
        },
        host: { type: 'string', description: '数据库主机地址' },
        port: { type: 'number', description: '端口号' },
        user: { type: 'string', description: '用户名' },
        password: { type: 'string', description: '密码' },
        database: { type: 'string', description: '数据库名称' },
        ssl: { type: 'boolean', description: '是否启用 SSL' },
        readonly: { type: 'boolean', description: '只读模式（禁止 DML/DDL）' },
        sql: { type: 'string', description: 'SQL 查询语句（或 Redis 命令、MongoDB JSON）' },
        table: { type: 'string', description: '表名（describe_table 时使用）' },
        maxRows: { type: 'number', description: '最大返回行数（默认 100）' },
        timeout: { type: 'number', description: '查询超时（毫秒，默认 30000）' },
      },
      required: ['action'],
    };
  }

  async execute(input: DatabaseToolInput): Promise<ToolResult> {
    try {
      switch (input.action) {
        case 'connect': {
          if (!input.connection) return this.error('缺少参数: connection（连接名称）');
          if (!input.type && !input.connectionString) return this.error('缺少参数: type 或 connectionString');

          // 从连接字符串推断类型
          let dbType = input.type;
          if (!dbType && input.connectionString) {
            if (input.connectionString.startsWith('postgres')) dbType = 'postgres';
            else if (input.connectionString.startsWith('mysql')) dbType = 'mysql';
            else if (input.connectionString.startsWith('redis')) dbType = 'redis';
            else if (input.connectionString.startsWith('mongodb')) dbType = 'mongo';
            else dbType = 'sqlite'; // 默认为文件路径
          }

          const config = {
            type: dbType!,
            connectionString: input.connectionString,
            host: input.host,
            port: input.port,
            user: input.user,
            password: input.password,
            database: input.database,
            ssl: input.ssl,
            readonly: input.readonly,
            maxRows: input.maxRows ?? 100,
            queryTimeout: input.timeout ?? 30000,
          };

          await connectionManager.connect(input.connection, config);
          const masked = input.connectionString
            ? connectionManager.maskPassword(input.connectionString)
            : `${dbType}://${input.host ?? 'localhost'}/${input.database ?? ''}`;
          return this.success(`已连接到 ${input.connection}（${masked}）${input.readonly ? ' [只读]' : ''}`);
        }

        case 'disconnect': {
          if (!input.connection) return this.error('缺少参数: connection');
          await connectionManager.disconnect(input.connection);
          return this.success(`已断开连接: ${input.connection}`);
        }

        case 'query': {
          if (!input.connection) return this.error('缺少参数: connection');
          if (!input.sql) return this.error('缺少参数: sql');
          const maxRows = input.maxRows ?? 100;
          const timeout = input.timeout ?? 30000;
          const result = await connectionManager.query(input.connection, input.sql, maxRows, timeout);
          const truncated = (result as any).__truncated as boolean | undefined;
          const displayRows = (result as any).__displayRows as number | undefined;
          return this.success(formatTable(result, truncated, displayRows));
        }

        case 'list_connections': {
          const conns = connectionManager.listConnections();
          if (conns.length === 0) return this.success('当前无活跃连接');
          const lines = conns.map(c => `- ${c.name} [${c.type}] ${c.database}${c.readonly ? ' (只读)' : ''}`);
          return this.success(`活跃连接（${conns.length}）:\n${lines.join('\n')}`);
        }

        case 'list_databases': {
          if (!input.connection) return this.error('缺少参数: connection');
          const dbs = await connectionManager.listDatabases(input.connection);
          return this.success(`数据库列表:\n${dbs.map(d => `- ${d}`).join('\n')}`);
        }

        case 'list_tables': {
          if (!input.connection) return this.error('缺少参数: connection');
          const tables = await connectionManager.listTables(input.connection, input.database);
          return this.success(`表/集合列表:\n${tables.map(t => `- ${t}`).join('\n')}`);
        }

        case 'describe_table': {
          if (!input.connection) return this.error('缺少参数: connection');
          if (!input.table) return this.error('缺少参数: table');
          const cols = await connectionManager.describeTable(input.connection, input.table);
          return this.success(`表结构: ${input.table}\n\n${formatColumns(cols)}`);
        }

        default:
          return this.error(`未知操作: ${(input as any).action}`);
      }
    } catch (error: any) {
      return this.error(error.message ?? String(error));
    }
  }
}
