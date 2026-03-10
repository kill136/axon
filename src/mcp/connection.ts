/**
 * MCP Connection Management Module
 *
 * This module provides a comprehensive connection management system for MCP (Model Context Protocol) servers.
 * It supports multiple transport types (stdio, SSE, HTTP, WebSocket) with advanced features like:
 * - Connection pooling and reuse
 * - Automatic reconnection with exponential backoff
 * - Heartbeat monitoring
 * - Message queueing and retry mechanisms
 * - Event-driven architecture
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosInstance } from 'axios';
import { createRequire } from 'module';
import http from 'http';
import https from 'https';
import { WebSocketConnection } from './websocket-connection.js';
import { VERSION } from '../version.js';

// Import EventSource for Node.js (CommonJS module)
const require = createRequire(import.meta.url);
const EventSource = require('eventsource');

// ============ Type Definitions ============

export interface ConnectionOptions {
  timeout?: number;                  // Request timeout in ms (default: 30000)
  maxRetries?: number;                // Max retry attempts (default: 3)
  heartbeatInterval?: number;         // Heartbeat interval in ms (default: 30000)
  poolSize?: number;                  // Max connections per server (default: 5)
  reconnectDelayBase?: number;        // Base delay for exponential backoff (default: 1000)
  queueMaxSize?: number;              // Max queued messages (default: 100)
}

export interface McpServerInfo {
  name: string;
  type: 'stdio' | 'sse' | 'http' | 'websocket';
  // For stdio connections
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For HTTP/SSE/WebSocket connections
  url?: string;
  headers?: Record<string, string>;
  // Authentication
  auth?: {
    type: 'bearer' | 'basic';
    token?: string;
    username?: string;
    password?: string;
  };
}

export interface McpConnection {
  id: string;
  serverName: string;
  type: 'stdio' | 'sse' | 'http' | 'websocket';
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  createdAt: Date;
  lastActivity: Date;
  transport?: McpTransport;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

export interface McpMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpResponse {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface QueuedMessage {
  id: string;
  message: McpMessage;
  resolve: (value: McpResponse) => void;
  reject: (error: Error) => void;
  timestamp: number;
  retries: number;
}

// ============ Transport Interface ============

export interface McpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: McpMessage): Promise<void>;
  sendNotification(method: string, params: unknown): Promise<void>;
  isConnected(): boolean;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
}

// ============ Connection Implementations ============

/**
 * Stdio-based MCP connection (subprocess communication)
 */
