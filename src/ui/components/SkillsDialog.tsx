/**
 * SkillsDialog 组件 - 官方风格的 Skills 对话框
 * 显示可用的 skills，按来源分组
 */

import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../../i18n/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Skill 来源类型
type SkillSource = 'policySettings' | 'userSettings' | 'projectSettings' | 'localSettings' | 'flagSettings' | 'plugin' | 'builtin';

// Skill 信息
interface SkillInfo {
  name: string;
  source: SkillSource;
  description?: string;
  contentLength?: number;
  filePath?: string;
}

interface SkillsDialogProps {
  onDone?: () => void;
  cwd: string;
}

// 来源显示名称
function getSourceLabels(): Record<SkillSource, string> {
  return {
    policySettings: t('skills.source.enterprisePolicy'),
    userSettings: t('skills.source.userSettings'),
    projectSettings: t('skills.source.project'),
    localSettings: t('skills.source.local'),
    flagSettings: t('skills.source.flagSettings'),
    plugin: t('skills.source.plugin'),
    builtin: t('skills.source.builtin'),
  };
}

// 来源路径提示
const SOURCE_PATHS: Record<SkillSource, string> = {
  policySettings: '',
  userSettings: '~/.claude/skills/',
  projectSettings: '.claude/commands/',
  localSettings: '.claude/skills/',
  flagSettings: '',
  plugin: 'plugin',
  builtin: '',
};

// 格式化 token 数
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

// 扫描目录中的 skills
function scanSkillsDir(dir: string, source: SkillSource): SkillInfo[] {
  const skills: SkillInfo[] = [];

  if (!fs.existsSync(dir)) return skills;

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(dir, file);
        const name = file.replace('.md', '');

        let contentLength = 0;
        try {
          const stat = fs.statSync(filePath);
          contentLength = stat.size;
        } catch {
          // ignore
        }

        skills.push({
          name,
          source,
          contentLength,
          filePath,
        });
      }
    }
  } catch {
    // ignore
  }

  return skills;
}

// 扫描 plugin 中的 skills
function scanPluginSkills(): SkillInfo[] {
  const skillsMap = new Map<string, SkillInfo>(); // 用于去重
  const pluginsCacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');

  if (!fs.existsSync(pluginsCacheDir)) return [];

  try {
    // 遍历 marketplace 目录
    const marketplaces = fs.readdirSync(pluginsCacheDir, { withFileTypes: true });
    for (const marketplace of marketplaces) {
      if (!marketplace.isDirectory()) continue;

      const marketplacePath = path.join(pluginsCacheDir, marketplace.name);
      const plugins = fs.readdirSync(marketplacePath, { withFileTypes: true });

      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue;

        const pluginPath = path.join(marketplacePath, plugin.name);
        const versions = fs.readdirSync(pluginPath, { withFileTypes: true });

        for (const version of versions) {
          if (!version.isDirectory()) continue;

          // 检查 skills 目录
          const skillsPath = path.join(pluginPath, version.name, 'skills');
          if (!fs.existsSync(skillsPath)) continue;

          const skillDirs = fs.readdirSync(skillsPath, { withFileTypes: true });
          for (const skillDir of skillDirs) {
            if (!skillDir.isDirectory()) continue;

            // 如果已经存在同名 skill，跳过（去重）
            if (skillsMap.has(skillDir.name)) continue;

            // 查找 SKILL.md 或 skill.md
            const skillMdPath = path.join(skillsPath, skillDir.name, 'SKILL.md');
            const skillMdPathLower = path.join(skillsPath, skillDir.name, 'skill.md');

            let skillFilePath = '';
            if (fs.existsSync(skillMdPath)) {
              skillFilePath = skillMdPath;
            } else if (fs.existsSync(skillMdPathLower)) {
              skillFilePath = skillMdPathLower;
            }

            if (skillFilePath) {
              try {
                const stat = fs.statSync(skillFilePath);
                skillsMap.set(skillDir.name, {
                  name: skillDir.name,
                  source: 'plugin',
                  contentLength: stat.size,
                  filePath: skillFilePath,
                });
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return Array.from(skillsMap.values());
}

// 获取所有可用的 skills
function getAllSkills(cwd: string): SkillInfo[] {
  const skills: SkillInfo[] = [];

  // 1. Plugin skills (从已安装的 plugins 加载)
  skills.push(...scanPluginSkills());

  // 2. User skills (~/.claude/skills/)
  const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  skills.push(...scanSkillsDir(userSkillsDir, 'userSettings'));

  // 3. Project skills (.claude/commands/)
  const projectSkillsDir = path.join(cwd, '.claude', 'commands');
  skills.push(...scanSkillsDir(projectSkillsDir, 'projectSettings'));

  // 4. Local skills (.claude/skills/)
  const localSkillsDir = path.join(cwd, '.claude', 'skills');
  skills.push(...scanSkillsDir(localSkillsDir, 'localSettings'));

  return skills;
}

export const SkillsDialog: React.FC<SkillsDialogProps> = ({ onDone, cwd }) => {
  // 处理键盘输入
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'q') {
      onDone?.();
    }
  });

  // 获取并分组 skills
  const skills = useMemo(() => getAllSkills(cwd), [cwd]);

  const groupedSkills = useMemo(() => {
    const groups: Record<SkillSource, SkillInfo[]> = {
      policySettings: [],
      userSettings: [],
      projectSettings: [],
      localSettings: [],
      flagSettings: [],
      plugin: [],
      builtin: [],
    };

    for (const skill of skills) {
      if (skill.source in groups) {
        groups[skill.source].push(skill);
      }
    }

    return groups;
  }, [skills]);

  // 渲染单个 skill
  const renderSkill = (skill: SkillInfo) => {
    const tokens = skill.contentLength ? Math.ceil(skill.contentLength / 4) : undefined;
    const tokenStr = tokens ? formatTokens(tokens) : '';

    return (
      <Box key={`${skill.name}-${skill.source}`}>
        <Text>{skill.name}</Text>
        {tokenStr && <Text dimColor> · {tokenStr} tokens</Text>}
      </Box>
    );
  };

  // 渲染分组
  const renderGroup = (source: SkillSource) => {
    const items = groupedSkills[source];
    if (items.length === 0) return null;

    const label = getSourceLabels()[source];
    const pathHint = SOURCE_PATHS[source];

    return (
      <Box flexDirection="column" key={source} marginBottom={1}>
        <Box>
          <Text bold dimColor>{label}</Text>
          {pathHint && <Text dimColor> ({pathHint})</Text>}
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {items.map(renderSkill)}
        </Box>
      </Box>
    );
  };

  // 无 skills 时的显示
  if (skills.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">{t('skills.title')}</Text>
          <Text dimColor> · {t('skills.noSkillsFound')}</Text>
        </Box>

        <Text dimColor>{t('skills.createHint')}</Text>

        <Box marginTop={1}>
          <Text dimColor italic>{t('skills.escToClose')}</Text>
        </Box>
      </Box>
    );
  }

  // 正常显示
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">{t('skills.title')}</Text>
        <Text dimColor> · {skills.length === 1 ? t('skills.skillCount', { count: skills.length }) : t('skills.skillsCount', { count: skills.length })}</Text>
      </Box>

      <Box flexDirection="column">
        {renderGroup('plugin')}
        {renderGroup('policySettings')}
        {renderGroup('userSettings')}
        {renderGroup('projectSettings')}
        {renderGroup('localSettings')}
      </Box>

      <Box marginTop={1}>
        <Text dimColor italic>{t('skills.escToClose')}</Text>
      </Box>
    </Box>
  );
};

export default SkillsDialog;
