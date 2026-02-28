# 品牌重命名计划：Claude Code → Axon

## 核心命名映射

| 旧名称 | 新名称 | 说明 |
|--------|--------|------|
| Claude Code | Axon | 产品名 |
| Claude Code Open | Axon | 项目名 |
| claude-code-open | axon | npm 包名、仓库名 |
| claude | axon | CLI 命令名 |
| claude-web | axon-web | Web CLI 命令 |
| claude-proxy | axon-proxy | Proxy CLI 命令 |
| ~/.claude/ | ~/.axon/ | 配置目录 |
| .claude/ | .axon/ | 项目本地配置目录 |
| CLAUDE.md | AXON.md | 项目指令文件 |
| CLAUDE_* | AXON_* | 环境变量前缀 |
| Claude Code Browser Bridge | Axon Browser Bridge | 浏览器扩展 |

## 不改的内容（关键！）

1. **API 模型名称** — `claude-sonnet-4-*`, `claude-opus-4-*`, `claude-haiku-4-*` 等 Anthropic 官方模型 ID，这些是 API 标识符，必须保留
2. **Anthropic SDK** — `@anthropic-ai/sdk`, `@anthropic-ai/claude-code` 包引用保留
3. **Co-Authored-By 署名** — `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>` 保留（这是模型名，不是产品名）
4. **claude.ai URL** — `https://claude.ai/*` 保留
5. **模型显示名** — `Claude Opus 4.6`, `Claude Sonnet 4.5` 等模型名称保留
6. **git helper 中检测 Claude 署名** — 逻辑保留（检测的是模型签名）

## 分阶段执行

### 阶段一：源码核心替换（TaskPlan 任务 1-5）

#### Task 1: package.json + 版本文件 + LICENSE
- `package.json`: name, bin, description
- `src/version.ts`: 注释中的 "Claude Code CLI"
- `LICENSE`: "Claude Code Open Contributors" → "Axon Contributors"
- `CONTRIBUTING.md`: 品牌名替换

#### Task 2: 系统提示词 + 身份标识
- `src/prompt/templates.ts`: CORE_IDENTITY_VARIANTS 三个变体
- `src/core/client.ts`: CLAUDE_CODE_IDENTITY 等常量 + hasValidIdentity
- `src/prompt/builder.ts`: 所有 "Claude Code" 引用
- `src/prompt/attachments.ts`: CLAUDE.md 相关引用

#### Task 3: 配置目录 `.claude` → `.axon`
- `src/utils/platform.ts`: getConfigDir() 中 `.claude` → `.axon`
- 全局搜索替换所有 `'.claude'` / `".claude"` / `` `.claude` `` 路径字面量（排除 `@anthropic-ai/claude-code` 包引用）
- `docker-compose.yml`: 卷映射
- 环境变量 `CLAUDE_*` → `AXON_*`（跳过 `CLAUDE_API_KEY` 因为那是 Anthropic 的标准变量名...不对，CLAUDE_API_KEY 也是自定义的，也得改）

**注意**: `ANTHROPIC_API_KEY` 保留不变，`CLAUDE_API_KEY` → `AXON_API_KEY`

#### Task 4: CLAUDE.md 机制 → AXON.md
- `src/config/claude-md-parser.ts` → 重命名为 `src/config/axon-md-parser.ts`
- `src/ui/components/ClaudeMdImportDialog.tsx` → `src/ui/components/AxonMdImportDialog.tsx`
- `src/ui/hooks/useClaudeMdImport.ts` → `src/ui/hooks/useAxonMdImport.ts`
- `src/rules/index.ts`: CLAUDE_MD_FILES 数组
- 所有导入路径更新
- i18n 中的 `claudemd.*` key 值更新（key 名本身也改为 `axonmd.*`）

