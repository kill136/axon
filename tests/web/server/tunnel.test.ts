/**
 * Tests for Cloudflare Tunnel module
 *
 * 测试 CloudflareTunnel 类的基本行为：构造、状态、停止、事件。
 * 不测试实际的 cloudflared 启动（需要网络和二进制），
 * 只测试可以纯逻辑验证的部分。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudflareTunnel, getTunnel } from '../../../src/web/server/tunnel.js';

describe('CloudflareTunnel', () => {
  let tunnel: CloudflareTunnel;

  beforeEach(() => {
    tunnel = new CloudflareTunnel(3456);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tunnel.stop();
  });

  describe('constructor', () => {
    it('should initialize with stopped status', () => {
      const info = tunnel.info;
      expect(info.status).toBe('stopped');
      expect(info.url).toBeNull();
      expect(info.wsUrl).toBeNull();
      expect(info.error).toBeNull();
      expect(info.startedAt).toBeNull();
      expect(info.localPort).toBe(3456);
    });
  });

  describe('info', () => {
    it('should return current tunnel info', () => {
      const info = tunnel.info;
      expect(info).toEqual({
        status: 'stopped',
        url: null,
        wsUrl: null,
        error: null,
        startedAt: null,
        localPort: 3456,
      });
    });

    it('should convert https to wss for wsUrl', () => {
      // Manually set internal state to test wsUrl conversion
      (tunnel as any)._url = 'https://test.trycloudflare.com';
      (tunnel as any)._status = 'connected';
      expect(tunnel.info.wsUrl).toBe('wss://test.trycloudflare.com');
    });
  });

  describe('stop', () => {
    it('should set status to stopped', async () => {
      const info = await tunnel.stop();
      expect(info.status).toBe('stopped');
      expect(info.url).toBeNull();
      expect(info.wsUrl).toBeNull();
      expect(info.error).toBeNull();
      expect(info.startedAt).toBeNull();
    });

    it('should emit status event', async () => {
      const handler = vi.fn();
      tunnel.on('status', handler);

      await tunnel.stop();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        status: 'stopped',
      }));
    });
  });

  describe('start', () => {
    it('should not start again if already connected', async () => {
      // Simulate connected state
      (tunnel as any)._status = 'connected';
      (tunnel as any)._url = 'https://existing.trycloudflare.com';

      const info = await tunnel.start();
      expect(info.status).toBe('connected');
      expect(info.url).toBe('https://existing.trycloudflare.com');
    });

    it('should not start again if already starting', async () => {
      (tunnel as any)._status = 'starting';

      const info = await tunnel.start();
      expect(info.status).toBe('starting');
    });

    it('should not start again if installing', async () => {
      (tunnel as any)._status = 'installing';

      const info = await tunnel.start();
      expect(info.status).toBe('installing');
    });
  });

  describe('getTunnel singleton', () => {
    it('should return same instance for same port', () => {
      const t1 = getTunnel(3456);
      const t2 = getTunnel(3456);
      expect(t1).toBe(t2);
    });

    it('should return new instance for different port', () => {
      const t1 = getTunnel(3456);
      const t2 = getTunnel(4567);
      expect(t1).not.toBe(t2);
    });
  });
});
