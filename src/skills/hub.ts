/**
 * Skill Hub - 社区 Skill 注册中心
 * 使用 GitHub 仓库作为注册中心，支持搜索、安装、发布 skill
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanSkillContent } from '../security/skill-scanner.js';
import { normalizeSkillManifest, loadSkillManifest } from './manifest.js';
import { SkillInstaller, readSkillInstallState, type SkillInstallStatus } from './installer.js';

/**
 * Skill Hub 条目
 */
export interface SkillHubEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  url: string;
  tags?: string[];
  downloads?: number;
  stars?: number;
}

/**
 * 已安装 Skill 信息
 */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: 'local' | 'hub';
  path: string;
  version?: string;
  author?: string;
  installStatus?: SkillInstallStatus;
}

/**
 * Skill 注册表缓存
 */
let registryCache: { data: SkillHubEntry[]; timestamp: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 小时

/**
 * 获取 Skill Hub URL（从配置或环境变量）
 */
function getSkillHubUrl(): string {
  // 从配置获取
  try {
    const { configManager } = require('../config/index.js');
    const config = configManager.getConfig();
    if (config.skillHubUrl) {
      return config.skillHubUrl;
    }
  } catch {
    // 配置读取失败，使用默认值
  }

  // 从环境变量获取
  if (process.env.AXON_SKILL_HUB_URL) {
    return process.env.AXON_SKILL_HUB_URL;
  }

  // 默认 GitHub raw URL
  return 'https://raw.githubusercontent.com/kill136/claude-code-skills/main/registry.json';
}

/**
 * 获取注册表数据（带缓存）
 */
async function getRegistry(): Promise<SkillHubEntry[]> {
  // 检查缓存
  if (registryCache && Date.now() - registryCache.timestamp < CACHE_TTL) {
    return registryCache.data;
  }

  try {
    const url = getSkillHubUrl();
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Claude-Code-Open/2.1.33',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.statusText}`);
    }

    const data: any = await response.json();
    const skills: SkillHubEntry[] = data.skills || [];

    // 更新缓存
    registryCache = {
      data: skills,
      timestamp: Date.now(),
    };

    return skills;
  } catch (error) {
    console.error('Failed to fetch skill registry:', error);
    return [];
  }
}

/**
 * 搜索 skills
 * @param query 搜索关键词（匹配 name 和 description）
 * @returns 匹配的 skill 列表
 */
export async function searchSkills(query: string): Promise<SkillHubEntry[]> {
  const skills = await getRegistry();

  if (!query || query.trim() === '') {
    return skills;
  }

  const lowerQuery = query.toLowerCase();

  return skills.filter((skill) => {
    const nameMatch = skill.name.toLowerCase().includes(lowerQuery);
    const descMatch = skill.description.toLowerCase().includes(lowerQuery);
    const tagMatch = skill.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery));
    
    return nameMatch || descMatch || tagMatch;
  });
}

/**
 * 安装 skill
 * @param skillId skill ID
 * @returns 安装成功返回 true
 */
