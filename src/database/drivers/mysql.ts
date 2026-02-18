import type { DriverInterface, ConnectionConfig, QueryResult, ColumnInfo } from '../types.js';

const WRITE_KEYWORDS = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|CALL|EXEC)/i;

export class MySQLDriver implements DriverInterface {
  private conn: any = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    let mysql: any;
    try {
      // @ts-ignore - 可选依赖，未安装时给出友好提示
      mysql = await import('mysql2/promise');
    } catch {
      throw new Error('请安装 mysql2 包：npm install mysql2');
    }

    this.config = config;
    const connStr = config.connectionString;

    const connConfig: any = connStr
      ? { uri: connStr, ssl: config.ssl ? {} : undefined }
      : {
          host: config.host ?? 'localhost',
          port: config.port ?? 3306,
          user: config.user,
          password: config.password,
          database: config.database,
          ssl: config.ssl ? {} : undefined,
        };

    this.conn = await mysql.createConnection(connConfig);
  }

  async query(sql: string, timeout: number): Promise<QueryResult> {
    if (!this.conn) throw new Error('未连接到数据库');

    if (this.config?.readonly && WRITE_KEYWORDS.test(sql)) {
      throw new Error('只读模式：不允许执行写操作');
    }

    const start = Date.now();
    const [rows, fields] = await this.conn.query({ sql, timeout });
    const duration = Date.now() - start;

    const resultRows: Record<string, unknown>[] = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
    const columns: string[] = fields ? (fields as any[]).map((f: any) => f.name) : Object.keys(resultRows[0] ?? {});

    // 对于非 SELECT 语句，rows 是 ResultSetHeader
    const isResultSet = Array.isArray(rows);
    const affectedRows = isResultSet ? undefined : (rows as any).affectedRows;

    return {
      columns,
      rows: resultRows,
      rowCount: isResultSet ? resultRows.length : (rows as any).affectedRows ?? 0,
      duration,
      affectedRows,
    };
  }

  async listDatabases(): Promise<string[]> {
    const [rows] = await this.conn.query('SHOW DATABASES');
    return (rows as any[]).map((r: any) => Object.values(r)[0] as string);
  }

  async listTables(database?: string): Promise<string[]> {
    const [rows] = await this.conn.query('SHOW TABLES');
    return (rows as any[]).map((r: any) => Object.values(r)[0] as string);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const [rows] = await this.conn.query(`DESCRIBE \`${table}\``);
    return (rows as any[]).map((r: any) => ({
      name: r.Field,
      type: r.Type,
      nullable: r.Null === 'YES',
    }));
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      await this.conn.end();
      this.conn = null;
    }
  }

  isConnected(): boolean {
    return this.conn !== null;
  }
}
