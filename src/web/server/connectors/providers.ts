/**
 * 预定义 OAuth 连接器模板
 */

import type { ConnectorProvider } from './types.js';

/**
 * Google Workspace MCP (@dguido/google-workspace-mcp) 需要的完整 OAuth scopes
 * 对应 MCP 源码中 SERVICE_SCOPES 定义的所有服务权限
 * 因为三个 Google connector 共享同一个 MCP 实例，所以任何一个授权时
 * 都需要一次性请求所有 scope
 */
const GOOGLE_WORKSPACE_SCOPES = [
  // Gmail: gmail.modify + full mailbox + settings
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  // Calendar
  'https://www.googleapis.com/auth/calendar',
  // Drive
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  // Docs
  'https://www.googleapis.com/auth/documents',
  // Sheets
  'https://www.googleapis.com/auth/spreadsheets',
  // Slides
  'https://www.googleapis.com/auth/presentations',
  // Contacts
  'https://www.googleapis.com/auth/contacts',
];

export const BUILTIN_PROVIDERS: ConnectorProvider[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'web',
    description: 'Access repositories, issues, and pull requests',
    icon: 'github',
    // 双模式：公网部署用 OAuth App，本地用 Personal Access Token
    oauth: {
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:user'],
      envClientId: 'GITHUB_CLIENT_ID',
      envClientSecret: 'GITHUB_CLIENT_SECRET',
    },
    credentials: {
      fields: [
        { key: 'pat', label: 'Personal Access Token', type: 'password', envVar: 'GITHUB_TOKEN', mcpEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
      ],
    },
    mcpServer: {
      serverName: 'connector-github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      envMapping: {
        'GITHUB_PERSONAL_ACCESS_TOKEN': 'accessToken',
      },
    },
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'google',
    description: 'Read and search email messages',
    icon: 'gmail',
    oauth: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: GOOGLE_WORKSPACE_SCOPES,
      responseType: 'code',
      envClientId: 'GOOGLE_CLIENT_ID',
      envClientSecret: 'GOOGLE_CLIENT_SECRET',
    },
    mcpServer: {
      serverName: 'connector-google',
      command: 'npx',
      args: ['-y', '@dguido/google-workspace-mcp'],
      envMapping: {},
      shared: true,
    },
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'google',
    description: 'View and manage calendar events',
    icon: 'google-calendar',
    oauth: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: GOOGLE_WORKSPACE_SCOPES,
      responseType: 'code',
      envClientId: 'GOOGLE_CLIENT_ID',
      envClientSecret: 'GOOGLE_CLIENT_SECRET',
    },
    mcpServer: {
      serverName: 'connector-google',
      command: 'npx',
      args: ['-y', '@dguido/google-workspace-mcp'],
      envMapping: {},
      shared: true,
    },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'google',
    description: 'Search and read files from Google Drive',
    icon: 'google-drive',
    oauth: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: GOOGLE_WORKSPACE_SCOPES,
      responseType: 'code',
      envClientId: 'GOOGLE_CLIENT_ID',
      envClientSecret: 'GOOGLE_CLIENT_SECRET',
    },
    mcpServer: {
      serverName: 'connector-google',
      command: 'npx',
      args: ['-y', '@dguido/google-workspace-mcp'],
      envMapping: {},
      shared: true,
    },
  },
  {
    id: 'feishu',
    name: 'Feishu',
    category: 'feishu',
    description: 'Access Feishu/Lark messages, docs, calendar, and more',
    icon: 'feishu',
    oauth: {
      authorizationEndpoint: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      tokenEndpoint: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      scopes: [],  // 飞书 OAuth 不在 URL 中指定 scope，权限由应用配置决定
      responseType: 'code',
      envClientId: 'FEISHU_APP_ID',
      envClientSecret: 'FEISHU_APP_SECRET',
    },
    mcpServer: {
      serverName: 'connector-feishu',
      command: 'npx',
      args: ['-y', '@larksuiteoapi/lark-mcp', 'mcp'],
      envMapping: {},
    },
  },
  {
    id: 'dingtalk',
    name: 'DingTalk',
    category: 'dingtalk',
    description: 'Contacts, calendar, to-dos, bot messages, logs, project management, and more',
    icon: 'dingtalk',
    credentials: {
      fields: [
        { key: 'clientId', label: 'Client ID (App Key)', type: 'text', envVar: 'DINGTALK_CLIENT_ID', mcpEnvVar: 'DINGTALK_Client_ID' },
        { key: 'clientSecret', label: 'Client Secret (App Secret)', type: 'password', envVar: 'DINGTALK_CLIENT_SECRET', mcpEnvVar: 'DINGTALK_Client_Secret' },
      ],
    },
    mcpServer: {
      serverName: 'connector-dingtalk',
      command: 'npx',
      args: ['-y', 'dingtalk-mcp@latest'],
      envMapping: {},
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'web',
    description: 'Search, read, and create Notion pages and databases',
    icon: 'notion',
    mcpRemoteUrl: 'https://mcp.notion.com/mcp',
    mcpServer: {
      serverName: 'connector-notion',
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.notion.com/mcp'],
      envMapping: {},
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'web',
    description: 'Send messages, manage channels, and search Slack workspace',
    icon: 'slack',
    // 双模式：公网 HTTPS 部署用 OAuth，本地/私有部署用 Bot Token
    // 运行时由 ConnectorManager.listConnectors 根据环境变量动态判断 authType
    oauth: {
      authorizationEndpoint: 'https://slack.com/oauth/v2/authorize',
      tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
      scopes: ['channels:history', 'channels:read', 'chat:write', 'groups:history', 'groups:read', 'im:history', 'im:read', 'mpim:history', 'mpim:read', 'users:read', 'reactions:read', 'reactions:write'],
      envClientId: 'SLACK_CLIENT_ID',
      envClientSecret: 'SLACK_CLIENT_SECRET',
    },
    credentials: {
      fields: [
        { key: 'botToken', label: 'Bot Token (xoxb-...)', type: 'password', envVar: 'SLACK_BOT_TOKEN', mcpEnvVar: 'SLACK_BOT_TOKEN' },
        { key: 'teamId', label: 'Team ID (T...)', type: 'text', envVar: 'SLACK_TEAM_ID', mcpEnvVar: 'SLACK_TEAM_ID' },
      ],
    },
    mcpServer: {
      serverName: 'connector-slack',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      envMapping: {
        'SLACK_BOT_TOKEN': 'accessToken',
      },
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'web',
    description: 'Manage issues, projects, and teams in Linear',
    icon: 'linear',
    mcpRemoteUrl: 'https://mcp.linear.app/mcp',
    mcpServer: {
      serverName: 'connector-linear',
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'],
      envMapping: {},
    },
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'web',
    description: 'Search issues, manage projects, and track work in Jira & Confluence',
    icon: 'jira',
    mcpRemoteUrl: 'https://mcp.atlassian.com/v1/mcp',
    mcpServer: {
      serverName: 'connector-jira',
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.atlassian.com/v1/mcp'],
      envMapping: {},
    },
  },
];
