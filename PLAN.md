# 功能增删计划：4 个新工具 + 2 个精简

## 概述

**新增 4 个工具（完整实现）：**
1. DatabaseClient — 数据库客户端工具（SQL/Redis/MongoDB）
2. Debugger — 调试器集成（DAP 协议）
3. TestRunner — 测试结果结构化解析
4. REPL — 多语言交互式执行环境

**精简 2 个模块：**
1. 删除微信集成（src/wechat/ + src/wechat-cli.ts）
2. 精简 map 模块（保留 types.ts，删除 25+ 个实现文件）

---

## 一、删除微信集成

### 影响范围
- `src/wechat/` 目录（5 个文件）
- `src/wechat-cli.ts`
- `package.json` 依赖：`wechaty`, `wechaty-puppet-wechat4u`
- `package.json` 脚本：`wechat`, `wechat:start`

### 操作步骤
1. 删除 `src/wechat/` 目录
2. 删除 `src/wechat-cli.ts`
3. 从 `package.json` 移除相关依赖和脚本

---

## 二、精简 map 模块

### 保留
- `src/map/types.ts` — 被 lsp-analyzer.ts 和 code-parser.ts 导入

### 删除（25+ 文件）
- 所有实现文件（analyzer, generators, analyzers 等）
- types-enhanced.ts, types-chunked.ts
- server/ 整个目录
- `src/commands/map.ts`

### 连带修改
- `src/map/index.ts` — 重写为只导出 types
- `src/commands/index.ts` — 移除 map 命令注册

---

## 三、新增 DatabaseClient 工具

### 文件
- `src/tools/database.ts` — 工具主文件
- `src/database/index.ts` — 连接管理器
- `src/database/drivers/` — postgres, mysql, sqlite, redis, mongo
- `src/database/types.ts`

### 支持：PostgreSQL, MySQL, SQLite, Redis, MongoDB
### 新增依赖：pg, mysql2, ioredis, mongodb

---

## 四、新增 Debugger 工具

### 文件
- `src/tools/debugger.ts`
- `src/debugger/dap-client.ts` — DAP 协议客户端
- `src/debugger/types.ts`
- `src/debugger/index.ts`

### 支持：Node.js (--inspect), Python (debugpy)
### 无新增依赖

---

## 五、新增 TestRunner 工具

### 文件
- `src/tools/test-runner.ts`
- `src/testing/index.ts`
- `src/testing/parsers/` — vitest, jest, pytest, go, cargo
- `src/testing/types.ts`

### 支持：vitest, jest, mocha, pytest, go test, cargo test
### 无新增依赖（通过 JSON reporter 解析）

---

## 六、新增 REPL 工具

### 文件
- `src/tools/repl.ts`
- `src/repl/index.ts`
- `src/repl/runtimes/` — node, python
- `src/repl/types.ts`

### 支持：Node.js, Python
### 无新增依赖

---

## 七、集成修改

### src/tools/index.ts — 注册 4 个新工具
### src/agents/tools.ts — 更新 agent 工具权限
### src/prompt/templates.ts — 添加新工具使用指南
### package.json — 依赖变更

---

## 八、实施顺序

### Phase 1: 清理
1. 删除 wechat, 精简 map, 更新引用, 验证编译

### Phase 2: 基础工具
2. TestRunner（最简单）
3. REPL（中等）

### Phase 3: 高级工具
4. DatabaseClient（多驱动）
5. Debugger（DAP 协议，最复杂）

### Phase 4: 集成
6. 注册工具, 更新权限, 更新提示词, 编译检查
