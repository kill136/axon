---
name: Skill Hub Manager
description: Manage skills from the community skill registry - search, install, list, and publish skills
version: 1.2.0
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

You MUST immediately execute the command specified by the arguments below. Do NOT ask the user what to do - just execute it.

The command to execute is: `$ARGUMENTS`

## Command Execution Rules

### If command is `list`:
1. Use Glob tool with pattern `**/SKILL.md` in directory `~/.axon/skills/`
2. Read each found SKILL.md file's YAML frontmatter (between `---` markers)
3. Extract: name, description, version, author
4. Display as a formatted list

### If command is `search <query>`:
1. Use WebFetch to fetch `https://raw.githubusercontent.com/kill136/claude-code-skills/main/registry.json` with prompt "Return the full JSON content"
2. Filter results where name/description/tags match the query
3. Display matches with: name, description, author, version, tags
4. Show install command for each: `/skill-hub install <id>`

### If command is `install <skill-id>`:
1. Fetch registry.json (as above) to find the skill's URL
2. Use WebFetch to download the SKILL.md content from the URL
3. Use Bash: `mkdir -p ~/.axon/skills/<skill-id>`
4. Use Write tool to save content to `~/.axon/skills/<skill-id>/SKILL.md`
5. Report success and tell user to restart session

### If command is `publish <path>`:
1. Read the SKILL.md at the given path
2. Validate required frontmatter: name, description, version, author
3. Generate registry entry JSON
4. Show PR instructions for https://github.com/kill136/claude-code-skills

### If no command or unknown command:
Show available commands: search, install, list, publish

ARGUMENTS: $ARGUMENTS