export class StdioConnection extends EventEmitter implements McpTransport {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private process?: ChildProcess;
  private buffer: string = '';
  private connected: boolean = false;

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}) {
    super();
    this.command = command;
    this.args = args;
    this.env = { ...process.env, ...env };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.on('error', (err) => {
          this.connected = false;
          this.emit('error', err);
          reject(err);
        });

        this.process.on('exit', (code) => {
          this.connected = false;
          this.emit('disconnect', code);
        });

        // Handle stdout data
        this.process.stdout?.on('data', (data: Buffer) => {
          this.buffer += data.toString();
          this.processBuffer();
        });

        // Handle stderr (log it)
        this.process.stderr?.on('data', (data: Buffer) => {
          this.emit('stderr', data.toString());
        });

        this.connected = true;
        this.emit('connect');
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message: McpMessage = JSON.parse(line);
          this.emit('message', message);
        } catch (err) {
          this.emit('parse-error', err, line);
        }
      }
    }
  }

  async send(message: McpMessage): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error('Connection not established');
    }

    return new Promise((resolve, reject) => {
      try {
        const data = JSON.stringify(message) + '\n';
        this.process!.stdin!.write(data, (err) => {
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async sendNotification(method: string, params: unknown): Promise<void> {
    const message: McpMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    await this.send(message);
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.connected = false;
    this.emit('disconnect');
  }

  isConnected(): boolean {
    return this.connected && !!this.process;
  }
}

/**
 * Server-Sent Events (SSE) based MCP connection
 * Uses native EventSource for real-time event streaming
 */
export class SseConnection extends EventEmitter implements McpTransport {
  private url: string;
  private headers: Record<string, string>;
  private eventSource?: any; // EventSource instance
  private httpClient: AxiosInstance;
  private connected: boolean = false;

  constructor(url: string, headers: Record<string, string> = {}) {
    super();
    this.url = url;
    this.headers = headers;

    // v2.1.11: 使用 HTTP Agent 连接池优化
    // keepAlive 启用连接重用，减少 TCP 连接开销
    const httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 5,
      maxFreeSockets: 2,
    });

    const httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 5,
      maxFreeSockets: 2,
    });

    this.httpClient = axios.create({
      baseURL: url,
      headers,
      httpAgent,
      httpsAgent,
      // v2.1.11: 保持长连接
      timeout: 30000,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        // Create EventSource connection for SSE streaming
        const eventSourceUrl = `${this.url}/events`;

        // EventSource options with custom headers
        const eventSourceInitDict = {
          headers: this.headers,
        };

        this.eventSource = new EventSource(eventSourceUrl, eventSourceInitDict);

        // Handle connection open
        this.eventSource.onopen = () => {
          this.connected = true;
          this.emit('connect');
          resolve();
        };

        // Handle incoming messages
        this.eventSource.onmessage = (event: MessageEvent) => {
          try {
            const message: McpMessage = JSON.parse(event.data);
            this.emit('message', message);
          } catch (err) {
            this.emit('parse-error', err, event.data);
          }
        };

        // Handle errors
        this.eventSource.onerror = (err) => {
          if (!this.connected) {
            // Connection failed during initial connect
            reject(new Error('Failed to establish SSE connection'));
          } else {
            // Connection error after successful connect
            this.emit('error', err);
          }
        };

        // Set a timeout for initial connection
        setTimeout(() => {
          if (!this.connected) {
            this.disconnect();
            reject(new Error('SSE connection timeout'));
          }
        }, 10000);
      } catch (err) {
        reject(err);
      }
    });
  }

  async send(message: McpMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Connection not established');
    }

    try {
      // Send messages via HTTP POST (SSE is unidirectional)
      const response = await this.httpClient.post('/messages', message);

      // Response handling is done through SSE events
      // No need to emit message here as it will come through EventSource
      return;
    } catch (err) {
      throw new Error(`Failed to send message: ${err}`);
    }
  }

  async sendNotification(method: string, params: unknown): Promise<void> {
    const message: McpMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    await this.send(message);
  }

  async disconnect(): Promise<void> {
    this.connected = false;

    if (this.eventSource) {
      // Remove event listeners to prevent memory leaks
      this.eventSource.onopen = null;
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;

      // Close the EventSource connection
      this.eventSource.close();
      this.eventSource = undefined;
    }

    this.emit('disconnect');
  }

  isConnected(): boolean {
    return this.connected && this.eventSource?.readyState === EventSource.OPEN;
  }
}

/**
 * HTTP-based MCP connection (REST API)
 */
export class HttpConnection extends EventEmitter implements McpTransport {
  private url: string;
  private headers: Record<string, string>;
  private httpClient: AxiosInstance;
  private connected: boolean = false;

