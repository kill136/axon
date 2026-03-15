/**
 * IPv6 地址处理测试
 *
 * 验证 Agent Network 正确处理 IPv6 地址的方括号包裹，
 * 确保 WebSocket URL 和 endpoint 格式正确。
 */

import { describe, it, expect } from 'vitest';

/**
 * 从 discovery.ts handleServiceFound 提取的 IPv6 地址处理逻辑
 */
function formatEndpoint(address: string, port: number): string {
  const host = address.includes(':') ? `[${address}]` : address;
  return `${host}:${port}`;
}

/**
 * 从 transport.ts connect 提取的 endpoint → WebSocket URL 逻辑
 */
function endpointToWsUrl(endpoint: string): string {
  let normalizedEndpoint = endpoint;
  if (!endpoint.startsWith('ws://') && !endpoint.startsWith('[')) {
    const lastColon = endpoint.lastIndexOf(':');
    const beforePort = endpoint.substring(0, lastColon);
    if (beforePort.includes(':')) {
      const port = endpoint.substring(lastColon + 1);
      normalizedEndpoint = `[${beforePort}]:${port}`;
    }
  }
  return normalizedEndpoint.startsWith('ws://') ? normalizedEndpoint : `ws://${normalizedEndpoint}`;
}

describe('IPv6 Address Handling', () => {
  describe('formatEndpoint (discovery)', () => {
    it('should wrap IPv6 address in brackets', () => {
      const endpoint = formatEndpoint('240e:b65:554:7000:ad3d:1f2d:d29:608b', 7860);
      expect(endpoint).toBe('[240e:b65:554:7000:ad3d:1f2d:d29:608b]:7860');
    });

    it('should wrap link-local IPv6 address in brackets', () => {
      const endpoint = formatEndpoint('fe80::1', 7860);
      expect(endpoint).toBe('[fe80::1]:7860');
    });

    it('should wrap loopback IPv6 address in brackets', () => {
      const endpoint = formatEndpoint('::1', 7860);
      expect(endpoint).toBe('[::1]:7860');
    });

    it('should not wrap IPv4 address in brackets', () => {
      const endpoint = formatEndpoint('192.168.1.100', 7860);
      expect(endpoint).toBe('192.168.1.100:7860');
    });

    it('should not wrap hostname in brackets', () => {
      const endpoint = formatEndpoint('my-desktop', 7860);
      expect(endpoint).toBe('my-desktop:7860');
    });
  });

  describe('endpointToWsUrl (transport)', () => {
    it('should handle already-bracketed IPv6 endpoint', () => {
      const url = endpointToWsUrl('[240e:b65:554:7000:ad3d:1f2d:d29:608b]:7860');
      expect(url).toBe('ws://[240e:b65:554:7000:ad3d:1f2d:d29:608b]:7860');
    });

    it('should auto-bracket bare IPv6 endpoint', () => {
      const url = endpointToWsUrl('240e:b65:554:7000:ad3d:1f2d:d29:608b:7860');
      expect(url).toBe('ws://[240e:b65:554:7000:ad3d:1f2d:d29:608b]:7860');
    });

    it('should handle link-local IPv6 without brackets', () => {
      const url = endpointToWsUrl('fe80::1:7860');
      // fe80::1 中最后一个冒号前是 fe80::1，包含冒号，所以被识别为 IPv6
      // 但这里有歧义 — fe80::1:7860 中 lastColon 后的 "7860" 是端口
      expect(url).toBe('ws://[fe80::1]:7860');
    });

    it('should handle IPv4 endpoint', () => {
      const url = endpointToWsUrl('192.168.1.100:7860');
      expect(url).toBe('ws://192.168.1.100:7860');
    });

    it('should handle hostname endpoint', () => {
      const url = endpointToWsUrl('my-desktop:7860');
      expect(url).toBe('ws://my-desktop:7860');
    });

    it('should pass through ws:// prefixed URL', () => {
      const url = endpointToWsUrl('ws://192.168.1.100:7860');
      expect(url).toBe('ws://192.168.1.100:7860');
    });

    it('should pass through ws:// prefixed IPv6 URL', () => {
      const url = endpointToWsUrl('ws://[::1]:7860');
      expect(url).toBe('ws://[::1]:7860');
    });

    it('should handle loopback IPv6 without brackets', () => {
      const url = endpointToWsUrl('::1:7860');
      expect(url).toBe('ws://[::1]:7860');
    });
  });
});
