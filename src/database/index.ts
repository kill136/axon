import type { DriverInterface, ConnectionConfig, QueryResult, ColumnInfo } from './types.js';

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;

export class ConnectionManager {
  private connections = new Map<string, { driver: DriverInterface; config: ConnectionConfig; name: string }>();

  async createDriver(config: ConnectionConfig): Promise<DriverInterface> {
    switch (config.type) {
      case 'postgres': {
        const { PostgresDriver } = await import('./drivers/postgres.js');
        return new PostgresDriver();
      }
      case 'mysql': {
        const { MySQLDriver } = await import('./drivers/mysql.js');
        return new MySQLDriver();
      }
      case 'sqlite': {
        const { SQLiteDriver } = await import('./drivers/sqlite.js');
        return new SQLiteDriver();
      }
      case 'redis': {
        const { RedisDriver } = await import('./drivers/redis.js');
        return new RedisDriver();
      }
      case 'mongo': {
        const { MongoDriver } = await import('./drivers/mongo.js');
        return new MongoDriver();
      }
      default:
        throw new Error(`Unsupported database type: ${(config as any).type}`);
    }
  }

  async connect(name: string, config: ConnectionConfig): Promise<void> {
    if (this.connections.has(name)) {
      // 先断开已有连接
      await this.disconnect(name);
    }
    const driver = await this.createDriver(config);
    await driver.connect(config);
    this.connections.set(name, { driver, config, name });
  }

  async disconnect(name: string): Promise<void> {
    const entry = this.connections.get(name);
    if (!entry) throw new Error(`Connection not found: ${name}`);
    await entry.driver.disconnect();
    this.connections.delete(name);
  }

  async query(name: string, sql: string, maxRows: number, timeout: number): Promise<QueryResult> {
    const entry = this.connections.get(name);
    if (!entry) throw new Error(`Connection not found: ${name}`);
    const result = await entry.driver.query(sql, timeout);
    // 截断行数
    if (result.rows.length > maxRows) {
      const total = result.rows.length;
      result.rows = result.rows.slice(0, maxRows);
      result.rowCount = total;
      (result as any).__truncated = true;
      (result as any).__displayRows = maxRows;
    }
    return result;
  }

  listConnections(): Array<{ name: string; type: string; database: string; readonly: boolean }> {
    return Array.from(this.connections.values()).map(({ config, name }) => ({
      name,
      type: config.type,
      database: config.database ?? config.connectionString ?? '',
      readonly: config.readonly ?? false,
    }));
  }

  async listDatabases(name: string): Promise<string[]> {
    const entry = this.connections.get(name);
    if (!entry) throw new Error(`Connection not found: ${name}`);
    return entry.driver.listDatabases();
  }

  async listTables(name: string, database?: string): Promise<string[]> {
    const entry = this.connections.get(name);
    if (!entry) throw new Error(`Connection not found: ${name}`);
    return entry.driver.listTables(database);
  }

  async describeTable(name: string, table: string): Promise<ColumnInfo[]> {
    const entry = this.connections.get(name);
    if (!entry) throw new Error(`Connection not found: ${name}`);
    return entry.driver.describeTable(table);
  }

  checkReadonly(sql: string): boolean {
    return WRITE_KEYWORDS.test(sql);
  }

  maskPassword(connStr: string): string {
    // 掩盖 URL 中的密码：protocol://user:password@host
    return connStr.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
  }
}

// 全局单例
export const connectionManager = new ConnectionManager();
