/**
 * Provider 配置管理 Hook
 * 从后端获取当前 API Provider 配置，支持快速切换
 */

import { useState, useEffect, useCallback } from 'react';

export interface ProviderInfo {
  id: string;
  name: string;
  icon: string;
}

export const PROVIDER_LIST: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', icon: '🟣' },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐' },
  { id: 'deepseek', name: 'DeepSeek', icon: '🔵' },
  { id: 'bedrock', name: 'Bedrock', icon: '🟠' },
  { id: 'vertex', name: 'Vertex', icon: '🔴' },
];

/**
 * 从后端 API 配置推断当前 Provider
 */
function detectProvider(config: any): string {
  const baseUrl = config.apiBaseUrl || '';
  const provider = config.apiProvider || 'anthropic';

  if (baseUrl.includes('openrouter.ai')) return 'openrouter';
  if (baseUrl.includes('deepseek.com')) return 'deepseek';
  if (provider === 'bedrock') return 'bedrock';
  if (provider === 'vertex') return 'vertex';
  if (baseUrl && !baseUrl.includes('anthropic')) return 'openrouter'; // custom endpoint treated as openrouter-like
  return 'anthropic';
}

export function useProviderConfig() {
  const [currentProvider, setCurrentProvider] = useState<string>('anthropic');
  const [loading, setLoading] = useState(false);

  // 初始化：从后端获取当前配置
  useEffect(() => {
    fetch('/api/config/api')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          setCurrentProvider(detectProvider(data.data));
        }
      })
      .catch(() => {});
  }, []);

  const switchProvider = useCallback(async (providerId: string) => {
    if (providerId === currentProvider) return;
    setLoading(true);

    try {
      const payload: any = {};

      switch (providerId) {
        case 'anthropic':
          payload.apiProvider = 'anthropic';
          payload.apiBaseUrl = '';
          break;
        case 'openrouter':
          payload.apiProvider = 'anthropic';
          payload.apiBaseUrl = 'https://openrouter.ai/api/v1';
          break;
        case 'deepseek':
          payload.apiProvider = 'anthropic';
          payload.apiBaseUrl = 'https://api.deepseek.com';
          break;
        case 'bedrock':
          payload.apiProvider = 'bedrock';
          payload.apiBaseUrl = '';
          break;
        case 'vertex':
          payload.apiProvider = 'vertex';
          payload.apiBaseUrl = '';
          break;
      }

      const response = await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (data.success) {
        setCurrentProvider(providerId);
      }
    } catch (err) {
      console.error('Failed to switch provider:', err);
    } finally {
      setLoading(false);
    }
  }, [currentProvider]);

  return { currentProvider, switchProvider, loading, providers: PROVIDER_LIST };
}
