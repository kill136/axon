import type { DriverInterface, ConnectionConfig, QueryResult, ColumnInfo } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Database: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDatabase(): Promise<any> {
  if (!_Database) {
    try {
      const mod = await import('better-sqlite3');
      _Database = mod.default;
    } catch (e) {
      throw new Error(
        'Failed to load better-sqlite3 module. Please ensure build dependencies are installed:\n' +
        '  Ubuntu/Debian: apt-get install python3 make g++\n' +
        '  Then re-run: npm install better-sqlite3\n' +
        'Original error: ' + (e as Error).message
      );
    }
  }
  return _Database;
}

const WRITE_KEYWORDS = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE)/i;

export class SQLiteDriver implements DriverInterface {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config;
    const filePath = config.connectionString ?? config.database ?? ':memory:';
    const options = config.readonly ? { readonly: true } : {};
    const Database = await getDatabase();
    this.db = new Database(filePath, options);
  }

  async query(sql: string, timeout: number): Promise<QueryResult> {
    if (!this.db) throw new Error('Not connected to database');

    if (this.config?.readonly && WRITE_KEYWORDS.test(sql)) {
      throw new Error('Read-only mode: write operations not allowed');
    }

    const start = Date.now();
    const trimmed = sql.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH');

    if (isSelect) {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all() as Record<string, unknown>[];
      const duration = Date.now() - start;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { columns, rows, rowCount: rows.length, duration, command: 'SELECT' };
    } else {
      const stmt = this.db.prepare(sql);
      const info = stmt.run();
      const duration = Date.now() - start;
      // 判断命令类型
      const command = trimmed.startsWith('INSERT') ? 'INSERT'
        : trimmed.startsWith('UPDATE') ? 'UPDATE'
        : trimmed.startsWith('DELETE') ? 'DELETE'
        : 'RUN';
      return { columns: [], rows: [], rowCount: info.changes, duration, command, affectedRows: info.changes };
    }
  }

  async listDatabases(): Promise<string[]> {
    const filePath = this.config?.connectionString ?? this.config?.database ?? ':memory:';
    return [filePath];
  }

  async listTables(database?: string): Promise<string[]> {
    if (!this.db) throw new Error('Not connected to database');
    const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    return rows.map(r => r.name);
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    if (!this.db) throw new Error('Not connected to database');
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.map(r => ({
      name: r.name,
      type: r.type,
      nullable: r.notnull === 0,
    }));
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }
}
