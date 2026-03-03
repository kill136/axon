import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { DatabaseToolInput, QueryResult, ColumnInfo } from '../database/types.js';
import { connectionManager } from '../database/index.js';

// 格式化查询结果为 ASCII 表格
function formatTable(result: QueryResult, truncated?: boolean, displayRows?: number): string {
  const { columns, rows, rowCount, duration, command, affectedRows } = result;

  let header = `Query completed | Rows: ${rowCount} | Duration: ${duration}ms`;
  if (command) header += ` | Command: ${command}`;

  // 非 SELECT 语句
  if (columns.length === 0 || rows.length === 0) {
    if (affectedRows !== undefined) {
      header += ` | Affected rows: ${affectedRows}`;
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
    lines.push(`(Showing first ${displayRows} of ${rowCount} rows)`);
  }

  return lines.join('\n');
}

// 格式化列描述
function formatColumns(cols: ColumnInfo[]): string {
  if (cols.length === 0) return '(No column info)';
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
  description = `Database client tool supporting PostgreSQL, MySQL, SQLite, Redis, MongoDB.

Supported operations:
- connect: Establish a database connection (requires connection name and connection parameters)
- disconnect: Disconnect
- query: Execute SQL/command queries
- list_connections: List all active connections
- list_databases: List databases
- list_tables: List tables/collections
- describe_table: Describe table structure

Connection examples:
  { "action": "connect", "connection": "mydb", "type": "sqlite", "connectionString": "/path/to/db.sqlite" }
  { "action": "connect", "connection": "pg", "type": "postgres", "connectionString": "postgresql://user:pass@host:5432/db" }

Query examples:
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
          description: 'The operation to perform',
        },
        connection: {
          type: 'string',
          description: 'Connection name (used to identify the connection)',
        },
        connectionString: {
          type: 'string',
          description: 'Database connection string (used for connect)',
        },
        type: {
          type: 'string',
          enum: ['postgres', 'mysql', 'sqlite', 'redis', 'mongo'],
          description: 'Database type',
        },
        host: { type: 'string', description: 'Database host address' },
        port: { type: 'number', description: 'Port number' },
        user: { type: 'string', description: 'Username' },
        password: { type: 'string', description: 'Password' },
        database: { type: 'string', description: 'Database name' },
        ssl: { type: 'boolean', description: 'Whether to enable SSL' },
        readonly: { type: 'boolean', description: 'Read-only mode (disables DML/DDL)' },
        sql: { type: 'string', description: 'SQL query statement (or Redis command, MongoDB JSON)' },
        table: { type: 'string', description: 'Table name (used for describe_table)' },
        maxRows: { type: 'number', description: 'Maximum number of rows to return (default 100)' },
        timeout: { type: 'number', description: 'Query timeout (milliseconds, default 30000)' },
      },
      required: ['action'],
    };
  }

  async execute(input: DatabaseToolInput): Promise<ToolResult> {
    try {
      switch (input.action) {
        case 'connect': {
          if (!input.connection) return this.error('Missing parameter: connection (connection name)');
          if (!input.type && !input.connectionString) return this.error('Missing parameter: type or connectionString');

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
          return this.success(`Connected to ${input.connection} (${masked})${input.readonly ? ' [read-only]' : ''}`);
        }

        case 'disconnect': {
          if (!input.connection) return this.error('Missing parameter: connection');
          await connectionManager.disconnect(input.connection);
          return this.success(`Disconnected: ${input.connection}`);
        }

        case 'query': {
          if (!input.connection) return this.error('Missing parameter: connection');
          if (!input.sql) return this.error('Missing parameter: sql');
          const maxRows = input.maxRows ?? 100;
          const timeout = input.timeout ?? 30000;
          const result = await connectionManager.query(input.connection, input.sql, maxRows, timeout);
          const truncated = (result as any).__truncated as boolean | undefined;
          const displayRows = (result as any).__displayRows as number | undefined;
          return this.success(formatTable(result, truncated, displayRows));
        }

        case 'list_connections': {
          const conns = connectionManager.listConnections();
          if (conns.length === 0) return this.success('No active connections');
          const lines = conns.map(c => `- ${c.name} [${c.type}] ${c.database}${c.readonly ? ' (read-only)' : ''}`);
          return this.success(`Active connections (${conns.length}):\n${lines.join('\n')}`);
        }

        case 'list_databases': {
          if (!input.connection) return this.error('Missing parameter: connection');
          const dbs = await connectionManager.listDatabases(input.connection);
          return this.success(`Database list:\n${dbs.map(d => `- ${d}`).join('\n')}`);
        }

        case 'list_tables': {
          if (!input.connection) return this.error('Missing parameter: connection');
          const tables = await connectionManager.listTables(input.connection, input.database);
          return this.success(`Table/collection list:\n${tables.map(t => `- ${t}`).join('\n')}`);
        }

        case 'describe_table': {
          if (!input.connection) return this.error('Missing parameter: connection');
          if (!input.table) return this.error('Missing parameter: table');
          const cols = await connectionManager.describeTable(input.connection, input.table);
          return this.success(`Table structure: ${input.table}\n\n${formatColumns(cols)}`);
        }

        default:
          return this.error(`Unknown operation: ${(input as any).action}`);
      }
    } catch (error: any) {
      return this.error(error.message ?? String(error));
    }
  }
}
