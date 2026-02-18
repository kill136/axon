import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

// 注册 Service Worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service Worker 注册失败不影响正常使用
    });
  });
}

// ============================================================================
// Vite HMR 错误防护
// 当 AI 通过 SelfEvolve 修改前端文件导致语法/编译错误时，
// Vite HMR 会推送坏模块到浏览器。这些错误发生在模块加载阶段，
// React ErrorBoundary 无法捕获。这里做全局兜底，防止白屏。
// ============================================================================

// 1. 监听 Vite HMR 错误 overlay 事件
//    Vite 在 HMR 出错时会创建 vite-error-overlay 自定义元素
//    我们监听 DOM 变化，检测到 overlay 后保持界面可交互
if (import.meta.hot) {
  // Vite HMR 错误回调 — 阻止模块热替换时的致命崩溃
  import.meta.hot.on('vite:error', (payload: { err: { message: string; stack?: string } }) => {
    console.error('[HMR Error Guard] Vite HMR error intercepted:', payload.err.message);
    // 不做额外处理 — Vite 自带的 error overlay 会显示错误详情
    // 关键是：我们不让这个错误导致整个 React 树被卸载
  });

  // 当 HMR 更新成功后，如果之前有错误 overlay，Vite 会自动移除
  import.meta.hot.on('vite:beforeUpdate', () => {
    console.log('[HMR Error Guard] HMR update incoming, previous errors may be resolved');
  });
}

// 2. 全局未捕获错误兜底
//    即使模块加载崩溃，也不让页面完全白屏
//    使用全局标志防止 HMR 重复注册
if (!(window as any).__errorGuardRegistered) {
  (window as any).__errorGuardRegistered = true;

  window.addEventListener('error', (event) => {
    // 只处理脚本错误，忽略资源加载错误
    if (event.error) {
      console.error('[Global Error Guard] Uncaught error:', event.error);
      showCrashRecoveryUI(event.error.message || 'Unknown error');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Global Error Guard] Unhandled rejection:', event.reason);
    // Promise rejection 不一定导致白屏，只记录日志
  });
}

/**
 * 当 React 树完全崩溃时，显示恢复 UI
 * 检查 #root 是否为空（白屏），如果是则注入恢复界面
 */
function showCrashRecoveryUI(errorMessage: string) {
  // 延迟检查，等 React 处理完错误
  setTimeout(() => {
    const root = document.getElementById('root');
    if (!root) return;

    // 如果 root 有内容（ErrorBoundary 生效了），不干预
    if (root.children.length > 0 && root.innerText.trim().length > 0) return;

    // React 树已空 = 白屏，注入恢复 UI
    root.innerHTML = `
      <div style="
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100vh; background: #030712; color: #f8fafc; font-family: system-ui, sans-serif;
        padding: 40px;
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">&#x1F6E0;&#xFE0F;</div>
        <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 600;">
          Hot Reload Error
        </h2>
        <p style="margin: 0 0 8px; color: #94a3b8; font-size: 14px; text-align: center; max-width: 600px;">
          A code change caused a frontend error. The backend is still running.
        </p>
        <pre style="
          margin: 0 0 24px; padding: 12px 16px; background: #1e293b; border-radius: 8px;
          color: #f87171; font-size: 12px; max-width: 600px; overflow-x: auto;
          white-space: pre-wrap; word-break: break-all;
        ">${escapeHtml(errorMessage)}</pre>
        <div style="display: flex; gap: 12px;">
          <button onclick="window.location.reload()" style="
            padding: 10px 24px; border-radius: 8px; border: none;
            background: #4a6cf7; color: #fff; cursor: pointer; font-size: 14px; font-weight: 500;
          ">
            Reload Page
          </button>
        </div>
        <p style="margin-top: 16px; color: #64748b; font-size: 12px;">
          Your conversation and session data are preserved.
        </p>
      </div>
    `;
  }, 100);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
