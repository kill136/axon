# 连接器系统完整投产计划

## 目标
将连接器从"空壳 OAuth UI"升级为**真正可投产的完整系统**：连接成功后自动启动 MCP Server，AI 能实际调用 GitHub API / Google API。

## MCP Server 选型

| Connector | MCP Server Package | 环境变量 | 备注 |
|-----------|-------------------|----------|------|
| GitHub | `@modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` ← accessToken | OAuth token 直接当 PAT 用 |
| Google Workspace (Gmail+Calendar+Drive) | `@anthropic-ai/google-workspace-mcp` 或 `@presto-ai/google-workspace-mcp` | 需要写 credentials 文件 | Google 系合并为一个 |

**关键设计决策**：
- GitHub 最简单：OAuth access_token 直接作为 `GITHUB_PERSONAL_ACCESS_TOKEN` 环境变量注入
- Google 系列复杂：社区 MCP server 都自带 OAuth 流程，需要 `gcp-oauth.keys.json` + 首次认证。我们的方案：**把我们已获取的 token 写入 MCP server 期望的 credentials 文件**，跳过它的内置认证
- 三个 Google connector（Gmail/Calendar/Drive）**合并为一个 MCP server 实例**（`google-workspace`），因为一个包就能覆盖全部

## 改动清单（6 个文件）

### 1. `src/web/server/connectors/types.ts`

新增 `mcpServer` 字段到 `ConnectorProvider`：
```typescript
mcpServer?: {
  serverName: string;       // MCP server 注册名，如 "connector-github"
  command: string;          // "npx"
  args: string[];           // ["-y", "@modelcontextprotocol/server-github"]
  envMapping: Record<string, 'accessToken' | 'refreshToken'>;
  // key = 环境变量名, value = 从 ConnectorTokenData 中取哪个字段
};
```

新增到 `ConnectorStatus`：
```typescript
mcpServerName?: string;    // 关联的 MCP server name
mcpConnected?: boolean;    // MCP server 是否已连接
mcpToolCount?: number;     // 可用工具数量
```

### 2. `src/web/server/connectors/providers.ts`

为 GitHub 添加 mcpServer 配置：
```typescript
{
  id: 'github',
  // ...existing
  mcpServer: {
    serverName: 'connector-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envMapping: {
      'GITHUB_PERSONAL_ACCESS_TOKEN': 'accessToken',
    },
  },
}
```

Gmail/Calendar/Drive 暂不配置 mcpServer（Google MCP 生态还不够成熟，各个社区包的 token 注入方式不统一）。先把 GitHub 做通，Google 系列后续补。

### 3. `src/web/server/connectors/index.ts` — 核心增强

#### 3a. Token 刷新
```typescript
async refreshTokenIfNeeded(connectorId: string): Promise<boolean>
```
- 检查 `expiresAt`，距过期 < 5 分钟时用 `refreshToken` 刷新
- 更新 settings.json 中的 accessToken/expiresAt
- 仅 Google 类需要（GitHub OAuth token 不过期）

#### 3b. 获取 MCP 配置
```typescript
getMcpServerConfig(connectorId: string): { name: string; config: McpServerConfig } | null
```
- 根据 provider.mcpServer 配置 + token data 构建完整 MCP server 配置
- 将 token 映射为 env 环境变量

#### 3c. handleCallback 后写入 MCP 配置
OAuth 成功后，如果 provider 有 mcpServer，自动写入 `settings.json` 的 `mcpServers` 字段。

#### 3d. disconnect 时清理 MCP 配置
从 `settings.json` 的 `mcpServers` 中删除 `connector-{id}`。

#### 3e. listConnectors 增强
填充 `mcpServerName`、`mcpConnected`、`mcpToolCount`。

### 4. `src/web/server/routes/connectors-api.ts`

#### 新增 POST `/api/connectors/:id/activate-mcp`
通知 ConversationManager 激活该 connector 的 MCP server。

#### 新增 POST `/api/connectors/:id/refresh`
手动刷新 Token。

#### 修改 callback 路由
成功后自动触发 MCP 激活。

### 5. `src/web/server/conversation.ts`

#### 新增 `activateConnectorMcp(connectorId: string)`
- 从 ConnectorManager 获取 MCP 配置
- 必要时刷新 token
- `registerMcpServer()` → `connectMcpServer()` → `createMcpTools()`
- 加入 `this.mcpTools`

#### 新增 `deactivateConnectorMcp(connectorId: string)`
- 断开 MCP server、清理 mcpTools、注销

#### 增强 `initializeAllMcpServers()`
启动时检查已连接的 connectors，自动激活有 mcpServer 配置的。

### 6. `ConnectorsPanel.tsx` — 前端增强
- 已连接 connector 显示 MCP 工具数量 "X tools available"
- Connect 成功后自动调用 activate-mcp
- 显示 MCP 连接状态（connected/connecting/failed）

## 实施顺序
1. types.ts — 扩展类型
2. providers.ts — GitHub MCP 映射
3. connectors/index.ts — Token 刷新 + MCP 配置生成 + 注册/清理
4. connectors-api.ts — 新 API + callback 联动
5. conversation.ts — MCP 激活/停用
6. ConnectorsPanel.tsx — 前端状态

## 注意事项
- MCP server name 用 `connector-` 前缀避免冲突
- GitHub OAuth token 等价于 PAT，可以直接用
- Google 系列先标记为"需手动配置 MCP"，后续补全
- Token 刷新失败 → 标记 disconnected → 前端提示重新授权
