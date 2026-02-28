/**
 * CLAUDE.md and Project Rules Parser
 * Parse project instructions and rules
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ProjectRules {
  instructions?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  model?: string;
  systemPrompt?: string;
  customRules?: CustomRule[];
  memory?: Record<string, string>;
}

export interface CustomRule {
  name: string;
  pattern?: string;
  action: 'allow' | 'deny' | 'warn' | 'transform';
  message?: string;
  transform?: string;
}

export interface AxonMdSection {
  title: string;
  content: string;
  level: number;
}

// File names to look for
const AXON_MD_FILES = [
  'AXON.md',
  '.axon.md',
  'axon.md',
  '.axon/AXON.md',
  '.axon/instructions.md',
];

const SETTINGS_FILES = [
  '.axon/settings.json',
  '.axon/settings.local.json',
];

/**
 * Find AXON.md file in directory hierarchy
 */
export function findClaudeMd(startDir?: string): string | null {
  let dir = startDir || process.cwd();

  // Walk up directory tree
  while (dir !== path.dirname(dir)) {
    for (const filename of AXON_MD_FILES) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    dir = path.dirname(dir);
  }

  // Check home directory
  const homeAxonMd = path.join(os.homedir(), '.axon', 'AXON.md');
  if (fs.existsSync(homeAxonMd)) {
    return homeAxonMd;
  }

  return null;
}

/**
 * Find settings files
 */
export function findSettingsFiles(startDir?: string): string[] {
  const dir = startDir || process.cwd();
  const found: string[] = [];

  // Local settings
  for (const filename of SETTINGS_FILES) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      found.push(filePath);
    }
  }

  // Global settings
  const globalSettings = path.join(os.homedir(), '.axon', 'settings.json');
  if (fs.existsSync(globalSettings)) {
    found.push(globalSettings);
  }

  return found;
}

/**
 * Parse AXON.md file
 */
export function parseClaudeMd(filePath: string): AxonMdSection[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const sections: AxonMdSection[] = [];
  const lines = content.split('\n');

  let currentSection: AxonMdSection | null = null;
  let contentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        title: headingMatch[2].trim(),
        content: '',
        level: headingMatch[1].length,
      };
      contentLines = [];
    } else if (currentSection) {
      contentLines.push(line);
    } else {
      // Content before first heading
      if (!currentSection && line.trim()) {
        currentSection = {
          title: 'Instructions',
          content: '',
          level: 0,
        };
        contentLines.push(line);
      }
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract rules from CLAUDE.md sections
 */
export function extractRules(sections: AxonMdSection[]): ProjectRules {
  const rules: ProjectRules = {};

  for (const section of sections) {
    const titleLower = section.title.toLowerCase();

    if (titleLower.includes('instruction') || section.level === 0) {
      rules.instructions = (rules.instructions || '') + section.content + '\n';
    } else if (titleLower.includes('allowed tool')) {
      rules.allowedTools = parseListFromContent(section.content);
    } else if (titleLower.includes('disallowed tool') || titleLower.includes('forbidden tool')) {
      rules.disallowedTools = parseListFromContent(section.content);
    } else if (titleLower.includes('permission')) {
      const mode = section.content.trim().split('\n')[0];
      if (['default', 'acceptEdits', 'bypassPermissions', 'plan'].includes(mode)) {
        rules.permissionMode = mode;
      }
    } else if (titleLower.includes('model')) {
      rules.model = section.content.trim().split('\n')[0];
    } else if (titleLower.includes('system prompt')) {
      rules.systemPrompt = section.content;
    } else if (titleLower.includes('rule')) {
      rules.customRules = parseCustomRules(section.content);
    } else if (titleLower.includes('memory') || titleLower.includes('context')) {
      rules.memory = parseMemoryFromContent(section.content);
    }
  }

  return rules;
}

/**
 * Parse list items from markdown content
 */
function parseListFromContent(content: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}

/**
 * Parse custom rules from content
 */
function parseCustomRules(content: string): CustomRule[] {
  const rules: CustomRule[] = [];
  const lines = content.split('\n');

  let currentRule: Partial<CustomRule> | null = null;

  for (const line of lines) {
    const ruleMatch = line.match(/^[\s]*[-*+]\s+\*\*(.+?)\*\*:\s*(.+)$/);
    if (ruleMatch) {
      if (currentRule && currentRule.name) {
        rules.push(currentRule as CustomRule);
      }

      currentRule = {
        name: ruleMatch[1].trim(),
        action: 'warn',
        message: ruleMatch[2].trim(),
      };
    } else if (currentRule) {
      // Check for action keywords
      const actionMatch = line.match(/action:\s*(allow|deny|warn|transform)/i);
      if (actionMatch) {
        currentRule.action = actionMatch[1].toLowerCase() as CustomRule['action'];
      }

      const patternMatch = line.match(/pattern:\s*(.+)/i);
      if (patternMatch) {
        currentRule.pattern = patternMatch[1].trim();
      }
    }
  }

  if (currentRule && currentRule.name) {
    rules.push(currentRule as CustomRule);
  }

  return rules;
}

/**
 * Parse memory/context section
 */
function parseMemoryFromContent(content: string): Record<string, string> {
  const memory: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^[\s]*[-*+]\s+\*\*(.+?)\*\*:\s*(.+)$/);
    if (match) {
      memory[match[1].trim()] = match[2].trim();
    }
  }

  return memory;
}

