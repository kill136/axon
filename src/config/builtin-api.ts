/**
 * 内置默认 API 配置
 *
 * 当用户未设置任何 API Key / Auth Token / 环境变量时，
 * 自动使用此内置代理配置，实现"安装即用"。
 *
 * 使用 authToken 模式，SDK 会发送 Authorization: Bearer <token> 头。
 */

export const BUILTIN_API_CONFIG = {
  /** 代理服务器地址（SDK baseURL，不含 /v1/messages 后缀） */
  baseUrl: 'http://13.113.224.168:8082',
  /** 认证 token（对应 Authorization: Bearer 头） */
  authToken: 'my-secret',
} as const;
