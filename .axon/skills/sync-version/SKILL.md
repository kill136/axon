---
name: sync-version
description: 同步 Axon 项目中所有需要版本号一致的文件。确保 package.json、electron/package.json、package-lock.json、installer/axon-setup.iss 的版本号完全一致。Use this skill whenever the user mentions 同步版本号、版本不一致、sync version、version mismatch，or when you detect version numbers are out of sync across files。
argument-hint: [新版本号]
---

# 版本号同步

## 需要同步的文件

| 文件 | 字段/位置 | 格式 |
|------|----------|------|
| `package.json` | `"version"` | `"X.Y.Z"` |
| `electron/package.json` | `"version"` | `"X.Y.Z"` |
| `package-lock.json` | 顶层 `"version"` + `"packages"."".version` | `"X.Y.Z"` |
| `installer/axon-setup.iss` | `#define MyAppVersion` | `"X.Y.Z"` |

## 流程

### Step 1: 读取当前版本
读取 `package.json` 获取当前版本号。

### Step 2: 确定目标版本
- 如果提供了 `$ARGUMENTS`，使用指定版本号
- 如果未提供，当前版本 patch +1

### Step 3: 更新所有文件
用 Edit 工具逐个更新上述文件中的版本号。

### Step 4: 验证
用 Grep 搜索旧版本号，确认已全部替换：
```bash
grep -r "OLD_VERSION" package.json electron/package.json package-lock.json installer/
```

## 注意事项
- `package-lock.json` 有两处版本号（顶层和 `packages.""` 下），都需要更新
- `installer/axon-setup.iss` 可能不存在（仅 Windows 安装包需要），不存在就跳过
- 不要运行 `npm install` 来更新 lock 文件版本号，直接编辑更可靠
