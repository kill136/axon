# 长期记忆向量检索补充层 — 实现计划

## 一、设计目标

在现有三层记忆架构（session memory → notebook → agent memory）基础上，增加**第四层：向量检索长期记忆**，作为 notebook 全量注入的**补充**而非替代。

核心原则：
- **笔记本全量注入仍为主**，向量检索只做长尾补充
- **严格防护相似度污染**（这是 OpenClaw 的核心缺陷）
- **零外部依赖**，只用 BM25 关键词搜索 + 已有的 better-sqlite3，不引入嵌入模型

### 为什么不用向量嵌入？

1. **依赖重** — 需要 API key 或本地模型（node-llama-cpp 在 Windows 上编译困难）
2. **相似度污染无法根治** — 嵌入向量无法区分"语义相近但上下文不同"的记忆
3. **BM25 + 精确匹配足够** — 记忆内容是我们自己写的 Markdown，关键词明确，不需要语义模糊匹配
4. **成本** — 每次查询都要调嵌入 API，日积月累有费用

## 二、架构设计

```
现有记忆系统（保持不变）
├── session memory (短期, ~2K tokens, 当前会话压缩)
├── notebook experience.md (中期, ~4K tokens, 全量注入)
├── notebook project.md (中期, ~8K tokens, 全量注入)  
└── agent memory MEMORY.md (中期, ~12K tokens, 前200行注入)

新增补充层
└── Long-Term Memory Store (长期, 无上限)
    ├── 存储: SQLite (better-sqlite3, 已有依赖)
    ├── 索引: BM25 (自研, 已有测试用例) + FTS5 (SQLite 内置)
    ├── 数据源:
    │   ├── memory/ 目录下的 .md 文件 (增量同步)
    │   └── 历史 session-memory/summary.md (增量索引)
    ├── 检索: 工具调用 MemorySearch（AI 按需搜索）
    └── 防污染:
        ├── 项目隔离 (每项目独立 SQLite)
        ├── 时间衰减 (旧记忆降权)
        ├── 来源标注 (文件路径 + 行号 + 时间)
        └── 高阈值过滤 (minScore ≥ 0.3 for BM25)
```

## 三、新增文件清单

```
src/memory/
├── types.ts              — 记忆系统共享类型（已有测试引用，需新建）
├── bm25-engine.ts        — BM25 搜索引擎（已有测试用例，需实现）
├── link-memory.ts        — 关联记忆系统（已有测试用例，需实现）
├── long-term-store.ts    — 长期记忆存储管理（SQLite, 核心新模块）
├── memory-search.ts      — 统一搜索接口（协调 BM25 + SQLite FTS5）
└── memory-sync.ts        — 增量同步引擎（文件监听 + hash 比对）

src/tools/
└── memory-search.ts      — MemorySearch 工具（AI 调用的搜索入口）
```

## 四、分步实现计划

### 步骤 1: types.ts — 共享类型定义
**文件**: `src/memory/types.ts`（新建）

```typescript
// 测试文件已引用的类型
export enum MemoryImportance {
  LOW = 'low',
  MEDIUM = 'medium', 
  HIGH = 'high',
  CRITICAL = 'critical',
}

// 记忆搜索结果
export interface MemorySearchResult {
  id: string;
  path: string;           // 来源文件路径
  startLine: number;      // chunk 起始行
  endLine: number;        // chunk 结束行
  score: number;          // BM25 分数
  snippet: string;        // 匹配文本片段
  source: MemorySource;   // 来源类型
  timestamp: string;      // 写入时间 (ISO 8601)
  age: number;            // 距今毫秒数（用于衰减计算）
}

export type MemorySource = 'memory' | 'session' | 'notebook';

// 记忆 chunk（索引单元）
export interface MemoryChunk {
  id: string;
  path: string;
  source: MemorySource;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
  createdAt: number;      // 毫秒时间戳
  updatedAt: number;
}

// 链接记忆条目（已被测试用例定义）
export interface MemoryLink {
  id: string;
  timestamp: string;
  conversationId?: string;
  sessionId?: string;
  files: string[];
  symbols: string[];
  commits: string[];
  topics: string[];
  description: string;
  importance: MemoryImportance;
  relatedLinks: string[];
}
```

### 步骤 2: bm25-engine.ts — BM25 搜索引擎
**文件**: `src/memory/bm25-engine.ts`（新建）

核心功能（对齐测试用例）：
- `tokenize(text)` — 中英文混合分词，单字 + 2-gram + 停用词过滤
- `BM25Engine` 类：
  - `addDocument({ id, text, fields? })` — 添加文档，支持多字段
  - `removeDocument(id)` — 移除文档
  - `search(query)` — 返回 `{ id, score, matchedTerms }[]`
  - `buildIndex()` — 构建/重建倒排索引
  - `clear()` — 清空
  - `exportIndex() / importIndex()` — 序列化/反序列化
  - `getStats()` — 统计信息
- `createBM25Engine({ k1, b })` — 工厂函数

**不用** `wink-bm25-text-search` 依赖，自研实现。原因：
1. wink 不支持中文分词
2. 自研可以精确控制分词策略和评分公式
3. 代码量不大（~300行），完全可控

