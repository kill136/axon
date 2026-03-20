/**
 * 端口转发（反向代理）
 * 
 * 将 /proxy/:port/* 的请求转发到 localhost:<port>
 * 用于 Railway 等单端口环境下，预览 Axon 生成的动态 Web 应用
 * 
 * 类似 VS Code 的端口转发功能
 */

import { Router, Request, Response } from 'express';
import http from 'http';
import type { Duplex } from 'stream';

const router = Router();

// 允许转发的端口范围
const MIN_PORT = 1024;
const MAX_PORT = 65535;

// 活跃的被转发端口跟踪（用于 API 查询）
const activeProxiedPorts = new Set<number>();

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * GET /api/proxy/ports
 * 返回当前被转发过的端口列表
 */
router.get('/ports', (_req: Request, res: Response) => {
  res.json({ ports: Array.from(activeProxiedPorts) });
});

/**
 * ALL /proxy/:port 和 /proxy/:port/*
 * 反向代理到 localhost:<port>
 */
router.all('/:port', proxyHandler);
router.all('/:port/*path', proxyHandler);

function proxyHandler(req: Request, res: Response) {
  const port = parseInt(req.params.port);

  if (!isValidPort(port)) {
    res.status(400).json({ error: `Invalid port: ${req.params.port}. Must be ${MIN_PORT}-${MAX_PORT}` });
    return;
  }

  activeProxiedPorts.add(port);

  // 构造转发路径：去掉 /proxy/:port 前缀
  // Express 5 中 *path 返回数组，需要 join
  const rawPath = req.params.path;
  const targetPath = '/' + (Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || ''));
  const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  const proxyOptions: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: port,
    path: targetPath + queryString,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${port}`,
    },
    timeout: 30000,
  };

  // 移除一些不适合转发的 headers
  delete proxyOptions.headers!['connection'];

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // 转发响应头
    const headers = { ...proxyRes.headers };

    // 移除 transfer-encoding 让 Express 自己处理
    // 保留其他头原样转发
    res.writeHead(proxyRes.statusCode || 502, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNREFUSED') {
      res.status(502).json({
        error: `Port ${port} is not running`,
        hint: `No service is listening on localhost:${port}`,
      });
    } else {
      res.status(502).json({
        error: `Proxy error: ${err.message}`,
      });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: `Proxy timeout: localhost:${port} did not respond in 30s` });
  });

  // 转发请求体
  // 注意：如果 Express 的 body parser 已经消费了 stream，req 不可 pipe
  // 这时候需要从 req.body 重新构造
  if (req.readable) {
    req.pipe(proxyReq);
  } else if (req.body && Object.keys(req.body).length > 0) {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    proxyReq.end(bodyStr);
  } else {
    proxyReq.end();
  }
}

/**
 * 设置 WebSocket 转发
 * 
 * 需要在 HTTP server 的 upgrade 事件中调用
 * 匹配 /proxy/:port/ 路径的 WebSocket 升级请求
 */
export function handleProxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/proxy\/(\d+)(\/.*)?$/);

  if (!match) return false;

  const port = parseInt(match[1]);
  if (!isValidPort(port)) {
    socket.destroy();
    return true;
  }

  const targetPath = match[2] || '/';

  // 建立到目标服务的连接
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: port,
    path: targetPath,
    method: 'GET',
    headers: {
      ...req.headers,
      host: `127.0.0.1:${port}`,
    },
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    // 将升级响应写回给客户端
    const responseHeaders = ['HTTP/1.1 101 Switching Protocols'];
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value) {
        responseHeaders.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
      }
    }
    responseHeaders.push('', '');

    socket.write(responseHeaders.join('\r\n'));

    if (proxyHead.length > 0) {
      socket.write(proxyHead);
    }
    if (head.length > 0) {
      proxySocket.write(head);
    }

    // 双向管道
    socket.pipe(proxySocket);
    proxySocket.pipe(socket);

    socket.on('error', () => proxySocket.destroy());
    proxySocket.on('error', () => socket.destroy());
    socket.on('close', () => proxySocket.destroy());
    proxySocket.on('close', () => socket.destroy());
  });

  proxyReq.on('error', () => {
    socket.destroy();
  });

  proxyReq.end();
  return true;
}

export default router;
