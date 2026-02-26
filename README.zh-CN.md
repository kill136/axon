# Claude Code Open - 开源 AI 编程平台

> 世界需要一个开源的 Claude Code。它将成为未来 AI 的基础设施，运行在每台 PC 上。

[![Website](https://img.shields.io/badge/Website-chatbi.site-blue?style=flat-square)](https://www.chatbi.site)
[![在线体验](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-voicegpt.site:3456-orange?style=flat-square)](http://voicegpt.site:3456/)
[![GitHub Stars](https://img.shields.io/github/stars/kill136/claude-code-open?style=flat-square)](https://github.com/kill136/claude-code-open)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)

[访问网站](https://www.chatbi.site) | [在线体验](http://voicegpt.site:3456/) | [操作手册](https://www.chatbi.site/zh/user-guide.html) | [English README](README.md) | [Discord](https://discord.gg/bNyJKk6PVZ)

<div align="center">

### 演示

<a href="http://voicegpt.site:3456/">
<img src="demo-screenshots/01-main.png" width="720" alt="Claude Code Open - Web IDE 界面">
</a>

**Web UI IDE** &bull; **蓝图多智能体** &bull; **37+ 工具** &bull; **自我进化**

<table>
<tr>
<td><img src="demo-screenshots/02-blueprint.png" width="400" alt="蓝图系统"></td>
<td><img src="demo-screenshots/05-typing.png" width="400" alt="实时 AI 流式响应"></td>
</tr>
<tr>
<td align="center"><b>蓝图多智能体系统</b></td>
<td align="center"><b>实时 AI 流式响应</b></td>
</tr>
</table>

> [观看宣传视频](demo-screenshots/promo-video.mp4) &bull; [在线体验](http://voicegpt.site:3456/) &bull; [加入 Discord](https://discord.gg/bNyJKk6PVZ)

</div>

基于 `@anthropic-ai/claude-code` 的开源逆向重新实现。

**仅用于教育和研究目的。**

## 免责声明

这是一个教育项目，用于研究和学习 CLI 工具的架构设计。这**不是**官方 Claude Code 的源代码，而是基于公开 API 和类型定义的重新实现。

如需使用官方 Claude Code，请安装官方版本：
```bash
npm install -g @anthropic-ai/claude-code
```

## 功能概览

| 类别 | 亮点 |
| --- | --- |
| **37+ 内置工具** | 文件操作、搜索、执行、Web 访问、任务管理、定时任务、浏览器自动化等 |
| **Web UI IDE** | 完整的浏览器 IDE，集成 Monaco 编辑器、文件树、AI 增强编辑、Blueprint 可视化、Swarm 控制台 |
| **Blueprint 多 Agent** | 智能规划器 + Lead Agent + 自主 Worker + 任务队列 + 质量审查员 + E2E 测试 |
| **一键安装** | Windows/macOS/Linux 自动化脚本，自动检测并安装缺失依赖（Node.js、Git、g++、make） |
| **定时任务守护进程** | 后台守护进程，支持定时任务、间隔任务、文件监控、多渠道通知 |
| **自我进化** | AI 可修改自身源码，带安全检查和热重载 |
| **检查点与回退** | 文件快照管理和会话时间旅行 |
| **记忆系统** | 向量存储、BM25 搜索、意图提取、对话记忆 |
| **MCP 协议** | 完整的 Model Context Protocol，支持自动发现（stdio、HTTP、SSE） |
| **多云服务商** | Anthropic、AWS Bedrock、Google Vertex AI |
| **代理服务器** | 跨设备共享 Claude 订阅 |
| **浏览器自动化** | 自定义浏览器控制 + Chrome MCP 集成 + Playwright 支持 |
| **国际化** | 中英文双语支持 |
| **飞书机器人** | 飞书消息集成，支持 Web UI 模式 |
| **微信机器人** | 微信消息集成 |
| **Docker 部署** | 容器化部署，支持镜像加速 |
| **自动更新** | 版本管理，支持回滚 |
| **插件与 Hook 系统** | 可扩展架构，支持生命周期钩子 |
| **快速模式** | 使用相同模型但优化输出速度 |
| **Extended Thinking** | 扩展推理模式，更深入的分析 |
| **团队协作** | 团队管理功能 |

## 为什么选择 Claude Code Open？

- **开源透明** — 完整的 MIT 许可证源代码。没有黑盒，完全社区驱动开发。
- **Web UI IDE 体验** — 不仅仅是 CLI。完整的浏览器 IDE，集成 Monaco 编辑器、VS Code 风格文件树、AI 增强代码编辑（悬浮提示、选中即问 AI、代码导游、热力图装饰器）、Blueprint 可视化、Swarm 多 Agent 控制台。
- **多智能体协作** — Blueprint 系统将复杂任务分解给多个并行工作的 AI Agent，配备 E2E 测试、视觉对比和验证服务。
- **7×24 自动化** — 定时任务守护进程自动运行 AI 工作流：自然语言时间配置、文件监控、多渠道通知（桌面 + 飞书）、SQLite 持久化。
- **一键安装** — Windows/macOS/Linux 单命令安装。自动检测并安装缺失依赖（Node.js、Git、g++、make）。自动创建桌面快捷方式。
- **自我进化** — AI 可修改自身源码，运行 TypeScript 编译检查，热重载——实现持续自我改进。

## 快速安装（推荐）

### Windows 快速安装（最简单）

**方式 A：一键安装器** — 下载后双击即可，无需命令行操作！

[![Windows 安装器](https://img.shields.io/badge/Windows-下载安装器-blue?style=for-the-badge&logo=windows)](https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.bat)
[![Gitee 镜像](https://img.shields.io/badge/Gitee-国内镜像-orange?style=for-the-badge&logo=gitee)](https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.bat)

1. 点击上方按钮下载 `install.bat`
2. 双击下载的文件运行
3. 完成！安装器会自动处理一切（Node.js、依赖安装、编译构建、桌面快捷方式）

**方式 B：预编译包** — 下载解压即用，无需编译！

[![下载预编译包](https://img.shields.io/badge/下载-预编译安装包-green?style=for-the-badge&logo=github)](https://github.com/kill136/claude-code-open/releases/latest)

1. 从最新 Release 下载 `claude-code-open-windows-x64-*.zip`
2. 解压到任意文件夹
3. 双击 `start.bat` 启动（需预装 [Node.js](https://nodejs.org/)）

---

### macOS / Linux 快速安装

**方式 A：一键安装脚本**

```bash
curl -fsSL https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.sh | bash
```

国内镜像：
```bash
curl -fsSL https://gitee.com/lubanbbs/claude-code-open/raw/private_web_ui/install.sh | bash
```

**方式 B：预编译包** — 下载解压即用！

[![下载预编译包](https://img.shields.io/badge/下载-预编译安装包-green?style=for-the-badge&logo=github)](https://github.com/kill136/claude-code-open/releases/latest)

| 平台 | 文件名 |
| --- | --- |
| macOS Apple Silicon (M1/M2/M3/M4) | `claude-code-open-macos-arm64-*.tar.gz` |
| macOS Intel | `claude-code-open-macos-x64-*.tar.gz` |
| Linux x64 | `claude-code-open-linux-x64-*.tar.gz` |

```bash
# 解压并运行（需预装 Node.js）
tar -xzf claude-code-open-*.tar.gz
cd claude-code-open-*/
./start.sh
```

---

### 进阶：PowerShell 安装（Windows）

```powershell
irm https://raw.githubusercontent.com/kill136/claude-code-open/private_web_ui/install.ps1 | iex
```

安装脚本会自动完成：
- ✅ 检测并安装缺失依赖（Node.js、Git、g++、make）
- ✅ 克隆代码仓库
- ✅ 安装所有 npm 依赖
- ✅ 构建前端和后端
- ✅ 创建桌面快捷方式
- ✅ 预设 API 配置
- ✅ 全局命令链接

**安装完成后：**
1. 双击桌面快捷方式 "Claude Code WebUI"
2. 浏览器自动打开 http://localhost:3456
3. 开始使用！

### 手动安装

```bash
# 克隆仓库
git clone https://github.com/kill136/claude-code-open.git
cd claude-code-open

# 安装依赖
npm install

# 构建前端
cd src/web/client
npm install
npm run build
cd ../../..

# 构建后端
npm run build

# 全局链接（可选）
npm link

# 可选：安装 Playwright CLI（浏览器自动化）
npm run install:playwright
```

### Windows 部署注意事项

**Native addon 编译（通常不需要）：**

项目依赖了 `better-sqlite3`、`node-pty`、`sharp` 等 native addon，但它们都自带 **Windows x64 预编译二进制**。正常情况下，`npm install` 会直接下载预编译文件，无需本地编译。

如果预编译下载失败（如无法访问 GitHub releases、冷门 Node.js 版本），npm 会回退到从源码编译。**仅在此情况下**才需要：

- **Python 3.6+** — node-gyp 依赖
- **Visual Studio Build Tools 2022** — 安装时选择"使用 C++ 的桌面开发"工作负载

**环境变量冲突：**

| 变量 | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API 认证 |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点（默认：`https://api.anthropic.com`） |

如果系统级已设置这些变量，按会话设置以避免冲突：

```powershell
# PowerShell（仅当前会话生效）
$env:ANTHROPIC_API_KEY="your-key-for-this-project"
$env:ANTHROPIC_BASE_URL="https://your-api-endpoint"
```

> 注意：项目根目录的 `.env` 文件**不会被自动加载**。环境变量需通过系统设置、`settings.json` 或 `--env` CLI 参数配置。

### Docker 部署

```bash
# 构建 Docker 镜像
docker build -t claude-code-open .

# 国内用户（使用镜像加速）
docker build --build-arg REGISTRY=docker.1ms.run -t claude-code-open .

# 运行 CLI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open

# 运行 Web UI
docker run -it \
  -e ANTHROPIC_API_KEY=your-api-key \
  -p 3456:3456 \
  -v $(pwd):/workspace \
  -v ~/.claude:/root/.claude \
  claude-code-open node /app/dist/web-cli.js --host 0.0.0.0
```

## 使用

### CLI 模式

```bash
# 交互模式
npm run dev

# 或构建后运行
node dist/cli.js

# 带初始 prompt
node dist/cli.js "你好，请帮我分析这个项目"

# 打印模式（非交互）
node dist/cli.js -p "解释这段代码"

# 指定模型（opus/sonnet/haiku）
node dist/cli.js -m opus "复杂任务"

# 恢复上一次会话
node dist/cli.js --resume

# 列出会话
node dist/cli.js --list

# 分叉会话
node dist/cli.js --fork <session-id>
```

### Web UI 模式

```bash
# 开发模式
npm run web

# 生产模式
npm run web:start

# 自定义端口和主机
npm run web -- -p 8080 -H 0.0.0.0

# 启用 ngrok 公网隧道
npm run web -- --ngrok

# 自我进化模式
npm run web:evolve
```

### 代理服务器模式

跨设备共享你的 Claude 订阅：

```bash
# 启动代理服务器
npm run proxy
# 或构建后
node dist/proxy-cli.js --proxy-key my-secret

# 客户端使用（在其他设备上）
export ANTHROPIC_API_KEY="my-secret"
export ANTHROPIC_BASE_URL="http://your-server-ip:8082"
claude
```

### 飞书机器人模式

```bash
# 启动飞书机器人
npm run feishu

# 飞书机器人 + Web UI
npm run feishu:webui
```

### 微信机器人模式

```bash
npm run wechat
```

## Web UI 功能

Web UI 是一个基于 React、Express 和 WebSocket 构建的完整浏览器 IDE：

```bash
npm run web
# 打开 http://localhost:3456
```

**核心功能：**
- **Monaco 编辑器** — 多标签页代码编辑，语法高亮
- **文件树** — VS Code 风格文件浏览器，支持右键上下文菜单
- **AI 增强编辑** — 智能悬浮提示、选中即问 AI、代码导游、热力图装饰器
- **WebSocket 实时通信** — AI 响应实时流式传输
- **会话管理** — 创建、恢复、分叉、导出会话
- **Blueprint 可视化** — 任务分解和 Agent 协调可视化
- **Swarm 控制台** — 多 Agent 监控，任务树、架构流程图
- **终端集成** — 浏览器内终端面板
- **检查点与回退** — 文件快照管理和会话时间旅行
- **持续开发** — 周期评审、影响分析、TDD 面板
- **认证** — OAuth 和 API 密钥支持
- **Artifacts 面板** — 富内容渲染
- **调试面板** — 开发调试工具

## Blueprint 多 Agent 系统

通过多个并行工作的 AI Agent 编排复杂任务：

- **智能规划器** — 智能任务拆解和规划（97KB 规划逻辑）
- **Lead Agent** — 协调 Worker Agent，追踪进度，自动项目选择
- **自主 Worker** — 独立任务执行，拥有完整工具访问权限
- **任务队列** — 基于优先级的任务调度，支持持久化
- **任务评审器** — 质量保证和验证
- **实时协调器** — Agent 通信、同步和冲突解决
- **模型选择器** — 根据任务复杂度自适应选择模型
- **E2E 测试 Agent** — 端到端测试自动化
- **环境检查器** — 运行时环境验证
- **视觉对比器** — 视觉 diff 和对比
- **验证服务** — 结果验证流水线

## 定时任务守护进程

强大的后台守护进程系统，支持自动化任务执行：

**功能特性：**
- **基于时间的任务** — 使用自然语言调度（"明天下午3点"、"每天早上9点"、"2小时后"）
- **文件监控** — 监控文件变化并自动触发 AI 任务
- **多渠道通知** — 桌面通知和飞书消息推送
- **持久化存储** — 基于 SQLite 的任务存储，重启后保持
- **模型选择** — 为每个任务选择不同的 Claude 模型

**使用方法：**
```bash
# 启动守护进程
claude daemon start

# 通过对话调度任务
"在每天早上9点进行代码审查，并通过飞书通知我"
```

**任务类型：** `once`（一次性）、`interval`（循环执行）、`watch`（文件监控）

## 已实现工具（37+）

| 工具 | 说明 |
| --- | --- |
| **文件操作** | |
| Read | 文件读取，支持图像/PDF/Notebook + 外部修改检测 |
| Write | 文件写入，带覆盖保护 |
| Edit | 文件编辑（字符串替换） |
| MultiEdit | 批量文件编辑（原子操作） |
| **搜索与发现** | |
| Glob | 文件模式匹配 |
| Grep | 内容搜索（基于 ripgrep） |
| **执行** | |
| Bash | 命令执行，支持后台和沙箱 |
| BashHistory | 命令历史追踪 |
| TaskOutput | 获取后台命令/代理输出 |
| **Web 访问** | |
| WebFetch | Web 页面获取，带缓存 |
| WebSearch | 服务端 Web 搜索 |
| **任务管理** | |
| TodoWrite | 任务管理，带自动提醒系统 |
| Task | 子代理（explore、plan、guide 等） |
| TaskStatus | 查询任务执行状态 |
| ScheduleTask | 创建/取消/列出定时任务 |
| **规划** | |
| EnterPlanMode | 进入规划模式 |
| ExitPlanMode | 退出规划模式 |
| **交互** | |
| AskUserQuestion | 询问用户问题（multiSelect、选项、验证） |
| **代码工具** | |
| NotebookEdit | Jupyter Notebook 单元格编辑 |
| NotebookWrite | Jupyter Notebook 创建 |
| LSP | 语言服务器协议集成 |
| **集成** | |
| MCP 工具 | ListMcpResources、ReadMcpResource、MCPSearch |
| Skill | 技能系统，带 args 参数 |
| **浏览器** | |
| Browser | 自定义浏览器自动化和控制 |
| **记忆** | |
| MemorySearch | 语义记忆搜索 |
| **多 Agent** | |
| GenerateBlueprint | 生成任务执行蓝图 |
| GenerateDesign | 生成设计文档 |
| StartLeadAgent | 启动 Lead Agent 协调器 |
| DispatchWorker | 派发自主 Worker Agent |
| SubmitReview | 提交质量评审 |
| SubmitE2EResult | 提交 E2E 测试结果 |
| TriggerE2ETest | 触发 E2E 测试 |
| UpdateTaskPlan | 更新任务执行计划 |
| **高级** | |
| SelfEvolve | AI 自我修改，带安全检查 |
| StructuredOutput | 结构化数据输出 |
| OutputPersistence | 持久化输出存储 |
| Teammate | 团队协作 |

## 配置

设置 API 密钥：

**Linux/macOS:**
```bash
export ANTHROPIC_API_KEY=your-api-key
```

**Windows PowerShell:**
```powershell
$env:ANTHROPIC_API_KEY="your-api-key"
```

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | API 密钥 | - |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点 | `https://api.anthropic.com` |
| `CLAUDE_CODE_LANG` | 语言（en/zh） | 自动检测 |
| `BASH_MAX_OUTPUT_LENGTH` | Bash 输出最大长度 | 30000 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 最大输出 tokens | 32000 |
| `USE_BUILTIN_RIPGREP` | 使用系统 ripgrep | false |

### 多云服务商支持

- **Anthropic** — 直连 API（默认）
- **AWS Bedrock** — 设置 `ANTHROPIC_BEDROCK=1` 并配置 AWS 凭证
- **Google Vertex AI** — 设置 `ANTHROPIC_VERTEX=1` 并配置 GCP 凭证

### MCP 协议

完整的 Model Context Protocol 实现：

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

支持 stdio、HTTP 和 SSE 传输，含自动发现。

### Hooks 系统

在工具调用前后执行自定义脚本：

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "Bash",
      "command": "/path/to/script.sh",
      "blocking": true
    }
  ]
}
```

支持事件：`PreToolUse`、`PostToolUse`、`PrePromptSubmit`、`PostPromptSubmit`、`Notification`、`Stop`

## 项目结构

```
src/
├── cli.ts                  # CLI 入口点（Commander.js）
├── web-cli.ts              # Web UI 入口点
├── proxy-cli.ts            # 代理服务器入口点
├── feishu-cli.ts           # 飞书机器人入口点
├── wechat-cli.ts           # 微信机器人入口点
├── index.ts                # 主导出文件
│
├── core/                   # 核心引擎
│   ├── client.ts           # Anthropic API 客户端（流式、重试、成本）
│   ├── session.ts          # 会话状态管理
│   ├── loop.ts             # 对话编排器
│   └── backgroundTasks.ts  # 异步后台任务处理
│
├── tools/                  # 37+ 工具（见工具表）
│
├── web/                    # Web UI 系统
│   ├── server/             # Express + WebSocket 后端
│   │   ├── websocket.ts    # WebSocket 处理器
│   │   ├── conversation.ts # 对话管理器
│   │   ├── session-manager.ts
│   │   ├── auth-manager.ts # 认证管理
│   │   ├── routes/         # API 路由
│   │   └── handlers/       # 请求处理器
│   └── client/             # React 前端
│       └── src/
│           ├── components/
│           │   ├── CodeView/        # Monaco 编辑器 + 文件树 + AI hooks
│           │   ├── BlueprintSummaryCard/
│           │   ├── continuous/      # 持续开发面板
│           │   ├── config/          # 设置面板
│           │   └── ...              # 40+ UI 组件
│           ├── hooks/      # 自定义 React hooks
│           └── contexts/   # React Context
│
├── blueprint/              # Blueprint 多 Agent 系统（16 个文件）
│   ├── smart-planner.ts    # 智能任务规划器
│   ├── lead-agent.ts       # Lead Agent 协调器
│   ├── autonomous-worker.ts # 自主 Worker
│   ├── task-queue.ts       # 任务优先级队列
│   ├── task-reviewer.ts    # 质量评审器
│   ├── realtime-coordinator.ts # 实时协调器
│   ├── model-selector.ts   # 自适应模型选择器
│   ├── e2e-test-agent.ts   # E2E 测试 Agent
│   ├── verification-service.ts # 结果验证
│   ├── visual-comparator.ts # 视觉 diff
│   └── ...
│
├── agents/                 # 专用子代理
│   ├── explore.ts          # 代码库探索
│   ├── plan.ts             # 实现规划
│   ├── guide.ts            # 文档引导
│   ├── parallel.ts         # 并行执行
│   ├── monitor.ts          # 监控代理
│   └── resume.ts           # 会话恢复
│
├── memory/                 # 统一记忆系统
│   ├── unified-memory.ts   # 记忆管理器
│   ├── vector-store.ts     # 向量存储
│   ├── bm25-engine.ts      # BM25 文本搜索
│   ├── chat-memory.ts      # 对话记忆
│   ├── embedder.ts         # 嵌入模型
│   └── intent-extractor.ts # 意图提取
│
├── checkpoint/             # 文件快照管理
├── rewind/                 # 会话时间旅行
├── updater/                # 自动更新系统
├── browser/                # 自定义浏览器控制
├── chrome/                 # Chrome 集成
├── chrome-mcp/             # Chrome MCP 桥接
├── daemon/                 # 定时任务守护进程
├── feishu/                 # 飞书集成
├── wechat/                 # 微信集成
├── i18n/                   # 国际化（en、zh）
├── teams/                  # 团队管理
├── mcp/                    # MCP 协议（完整实现）
├── permissions/            # 权限系统
├── session/                # 会话持久化
├── context/                # 上下文管理与摘要
├── config/                 # 配置管理
├── models/                 # 模型配置（Anthropic/Bedrock/Vertex）
├── hooks/                  # Hook 系统
├── plugins/                # 插件系统
├── commands/               # 斜杠命令
├── auth/                   # 认证（API 密钥 + OAuth）
├── parser/                 # 代码解析（Tree-sitter WASM）
├── search/                 # 搜索（ripgrep 集成）
├── proxy/                  # 代理服务器
├── providers/              # 云服务商
├── fast-mode/              # 快速模式
├── lsp/                    # 语言服务器协议
├── git/                    # Git 操作
├── github/                 # GitHub 集成
├── sandbox/                # 沙箱执行
├── security/               # 安全约束
├── trust/                  # 信任验证
├── ratelimit/              # 速率限制
├── rules/                  # 规则引擎
├── diagnostics/            # 诊断工具
├── notifications/          # 通知系统
├── ui/                     # 终端 UI（Ink/React）
├── streaming/              # 流式 I/O
├── telemetry/              # 本地遥测
├── types/                  # TypeScript 类型定义
└── utils/                  # 工具函数
```

## 斜杠命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示帮助 |
| `/clear` | 清除对话历史 |
| `/status` | 显示会话状态 |
| `/resume` | 恢复历史会话 |
| `/context` | 显示上下文使用情况 |
| `/compact` | 压缩对话历史 |
| `/rename` | 重命名当前会话 |
| `/export` | 导出会话（JSON/Markdown） |
| `/transcript` | 导出会话转录记录 |
| `/config` | 查看配置 |
| `/tools` | 列出可用工具 |
| `/model` | 查看/切换模型 |
| `/fast` | 切换快速模式 |
| `/exit` | 退出 |

## 测试

```bash
npm test                    # 运行所有测试（vitest）
npm run test:unit           # 仅单元测试
npm run test:integration    # 集成测试
npm run test:e2e            # 端到端 CLI 测试
npm run test:coverage       # 覆盖率报告
npm run test:watch          # 监视模式
npm run test:ui             # Vitest UI
```

## 开发

```bash
# 开发模式（使用 tsx）
npm run dev

# Web UI 开发
npm run web

# Web UI 文件监视
npm run web:dev

# 构建
npm run build

# 类型检查
npx tsc --noEmit
```

## 技术栈

- **TypeScript** — 类型安全
- **Anthropic SDK** — API 调用
- **Ink + React** — 终端 UI
- **Express + WebSocket** — Web 后端
- **React + Monaco Editor** — Web 前端
- **Commander** — CLI 框架
- **Zod** — 模式验证
- **Tree-sitter WASM** — 代码解析
- **better-sqlite3** — 本地数据库
- **sharp** — 图像处理
- **ngrok** — 公网隧道
- **Vitest** — 测试框架

## 社区

- **网站：** https://www.chatbi.site
- **Discord：** [加入我们的 Discord](https://discord.gg/bNyJKk6PVZ)
- **X (Twitter)：** [@wangbingjie1989](https://x.com/wangbingjie1989)
- **微信：** h694623326

## 许可证

本项目仅用于教育目的。原始 Claude Code 归 Anthropic PBC 所有。

---

*这个项目是对混淆代码的逆向工程研究，不代表官方实现。*

[English README](README.md)
