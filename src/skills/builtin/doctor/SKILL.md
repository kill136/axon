---
description: Perform comprehensive security audit of Axon configuration, skills, browser settings, and environment. Use when asked to check security or diagnose potential vulnerabilities.
user-invocable: true
argument-hint: "[component=all|config|skills|browser|web|env]"
---

# Security Doctor Skill

Perform a comprehensive security audit of the Axon environment, identifying potential security risks and misconfigurations.

## Audit Components

### 1. File Permissions Check

**Purpose**: Ensure sensitive directories and files are properly protected.

**Steps**:
1. Check `~/.axon/` directory permissions
   - Read using Bash: `ls -la ~/.axon`
   - **CRITICAL**: Directory should NOT be world-readable (no `drwxrwxrwx`)
   - **WARN**: Recommend `chmod 700 ~/.axon` if too permissive

2. Check `~/.axon/settings.json` permissions
   - Read using Bash: `ls -l ~/.axon/settings.json`
   - **CRITICAL**: File should be readable only by owner (recommend `600`)

3. Check browser profile directory
   - Read using Bash: `ls -la ~/.axon/browser-profile` (or wherever browser profile is stored)
   - **WARN**: Browser profile should not be world-accessible

### 2. Configuration Security Check

**Purpose**: Detect plain-text API keys and sensitive data in configuration files.

**Steps**:
1. Read `~/.axon/settings.json` using Read tool
2. Check for sensitive patterns:
   - **CRITICAL**: Plain-text API keys matching pattern `sk-ant-[a-zA-Z0-9-_]+`
   - **CRITICAL**: AWS credentials (`aws_access_key_id`, `aws_secret_access_key`)
   - **WARN**: Unencrypted passwords or tokens
3. **Recommendation**: API keys should use environment variables or secure storage

### 3. Skill Security Scan

**Purpose**: Detect malicious or dangerous patterns in loaded skills.

**Steps**:
1. Scan all skills in:
   - `~/.axon/skills/`
   - `.axon/skills/` (project-level)
   
2. For each skill SKILL.md file, check for dangerous patterns:
   - **CRITICAL**: `child_process` module usage
   - **CRITICAL**: `exec(`, `spawn(`, `eval(` function calls
   - **CRITICAL**: Crypto-mining keywords (`stratum+tcp`, `xmrig`, `coinhive`)
   - **WARN**: Excessive `process.env.*` accesses (>=3 different env vars)
   - **WARN**: Suspicious base64 strings (>100 chars)

3. Use Grep tool with patterns:
   ```
   grep -rn "child_process\|exec(\|spawn(\|eval(" ~/.axon/skills .axon/skills
   grep -rn "stratum+tcp\|xmrig\|coinhive" ~/.axon/skills .axon/skills
   ```

4. Report any matches with file path and line number

### 4. Browser Security Check

**Purpose**: Ensure browser usage doesn't expose sensitive data.

**Steps**:
1. Check if browser profile directory exists
   - Bash: `ls ~/.axon/browser-profile 2>/dev/null`
   
2. **WARN** if profile directory is in a shared location (e.g., `/tmp/`)

3. Check browser cookies for sensitive domains:
   - Read using Browser tool (if running): action `cookies`
   - **INFO**: List domains with stored cookies
   - **WARN**: Cookies from banking/financial domains

### 5. Web Server Security Check

**Purpose**: Verify Web UI mode is properly secured (if enabled).

**Steps**:
1. Check if Web mode is running:
   - Bash: `ps aux | grep -i "axon.*web\|axon.*server" | grep -v grep`
   
2. If running, check:
   - **CRITICAL**: Port should not be exposed to 0.0.0.0 without authentication
   - **WARN**: Check if authentication is enabled in settings.json (`webAuth` field)
   - **WARN**: Check if HTTPS is enabled (`webSSL` field)

3. Recommendations:
   - Use authentication for Web UI
   - Bind to localhost (127.0.0.1) only, use SSH tunneling for remote access
   - Enable HTTPS for production use

### 6. Environment Variable Check

**Purpose**: Detect potential environment variable leakage.

**Steps**:
1. Check for sensitive environment variables:
   - Bash: `printenv | grep -E "(API|KEY|SECRET|TOKEN|PASSWORD)" | wc -l`
   
2. **INFO**: Report count of potentially sensitive env vars

3. **WARN** if any skill or config attempts to log environment variables:
   - Grep: `grep -rn "console.log.*process.env\|console.error.*process.env" ~/.axon .axon`

## Output Format

Produce a structured security report with three severity levels:

```
# Security Audit Report

Date: [current date/time]
Audit Scope: [all|component name]

## CRITICAL Issues (Immediate Action Required)

- [Issue description with file path/command to fix]
- [Another critical issue]

## WARNINGS (Recommended to Address)

- [Warning description]
- [Another warning]

## INFO (Good to Know)

- [Informational finding]

## Summary

- Total Issues: X (Critical: Y, Warnings: Z)
- Security Score: [Green/Yellow/Red based on critical count]
  - Green: 0 critical issues
  - Yellow: 1-2 critical issues
  - Red: 3+ critical issues

## Recommendations

1. [Specific actionable recommendation]
2. [Another recommendation]
```

## Important Notes

- **Read-only operations**: This skill should NEVER modify files or execute destructive commands
- Use Bash tool for permission checks (ls, stat) and process checks (ps, netstat)
- Use Read tool for file content analysis
- Use Grep tool for pattern scanning across multiple files
- If any command fails (e.g., file doesn't exist), note as INFO and continue
- Provide clear remediation steps for each finding
- Save summary to project notebook for tracking fixes across sessions

## Usage Examples

- `/doctor` - Full security audit
- `/doctor config` - Check configuration security only
- `/doctor skills` - Scan all skills for dangerous patterns
- `/doctor browser` - Check browser-related security
