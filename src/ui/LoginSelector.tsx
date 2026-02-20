/**
 * 登录方法选择器组件
 * 复刻官方 Claude Code 的登录选择界面
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { t } from '../i18n/index.js';

export type LoginMethod = 'claudeai' | 'console' | 'exit';

export interface LoginSelectorProps {
  onSelect: (method: LoginMethod) => void;
}

/**
 * 登录方法选择器
 * 提供交互式界面让用户选择登录方式
 */
export function LoginSelector({ onSelect }: LoginSelectorProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState<number>(1); // 默认选择 Console account (索引1)
  const { exit } = useApp();

  // 登录选项
  const options = [
    {
      key: 'claudeai',
      label: 'Claude account with subscription',
      detail: 'Pro, Max, Team, or Enterprise',
      value: 'claudeai' as LoginMethod,
    },
    {
      key: 'console',
      label: 'Anthropic Console account',
      detail: 'API usage billing',
      value: 'console' as LoginMethod,
    },
  ];

  // 处理键盘输入
  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => Math.min(options.length - 1, prev + 1));
    } else if (key.return) {
      // 用户按下回车确认选择
      onSelect(options[selectedIndex].value);
    } else if (key.escape || input === 'q') {
      // ESC 或 q 退出
      onSelect('exit');
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text>
          Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold>Select login method:</Text>
      </Box>

      {options.map((option, index) => (
        <Box key={option.key} marginLeft={1} marginY={0}>
          <Text>
            {selectedIndex === index ? (
              <Text color="cyan" bold>
                {'>'}{' '}
              </Text>
            ) : (
              <Text dimColor>  </Text>
            )}
            {index + 1}. <Text bold={selectedIndex === index}>{option.label}</Text>
            {' · '}
            <Text dimColor>{option.detail}</Text>
          </Text>
        </Box>
      ))}

      <Box marginTop={1} marginLeft={1}>
        <Text dimColor>
          Use arrow keys or j/k to navigate, Enter to select, Esc or q to exit
        </Text>
      </Box>
    </Box>
  );
}

/**
 * 检查是否需要显示登录选择器
 * 如果用户已经有认证凭据,则不需要
 *
 * 支持以下认证方式（跳过登录选择器）：
 * 1. ANTHROPIC_API_KEY 或 CLAUDE_API_KEY 环境变量
 * 2. ANTHROPIC_AUTH_TOKEN 环境变量（OAuth token）
 * 3. ANTHROPIC_BASE_URL + 上述任一认证方式（第三方API服务）
 */
export function shouldShowLoginSelector(): boolean {
  // 检查环境变量中的 API key
  const hasEnvKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (hasEnvKey) {
    return false;
  }

  // 检查环境变量中的 Auth Token（支持第三方API服务）
  // Issue #64: 支持 ANTHROPIC_AUTH_TOKEN 环境变量
  const hasAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;
  if (hasAuthToken) {
    return false;
  }

  // 检查文件系统中的凭据
  const claudeDir = path.join(os.homedir(), '.claude');

  // 检查 credentials.json (API key)
  const credentialsFile = path.join(claudeDir, 'credentials.json');
  if (fs.existsSync(credentialsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
      if (creds.apiKey || creds.api_key) {
        return false; // 已经有 API key
      }
    } catch {
      // 文件存在但格式错误,继续检查其他文件
    }
  }

  // 检查 auth.json (OAuth token)
  const authFile = path.join(claudeDir, 'auth.json');
  if (fs.existsSync(authFile)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
      if (auth.accessToken || auth.access_token) {
        return false; // 已经有 OAuth token
      }
    } catch {
      // 文件存在但格式错误,继续检查
    }
  }

  // 检查 settings.json 中的 sessionToken 或其他认证信息
  const settingsFile = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      if (settings.apiKey || settings.sessionToken || settings.oauthToken) {
        return false;
      }
    } catch {
      // 忽略解析错误
    }
  }

  // 如果所有检查都没有找到凭据,则需要显示登录选择器
  return true;
}

/**
 * 获取当前认证状态描述
 */
export function getAuthStatusMessage(): string {
  const hasEnvKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (hasEnvKey) {
    return t('auth.envVar');
  }

  const claudeDir = path.join(os.homedir(), '.claude');

  const credentialsFile = path.join(claudeDir, 'credentials.json');
  if (fs.existsSync(credentialsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
      if (creds.apiKey || creds.api_key) {
        return t('auth.apiKey');
      }
    } catch {
      // 忽略
    }
  }

  const authFile = path.join(claudeDir, 'auth.json');
  if (fs.existsSync(authFile)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
      if (auth.accessToken || auth.access_token) {
        return t('auth.oauth');
      }
    } catch {
      // 忽略
    }
  }

  return t('auth.notAuthenticated');
}
