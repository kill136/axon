import type { DriverInterface, ConnectionConfig, QueryResult, ColumnInfo } from '../types.js';

export class RedisDriver implements DriverInterface {
  private client: any = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    let Redis: any;
    try {
      // @ts-ignore - 可选依赖，未安装时给出友好提示
      const mod = await import('ioredis');
      Redis = mod.default ?? mod;
    } catch {
      throw new Error('Please install ioredis package: npm install ioredis');
    }

    this.config = config;
    const connStr = config.connectionString;

    if (connStr) {
      this.client = new Redis(connStr);
    } else {
      this.client = new Redis({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password,
        db: 0,
        tls: config.ssl ? {} : undefined,
      });
    }

    // 等待连接就绪
    await new Promise<void>((resolve, reject) => {
      this.client.once('ready', resolve);
      this.client.once('error', reject);
    });
  }

  async query(sql: string, timeout: number): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected to database');

    if (this.config?.readonly) {
      const cmd = sql.trim().split(/\s+/)[0].toUpperCase();
      const writeCmds = new Set(['SET', 'DEL', 'HSET', 'HMSET', 'LPUSH', 'RPUSH', 'SADD', 'ZADD', 'INCR', 'DECR', 'EXPIRE', 'PERSIST', 'RENAME', 'FLUSHDB', 'FLUSHALL']);
      if (writeCmds.has(cmd)) {
        throw new Error('Read-only mode: write operations not allowed');
      }
    }

    const start = Date.now();
    // 解析命令和参数
    const parts = sql.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const result = await this.client.call(cmd, ...args);
    const duration = Date.now() - start;

    // 格式化结果
    const resultStr = Array.isArray(result)
      ? result.map(String)
      : [String(result ?? 'nil')];

    const rows: Record<string, unknown>[] = resultStr.map((v, i) => ({ index: i, value: v }));

    return {
      columns: ['index', 'value'],
      rows,
      rowCount: rows.length,
      duration,
      command: cmd.toUpperCase(),
    };
  }

  async listDatabases(): Promise<string[]> {
    return Array.from({ length: 16 }, (_, i) => `db${i}`);
  }

  async listTables(database?: string): Promise<string[]> {
    if (!this.client) throw new Error('Not connected to database');
    const keys = await this.client.keys('*');
    return keys;
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    if (!this.client) throw new Error('Not connected to database');
    const type = await this.client.type(table);
    let encoding = 'unknown';
    try {
      encoding = await this.client.object('ENCODING', table);
    } catch {
      // 可能不支持
    }
    return [
      { name: 'key', type: table },
      { name: 'type', type },
      { name: 'encoding', type: encoding },
    ];
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}
