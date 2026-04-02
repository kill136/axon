# Skill 安装依赖补齐设计方案

## 背景与问题
- 当前 skill 安装仅下载 `SKILL.md` 并写入 `.meta.json`，没有任何依赖解析、bootstrap、安装后校验。证据：`src/skills/hub.ts:134-204`。
- `Skill` 工具运行时只把 `SKILL.md` 注入上下文，不负责依赖安装或环境检测。证据：`src/tools/skill.ts:1533-1650`。
- 用户要求把问题按“所有语言/运行时的 skill 安装时自动补依赖”统一设计，而不是仅修 xlsx。

## 目标
1. skill 安装时自动解析并补齐依赖，而不是首次运行时才发现缺失。
2. 设计必须覆盖多语言/多运行时：Python、Node、系统二进制，以及未来扩展空间。
3. 安装后必须有状态记录与健康检查，能够明确知道 skill 是否真正 runnable。
4. 保持向后兼容：旧的仅有 `SKILL.md` 的 skill 仍可安装和使用。

## 现状分析
### 当前 skill 元数据能力
- frontmatter 解析器是非常简陋的 `key: value` 逐行解析，不支持嵌套对象/数组。证据：`src/tools/skill.ts:377-404`。
- 已支持的 frontmatter 主要是 `allowed-tools`、`arguments`、`model`、`hooks` 等平铺字段。证据：`src/tools/skill.ts:526-540`。
- 现有 `installSkill()` 没有依赖模型，也没有安装记录模型。证据：`src/skills/hub.ts:134-204`。

### 可以复用的现有模式
- 插件系统已有“安装记录”思路：`installed_plugins.json`。证据：`src/plugins/marketplace.ts:773-799`。
- 插件系统已有“依赖不满足时报错”的模式。证据：`src/plugins/index.ts:794-813`。
- 项目已有 `js-yaml` 依赖，可安全引入更完整的 manifest 解析，而不必继续靠手写 frontmatter。证据：`package.json:200`。

## 设计决策
### 决策 1：将 skill 说明与安装元数据分离
不要继续把依赖信息塞进 `SKILL.md` frontmatter。

新增独立 manifest 文件，建议命名：`skill.json`。

原因：
- 当前 frontmatter 解析器不支持嵌套结构，不适合表达多语言依赖。
- `SKILL.md` 应保持给模型看的说明文档；依赖、安装、健康检查是运行时元数据，不应混在提示词里。
- 与插件 marketplace manifest 分层思路一致。

### 决策 2：manifest 采用运行时无关的统一依赖模型
建议 `skill.json` 结构：
- `name`
- `version`
- `runtime`（可选，主运行时提示）
- `dependencies`：
  - `python.packages`
  - `node.packages`
  - `system.commands`
  - `files`
- `bootstrap`：安装后执行的初始化步骤（受限）
- `healthcheck`：验证 skill 是否可运行
- `installPolicy`：`auto` / `check-only`

示意：
```json
{
  "name": "xlsx",
  "version": "1.0.0",
  "runtime": "python",
  "dependencies": {
    "python": {
      "packages": ["pandas", "openpyxl", "xlsxwriter"]
    },
    "system": {
      "commands": ["soffice"]
    },
    "files": ["scripts/recalc.py"]
  },
  "bootstrap": {
    "python": ["python scripts/recalc.py --help"]
  },
  "healthcheck": {
    "pythonImports": ["pandas", "openpyxl"],
    "commands": ["soffice"],
    "files": ["scripts/recalc.py"]
  },
  "installPolicy": "auto"
}
```

### 决策 3：安装范围按依赖类型分层处理
#### Python 依赖
- 为每个 skill 创建隔离 venv，例如 `~/.axon/skills/<skill>/runtime/python/venv`。
- 安装 `python.packages` 到 skill 私有环境。
- 记录解释器路径与安装结果。

#### Node 依赖
- 为每个 skill 创建 `runtime/node/package.json`。
- 安装 `node.packages` 到 skill 私有目录，不污染主项目依赖。
- 记录 node_modules 状态。

#### 系统依赖
- **默认不静默安装系统包管理器依赖**（apt/brew/choco）。
- 只检测并记录缺失，必要时给出明确诊断。
- 原因：系统级安装破坏面大、不可逆、平台差异大。

#### 文件依赖
- 检查仓库内相对路径、skill 包内资源、下载资源三类。
- 缺失时安装失败或进入 degraded 状态，由 manifest 指定是否阻断。

### 决策 4：引入 Skill 安装状态文件
在 skill 目录中扩展 `.meta.json` 或新增 `install-state.json`，记录：
- manifest 版本
- 安装时间
- 安装状态：`installed` / `degraded` / `failed`
- 各 runtime 详细结果
- healthcheck 结果
- 错误信息

