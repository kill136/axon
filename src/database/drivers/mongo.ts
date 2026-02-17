import type { DriverInterface, ConnectionConfig, QueryResult, ColumnInfo } from '../types.js';

export class MongoDriver implements DriverInterface {
  private mongoClient: any = null;
  private db: any = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    let MongoClient: any;
    try {
      // @ts-ignore - 可选依赖，未安装时给出友好提示
      const mod = await import('mongodb');
      MongoClient = mod.MongoClient;
    } catch {
      throw new Error('请安装 mongodb 包：npm install mongodb');
    }

    this.config = config;
    const connStr = config.connectionString ?? `mongodb://${config.host ?? 'localhost'}:${config.port ?? 27017}`;

    this.mongoClient = new MongoClient(connStr, {
      tls: config.ssl,
      auth: config.user ? { username: config.user, password: config.password } : undefined,
    });
    await this.mongoClient.connect();
    this.db = this.mongoClient.db(config.database);
  }

  async query(sql: string, timeout: number): Promise<QueryResult> {
    if (!this.db) throw new Error('未连接到数据库');

    // sql 字段解析为 JSON 命令
    let cmd: any;
    try {
      cmd = JSON.parse(sql);
    } catch {
      throw new Error('MongoDB 查询必须是 JSON 格式，例如：{"collection":"users","find":{},"limit":10}');
    }

    if (this.config?.readonly) {
      if (cmd.insert || cmd.update || cmd.delete || cmd.drop || cmd.create) {
        throw new Error('只读模式：不允许执行写操作');
      }
    }

    const start = Date.now();
    const collection = this.db.collection(cmd.collection);

    let rows: Record<string, unknown>[] = [];
    let command = 'find';

    if (cmd.find !== undefined) {
      command = 'find';
      const cursor = collection.find(cmd.find ?? {}, { projection: cmd.projection });
      if (cmd.sort) cursor.sort(cmd.sort);
      if (cmd.skip) cursor.skip(cmd.skip);
      const limit = cmd.limit ?? 100;
      cursor.limit(limit);
      const docs = await cursor.toArray();
      rows = docs.map((d: any) => {
        const { _id, ...rest } = d;
        return { _id: String(_id), ...rest };
      });
    } else if (cmd.aggregate) {
      command = 'aggregate';
      const docs = await collection.aggregate(cmd.aggregate).toArray();
      rows = docs;
    } else if (cmd.count !== undefined) {
      command = 'count';
      const count = await collection.countDocuments(cmd.count ?? {});
      rows = [{ count }];
    } else {
      throw new Error('不支持的 MongoDB 命令，支持：find, aggregate, count');
    }

    const duration = Date.now() - start;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return { columns, rows, rowCount: rows.length, duration, command };
  }

  async listDatabases(): Promise<string[]> {
    if (!this.mongoClient) throw new Error('未连接到数据库');
    const admin = this.mongoClient.db().admin();
    const result = await admin.listDatabases();
    return result.databases.map((d: any) => d.name);
  }

  async listTables(database?: string): Promise<string[]> {
    if (!this.db) throw new Error('未连接到数据库');
    const db = database ? this.mongoClient.db(database) : this.db;
    const collections = await db.listCollections().toArray();
    return collections.map((c: any) => c.name);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    if (!this.db) throw new Error('未连接到数据库');
    const doc = await this.db.collection(table).findOne({});
    if (!doc) return [];
    return Object.entries(doc).map(([key, val]) => ({
      name: key,
      type: Array.isArray(val) ? 'array' : typeof val,
    }));
  }

  async disconnect(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close();
      this.mongoClient = null;
      this.db = null;
    }
  }

  isConnected(): boolean {
    return this.mongoClient !== null;
  }
}
