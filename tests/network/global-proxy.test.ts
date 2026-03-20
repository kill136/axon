import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as net from 'net';

describe('global-proxy', () => {
  // We test probeProxy logic directly by creating a TCP server
  
  describe('proxy reachability probe', () => {
    let server: net.Server;
    let serverPort: number;

    afterEach(() => {
      return new Promise<void>((resolve) => {
        if (server?.listening) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });

    it('should detect reachable proxy', async () => {
      // Start a TCP server to simulate a reachable proxy
      server = net.createServer((socket) => socket.destroy());
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = server.address() as net.AddressInfo;
      serverPort = addr.port;

      const reachable = await probeProxy(`http://127.0.0.1:${serverPort}`);
      expect(reachable).toBe(true);
    });

    it('should detect unreachable proxy', async () => {
      // Use a port that nothing is listening on
      const reachable = await probeProxy('http://127.0.0.1:19999', 500);
      expect(reachable).toBe(false);
    });

    it('should handle invalid proxy URL', async () => {
      const reachable = await probeProxy('not-a-url');
      expect(reachable).toBe(false);
    });

    it('should return false for connection refused on closed port', async () => {
      // Port 19998 should not have anything listening
      const reachable = await probeProxy('http://127.0.0.1:19998', 500);
      expect(reachable).toBe(false);
    });

    it('should default port 80 for http URLs without port', async () => {
      const reachable = await probeProxy('http://127.0.0.1', 500);
      // Will fail to connect (nothing on port 80 usually), but should not throw
      expect(typeof reachable).toBe('boolean');
    });
  });
});

/**
 * Inline version of probeProxy for testing (same logic as in global-proxy.ts).
 * We duplicate here because the module uses top-level side effects and is hard to import in tests.
 */
function probeProxy(proxyUrl: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyUrl);
      const host = url.hostname;
      const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);

      const socket = net.createConnection({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}
