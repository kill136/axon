import type { DriverInterface, ConnectionConfig, QueryResult, ColumnInfo } from '../types.js';

// readonly 模式下禁止的关键字
const WRITE_KEYWORDS = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|CALL|EXEC)/i;

export class PostgresDriver implements DriverInterface {
  private client: any = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    let pg: any;
    try {
      // @ts-ignore - 可选依赖，未安装时给出友好提示
      const mod = await import('pg');
      pg = mod.default ?? mod;
    } catch {
      throw new Error('请安装 pg 包：npm install pg');
    }

    this.config = config;
    const connStr = config.connectionString;

    const clientConfig: any = connStr
      ? { connectionString: connStr, ssl: config.ssl ? { rejectUnauthorized: false } : undefined }
      : {
          host: config.host ?? 'localhost',
          port: config.port ?? 5432,
          user: config.user,
          password: config.password,
          database: config.database,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        };

    this.client = new pg.Client(clientConfig);
    await this.client.connect();
  }

  async query(sql: string, timeout: number): Promise<QueryResult> {
    if (!this.client) throw new Error('未连接到数据库');

    if (this.config?.readonly && WRITE_KEYWORDS.test(sql)) {
      throw new Error('只读模式：不允许执行写操作');
    }

    const start = Date.now();
    // 设置语句超时
    await this.client.query(`SET statement_timeout = ${timeout}`);
    const result = await this.client.query(sql);
    const duration = Date.now() - start;

    const rows: Record<string, unknown>[] = result.rows ?? [];
    const columns: string[] = result.fields ? result.fields.map((f: any) => f.name) : Object.keys(rows[0] ?? {});

    return {
      columns,
      rows,
      rowCount: result.rowCount ?? rows.length,
      duration,
      command: result.command,
      affectedRows: result.rowCount ?? undefined,
    };
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.client.query('SELECT datname FROM pg_database WHERE datistemplate = false');
    return result.rows.map((r: any) => r.datname);
  }

  async listTables(database?: string): Promise<string[]> {
    const result = await this.client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    return result.rows.map((r: any) => r.tablename);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const result = await this.client.query(
      'SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1',
      [table]
    );
    return result.rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
    }));
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}
