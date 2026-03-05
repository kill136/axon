# Axon

### 免费开源的 Axon，带 Web IDE、多智能体和自我进化

[![npm](https://img.shields.io/npm/v/axon?style=flat-square&color=CB3837)](https://www.npmjs.com/package/axon)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![Discord](https://img.shields.io/discord/1454020463486566432?style=flat-square&label=Discord&color=5865F2)](https://discord.gg/bNyJKk6PVZ)

[官网](https://www.chatbi.site) | [在线体验](https://voicegpt.site) | [操作手册](https://www.chatbi.site/zh/user-guide.html) | [Discord](https://discord.gg/bNyJKk6PVZ) | [English](README.md)

<div align="center">

<a href="https://voicegpt.site">
<img src="demo-screenshots/demo.gif" width="720" alt="Axon Demo">
</a>

<sub><a href="https://youtu.be/OQ29pIgp5AI">YouTube 观看</a> | <a href="https://github.com/kill136/claude-code-open/releases/download/v2.1.37/promo-video.mp4">下载视频</a> | <a href="https://voicegpt.site">在线体验</a></sub>

</div>

## 为什么选择 Axon？

| | 官方 Axon | Axon |
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
npm install -g axon

# 设置 API Key
export ANTHROPIC_API_KEY="sk-..."  # Windows: $env:ANTHROPIC_API_KEY="sk-..."

# CLI 模式
axon

# Web IDE 模式
axon-web
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
  -v ~/.axon:/root/.axon \
  wbj66/axon node /app/dist/web-cli.js --host 0.0.0.0

# 仅 CLI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.axon:/root/.axon \
  wbj66/axon
```
</details>

<details>
<summary>从源码构建</summary>

```bash
git clone https://github.com/kill136/claude-code-open.git
cd axon
npm install && npm run build
node dist/cli.js        # CLI
node dist/web-cli.js    # Web IDE
```
</details>

<details>
<summary>卸载</summary>

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.sh | bash
```

**国内镜像：**
```bash
curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/uninstall.sh | bash
```

**Windows（PowerShell）：**
```powershell
irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.ps1 | iex
```

**Windows（cmd）：**
```cmd
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/uninstall.bat -o uninstall.bat && uninstall.bat
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
| `AXON_LANG` | 语言（`en`/`zh`） | 自动检测 |
| `AXON_CONFIG_DIR` | 自定义配置/数据目录（C 盘空间不足时可迁移到其他盘） | `~/.axon` |

### MCP 协议

```json
// .axon/settings.json
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
axon                          # 交互模式
axon "分析这个项目"              # 带初始 prompt
axon -p "解释这段代码"           # 打印模式（非交互）
axon -m opus "复杂任务"         # 指定模型
axon --resume                 # 恢复上次会话
axon-web                      # Web IDE
axon-web -p 8080 -H 0.0.0.0  # 自定义端口
axon-web --ngrok              # 公网隧道
axon-web --evolve             # 自我进化模式
axon-proxy -k my-secret       # 启动本地代理服务器（共享你的额度）
```

### 代理服务器（本地模式）

将你的 Anthropic API Key 或 Claude 订阅额度共享给局域网内的其他设备使用。

**在宿主机上（持有 API Key / 订阅账号的那台机器）：**

```bash
# 自动检测本地凭据（API Key 或 OAuth 订阅），推荐方式
axon-proxy -k my-secret

# 手动指定 API Key
axon-proxy -k my-secret --anthropic-key sk-ant-xxx

# 自定义端口（默认 8082）
axon-proxy -k my-secret -p 9000
```

**在客户端机器上（连接到代理）：**

```bash
# Linux / macOS
export ANTHROPIC_API_KEY="my-secret"
export ANTHROPIC_BASE_URL="http://<宿主机IP>:8082"
axon

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY="my-secret"
$env:ANTHROPIC_BASE_URL="http://<宿主机IP>:8082"
axon

# Windows (CMD)
set ANTHROPIC_API_KEY=my-secret
set ANTHROPIC_BASE_URL=http://<宿主机IP>:8082
axon
```

**参数说明：**

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-k, --proxy-key` | 自动生成 | 客户端连接时使用的密钥 |
| `-p, --port` | `8082` | 监听端口 |
| `-H, --host` | `0.0.0.0` | 绑定地址 |
| `--anthropic-key` | 自动检测 | 手动指定 Anthropic API Key |
| `--auth-token` | 自动检测 | 手动指定 OAuth Access Token |
| `--target` | `https://api.anthropic.com` | 上游 API 地址 |

代理服务器按以下优先级自动检测本地凭据：`ANTHROPIC_API_KEY` 环境变量 → `~/.axon/.credentials.json`（OAuth 订阅）。

## 社区

- **官网：** [chatbi.site](https://www.chatbi.site)
- **Discord：** [加入我们](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter)：** [@wangbingjie1989](https://x.com/wangbingjie1989)
- **微信：** h694623326

## 贡献

欢迎 PR 和 Issue。

## 致谢

本项目灵感来自 Anthropic 的 @anthropic-ai/claude-code，是基于公开 API 的独立开源重新实现。官方版本请见 [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)。

## 许可证

MIT

[English README](README.md)
