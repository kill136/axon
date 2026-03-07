/**
 * Axon PWA Service Worker
 * 缓存静态资源，支持离线访问 UI shell
 * API 和 WebSocket 请求不缓存，始终走网络
 */

const CACHE_NAME = 'claude-code-v1';

// 需要预缓存的核心资源（app shell）
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // 跳过等待，立即激活
      return self.skipWaiting();
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // 立即接管所有客户端
      return self.clients.claim();
    })
  );
});

// 请求拦截：Network-first 策略（优先网络，失败时使用缓存）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 和 WebSocket 请求不缓存
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/ws') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 网络请求成功，更新缓存
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 网络失败，尝试从缓存获取
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // 对于导航请求，返回缓存的首页（SPA fallback）
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
