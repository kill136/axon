---
name: Skill Hub Manager
description: Manage skills from the community skill registry - search, install, list, and publish skills
version: 1.0.0
author: Axon
user-invocable: true
argument-hint: "search|install|list|publish [args]"
category: tools
tags:
  - skills
  - package-manager
  - community
---

# Skill Hub Manager

This skill provides a command-line interface to interact with the Axon Skill Hub - a community registry of skills.

## Usage

### Search for skills

```
/skill-hub search <query>
```

Search the community skill registry for skills matching the query. The search looks in skill names, descriptions, and tags.

**Example:**
```
/skill-hub search weather
```

### Install a skill

```
/skill-hub install <skill-id>
```

Install a skill from the community registry. The skill will be downloaded, security-scanned, and installed to `~/.axon/skills/<skill-id>/`.

**Example:**
```
/skill-hub install weather
```

**Security:** All skills are automatically scanned for security issues before installation. Skills with critical security issues will be rejected.

### List installed skills

```
/skill-hub list
```

List all skills currently installed on your system, showing their source (local or hub), version, and author.

### Publish a skill

```
/skill-hub publish <path>
```

Prepare a local skill for publication to the community registry. This command will:
- Validate the skill's frontmatter
- Run security scans
- Generate the registry entry JSON
- Provide instructions for creating a PR

**Example:**
```
/skill-hub publish ~/.claude/skills/my-skill/SKILL.md
```

## Skill Registry

The skill registry is hosted on GitHub at: https://github.com/kill136/claude-code-skills

Skills are stored as SKILL.md files in the repository, with a central `registry.json` index file.

## Implementation

```typescript
import { searchSkills, installSkill, listInstalledSkills, publishSkill } from '../../../src/skills/hub.js';

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0];
  const restArgs = parts.slice(1).join(' ');

  switch (command) {
    case 'search': {
      if (!restArgs) {
        return '❌ Usage: /skill-hub search <query>';
      }

      const results = await searchSkills(restArgs);

      if (results.length === 0) {
        return `No skills found matching "${restArgs}"`;
      }

      let output = `🔍 Found ${results.length} skill(s):\n\n`;

      for (const skill of results) {
        output += `**${skill.name}** (${skill.id})\n`;
        output += `  ${skill.description}\n`;
        output += `  Author: ${skill.author} | Version: ${skill.version}\n`;
        if (skill.tags && skill.tags.length > 0) {
          output += `  Tags: ${skill.tags.join(', ')}\n`;
        }
        output += `  Install: \`/skill-hub install ${skill.id}\`\n\n`;
      }

      return output;
    }

    case 'install': {
      if (!restArgs) {
        return '❌ Usage: /skill-hub install <skill-id>';
      }

      try {
        await installSkill(restArgs);
        return `✅ Skill "${restArgs}" installed successfully!\n\nRestart your session to load the new skill.`;
      } catch (error: any) {
        return `❌ Failed to install skill: ${error.message}`;
      }
    }

    case 'list': {
      const skills = listInstalledSkills();

      if (skills.length === 0) {
        return 'No skills installed.\n\nSearch for skills: `/skill-hub search <query>`';
      }

      let output = `📦 Installed Skills (${skills.length}):\n\n`;

      for (const skill of skills) {
        const sourceIcon = skill.source === 'hub' ? '🌐' : '📁';
        output += `${sourceIcon} **${skill.name}** (${skill.id})\n`;
        output += `   ${skill.description}\n`;
        if (skill.version) {
          output += `   Version: ${skill.version}`;
        }
        if (skill.author) {
          output += ` | Author: ${skill.author}`;
        }
        output += `\n   Path: ${skill.path}\n\n`;
      }

      return output;
    }

    case 'publish': {
      if (!restArgs) {
        return '❌ Usage: /skill-hub publish <path-to-skill-file>';
      }

      try {
        const prUrl = await publishSkill(restArgs);
        return `✅ Skill validated and ready for publication!\n\nFollow the instructions above to create a PR at:\n${prUrl}`;
      } catch (error: any) {
        return `❌ Failed to prepare skill for publication: ${error.message}`;
      }
    }

    default:
      return `❌ Unknown command: ${command}\n\nAvailable commands:\n- search <query>\n- install <skill-id>\n- list\n- publish <path>`;
  }
}
```

## Notes

- The skill registry is cached for 1 hour to reduce network requests
- All installed skills from the hub include metadata in `.meta.json` for tracking
- Skills are installed to `~/.claude/skills/<skill-id>/SKILL.md`
- Security scanning is mandatory for all hub skills