/**
 * Load all project rules
 */
export function loadProjectRules(projectDir?: string): ProjectRules {
  const dir = projectDir || process.cwd();
  let rules: ProjectRules = {};

  // Load CLAUDE.md
  const claudeMdPath = findClaudeMd(dir);
  if (claudeMdPath) {
    const sections = parseClaudeMd(claudeMdPath);
    rules = { ...rules, ...extractRules(sections) };
  }

  // Load settings files
  const settingsFiles = findSettingsFiles(dir);
  for (const settingsPath of settingsFiles) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      rules = mergeRules(rules, settings);
    } catch {
      // Ignore parse errors
    }
  }

  return rules;
}

/**
 * Merge rules with priority to second
 */
function mergeRules(base: ProjectRules, override: ProjectRules): ProjectRules {
  return {
    instructions: override.instructions || base.instructions,
    allowedTools: override.allowedTools || base.allowedTools,
    disallowedTools: override.disallowedTools || base.disallowedTools,
    permissionMode: override.permissionMode || base.permissionMode,
    model: override.model || base.model,
    systemPrompt: override.systemPrompt || base.systemPrompt,
    customRules: [
      ...(base.customRules || []),
      ...(override.customRules || []),
    ],
    memory: { ...base.memory, ...override.memory },
  };
}

/**
 * Apply custom rules to content
 */
export function applyRules(
  content: string,
  rules: CustomRule[]
): { result: string; warnings: string[]; blocked: boolean } {
  let result = content;
  const warnings: string[] = [];
  let blocked = false;

  for (const rule of rules) {
    if (!rule.pattern) continue;

    try {
      const regex = new RegExp(rule.pattern, 'g');

      if (regex.test(content)) {
        switch (rule.action) {
          case 'deny':
            blocked = true;
            warnings.push(`Blocked by rule "${rule.name}": ${rule.message || 'No message'}`);
            break;

          case 'warn':
            warnings.push(`Warning from rule "${rule.name}": ${rule.message || 'No message'}`);
            break;

          case 'transform':
            if (rule.transform) {
              result = result.replace(regex, rule.transform);
            }
            break;

          case 'allow':
            // No action needed
            break;
        }
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return { result, warnings, blocked };
}

/**
 * Generate system prompt from rules
 */
export function generateSystemPromptAddition(rules: ProjectRules): string {
  const parts: string[] = [];

  if (rules.instructions) {
    parts.push('## Project Instructions\n');
    parts.push(rules.instructions);
    parts.push('');
  }

  if (rules.memory && Object.keys(rules.memory).length > 0) {
    parts.push('## Project Context\n');
    for (const [key, value] of Object.entries(rules.memory)) {
      parts.push(`- **${key}**: ${value}`);
    }
    parts.push('');
  }

  if (rules.customRules && rules.customRules.length > 0) {
    parts.push('## Custom Rules\n');
    for (const rule of rules.customRules) {
      parts.push(`- **${rule.name}** (${rule.action}): ${rule.message || 'No description'}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Create default CLAUDE.md template
 */
export function createClaudeMdTemplate(): string {
  return `# Project Instructions

Add your project-specific instructions here. Claude will follow these when working on your codebase.

## Guidelines

- Describe your coding style preferences
- List important conventions
- Mention key architecture decisions

## Memory

- **Project Type**: (e.g., Web App, CLI Tool, Library)
- **Language**: (e.g., TypeScript, Python, Rust)
- **Framework**: (e.g., React, Express, Django)

## Allowed Tools

- Read
- Write
- Edit
- Bash
- Glob
- Grep

## Rules

- **No Console Logs**: Avoid adding console.log statements in production code
- **Test Coverage**: All new features should include tests
`;
}

/**
 * Initialize CLAUDE.md in current directory
 */
export function initClaudeMd(dir?: string): string {
  const targetDir = dir || process.cwd();
  const filePath = path.join(targetDir, 'CLAUDE.md');

  if (fs.existsSync(filePath)) {
    throw new Error('CLAUDE.md already exists');
  }

  const template = createClaudeMdTemplate();
  fs.writeFileSync(filePath, template);

  return filePath;
}