### 步骤 3: long-term-store.ts — SQLite 长期存储
**文件**: `src/memory/long-term-store.ts`（新建）

```
SQLite Schema:
├── files (path, source, hash, mtime, size)
├── chunks (id, path, source, start_line, end_line, text, hash, created_at, updated_at)
├── chunks_fts (FTS5 虚拟表, 对 chunks.text 做全文索引)
└── meta (key, value) — 元数据
```

核心类 `LongTermStore`:
- `constructor(dbPath)` — 打开/创建 SQLite 数据库
- `indexFile(entry)` — 对单个文件分块并写入
- `removeFile(path)` — 删除文件的所有 chunk
- `search(query, opts)` — BM25 + FTS5 混合搜索，**带时间衰减**
- `getStats()` — 统计
- `close()` — 关闭数据库

**反污染措施在此层实现**：
1. 每个项目独立 SQLite 文件：`~/.claude/memory/projects/{hash}/ltm.sqlite`
2. 时间衰减公式：`finalScore = rawScore * decay(age)`，其中 `decay(age) = 1 / (1 + age/halfLife)`，halfLife = 30 天
3. 来源元数据：每条结果携带 path + startLine + endLine + createdAt
4. 高阈值：默认 minScore = 0.3（BM25 场景下已经相当严格）
5. 最大返回条数：默认 8 条

### 步骤 4: memory-sync.ts — 增量同步
**文件**: `src/memory/memory-sync.ts`（新建）

同步策略：
- **memory 文件**：扫描 `~/.claude/memory/projects/{hash}/` 下的所有 `.md` 文件，基于 hash 增量更新
- **session 文件**：扫描 `~/.claude/projects/{path}/*/session-memory/summary.md`，基于 mtime 增量更新
- **触发时机**：搜索前检查 dirty flag，dirty 则先同步（与 OpenClaw 一致但更简单）
- **不用 chokidar 实时监听**，避免额外开销。按需同步足够

### 步骤 5: memory-search.ts — 统一搜索接口
**文件**: `src/memory/memory-search.ts`（新建）

```typescript
export class MemorySearchManager {
  search(query: string, opts?: SearchOptions): MemorySearchResult[]
  sync(reason?: string): void
  status(): MemoryStoreStatus
}
```

协调 BM25Engine + LongTermStore，对外暴露简洁接口。

### 步骤 6: link-memory.ts — 关联记忆
**文件**: `src/memory/link-memory.ts`（新建）

对齐已有测试用例，基于 JSON 文件持久化：
- 多维索引：files, symbols, topics, conversationId, sessionId, importance, timeRange
- 双向关联管理
- 组合查询

存储：`~/.claude/memory/projects/{hash}/links.json`

### 步骤 7: MemorySearch 工具
**文件**: `src/tools/memory-search.ts`（新建）

```typescript
export class MemorySearchTool extends BaseTool {
  name = 'MemorySearch';
  description = '搜索长期记忆...';
  inputSchema = z.object({
    query: z.string(),           // 搜索关键词
    source: z.enum(['all', 'memory', 'session']).optional(),
    maxResults: z.number().optional(),
  });
  
  async execute(input) {
    // 1. 获取 MemorySearchManager 实例
    // 2. 按需同步
    // 3. 搜索并返回结果（含来源标注）
  }
}
```

### 步骤 8: 集成到 loop.ts 和 builder.ts
- `loop.ts`：初始化 MemorySearchManager，注册到 ToolRegistry
- `builder.ts`：在 system prompt 中添加长期记忆搜索指引
- `cli.ts`：退出时调用 sync 确保最新记忆已索引

## 五、防污染机制总结

| # | 措施 | 实现位置 | 说明 |
|---|------|---------|------|
| 1 | 项目隔离 | long-term-store.ts | 每项目独立 SQLite，零跨项目干扰 |
| 2 | 时间衰减 | long-term-store.ts | `1/(1+age/halfLife)`，30天半衰期 |
| 3 | 来源标注 | types.ts + 搜索结果 | path + line + timestamp，AI 自行判断 |
| 4 | 高阈值 | memory-search.ts | minScore ≥ 0.3，宁漏不错 |
| 5 | 限制条数 | memory-search.ts | 默认最多 8 条，避免噪声淹没 |
| 6 | 笔记本优先 | 架构层面 | 笔记本全量注入不变，向量检索只是补充 |
| 7 | 精确匹配优先 | bm25-engine.ts | BM25 关键词匹配比向量余弦相似度更精确 |

## 六、执行顺序

1. `types.ts` — 基础类型（其余所有模块依赖）
2. `bm25-engine.ts` — 搜索引擎（已有测试，可立即验证）
3. `link-memory.ts` — 关联记忆（已有测试，可立即验证）
4. `long-term-store.ts` — SQLite 存储层
5. `memory-sync.ts` — 增量同步
6. `memory-search.ts` — 统一搜索接口
7. `src/tools/memory-search.ts` — AI 工具
8. 集成（loop.ts, builder.ts, cli.ts）

前三步已有完整测试用例，实现后立即跑测试验证。后续步骤需要补充测试。
