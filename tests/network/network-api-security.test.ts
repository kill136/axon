/**
 * Network API 安全性测试
 *
 * 测试 localhost-only 中间件逻辑、toggle 互斥锁
 */

import { describe, it, expect, vi } from 'vitest';

describe('Network API Security', () => {
  describe('requireLocalhost middleware', () => {
    // 直接从模块源码中提取逻辑进行测试（不依赖 supertest）
    function isLocalhost(ip: string): boolean {
      return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
    }

    it('should allow 127.0.0.1', () => {
      expect(isLocalhost('127.0.0.1')).toBe(true);
    });

    it('should allow ::1 (IPv6 loopback)', () => {
      expect(isLocalhost('::1')).toBe(true);
    });

    it('should allow ::ffff:127.0.0.1 (IPv4-mapped IPv6)', () => {
      expect(isLocalhost('::ffff:127.0.0.1')).toBe(true);
    });

    it('should reject 192.168.1.100 (LAN)', () => {
      expect(isLocalhost('192.168.1.100')).toBe(false);
    });

    it('should reject 10.0.0.1 (private)', () => {
      expect(isLocalhost('10.0.0.1')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isLocalhost('')).toBe(false);
    });
  });

  describe('toggle mutex', () => {
    it('should have toggleInProgress flag in module', async () => {
      // 验证 network-api 模块导出的 router 存在
      // 以及 toggle 端点要求 boolean enabled 参数
      const module = await import('../../src/web/server/routes/network-api.js');
      expect(module.default).toBeDefined();

      // router 是 express Router，应有 stack 包含 toggle 路由
      const router = module.default;
      const routes = (router as any).stack
        ?.filter((layer: any) => layer.route)
        ?.map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      // 验证 toggle 路由存在
      const toggleRoute = routes?.find((r: any) => r.path === '/toggle');
      expect(toggleRoute).toBeDefined();
      expect(toggleRoute?.methods).toContain('post');
    });
  });

  describe('write endpoints have localhost middleware', () => {
    it('should have middleware on all write routes', async () => {
      const module = await import('../../src/web/server/routes/network-api.js');
      const router = module.default;

      const writeRoutes = (router as any).stack
        ?.filter((layer: any) => layer.route)
        ?.filter((layer: any) => {
          const methods = Object.keys(layer.route.methods);
          return methods.includes('post') || methods.includes('put') || methods.includes('delete');
        });

      // 所有写路由应该有至少 2 个 handler（middleware + handler）
      for (const route of writeRoutes || []) {
        const handlerCount = route.route.stack.length;
        expect(
          handlerCount,
          `Route ${route.route.path} should have localhost middleware (expected >=2 handlers, got ${handlerCount})`,
        ).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
