/**
 * 缓存管理面板组件
 * 用于管理蓝图分析缓存
 */

import { useState, useEffect, useCallback } from 'react';
import { cacheApi } from '../../api/blueprint';
import '../../styles/config-panels.css';

// ============ 类型定义 ============

interface CacheStats {
  total: number;
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

interface ConfigPanelProps {
  onSave?: () => void;
  onClose?: () => void;
}

// ============ 工具函数 ============

/**
 * 格式化字节大小为人类可读格式
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化命中率为百分比
 */
function formatHitRate(rate: number): string {
  return (rate * 100).toFixed(1) + '%';
}

// ============ 主组件 ============

export function CacheManagementPanel({ onSave, onClose }: ConfigPanelProps) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [clearPath, setClearPath] = useState('');

  // 获取缓存统计
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cacheApi.getStats();
      setStats(data);
    } catch (error) {
      console.error('获取缓存统计失败:', error);
      setMessage({ type: 'error', text: '获取缓存统计失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // 清除所有缓存
  const handleClearAll = async () => {
    if (!window.confirm('确定要清除所有缓存吗？此操作不可撤销。')) return;

    setActionLoading('clearAll');
    setMessage(null);
    try {
      const result = await cacheApi.clearAll();
      setMessage({ type: 'success', text: result.message || '已清除所有缓存' });
      await fetchStats();
      onSave?.();
    } catch (error) {
      console.error('清除缓存失败:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '清除缓存失败'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // 清除过期缓存
  const handleClearExpired = async () => {
    setActionLoading('clearExpired');
    setMessage(null);
    try {
      const result = await cacheApi.clearExpired();
      setMessage({ type: 'success', text: result.message || '已清除过期缓存' });
      await fetchStats();
      onSave?.();
    } catch (error) {
      console.error('清除过期缓存失败:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '清除过期缓存失败'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // 清除指定路径的缓存
  const handleClearPath = async () => {
    if (!clearPath.trim()) {
      setMessage({ type: 'error', text: '请输入要清除的路径' });
      return;
    }

    setActionLoading('clearPath');
    setMessage(null);
    try {
      const result = await cacheApi.clearPath(clearPath.trim());
      setMessage({ type: 'success', text: result.message || '已清除指定路径缓存' });
      setClearPath('');
      await fetchStats();
      onSave?.();
    } catch (error) {
      console.error('清除路径缓存失败:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '清除路径缓存失败'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // 重置统计
  const handleResetStats = async () => {
    setActionLoading('resetStats');
    setMessage(null);
    try {
      const result = await cacheApi.resetStats();
      setMessage({ type: 'success', text: result.message || '已重置统计数据' });
      await fetchStats();
    } catch (error) {
      console.error('重置统计失败:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '重置统计失败'
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !stats) {
    return (
      <div className="cache-management-panel">
        <div className="config-loading">加载缓存统计中...</div>
      </div>
    );
  }

  return (
    <div className="cache-management-panel">
      <div className="config-panel-header">
        <h3>缓存管理 (Cache Management)</h3>
        <p className="config-description">
          管理蓝图分析的缓存数据，包括代码分析结果、符号信息等。清除缓存后，下次访问时将重新生成分析结果。
        </p>
      </div>

      {message && (
        <div className={`config-message config-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 缓存统计信息 */}
      <section className="config-section">
        <h4>缓存统计 (Cache Statistics)</h4>

        {stats ? (
          <div className="cache-stats-grid">
            <div className="cache-stat-item">
              <span className="cache-stat-label">缓存文件数</span>
              <span className="cache-stat-value">{stats.total}</span>
            </div>
            <div className="cache-stat-item">
              <span className="cache-stat-label">总大小</span>
              <span className="cache-stat-value">{formatBytes(stats.size)}</span>
            </div>
            <div className="cache-stat-item">
              <span className="cache-stat-label">命中次数</span>
              <span className="cache-stat-value">{stats.hits}</span>
            </div>
            <div className="cache-stat-item">
              <span className="cache-stat-label">未命中次数</span>
              <span className="cache-stat-value">{stats.misses}</span>
            </div>
            <div className="cache-stat-item cache-stat-highlight">
              <span className="cache-stat-label">命中率</span>
              <span className="cache-stat-value">{formatHitRate(stats.hitRate)}</span>
            </div>
          </div>
        ) : (
          <div className="cache-stats-empty">无法获取缓存统计</div>
        )}

        <div className="cache-stat-actions">
          <button
            className="config-btn config-btn-secondary config-btn-sm"
            onClick={fetchStats}
            disabled={loading}
          >
            {loading ? '刷新中...' : '刷新统计'}
          </button>
          <button
            className="config-btn config-btn-secondary config-btn-sm"
            onClick={handleResetStats}
            disabled={actionLoading === 'resetStats'}
          >
            {actionLoading === 'resetStats' ? '重置中...' : '重置统计'}
          </button>
        </div>
      </section>

      {/* 缓存清理操作 */}
      <section className="config-section">
        <h4>缓存清理 (Cache Cleanup)</h4>

        <div className="cache-actions-grid">
          <div className="cache-action-item">
            <div className="cache-action-info">
              <span className="cache-action-title">清除过期缓存</span>
              <span className="cache-action-desc">清除已过期的缓存条目，释放存储空间</span>
            </div>
            <button
              className="config-btn config-btn-primary"
              onClick={handleClearExpired}
              disabled={actionLoading === 'clearExpired'}
            >
              {actionLoading === 'clearExpired' ? '清除中...' : '清除过期'}
            </button>
          </div>

          <div className="cache-action-item">
            <div className="cache-action-info">
              <span className="cache-action-title">清除所有缓存</span>
              <span className="cache-action-desc cache-action-desc-warning">
                清除全部缓存数据，下次访问时需重新生成
              </span>
            </div>
            <button
              className="config-btn config-btn-danger"
              onClick={handleClearAll}
              disabled={actionLoading === 'clearAll'}
            >
              {actionLoading === 'clearAll' ? '清除中...' : '清除全部'}
            </button>
          </div>
        </div>
      </section>

      {/* 指定路径清除 */}
      <section className="config-section">
        <h4>按路径清除 (Clear by Path)</h4>
        <p className="config-description">
          清除指定文件或目录的缓存数据
        </p>

        <div className="cache-path-input">
          <label className="config-label">
            <span className="label-text">文件/目录路径</span>
            <input
              type="text"
              className="config-input"
              value={clearPath}
              onChange={(e) => setClearPath(e.target.value)}
              placeholder="例如: src/components 或 src/utils/helper.ts"
            />
          </label>
          <button
            className="config-btn config-btn-primary"
            onClick={handleClearPath}
            disabled={actionLoading === 'clearPath' || !clearPath.trim()}
          >
            {actionLoading === 'clearPath' ? '清除中...' : '清除'}
          </button>
        </div>
      </section>

      {/* 关于缓存 */}
      <section className="config-section">
        <h4>关于缓存 (About Cache)</h4>
        <div className="cache-about">
          <p>
            缓存系统用于存储代码分析结果，包括：
          </p>
          <ul>
            <li>文件和目录的语义分析结果</li>
            <li>代码符号的详细信息</li>
            <li>AI 生成的代码解释和建议</li>
            <li>调用图和依赖关系数据</li>
          </ul>
          <p>
            缓存会在文件内容发生变化时自动失效。定期清理过期缓存可以释放存储空间。
          </p>
        </div>
      </section>

      <div className="config-actions">
        {onClose && (
          <button
            className="config-btn config-btn-secondary"
            onClick={onClose}
          >
            关闭
          </button>
        )}
      </div>
    </div>
  );
}

export default CacheManagementPanel;
