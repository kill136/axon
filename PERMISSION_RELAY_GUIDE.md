# Permission Relay & OAuth RFC 9728 集成指南

## 概述

Agent 7 完成了AXON权限系统的第三层：权限中继（Permission Relay）和OAuth认证。该系统支持跨进程权限传播、令牌管理和现代OAuth认证流程。

## 核心模块

### 1. Token Manager (token-manager.ts)

权限令牌的生成和验证，基于 HMAC-SHA256 签名。

```typescript
import PermissionTokenManager from './src/permissions/token-manager.js';

// 创建令牌管理器
const manager = new PermissionTokenManager('secret-key', 24 * 60 * 60 * 1000);

// 创建令牌
const token = manager.createToken('alice', ['read', 'write'], 'admin', 'session-123');

// 验证令牌
const result = manager.validateToken(token);
if (result.valid) {
  console.log('User:', result.payload?.userId);
  console.log('Scopes:', result.payload?.scopes);
}

// 验证特定作用域
const hasAccess = manager.validateScopes(token, ['write']);

// 刷新令牌
const newToken = manager.refreshToken(token);
```

令牌格式：`{base64url(payload)}.{hmac-sha256-signature}`

### 2. Permission Relay (permission-relay.ts)

支持多进程间的权限令牌传播和委托。

```typescript
import PermissionRelay from './src/permissions/permission-relay.js';

const relay = new PermissionRelay('secret-key', '~/.axon/permission-relay');

// 注册权限通道
relay.registerChannel({
  channel: 'main-process',
  userId: 'app-server',
  scopes: ['admin', 'execute']
});

// 创建中继令牌（允许 alice 在 bob 的上下文中执行）
const relayToken = relay.createRelayToken({
  sourceUser: 'alice',
  sourceSession: 'session-1',
  targetUser: 'bob',
  scopes: ['read', 'write'],
  reason: 'Delegated access for project work'
});

if (relayToken.success) {
  console.log('Token:', relayToken.token);
  console.log('Expires at:', new Date(relayToken.expiresAt));
}

// 验证并使用中继令牌（一次性使用）
const validation = relay.validateAndUseRelayToken(relayToken.token);
if (validation.success) {
  console.log('Token validated and consumed');
}

// 撤销令牌
relay.revokeRelayToken(relayToken.token);

// 清理过期令牌
const cleaned = relay.cleanupExpiredTokens();
console.log(`Cleaned ${cleaned} expired tokens`);
```

### 3. OAuth 2.0 Manager (oauth.ts)

支持三种 OAuth 授权流程，符合 RFC 6749/7636/8628 标准。

#### Authorization Code Flow (推荐)

```typescript
import OAuth2Manager from './src/permissions/oauth.js';

const oauth = new OAuth2Manager({
  clientId: 'my-app',
  clientSecret: 'secret',
  tokenEndpoint: 'https://provider.com/token',
  authorizationEndpoint: 'https://provider.com/authorize',
  redirectUri: 'http://localhost:3000/callback',
  scopes: ['read', 'write']
});

// 生成授权 URL
const authUrl = oauth.buildAuthorizationUrl({
  clientId: 'my-app',
  redirectUri: 'http://localhost:3000/callback',
  scopes: ['read', 'write']
});
console.log('Send user to:', authUrl);

// 用户授权后，交换授权码获取令牌
const tokenResponse = await oauth.exchangeAuthorizationCode('auth-code', 'http://localhost:3000/callback');
console.log('Access token:', tokenResponse.access_token);
```

#### Device Flow (CLI 场景)

```typescript
// 初始化设备流程
const deviceResponse = await oauth.initializeDeviceFlow();
console.log(`Go to ${deviceResponse.verification_uri} and enter: ${deviceResponse.user_code}`);

// 轮询令牌（等待用户授权）
const tokenResponse = await oauth.pollDeviceFlowToken(
  deviceResponse.device_code,
  5000,  // 轮询间隔
  120    // 最大尝试次数
);
console.log('Access token:', tokenResponse.access_token);
```

#### Client Credentials Flow (M2M)

```typescript
// 获取 M2M 令牌（机器对机器）
const tokenResponse = await oauth.getTokenWithClientCredentials({
  clientId: 'my-service',
  clientSecret: 'secret',
  scopes: ['admin']
});
console.log('Service token:', tokenResponse.access_token);
```

#### PKCE 支持 (RFC 7636)

```typescript
// 生成 PKCE 挑战
const { codeVerifier, codeChallenge } = oauth.generatePKCEChallenge();

// 构建包含 PKCE 的授权 URL
const authUrl = oauth.buildAuthorizationUrl({
  clientId: 'my-app',
  redirectUri: 'http://localhost:3000/callback',
  scopes: ['read', 'write'],
  codeChallenge
});

// 交换时使用 code verifier
const tokenResponse = await oauth.exchangeAuthorizationCode(
  'auth-code',
  'http://localhost:3000/callback',
  codeVerifier
);
```

#### Token 刷新

```typescript
const newToken = await oauth.refreshAccessToken({
  clientId: 'my-app',
  clientSecret: 'secret',
  refreshToken: tokenResponse.refresh_token
});
console.log('New access token:', newToken.access_token);
```

## 与权限引擎集成

权限中继系统与现有的 PermissionEngine 无缝集成：

```typescript
import PermissionEngine from './src/permissions/permission-engine.js';
import PermissionRelay from './src/permissions/permission-relay.js';

// 权限决策流程
const engine = new PermissionEngine();
engine.addRule('allow', 'Bash(git **)');
engine.addRule('deny', 'Bash(rm **)');

// 做出权限决策
const decision = engine.decide({
  toolName: 'Bash',
  toolInput: { command: 'git push' },
  user: 'alice'
});

if (decision.decision === 'allow') {
  // 创建中继令牌供其他进程使用
  const relay = new PermissionRelay();
  const token = relay.createRelayToken({
    sourceUser: 'alice',
    sourceSession: 'session-1',
    targetUser: 'bob',
    scopes: ['execute']
  });
}
```

## 安全特性

1. **签名防篡改**: 所有令牌使用 HMAC-SHA256 签名
2. **时间戳验证**: 支持可配置的过期时间
3. **一次性使用**: Relay 令牌使用后自动失效
4. **环境变量密钥**: 支持 `AXON_PERMISSION_SECRET`
5. **PKCE 支持**: 防止授权码拦截攻击

## 测试

所有模块均有完整的单元测试覆盖：

```bash
# 运行所有权限测试
npm test -- tests/unit/permissions/ --run

# 运行特定模块测试
npm test -- tests/unit/permissions/token-manager.test.ts --run
npm test -- tests/unit/permissions/permission-relay.test.ts --run
npm test -- tests/unit/permissions/oauth.test.ts --run
```

**测试覆盖**: 122 个单元测试，100% 通过率

## 下一步工作

- [ ] CLI `--channels` 参数集成
- [ ] ConversationLoop 集成
- [ ] 审计日志持久化
- [ ] 性能基准测试 (10000次 < 2秒)
- [ ] 管理界面支持

## 相关文档

- [权限引擎](./src/permissions/permission-engine.ts)
- [条件规则引擎](./src/permissions/condition-evaluator.ts)
- [托管策略](./src/permissions/managed-policies.ts)
- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [OAuth Device Flow RFC 8628](https://tools.ietf.org/html/rfc8628)
- [PKCE RFC 7636](https://tools.ietf.org/html/rfc7636)
