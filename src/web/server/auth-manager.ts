/**
 * WebUI 认证管理器
 * 管理 API 密钥设置、登录状态等
 */

import { configManager } from '../../config/index.js';
import { getAuth } from '../../auth/index.js';
import type { AuthStatus } from '../shared/types.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * 认证管理器类
 */
export class AuthManager {
  /**
   * 获取认证状态
   */
  getAuthStatus(): AuthStatus {
    const apiKey = this.getApiKey();

    // 检查是否使用 OAuth（暂不支持）
    const oauthToken = configManager.get('oauthToken');

    if (oauthToken) {
      return {
        authenticated: true,
        type: 'oauth',
        provider: this.getProvider(),
        // OAuth 相关信息可以从token解析获得（暂时简化）
      };
    }

    if (apiKey) {
      return {
        authenticated: true,
        type: 'api_key',
        provider: this.getProvider(),
      };
    }

    // 检查是否通过 initAuth() 有内置认证（如内置代理配置）
    const coreAuth = getAuth();
    if (coreAuth && (coreAuth.apiKey || coreAuth.authToken || coreAuth.accessToken)) {
      return {
        authenticated: true,
        type: coreAuth.type === 'oauth' ? 'oauth' : 'api_key',
        provider: this.getProvider(),
      };
    }

    return {
      authenticated: false,
      type: 'none',
      provider: 'anthropic',
    };
  }

  /**
   * 设置 API 密钥
   */
  setApiKey(key: string): boolean {
    try {
      // 基本验证
      if (!key || typeof key !== 'string') {
        return false;
      }

      // 验证密钥格式（Anthropic API key 通常以 sk-ant- 开头）
      if (!key.startsWith('sk-ant-')) {
        console.warn('[AuthManager] API key 不符合 Anthropic 格式，但仍尝试保存');
      }

      // 保存到配置
      configManager.set('apiKey', key);

      // 同时设置环境变量（运行时使用）
      process.env.ANTHROPIC_API_KEY = key;

      return true;
    } catch (error) {
      console.error('[AuthManager] 设置 API 密钥失败:', error);
      return false;
    }
  }

  /**
   * 清除认证
   */
  clearAuth(): void {
    try {
      // 从配置中移除
      configManager.set('apiKey', undefined as any);

      // 同时清除环境变量
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;

      console.log('[AuthManager] 认证已清除');
    } catch (error) {
      console.error('[AuthManager] 清除认证失败:', error);
    }
  }

  /**
   * 验证 API 密钥
   */
  async validateApiKey(key: string): Promise<boolean> {
    try {
      // 创建临时客户端测试密钥
      const client = new Anthropic({
        apiKey: key,
      });

      // 尝试调用 API（使用最小 token 限制）
      await client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [
          {
            role: 'user',
            content: 'test',
          },
        ],
      });

      return true;
    } catch (error: any) {
      // 检查是否是认证错误
      if (error?.status === 401 || error?.error?.type === 'authentication_error') {
        return false;
      }

      // 其他错误（如网络错误）也认为密钥可能有效
      // 因为我们只是想验证认证，不是验证 API 能否调用
      console.warn('[AuthManager] API 验证遇到非认证错误:', error?.message);
      return true;
    }
  }

  /**
   * 获取认证提供商
   */
  getProvider(): string {
    const useBedrock = configManager.get('useBedrock');
    const useVertex = configManager.get('useVertex');
    const apiProvider = configManager.get('apiProvider');

    // 优先使用新的 apiProvider 字段
    if (apiProvider) {
      return apiProvider;
    }

    // 向后兼容旧的布尔标志
    if (useBedrock) {
      return 'bedrock';
    }

    if (useVertex) {
      return 'vertex';
    }

    return 'anthropic';
  }

  /**
   * 获取 API 密钥
   */
  private getApiKey(): string | undefined {
    // 优先从配置获取
    let apiKey = configManager.getApiKey();

    // 其次从环境变量获取
    if (!apiKey) {
      apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    }

    return apiKey;
  }

  /**
   * 获取掩码后的 API 密钥（用于显示）
   */
  getMaskedApiKey(): string | undefined {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      return undefined;
    }

    // 只显示前7个字符和最后4个字符
    if (apiKey.length > 11) {
      return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
    }

    return '***';
  }
}

// 导出单例
export const authManager = new AuthManager();
