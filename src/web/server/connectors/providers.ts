/**
 * 预定义 OAuth 连接器模板
 */

import type { ConnectorProvider } from './types.js';

export const BUILTIN_PROVIDERS: ConnectorProvider[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'web',
    description: 'Access repositories, issues, and pull requests',
    icon: 'github',
    oauth: {
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:user'],
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
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      responseType: 'code',
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
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      responseType: 'code',
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
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      responseType: 'code',
    },
  },
];
