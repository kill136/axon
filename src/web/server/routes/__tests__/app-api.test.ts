/**
 * App API 路由模块测试
 */

import { describe, it, expect } from 'vitest';

describe('app-api module', () => {
  it('should export a default Router', async () => {
    const mod = await import('../app-api.js');
    expect(mod.default).toBeDefined();
    // Express Router 是一个函数
    expect(typeof mod.default).toBe('function');
  });

  it('should have the expected route handlers', async () => {
    const mod = await import('../app-api.js');
    const router = mod.default;

    // Express Router 的 stack 包含所有注册的路由
    const stack = (router as any).stack;
    expect(stack).toBeDefined();
    expect(Array.isArray(stack)).toBe(true);

    // 提取路由路径
    const routes = stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
      }));

    // 基本 CRUD 路由
    expect(routes.find((r: any) => r.path === '/' && r.methods.includes('get'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/' && r.methods.includes('post'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id' && r.methods.includes('get'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id' && r.methods.includes('put'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id' && r.methods.includes('delete'))).toBeTruthy();

    // 进程管理路由
    expect(routes.find((r: any) => r.path === '/:id/start' && r.methods.includes('post'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id/stop' && r.methods.includes('post'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id/restart' && r.methods.includes('post'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id/logs' && r.methods.includes('get'))).toBeTruthy();

    // 隧道路由
    expect(routes.find((r: any) => r.path === '/:id/tunnel/start' && r.methods.includes('post'))).toBeTruthy();
    expect(routes.find((r: any) => r.path === '/:id/tunnel/stop' && r.methods.includes('post'))).toBeTruthy();
  });

  it('should have 11 route handlers total', async () => {
    const mod = await import('../app-api.js');
    const router = mod.default;
    const routes = (router as any).stack.filter((layer: any) => layer.route);
    expect(routes.length).toBe(11);
  });
});
