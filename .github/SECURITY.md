# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| latest (private_web_ui branch) | Yes |
| older releases | No |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **DO NOT** open a public issue
2. Email: [wangbingjie1989@gmail.com](mailto:wangbingjie1989@gmail.com)
3. Or use [GitHub Security Advisories](https://github.com/kill136/axon/security/advisories/new)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- Acknowledgment: within 48 hours
- Status update: within 7 days
- Fix release: depends on severity

## Scope

The following are in scope:
- Command injection via tool inputs
- Path traversal in file operations
- WebSocket authentication bypass
- Cross-site scripting (XSS) in Web UI
- Sensitive data exposure in logs or responses

## Out of Scope

- Issues requiring physical access to the machine
- Social engineering attacks
- Denial of service (this is a local/self-hosted tool)
- Vulnerabilities in third-party dependencies (report upstream)