建议新增独立 `install-state.json`，避免把来源元数据和运行时状态混在一起。

### 决策 5：旧 skill 向后兼容
对于只有 `SKILL.md`、没有 `skill.json` 的 skill：
- 继续允许安装
- 标记为 `legacy` 模式
- 不执行自动依赖安装
- 安装状态记为 `installed_no_manifest`

这样不会破坏现有 skill 生态。

## 实施方案
### 第一阶段：Manifest 与安装器骨架
涉及文件：
- `src/skills/hub.ts`
- 新增 `src/skills/installer.ts`
- 新增 `src/skills/manifest.ts`
- 可能补充 `src/types/` 中 skill manifest 类型

内容：
1. 定义 `SkillManifest` 类型与解析器。
2. `installSkill()` 除下载 `SKILL.md` 外，还尝试下载/读取 `skill.json`。
3. 若有 manifest，则调用 `SkillInstaller.install()`。
4. 写入 `install-state.json`。

### 第二阶段：Python / Node runtime 支持
内容：
1. Python runtime：
   - 检测 `python3`
   - 创建 venv
   - pip 安装 packages
   - healthcheck import
2. Node runtime：
   - 检测 `node` / `npm`
   - 生成最小 package.json
   - npm install 指定包
   - healthcheck require/import

### 第三阶段：系统依赖与 healthcheck
内容：
1. 增加 `command -v` / `which` 风格命令检测封装。
2. 增加文件存在性检查。
3. 按 manifest 规则将结果标记为 `installed`、`degraded` 或 `failed`。

### 第四阶段：运行时集成
内容：
1. `listInstalledSkills()` 返回安装状态摘要。
2. `Skill` 调用前若发现 skill 已安装但状态 degraded/failed，则在注入前给出明确警告。
3. Web UI / CLI 可显示 skill 安装健康状态。

## 需要注意的约束
### 安全性
- 不允许 skill manifest 自由指定任意 shell 命令直接执行。
- bootstrap 必须限制在白名单模型内，例如：
  - Python import 检查
  - pip install 指定包
  - npm install 指定包
  - 文件/命令探测
- 任意 shell bootstrap 会把 skill 变成远程代码执行入口，这不能接受。

### 跨语言支持
用户明确要求“其他语言的 skills 要同时考虑到”，所以 manifest 设计必须预留：
- Python
- Node
- system commands
- files
- future runtimes（例如 `ruby`, `go`, `java`）

但首版实现不需要全部落地，只要 schema 可扩展、安装器接口可扩展即可。

### 不做的事
首版不建议：
- 自动 apt/brew 安装系统软件
- 支持任意自定义 shell bootstrap
- 在 `SKILL.md` frontmatter 中硬塞复杂依赖结构

## 推荐实施顺序
1. 定义 `skill.json` manifest 与类型
2. 改 `installSkill()` 支持 manifest 下载/读取
3. 实现 Python/Node installer
4. 写 `install-state.json`
5. 给 `listInstalledSkills()` 和 skill 调用链补状态展示
6. 为 xlsx skill 增加 manifest，作为首个验证样例
7. 再推广到其他 skill

## 测试计划
新增测试覆盖：
1. 安装 legacy skill（只有 `SKILL.md`）仍成功
2. 安装带 python 依赖的 skill，会创建 venv 并记录状态
3. 安装带 node 依赖的 skill，会创建 runtime/node 并记录状态
4. 缺系统依赖时进入 degraded，而不是假成功
5. healthcheck 失败时状态正确
6. 重复安装时幂等
7. manifest 非法时安装失败并给出清晰错误

可参考现有 skill 测试文件：
- `tests/skill-builtin.test.ts`
- `tests/skill-hot-reload.test.ts`

## 风险与取舍
### 方案 A：继续扩展 SKILL.md frontmatter
- 优点：文件少
- 缺点：表达能力差、解析脆弱、提示词与运行时配置耦合
- 结论：不推荐

### 方案 B：新增 `skill.json` manifest
- 优点：职责清晰、易扩展、适配多语言
- 缺点：skill 包从单文件变成双文件
- 结论：推荐

### 方案 C：把依赖安装推迟到首次调用 skill
- 优点：安装阶段更快
- 缺点：用户在真正使用时才爆炸，体验差
- 结论：不符合当前需求，安装时补齐才是正确方向

## 最终建议
采用 `SKILL.md + skill.json + install-state.json` 三层结构：
- `SKILL.md`：模型说明
- `skill.json`：依赖/安装/健康检查声明
- `install-state.json`：安装结果与状态

并在 `installSkill()` 中接入统一安装器，首版落地 Python/Node/file/command 四类依赖模型，系统包只检测不自动安装。