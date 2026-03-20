/**
 * Tests for tunnel-api route / tunnel module integration
 *
 * Tests the CloudflareTunnel class directly (not via mocked routes).
 */
import { describe, it, expect } from 'vitest';

describe('Tunnel API', () => {
  // Test the CloudflareTunnel import and interface
  describe('module interface', () => {
    it('should export getTunnel function', async () => {
      const mod = await import('../../tunnel.js');
      expect(typeof mod.getTunnel).toBe('function');
    });

    it('should export CloudflareTunnel class', async () => {
      const mod = await import('../../tunnel.js');
      expect(typeof mod.CloudflareTunnel).toBe('function');
    });

    it('getTunnel returns tunnel with correct port', async () => {
      const { getTunnel } = await import('../../tunnel.js');
      const tunnel = getTunnel(4567);
      expect(tunnel.info.localPort).toBe(4567);
      expect(tunnel.info.status).toBe('stopped');
      expect(tunnel.info.url).toBeNull();
      expect(tunnel.info.wsUrl).toBeNull();
      expect(tunnel.info.error).toBeNull();
      expect(tunnel.info.startedAt).toBeNull();
      await tunnel.stop(); // cleanup
    });

    it('getTunnel returns singleton for same port', async () => {
      const { getTunnel } = await import('../../tunnel.js');
      const t1 = getTunnel(4568);
      const t2 = getTunnel(4568);
      expect(t1).toBe(t2);
      await t1.stop();
    });

    it('getTunnel returns new instance for different port', async () => {
      const { getTunnel } = await import('../../tunnel.js');
      const t1 = getTunnel(4569);
      const t2 = getTunnel(4570);
      expect(t1).not.toBe(t2);
      await t1.stop();
      await t2.stop();
    });

    it('stop returns stopped status', async () => {
      const { CloudflareTunnel } = await import('../../tunnel.js');
      const tunnel = new CloudflareTunnel(9999);
      const info = await tunnel.stop();
      expect(info.status).toBe('stopped');
      expect(info.url).toBeNull();
      expect(info.error).toBeNull();
    });

    it('TunnelInfo has installing as valid status type', async () => {
      const { CloudflareTunnel } = await import('../../tunnel.js');
      const tunnel = new CloudflareTunnel(9998);
      // installing is a valid status in the type union
      const info = tunnel.info;
      expect(['stopped', 'starting', 'connected', 'error', 'installing']).toContain(info.status);
      await tunnel.stop();
    });
  });

  // Test the route module exports
  describe('route module', () => {
    it('should export a default router', async () => {
      const mod = await import('../tunnel-api.js');
      expect(mod.default).toBeDefined();
      // Express Router has `stack` property
      expect(Array.isArray((mod.default as any).stack)).toBe(true);
    });

    it('router should have expected routes (no /install)', async () => {
      const mod = await import('../tunnel-api.js');
      const router = mod.default as any;
      const routes = router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      // Check /status GET
      const statusRoute = routes.find((r: any) => r.path === '/status');
      expect(statusRoute).toBeDefined();
      expect(statusRoute.methods).toContain('get');

      // Check /start POST
      const startRoute = routes.find((r: any) => r.path === '/start');
      expect(startRoute).toBeDefined();
      expect(startRoute.methods).toContain('post');

      // Check /stop POST
      const stopRoute = routes.find((r: any) => r.path === '/stop');
      expect(stopRoute).toBeDefined();
      expect(stopRoute.methods).toContain('post');

      // /install route should NOT exist (cloudflared auto-managed via npm)
      const installRoute = routes.find((r: any) => r.path === '/install');
      expect(installRoute).toBeUndefined();
    });
  });
});
