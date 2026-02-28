# Claude Code Open

### 免费开源的 Claude Code，带 Web IDE、多智能体和自我进化

[![npm](https://img.shields.io/npm/v/claude-code-open?style=flat-square&color=CB3837)](https://www.npmjs.com/package/claude-code-open)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![Discord](https://img.shields.io/discord/1454020463486566432?style=flat-square&label=Discord&color=5865F2)](https://discord.gg/bNyJKk6PVZ)

[官网](https://www.chatbi.site) | [在线体验](https://voicegpt.site) | [操作手册](https://www.chatbi.site/zh/user-guide.html) | [Discord](https://discord.gg/bNyJKk6PVZ) | [English](README.md)

<div align="center">

<a href="https://voicegpt.site">
<img src="demo-screenshots/01-main.png" width="720" alt="Claude Code Open - Web IDE">
</a>

</div>

## 为什么选择 Claude Code Open？

| | 官方 Claude Code | Claude Code Open |
|---|---|---|
| **价格** | $20/月 (需要 Max 订阅) | 免费（自备 API Key） |
| **界面** | 仅终端 | 终端 + **Web IDE**（Monaco 编辑器、文件树、AI 增强编辑） |
| **复杂任务** | 单 Agent | **多智能体蓝图**系统（并行 Worker、任务队列、自动评审） |
| **可定制** | 闭源 | 完全开源，**自我进化**（AI 可修改自身代码） |
| **部署** | 仅本地 | 本地、Docker、云端、**代理服务器共享** |
| **集成** | 仅 GitHub | GitHub、飞书、微信、MCP 协议、37+ 工具 |

## 快速开始

```bash
# 全局安装
npm install -g claude-code-open

# 设置 API Key
export ANTHROPIC_API_KEY="sk-..."  # Windows: $env:ANTHROPIC_API_KEY="sk-..."

# CLI 模式
claude

# Web IDE 模式
claude-web
```

打开 `http://localhost:3456` 即可使用 Web IDE。

### 其他安装方式

<details>
<summary>一键安装（无需 Node.js）</summary>

**Windows：** 下载 [install.bat](https://github.com/kill136/claude-code-open/releases/latest/download/install.bat) 双击运行。

[Gitee 国内镜像](https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.bat)

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
```

**国内镜像：**
```bash
curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.sh | bash
```
</details>

<details>
<summary>Docker</summary>

```bash
# Web IDE
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -p 3456:3456 \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open node /app/dist/web-cli.js --host 0.0.0.0

# 仅 CLI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open
```
</details>

<details>
<summary>从源码构建</summary>

```bash
git clone https://github.com/kill136/claude-code-open.git
cd claude-code-open
npm install && npm run build
node dist/cli.js        # CLI
node dist/web-cli.js    # Web IDE
```
</details>

## 核心功能

### Web IDE

基于 React + Monaco Editor + WebSocket 的完整浏览器 IDE：

- **Monaco 编辑器**，多标签页、语法高亮、AI 悬浮提示
- **VS Code 风格文件树**，右键上下文菜单
- **AI 增强编辑** — 选中代码即问 AI、代码导游、热力图装饰器
- **WebSocket 实时流式传输** AI 响应
- **会话管理** — 创建、恢复、分叉、导出
- **检查点与回退** — 文件快照和会话时间旅行

<table>
<tr>
<td><img src="demo-screenshots/01-main.png" width="400" alt="Web IDE"></td>
<td><img src="demo-screenshots/05-typing.png" width="400" alt="实时流式响应"></td>
</tr>
</table>

### 蓝图多智能体系统

将复杂任务分解给多个并行工作的 AI Agent：

- **智能规划器** — 将任务分解为执行计划
- **Lead Agent** — 协调 Worker，追踪进度
- **自主 Worker** — 独立执行，拥有完整工具权限
- **任务队列** — 基于优先级的调度，支持持久化
- **质量评审器** — 自动化评审和验证

<img src="demo-screenshots/02-blueprint.png" width="600" alt="蓝图系统">

### 自我进化

AI 可修改自身源码，运行 TypeScript 编译检查，热重载：

```
你：「增加一个查询天气的工具」
Claude：*编写工具代码，编译，重启自己，工具立即可用*
```

### 37+ 内置工具

| 类别 | 工具 |
|---|---|
| 文件操作 | Read, Write, Edit, MultiEdit, Glob, Grep |
| 执行 | Bash, 后台任务, 任务输出 |
| Web | WebFetch, WebSearch |
| 代码 | NotebookEdit, LSP, Tree-sitter 解析 |
| 浏览器 | 基于 Playwright 的自动化 |
| 规划 | 规划模式, 蓝图, 子代理 |
| 记忆 | 语义搜索, 向量存储, BM25 |
| 集成 | MCP 协议, 技能系统 |
| 定时任务 | 类 Cron 守护进程, 文件监控, 通知 |

### 更多功能

- **代理服务器** — 跨设备共享 API Key
- **多云服务商** — Anthropic, AWS Bedrock, Google Vertex AI
- **插件与 Hook 系统** — 自定义扩展
- **国际化** — 中英文双语
- **飞书和微信机器人** — 消息集成

## 配置

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ANTHROPIC_API_KEY` | API 密钥（必填） | - |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点 | `https://api.anthropic.com` |
| `CLAUDE_CODE_LANG` | 语言（`en`/`zh`） | 自动检测 |

### MCP 协议

```json
// .claude/settings.json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

## CLI 参考

```bash
claude                          # 交互模式
claude "分析这个项目"              # 带初始 prompt
claude -p "解释这段代码"           # 打印模式（非交互）
claude -m opus "复杂任务"         # 指定模型
claude --resume                 # 恢复上次会话
claude-web                      # Web IDE
claude-web -p 8080 -H 0.0.0.0  # 自定义端口
claude-web --ngrok              # 公网隧道
claude-web --evolve             # 自我进化模式
```

## 社区

- **官网：** [chatbi.site](https://www.chatbi.site)
- **Discord：** [加入我们](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter)：** [@wangbingjie1989](https://x.com/wangbingjie1989)
- **微信：** h694623326

## 贡献

欢迎 PR 和 Issue。

## 致谢

本项目灵感来自 Anthropic 的 Claude Code CLI，是基于公开 API 的独立开源重新实现。官方版本请见 [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)。

## 许可证

MIT

[English README](README.md)
