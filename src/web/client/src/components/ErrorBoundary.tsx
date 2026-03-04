/**
 * ErrorBoundary 组件
 * 捕获 React 渲染错误，防止白屏
 *
 * 关键设计：fallback UI 零外部依赖（不引用 i18n、CSS 变量等），
 * 确保即使其他模块被改坏，ErrorBoundary 自身也能正常渲染。
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

// 安全获取翻译 — 如果 i18n 模块出错则降级为英文硬编码
function safeTranslate(key: string): string {
  const fallbacks: Record<string, string> = {
    'error.title': 'Something went wrong',
    'error.unknown': 'An unexpected error occurred',
    'error.retry': 'Retry',
    'error.reload': 'Reload Page',
    'error.sessionPreserved': 'Your session data is preserved. Backend is still running.',
  };
  try {
    // 动态引入避免模块级依赖 — 如果 i18n 模块已加载则使用
    const { getTranslation } = require('../i18n');
    return getTranslation(key) || fallbacks[key] || key;
  } catch {
    return fallbacks[key] || key;
  }
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ''}] Uncaught error:`, error, errorInfo);
    // 上报到后端 ErrorWatcher
    (window as any).__reportClientError?.({
      message: error.message,
      stack: error.stack,
      componentName: this.props.name || 'Unknown',
      source: errorInfo.componentStack?.slice(0, 500),
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 所有样式内联、所有文本硬编码降级，确保此处渲染不会再次抛出
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: '200px',
          padding: '40px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#e0e0e0',
          backgroundColor: '#1a1a2e',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>
            {'\u26A0\uFE0F'}
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600 }}>
            {this.props.name ? `${this.props.name} ` : ''}
            {safeTranslate('error.title')}
          </h2>
          <p style={{
            margin: '0 0 16px', color: '#888', fontSize: '14px',
            maxWidth: '500px', textAlign: 'center',
          }}>
            {this.state.error?.message || safeTranslate('error.unknown')}
          </p>
          {this.state.error?.stack && (
            <pre style={{
              margin: '0 0 24px', padding: '12px 16px',
              background: '#0f172a', borderRadius: '8px',
              color: '#f87171', fontSize: '11px',
              maxWidth: '600px', maxHeight: '150px',
              overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {this.state.error.stack.slice(0, 500)}
            </pre>
          )}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: '1px solid #444',
                background: '#2a2a3e',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {safeTranslate('error.retry')}
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                background: '#4a6cf7',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {safeTranslate('error.reload')}
            </button>
          </div>
          <p style={{ marginTop: '16px', color: '#64748b', fontSize: '12px' }}>
            {safeTranslate('error.sessionPreserved')}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
