---
description: Analyze runtime logs, evolve logs, and agent logs to identify error patterns, repeated failures, and evolution opportunities. Use when asked to review logs, diagnose issues, or find improvement areas.
user-invocable: true
argument-hint: "[hours=24] [level=error|warn|all]"
---

# Analyze Logs Skill

Scan all available log sources, identify patterns, and produce an actionable report for self-improvement.

## Log Sources

1. **Runtime Log** (`~/.claude/runtime.log`) — Captured console.error/warn/log from the running process (JSONL format)
2. **Evolve Log** (`~/.claude/evolve-log.jsonl`) — Self-evolution history: what was changed, tsc pass/fail, restart count
3. **Agent Logs** (`~/.claude/tasks/conversations/*.log`) — Background agent execution results
4. **Session History** (`~/.claude/history.jsonl`) — User input history across sessions

## Analysis Steps

### Step 1: Read Runtime Logs
Read `~/.claude/runtime.log` (the main log file). Parse JSONL entries. Focus on:
- **error** level entries: categorize by module, extract patterns
- **warn** level entries: identify recurring warnings
- Count entries by module to find "noisy" components
- Identify time clusters (many errors at once = incident)

### Step 2: Read Evolve Log
Read `~/.claude/evolve-log.jsonl`. Analyze:
- Which modules were modified most frequently (indicates instability)
- tsc failures (what caused them?)
- Patterns in "reason" field — recurring themes

### Step 3: Scan Agent Logs
Grep across `~/.claude/tasks/conversations/*.log` for:
- Errors other than "Task cancelled by user" and "Test error"
- Stack traces
- Timeout patterns
- Empty log files (indicates logging bugs)

### Step 4: Cross-Reference
- Do runtime errors correlate with evolve changes? (regression detection)
- Do agent failures cluster around certain time periods?
- Are there modules that appear in both runtime errors AND evolve log? (unstable modules)

## Output Format

Produce a structured report:

```
## Log Analysis Report (last N hours)

### Runtime Errors Summary
- Total entries: X (errors: Y, warns: Z)
- Top error modules: [Module]: count
- Error patterns: [description]

### Evolution Health
- Total evolves: X (success: Y, tsc fail: Z)
- Most modified modules: [module]: count
- Unstable modules (evolved 3+ times): [list]

### Agent Health
- Total agent tasks: X (completed: Y, failed: Z, cancelled: W)
- Real failures (excluding cancels): [list with details]

### Recommendations
1. [Specific actionable recommendation]
2. [Another recommendation]
```

## Important Notes
- Only do READ operations. Never modify any log files.
- If runtime.log doesn't exist yet, note that the Logger was just installed and skip that section.
- Use Grep with `head_limit` when scanning large directories to avoid timeout.
- Write key findings to the project notebook so they persist across sessions.