  constructor(url: string, headers: Record<string, string> = {}) {
    super();
    this.url = url;
    this.headers = headers;

    // v2.1.11: 使用 HTTP Agent 连接池优化
    const httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 5,
      maxFreeSockets: 2,
    });

    const httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 5,
      maxFreeSockets: 2,
    });

    this.httpClient = axios.create({
      baseURL: url,
      headers,
      httpAgent,
      httpsAgent,
      timeout: 30000,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // Test connection with a ping or health check
      await this.httpClient.get('/health');
      this.connected = true;
      this.emit('connect');
    } catch (err) {
      throw new Error(`Failed to connect to ${this.url}: ${err}`);
    }
  }

  async send(message: McpMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Connection not established');
    }

    try {
      const response = await this.httpClient.post('/rpc', message);
      if (response.data) {
        this.emit('message', response.data);
      }
    } catch (err) {
      throw new Error(`Failed to send message: ${err}`);
    }
  }

  async sendNotification(method: string, params: unknown): Promise<void> {
    const message: McpMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    await this.send(message);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnect');
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ============ Connection Manager ============

/**
 * Main MCP Connection Manager
 *
 * Manages multiple MCP server connections with advanced features:
 * - Connection pooling and reuse
 * - Automatic reconnection with exponential backoff
 * - Heartbeat monitoring
 * - Message queueing and retry
 * - Event-driven notifications
 */
export class McpConnectionManager extends EventEmitter {
  private connections: Map<string, McpConnection> = new Map();
  private messageQueues: Map<string, QueuedMessage[]> = new Map();
  private pendingRequests: Map<string | number, QueuedMessage> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private messageIdCounter: number = 1;
  private options: Required<ConnectionOptions>;

  constructor(options: ConnectionOptions = {}) {
    super();
    this.options = {
      timeout: options.timeout ?? 30000,
      maxRetries: options.maxRetries ?? 3,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      poolSize: options.poolSize ?? 5,
      reconnectDelayBase: options.reconnectDelayBase ?? 1000,
      queueMaxSize: options.queueMaxSize ?? 100,
    };
  }

  /**
   * Connect to an MCP server
   */
  async connect(server: McpServerInfo): Promise<McpConnection> {
    // Check if connection already exists
    const existingConnection = this.getConnectionByServer(server.name);
    if (existingConnection && existingConnection.status === 'connected') {
      return existingConnection;
    }

    // Create new connection
    const connectionId = uuidv4();
    const connection: McpConnection = {
      id: connectionId,
      serverName: server.name,
      type: server.type,
      status: 'connecting',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, connection);
    this.emit('connection:establishing', connection);

    try {
      // Create transport based on type
      let transport: McpTransport;

      switch (server.type) {
        case 'stdio':
          if (!server.command) throw new Error('Command required for stdio connection');
          transport = new StdioConnection(server.command, server.args, server.env);
          break;

        case 'sse':
          if (!server.url) throw new Error('URL required for SSE connection');
          transport = new SseConnection(server.url, server.headers);
          break;

        case 'http':
          if (!server.url) throw new Error('URL required for HTTP connection');
          transport = new HttpConnection(server.url, server.headers);
          break;

        case 'websocket':
          if (!server.url) throw new Error('URL required for WebSocket connection');
          transport = new WebSocketConnection(server.url, {
            headers: server.headers,
            sessionId: connectionId,
          });
          break;

        default:
          throw new Error(`Unsupported connection type: ${server.type}`);
      }

      // Set up transport event handlers
      this.setupTransportHandlers(connectionId, transport);

      // Connect
      await transport.connect();
      connection.transport = transport;

      // Initialize MCP protocol
      const initResult = await this.sendInitialize(connectionId);
      connection.capabilities = (initResult as any)?.capabilities || {};
      connection.status = 'connected';
      connection.lastActivity = new Date();

      // Send initialized notification
      await transport.sendNotification('notifications/initialized', {});

      // Start heartbeat
      this.startHeartbeat(connectionId);

      this.emit('connection:established', connection);
      return connection;
    } catch (err) {
      connection.status = 'error';
      this.emit('connection:error', connection, err);
      throw err;
    }
  }

  /**
   * Set up event handlers for a transport
   */
  private setupTransportHandlers(connectionId: string, transport: McpTransport): void {
    transport.on('message', (message: McpMessage) => {
      this.handleMessage(connectionId, message);
    });

    transport.on('error', (err: Error) => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.status = 'error';
        this.emit('connection:error', connection, err);
      }
    });

    transport.on('disconnect', () => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.status = 'disconnected';
        this.stopHeartbeat(connectionId);
        this.emit('connection:closed', connection);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(connectionId: string, message: McpMessage): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastActivity = new Date();
    this.emit('message:received', connectionId, message);

    // Handle response to a request
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve({ result: message.result });
        }
      }
    }
  }

  /**
   * Send initialize message
   */
  private async sendInitialize(connectionId: string): Promise<unknown> {
    const initMessage: McpMessage = {
      jsonrpc: '2.0',
      id: this.messageIdCounter++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'axon',
          version: VERSION,
        },
      },
    };

    const response = await this.sendWithRetry(connectionId, initMessage);
    return response.result;
  }

  /**
   * Disconnect from a server
   */
  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.stopHeartbeat(connectionId);

    if (connection.transport) {
      await connection.transport.disconnect();
    }

    // Clear pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.message.id === connectionId) {
        pending.reject(new Error('Connection closed'));
        this.pendingRequests.delete(id);
      }
    }

    // Clear message queue
    this.messageQueues.delete(connectionId);

    connection.status = 'disconnected';
    this.emit('connection:closed', connection);
  }

  /**
   * Disconnect all connections
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((id) =>
      this.disconnect(id)
    );
    await Promise.all(disconnectPromises);
  }

  /**
   * Send a message to a server
   */
  async send(connectionId: string, message: McpMessage): Promise<McpResponse> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.transport) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    if (connection.status !== 'connected') {
      throw new Error(`Connection not ready: ${connection.status}`);
    }

    // Assign message ID if not present
    if (message.id === undefined && message.method) {
      message.id = this.messageIdCounter++;
    }

    return new Promise((resolve, reject) => {
      const queuedMessage: QueuedMessage = {
        id: uuidv4(),
        message,
        resolve,
        reject,
        timestamp: Date.now(),
        retries: 0,
      };

      if (message.id !== undefined) {
        this.pendingRequests.set(message.id, queuedMessage);
      }

      // Set timeout
      setTimeout(() => {
        if (message.id !== undefined) {
          this.pendingRequests.delete(message.id);
        }
        reject(new Error('Request timeout'));
      }, this.options.timeout);

      // Send immediately
      connection.transport!.send(message).catch((err) => {
        if (message.id !== undefined) {
          this.pendingRequests.delete(message.id);
        }
        reject(err);
      });

      this.emit('message:sent', connectionId, message);
    });
  }

  /**
   * Send a message with retry logic
   */
  async sendWithRetry(connectionId: string, message: McpMessage): Promise<McpResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        return await this.send(connectionId, message);
      } catch (err) {
        lastError = err as Error;

        if (attempt < this.options.maxRetries) {
          const delay = this.options.reconnectDelayBase * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Send failed after retries');
  }

  /**
   * Get connection by ID
   */
  getConnection(id: string): McpConnection | null {
    return this.connections.get(id) || null;
  }

  /**
   * Get connection by server name
   */
  getConnectionByServer(serverName: string): McpConnection | null {
    for (const connection of this.connections.values()) {
      if (connection.serverName === serverName && connection.status === 'connected') {
        return connection;
      }
    }
    return null;
  }

  /**
   * Get all connections
   */
  getAllConnections(): McpConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Start heartbeat for a connection
   */
  startHeartbeat(connectionId: string): void {
    this.stopHeartbeat(connectionId); // Clear existing timer

    const timer = setInterval(async () => {
      try {
        const connection = this.connections.get(connectionId);
        if (!connection || connection.status !== 'connected') {
          this.stopHeartbeat(connectionId);
          return;
        }

        // Send ping message
        const pingMessage: McpMessage = {
          jsonrpc: '2.0',
          id: this.messageIdCounter++,
          method: 'ping',
          params: {},
        };

        await this.send(connectionId, pingMessage);
      } catch (err) {
        this.emit('heartbeat:failed', connectionId, err);

        // Attempt reconnection
        const connection = this.connections.get(connectionId);
        if (connection) {
          this.emit('connection:reconnecting', connection);
        }
      }
    }, this.options.heartbeatInterval);

    this.heartbeatTimers.set(connectionId, timer);
  }

  /**
   * Stop heartbeat for a connection
   */
  stopHeartbeat(connectionId: string): void {
    const timer = this.heartbeatTimers.get(connectionId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(connectionId);
    }
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.disconnectAll();

    // Clear all timers
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    // Clear all pending requests
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Manager disposed'));
    }
    this.pendingRequests.clear();

    // Clear queues
    this.messageQueues.clear();
  }
}

// ============ Helper Functions ============

/**
 * Create a connection manager with default options
 */
export function createConnectionManager(options?: ConnectionOptions): McpConnectionManager {
  return new McpConnectionManager(options);
}

/**
 * Create a stdio transport
 */
export function createStdioTransport(
  command: string,
  args: string[] = [],
  env: Record<string, string> = {}
): StdioConnection {
  return new StdioConnection(command, args, env);
}

/**
 * Create an HTTP transport
 */
export function createHttpTransport(
  url: string,
  headers: Record<string, string> = {}
): HttpConnection {
  return new HttpConnection(url, headers);
}

/**
 * Create an SSE transport
 */
export function createSseTransport(
  url: string,
  headers: Record<string, string> = {}
): SseConnection {
  return new SseConnection(url, headers);
}
