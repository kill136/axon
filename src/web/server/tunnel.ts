/**
 * Cloudflare Tunnel Manager
 *
 * 使用 cloudflared npm 包创建临时隧道（quick tunnel），
 * 无需 Cloudflare 账号即可将本地服务暴露到公网。
 *
 * cloudflared 二进制由 npm 包自动管理（postinstall 下载），
 * 用户无需手动安装任何东西。
 *
 * 原理：cloudflared tunnel --url http://localhost:PORT
 * 会自动分配一个 *.trycloudflare.com 域名。
 */

import { EventEmitter } from 'events';
import fs from 'fs';

export type TunnelStatus = 'stopped' | 'starting' | 'connected' | 'error' | 'installing';

export interface TunnelInfo {
  status: TunnelStatus;
  url: string | null;
  wsUrl: string | null;
  error: string | null;
  startedAt: number | null;
  localPort: number;
}

export class CloudflareTunnel extends EventEmitter {
  private tunnel: any = null;
  private _status: TunnelStatus = 'stopped';
  private _url: string | null = null;
  private _error: string | null = null;
  private _startedAt: number | null = null;
  private _localPort: number;

  constructor(localPort: number) {
    super();
    this._localPort = localPort;
  }

  get info(): TunnelInfo {
    return {
      status: this._status,
      url: this._url,
      wsUrl: this._url ? this._url.replace('https://', 'wss://') : null,
      error: this._error,
      startedAt: this._startedAt,
      localPort: this._localPort,
    };
  }

  /**
   * 确保 cloudflared 二进制已安装。
   * 如果 npm postinstall 没跑（比如 --ignore-scripts），则在运行时自动安装。
   */
  private async ensureBinary(): Promise<string> {
    const { bin, install } = await import('cloudflared');

    if (!fs.existsSync(bin)) {
      this._status = 'installing';
      this._error = null;
      this.emit('status', this.info);

      await install(bin);
    }

    return bin;
  }

  /**
   * 启动 Cloudflare Quick Tunnel
   */
  async start(): Promise<TunnelInfo> {
    if (this._status === 'connected' || this._status === 'starting' || this._status === 'installing') {
      return this.info;
    }

    try {
      await this.ensureBinary();
    } catch (err: any) {
      this._status = 'error';
      this._error = `Failed to install cloudflared: ${err.message}`;
      this.emit('status', this.info);
      return this.info;
    }

    this._status = 'starting';
    this._error = null;
    this._url = null;
    this.emit('status', this.info);

    return new Promise((resolve) => {
      let resolved = false;

      import('cloudflared').then(({ Tunnel }) => {
        const t = Tunnel.quick(`http://localhost:${this._localPort}`);
        this.tunnel = t;

        t.on('url', (url: string) => {
          if (!resolved) {
            resolved = true;
            this._url = url;
            this._status = 'connected';
            this._startedAt = Date.now();
            this._error = null;
            this.emit('status', this.info);
            resolve(this.info);
          }
        });

        t.on('error', (err: Error) => {
          this._status = 'error';
          this._error = `cloudflared error: ${err.message}`;
          this.tunnel = null;
          this.emit('status', this.info);
          if (!resolved) {
            resolved = true;
            resolve(this.info);
          }
        });

        t.on('exit', (code: number | null) => {
          if (this._status === 'connected') {
            this._status = 'stopped';
            this._url = null;
            this._startedAt = null;
            this.tunnel = null;
            this.emit('status', this.info);
          } else if (!resolved) {
            this._status = 'error';
            this._error = `cloudflared exited with code ${code}`;
            this.tunnel = null;
            resolved = true;
            this.emit('status', this.info);
            resolve(this.info);
          }
        });

        // 超时 30 秒
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            if (this._status === 'starting') {
              this._status = 'error';
              this._error = 'Tunnel connection timed out (30s)';
              this.emit('status', this.info);
            }
            resolve(this.info);
          }
        }, 30000);
      }).catch((err: any) => {
        this._status = 'error';
        this._error = `Failed to load cloudflared module: ${err.message}`;
        this.emit('status', this.info);
        if (!resolved) {
          resolved = true;
          resolve(this.info);
        }
      });
    });
  }

  /**
   * 停止隧道
   */
  async stop(): Promise<TunnelInfo> {
    if (this.tunnel) {
      try {
        this.tunnel.stop();
      } catch {
        // ignore — process may already be dead
      }
      this.tunnel = null;
    }

    this._status = 'stopped';
    this._url = null;
    this._startedAt = null;
    this._error = null;
    this.emit('status', this.info);
    return this.info;
  }
}

// 全局单例
let tunnelInstance: CloudflareTunnel | null = null;

export function getTunnel(localPort: number): CloudflareTunnel {
  if (!tunnelInstance || tunnelInstance.info.localPort !== localPort) {
    tunnelInstance = new CloudflareTunnel(localPort);
  }
  return tunnelInstance;
}
