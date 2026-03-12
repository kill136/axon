---
name: build-portable
description: 打包 Axon Electron 便携版。执行 build-portable.ps1 脚本，生成免安装的便携版 zip，并可上传到 GitHub Release。Use this skill whenever the user mentions 打包、便携版、portable、Electron 打包、桌面版、build portable，even if they just say "打个包" or "出个桌面版"。
disable-model-invocation: true
argument-hint: [版本号，可选]
---

# Electron 便携版打包

## 架构
Axon.exe(Electron) → spawn → node.exe(内嵌) → dist/web-cli.js → Express server → BrowserWindow.loadURL()

## 关键文件
- `build-portable.ps1` — 打包脚本
- `electron/main.cjs` — Electron 主进程
- `electron/package.json` — Electron 包配置

## 打包流程

### Step 1: 前置检查
确认以下条件满足：
- `node_modules/electron/dist` 存在
- `dist/web-cli.js` 存在（如不存在，先运行 `npm run build`）
- 前端构建产物在 `src/web/server/public/` 下存在

### Step 2: 执行打包脚本
```powershell
.\build-portable.ps1
```

脚本自动完成：
1. 检查前置条件
2. 创建 `release/axon-portable/` 目录
3. 复制 Electron runtime
4. 复制 dist/、node_modules/、electron/ 等项目文件
5. 内嵌 Node.js 运行时
6. 生成启动入口 Axon.exe
7. 打包成 zip

### Step 3: 验证
- 检查输出文件大小是否合理（~300-400MB）
- 确认 `release/axon-portable/Axon.exe` 存在

### Step 4: 上传到 GitHub Release（可选）
如果用户指定了版本号或要上传：
```bash
gh release upload v$ARGUMENTS release/axon-portable.zip --clobber
```

## 常见问题
- **Windows Defender 拦截**：打包过程中 Defender 可能报告威胁，需要在安全中心排除 `F:\claude-code-open`
- **内存不足**：不要用 electron-builder，用手动复制方式避免内存溢出
- **HTTPS/HTTP 自适应**：main.cjs 同时尝试 HTTPS 和 HTTP，打包后默认 HTTP（`.axon-certs` 不在 resources/app/ 下）
