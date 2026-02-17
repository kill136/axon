export interface ConnectionConfig {
  type: 'postgres' | 'mysql' | 'sqlite' | 'redis' | 'mongo';
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  readonly?: boolean;
  maxRows?: number;
  queryTimeout?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface QueryResult {
  columns: string[];
  columnTypes?: ColumnInfo[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  command?: string;
  affectedRows?: number;
}

export interface DatabaseToolInput {
  action: 'connect' | 'disconnect' | 'query' | 'list_connections' | 'list_databases' | 'list_tables' | 'describe_table';
  connection?: string;
  connectionString?: string;
  type?: 'postgres' | 'mysql' | 'sqlite' | 'redis' | 'mongo';
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  readonly?: boolean;
  sql?: string;
  table?: string;
  maxRows?: number;
  timeout?: number;
}

export interface DriverInterface {
  connect(config: ConnectionConfig): Promise<void>;
  query(sql: string, timeout: number): Promise<QueryResult>;
  listDatabases(): Promise<string[]>;
  listTables(database?: string): Promise<string[]>;
  describeTable(table: string): Promise<ColumnInfo[]>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