#### Task 5: i18n 国际化文本
- `src/i18n/locales/en.ts`: 所有 "Claude Code" → "Axon"
- `src/i18n/locales/zh.ts`: 同上
- `src/i18n/locales.ts`: 如有品牌引用
- `src/web/client/src/i18n/locales.ts`: Web UI 国际化

### 阶段二：Web UI + 浏览器扩展（任务 6-8）

#### Task 6: Web UI 品牌替换
- `src/web/client/index.html`: title, apple-mobile-web-app-title
- `src/web/client/public/manifest.webmanifest`: name, short_name
- `src/web/client/src/components/WelcomeScreen.tsx`: logo alt text, title
- `src/web/client/src/components/SettingsPanel.tsx`: 品牌名引用
- `src/web/client/package.json`: 如有品牌名

#### Task 7: 浏览器扩展
- `src/browser/extension/manifest.json`: name, description, default_title
- `src/browser/extension/options.html`: 品牌名引用

#### Task 8: Attribution 系统
- `src/utils/attribution.ts`: CLAUDE_CODE_URL, "Generated with Claude Code"  
  - 改为 "Generated with Axon" + 新 URL
  - 保留 `Co-Authored-By: Claude Sonnet 4.5` (模型名不改)
- `src/tools/bash.ts`: 提示词中的 attribution 示例
- `src/utils/git-helper.ts`: Claude 署名检测逻辑（保留，因为检测的是模型签名）

### 阶段三：CLI + 脚本 + 文档（任务 9-12）

#### Task 9: CLI 入口
- `src/cli.ts`: 所有 "Claude Code" / "claude-code-open" 引用, CLAUDE.md 引用, 环境变量
- `src/web-cli.ts`: CLAUDE_EVOLVE_ENABLED 等
- `src/proxy-cli.ts`: 品牌名
- `src/feishu-cli.ts`: 品牌名

#### Task 10: 安装和启动脚本
- `install.sh`: banner、路径、变量
- `install.ps1`: 同上
- `install.bat`: 同上
- `start.sh` / `start.bat`: banner、品牌名
- `run.sh` / `run.bat`: 品牌名
- `update-and-start.bat`: 品牌名
- `create-shortcut.ps1`: 品牌名
- `deploy.sh`: 品牌名

#### Task 11: 文档替换
- `README.md`: 全面替换
- `README.zh-CN.md`: 全面替换
- `CLAUDE.md`（项目本身的）: 品牌名替换，但保留文件名（这是我们自己项目的 CLAUDE.md）→ **不对，这个文件也要改名为 AXON.md**
- `docs/user-guide.md`: 品牌名
- `docs/marketing/*`: 全部删除或大改

#### Task 12: Landing Page + 宣传素材
- `landing-page/**/*.html`: 所有品牌名
- `landing-page/promotion-templates.md`: 品牌名
- `landing-page/package.json`: 品牌名
- `demo-screenshots/`: 宣传 HTML/脚本中的品牌名
- `.github/**`: workflows, issue templates, SECURITY.md

### 阶段四：剩余散落文件（任务 13-15）

