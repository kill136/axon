---
description: Review code changes for quality, correctness, and maintainability. Use when the user asks to review code, a PR, staged changes, or specific files.
user-invocable: true
argument-hint: "[file/dir path or --staged]"
---

# Code Review

Review code changes systematically against a quality checklist.

## Arguments
- `$ARGUMENTS` - Optional: file path, directory, or `--staged` flag. Defaults to all uncommitted changes.

## Review Checklist

For each changed file, check the following in order:

### 1. Correctness
- Does the logic do what it's supposed to do?
- Are there off-by-one errors, null/undefined risks, or unhandled edge cases?
- Are async operations properly awaited? Are error paths handled?

### 2. Security
- No command injection, XSS, SQL injection, or path traversal
- No hardcoded secrets, credentials, or API keys
- User input validated at system boundaries

### 3. TypeScript Quality
- Types are accurate, no unnecessary `any` or type assertions
- No implicit `any` from missing type annotations on public APIs
- Generics used appropriately (not over-engineered)

### 4. Readability
- Variable and function names are clear and descriptive
- Complex logic has comments explaining *why*, not *what*
- Functions are reasonably sized (flag functions > 50 lines for review)

### 5. Performance
- No obvious N+1 queries or unnecessary loops
- Large data not loaded entirely into memory when streaming is possible
- No synchronous I/O in hot paths

### 6. Testing
- Are new code paths covered by tests?
- Are edge cases tested?
- Do test names clearly describe what they verify?

## Output Format

For each file with findings, output:

```
## <file_path>

### <severity>: <brief title>
Line <N>: <description>
Suggestion: <how to fix>
```

Severity levels:
- **CRITICAL** - Must fix. Bugs, security issues, data loss risks.
- **WARNING** - Should fix. Code smells, potential issues, maintainability concerns.
- **NOTE** - Optional. Style suggestions, minor improvements.

## Process

1. Determine scope: parse `$ARGUMENTS` to decide what to review
   - No args: `git diff` + `git diff --cached` (all uncommitted changes)
   - `--staged`: `git diff --cached` only
   - File/dir path: read those files directly
2. For each changed file, read the full file for context (not just the diff)
3. Apply the checklist above systematically
4. Group findings by file, ordered by severity (CRITICAL first)
5. End with a summary: total files reviewed, finding counts by severity
6. If no issues found, say so explicitly -- don't invent problems