export async function installSkill(skillId: string): Promise<void> {
  const skills = await getRegistry();
  const skill = skills.find((s) => s.id === skillId);

  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  // 下载 SKILL.md
  const response = await fetch(skill.url, {
    headers: {
      'User-Agent': 'Claude-Code-Open/2.1.33',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download skill: ${response.statusText}`);
  }

  const content = await response.text();

  // 安全扫描
  const scanResult = scanSkillContent(content);

  if (!scanResult.safe) {
    // 检查是否有critical级别的警告
    const criticalWarnings = scanResult.warnings.filter(w => w.rule.includes('child_process') || w.rule.includes('exec') || w.rule.includes('spawn') || w.rule.includes('eval'));
    
    if (criticalWarnings.length > 0) {
      throw new Error(
        `Skill contains critical security issues:\n${criticalWarnings.map((w) => `  - ${w.detail}`).join('\n')}`
      );
    }

    // 其他警告，显示但允许继续
    console.warn(`⚠️  Warning: Skill contains security warnings:`);
    scanResult.warnings.forEach((warning) => {
      console.warn(`  - ${warning.detail}`);
    });
  }

  // 保存到 ~/.axon/skills/{skillId}/SKILL.md
  const skillsDir = path.join(os.homedir(), '.axon', 'skills', skillId);

  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const skillPath = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillPath, content, 'utf-8');

  // 保存元数据
  const metaPath = path.join(skillsDir, '.meta.json');
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: skillId,
        source: 'hub',
        installedAt: new Date().toISOString(),
        version: skill.version,
        author: skill.author,
      },
      null,
      2
    ),
    'utf-8'
  );

  // 尝试下载 skill.json manifest
  let manifest = null;
  const manifestUrl = skill.url.replace(/SKILL\.md$/, 'skill.json');
  try {
    const manifestResponse = await fetch(manifestUrl, {
      headers: { 'User-Agent': 'Claude-Code-Open/2.1.33' },
    });
    if (manifestResponse.ok) {
      const manifestRaw = await manifestResponse.text();
      const manifestParsed = JSON.parse(manifestRaw);
      manifest = normalizeSkillManifest(manifestParsed);
      // 保存 skill.json 到本地
      fs.writeFileSync(path.join(skillsDir, 'skill.json'), manifestRaw, 'utf-8');
      console.log(`📦 Found skill manifest, installing dependencies...`);
    }
  } catch {
    // manifest 不存在或解析失败，按 legacy 模式处理
  }

  // 调用 installer 安装依赖并写入 install-state.json
  const installer = new SkillInstaller();
  const installState = await installer.install({
    skillName: skillId,
    skillDir: skillsDir,
    manifest,
  });

  if (installState.status === 'installed') {
    console.log(`✅ Skill "${skill.name}" installed successfully!`);
  } else if (installState.status === 'installed_no_manifest') {
    console.log(`✅ Skill "${skill.name}" installed (legacy mode, no dependency manifest).`);
  } else if (installState.status === 'degraded') {
    console.log(`⚠️  Skill "${skill.name}" installed with warnings: some dependencies are missing.`);
    for (const err of installState.errors) {
      console.warn(`   - ${err}`);
    }
  } else {
    console.error(`❌ Skill "${skill.name}" installation failed.`);
    for (const err of installState.errors) {
      console.error(`   - ${err}`);
    }
  }
}

/**
 * 发布 skill 到社区
 * @param skillPath skill 文件路径
 * @returns PR URL
 */
export async function publishSkill(skillPath: string): Promise<string> {
  // 读取 SKILL.md
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill file not found: ${skillPath}`);
  }

  const content = fs.readFileSync(skillPath, 'utf-8');

  // 验证 frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    throw new Error('Invalid skill file: missing frontmatter');
  }

  const frontmatter = frontmatterMatch[1];

  // 检查必需字段
  const requiredFields = ['name', 'description', 'version'];
  for (const field of requiredFields) {
    if (!frontmatter.includes(`${field}:`)) {
      throw new Error(`Invalid skill file: missing required field "${field}"`);
    }
  }

  // 安全扫描
  const scanResult = scanSkillContent(content);
  if (!scanResult.safe) {
    throw new Error(
      `Skill contains security issues that prevent publication:\n${scanResult.warnings.map((w) => `  - ${w.detail}`).join('\n')}`
    );
  }

  // 生成 PR（使用 gh CLI）
  // 这里简化实现：指导用户手动创建 PR
  console.log('\n📤 To publish your skill to the community:');
  console.log('\n1. Fork the repository: https://github.com/kill136/claude-code-skills');
  console.log('2. Add your skill to the registry.json and create a PR');
  console.log('3. Include your SKILL.md in the skills/ directory\n');

  // 显示应该添加到 registry.json 的条目
  const skillId = path.basename(path.dirname(skillPath));
  const nameMatch = frontmatter.match(/name:\s*(.+)/);
  const descMatch = frontmatter.match(/description:\s*(.+)/);
  const versionMatch = frontmatter.match(/version:\s*(.+)/);

  const entry: SkillHubEntry = {
    id: skillId,
    name: nameMatch?.[1].trim() || skillId,
    description: descMatch?.[1].trim() || '',
    version: versionMatch?.[1].trim() || '1.0.0',
    author: 'community',
    url: `https://raw.githubusercontent.com/kill136/claude-code-skills/main/skills/${skillId}/SKILL.md`,
  };

  console.log('Suggested registry entry:');
  console.log(JSON.stringify(entry, null, 2));
  console.log('');

  return 'https://github.com/kill136/claude-code-skills/pulls';
}

/**
 * 列出已安装的 skills
 * @returns skill 列表
 */
export function listInstalledSkills(): SkillInfo[] {
  const skillsDir = path.join(os.homedir(), '.axon', 'skills');

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const skillDirs = fs.readdirSync(skillsDir);
  const skills: SkillInfo[] = [];

  for (const dir of skillDirs) {
    const skillPath = path.join(skillsDir, dir);
    const skillFile = path.join(skillPath, 'SKILL.md');
    const metaFile = path.join(skillPath, '.meta.json');

    if (!fs.existsSync(skillFile)) {
      continue;
    }

    let source: 'local' | 'hub' = 'local';
    let version: string | undefined;
    let author: string | undefined;

    // 读取元数据
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        source = meta.source || 'local';
        version = meta.version;
        author = meta.author;
      } catch {
        // 忽略元数据读取错误
      }
    }

    // 读取 SKILL.md frontmatter
    const content = fs.readFileSync(skillFile, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    let name = dir;
    let description = '';

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(.+)/);

      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
    }

    // 读取安装状态
    const installState = readSkillInstallState(skillPath);
    const installStatus = installState?.status;

    skills.push({
      id: dir,
      name,
      description,
      source,
      path: skillPath,
      version,
      author,
      installStatus,
    });
  }

  return skills;
}