#### Task 13: 其他源码文件中的品牌名
- 遍历 `src/` 下所有含 "Claude Code" 的 227 个文件
- 逐个检查是品牌引用还是技术引用
- 主要集中在：tools/*, commands/*, ui/*, agents/*, config/*

#### Task 14: 环境变量全面替换
- `CLAUDE_CODE_*` → `AXON_*` (约 80+ 个变量名)
- `CLAUDE_WEB_*` → `AXON_WEB_*`
- `CLAUDE_MODEL` → `AXON_MODEL`
- `CLAUDE_EVOLVE_ENABLED` → `AXON_EVOLVE_ENABLED`
- `CLAUDE_API_KEY` → `AXON_API_KEY`
- 保留 `ANTHROPIC_API_KEY`（Anthropic 官方变量）

#### Task 15: 测试文件 + 配置文件
- `tests/**/*.ts`: 品牌名和路径引用
- `.claude/settings.json`: 内容中的品牌引用  
- `.claude/` 目录 → `.axon/` 目录（项目本地的）
- `.vscode/settings.json`: 如有品牌引用
- `.github/workflows/release.yml`: 品牌引用

### 阶段五：文件重命名 + 物理目录（任务 16）

#### Task 16: 物理文件/目录重命名
- `src/config/claude-md-parser.ts` → `src/config/axon-md-parser.ts`
- `src/ui/components/ClaudeMdImportDialog.tsx` → `src/ui/components/AxonMdImportDialog.tsx`  
- `src/ui/hooks/useClaudeMdImport.ts` → `src/ui/hooks/useAxonMdImport.ts`
- `tests/config/claude-md-include.test.ts` → `tests/config/axon-md-include.test.ts`（如存在）
- `tests/unit/ui/ClaudeMdImportDialog.test.tsx` → `tests/unit/ui/AxonMdImportDialog.test.tsx`（如存在）
- `.claude/` → `.axon/`（项目本地目录）
- `CLAUDE.md` → `AXON.md`（项目根目录）

### 阶段六：验证

#### Task 17: 编译验证
- `npx tsc --noEmit` 确认无类型错误
- 全局搜索确认无遗漏的 "Claude Code"（品牌用法）
- 确认 API 模型名未被误改

## 替换规则精确定义

### 规则 1: 品牌名替换
```
"Claude Code Open" → "Axon"
"Claude Code" → "Axon"        # 注意区分：不能改 "Claude Sonnet 4.5" 这类模型名
"claude-code-open" → "axon"
"claude-code" → "axon"         # 注意排除 @anthropic-ai/claude-code
"claude_code" → "axon"
```

### 规则 2: CLI 命令名
```
bin.claude → bin.axon
bin.claude-web → bin.axon-web
bin.claude-proxy → bin.axon-proxy
```

### 规则 3: 配置路径
```
'.claude' (目录名) → '.axon'
"~/.claude/" → "~/.axon/"
"%USERPROFILE%\.claude" → "%USERPROFILE%\.axon"
```

### 规则 4: 文件名
```
CLAUDE.md → AXON.md
.claude.md → .axon.md
claude.md → axon.md
claude-md → axon-md
claudeMd → axonMd
ClaudeMd → AxonMd
```

### 规则 5: 环境变量
```
CLAUDE_CODE_* → AXON_*
CLAUDE_WEB_* → AXON_WEB_*
CLAUDE_MODEL → AXON_MODEL
CLAUDE_API_KEY → AXON_API_KEY
CLAUDE_EVOLVE_ENABLED → AXON_EVOLVE_ENABLED
```
**保留**: `ANTHROPIC_API_KEY`

### 规则 6: Docker
```
wbj66/claude-code-open → wbj66/axon
服务名 claude: → axon:
```

### 规则 7: 安装路径
```
$HOME/.claude-code-open → $HOME/.axon
```

## 风险防控

1. **误伤 API 模型名** — 每个替换都要排除 `claude-sonnet-*`, `claude-opus-*`, `claude-haiku-*`, `claude-3-*` 模型 ID
2. **误伤 SDK 引用** — 排除 `@anthropic-ai/claude-code`, `@anthropic-ai/sdk` 
3. **误伤 claude.ai URL** — 排除 `claude.ai` 域名
4. **误伤 Co-Authored-By** — `Co-Authored-By: Claude` 中的 Claude 是模型名，保留
5. **循环引用** — 重命名文件后所有 import 路径必须更新
6. **现有用户数据迁移** — 不在本次改动范围，后续可做自动迁移脚本

## 执行方式

使用 StartLeadAgent + TaskPlan 模式，分 3-4 批执行：
- 第一批：Task 1-5（核心源码）
- 第二批：Task 6-10（UI + 脚本）
- 第三批：Task 11-16（文档 + 重命名）
- 最后：Task 17（验证）

每批完成后验证 tsc 编译通过再进行下一批。
