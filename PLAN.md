# Git 面板升级计划：对齐 IDEA Git Panel

## 目标
将现有的右侧抽屉式 Git 面板升级为 IDEA 风格的三栏 Git 面板，核心是添加 **Commit Graph 可视化**。

## 现状分析

### 当前面板
- **布局**：右侧固定 500px 抽屉，Tab 切换（status/log/branches/stash/tags/remotes）
- **Log 视图**：纯文本列表，每个 commit 显示 hash + message + author + time
- **分支视图**：扁平列表，本地/远程分组
- **数据模型**：GitCommit 只有 `hash, shortHash, author, date, message`，缺少 `parents` 和 `refs`

### IDEA 面板核心特征
1. **三栏布局**：左侧分支树 | 中间 Commit Graph + Commit 列表 | 右侧 Commit 详情
2. **Commit Graph**：SVG 线图，彩色区分分支，合并/分叉清晰可见
3. **Ref 标签**：commit 旁显示 branch/tag 标签（彩色小标签）
4. **顶部筛选栏**：按分支/用户/日期快速筛选

## 实施方案

### Phase 1：后端数据增强

**文件：`src/web/server/git-manager.ts`**

1. 扩展 `GitCommit` 接口，添加 graph 所需字段：
```typescript
export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  parents: string[];    // 父 commit hash 列表（用于画线）
  refs: string[];       // 指向此 commit 的 ref（如 "HEAD -> main", "origin/main", "tag: v1.0"）
}
```

2. 修改 `getLog()` 方法，使用 `--parents --decorate=short` 获取额外数据：
```
git log -N --format="%H|%P|%h|%an|%ai|%s|%D" --parents
```
其中 `%P` = parent hashes，`%D` = ref names

3. 同步修改 `searchCommits()` 方法

### Phase 2：前端 - Commit Graph 算法

**新文件：`src/web/client/src/components/GitPanel/graph-utils.ts`**

实现 commit graph 布局算法：
- 输入：按时间排序的 commits（含 parents）
- 输出：每个 commit 的列号（lane）和连线信息
- 算法：标准的 lane assignment
  - 维护活跃 lane 列表
  - 新 commit 分配到其第一个 parent 所在 lane
  - 合并 commit 产生交叉线
  - 分支分叉产生新 lane

### Phase 3：前端 - 全新布局

**改造：`src/web/client/src/components/GitPanel/index.tsx`**

从抽屉式改为独立页面式（或者大面板），采用三栏布局：

```
+-------------------+------------------------------------------+-------------------+
|   Branch Tree     |  Graph Column | Commit List              | Commit Detail     |
|                   |  (SVG lines)  | (message, author, date)  | (files, diff)     |
|   ▼ Local         |  ●──●         | fix: stripe lifetime...  |                   |
|     main          |  │  ●──●      | info: 添加升级检查...      |                   |
|     dev           |  ●  │         | fix: replicate 未填充...   |                   |
|   ▼ Remote        |  │  ●         | Merge branch 'feat/...'  |                   |
|     origin/main   |  ●──┤         | 开启阿里滤网             |                   |
+-------------------+------------------------------------------+-------------------+
```

布局方案：
- **左侧栏** (200px)：分支树（树形层级结构，本地/远程/feature 分组）
- **中间主区** (flex-1)：Graph + Commit 列表（水平排列）
  - Graph 列 (80-150px)：SVG 画布渲染分支线
  - Commit 列 (flex-1)：消息 + ref 标签 + 作者 + 日期
- **右侧栏** (300px, 可选)：选中 commit 的详情（文件列表 + diff）

### Phase 4：前端 - Graph SVG 渲染

**新文件：`src/web/client/src/components/GitPanel/CommitGraph.tsx`**

- 每行高度固定（32px），与 commit 列表同步滚动
- SVG 渲染：
  - 圆点 (●) 表示 commit，颜色按 lane 分配
  - 竖线 (│) 表示同一分支的连续 commit
  - 斜线 (╱╲) 表示合并/分叉
  - 颜色调色板：使用 7-8 种高对比色，循环分配给不同 lane

### Phase 5：前端 - Ref 标签

在 commit 消息旁显示 ref 标签：
- branch ref → 带颜色背景的小标签（如 `main`、`origin/dev`）
- tag ref → 不同颜色的标签
- HEAD 指针 → 特殊高亮

### Phase 6：前端 - 分支树组件

**改造：`src/web/client/src/components/GitPanel/BranchesView.tsx`**

从扁平列表改为树形：
```
▼ Local
  ● main (HEAD)
  ▸ feature/
    ○ feature/login
    ○ feature/payment
  ○ dev
▼ Remote
  ▸ origin/
    ○ main
    ○ dev
```
- 支持折叠/展开
- 点击分支 → 筛选 log 只显示该分支
- 双击 → checkout

### Phase 7：顶部筛选栏

在 commit 列表上方添加筛选工具栏：
- 分支下拉选择（多选）
- 作者下拉选择
- 日期范围选择
- 搜索框（commit message 模糊搜索）

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/web/server/git-manager.ts` | 修改 | `GitCommit` 加 parents/refs，`getLog()` 改 format |
| `src/web/server/websocket-git-handlers.ts` | 修改 | `handleGitGetLog` 传递新字段 |
| `src/web/client/src/components/GitPanel/index.tsx` | 重构 | 三栏布局 |
| `src/web/client/src/components/GitPanel/graph-utils.ts` | 新建 | Graph 布局算法 |
| `src/web/client/src/components/GitPanel/CommitGraph.tsx` | 新建 | Graph SVG 渲染组件 |
| `src/web/client/src/components/GitPanel/LogView.tsx` | 重构 | 集成 Graph，添加 ref 标签 |
| `src/web/client/src/components/GitPanel/BranchesView.tsx` | 重构 | 树形分支显示 |
| `src/web/client/src/components/GitPanel/GitPanel.css` | 大改 | 新布局样式 |
| `src/web/client/src/components/GitPanel/CommitDetail.tsx` | 新建 | 右侧 commit 详情面板 |

## 技术要点

1. **Graph 算法**：不依赖第三方库，自研 lane assignment 算法（~200 行）
2. **SVG 渲染**：纯 SVG path，不用 canvas（方便交互和样式）
3. **同步滚动**：Graph SVG 和 Commit 列表共用 scroll container
4. **性能**：只渲染可视区域的 commits（虚拟滚动，如果 commit 数量 > 200）
5. **Windows 兼容**：git format 中 `%` 在 cmd.exe 需要转义，用 `execFileSync` 或 `%%`

## 风险与注意

- Windows 下 `git log --format="%P"` 中的 `%` 可能被 cmd.exe 吃掉 → 现有代码已经用双引号包裹，需要测试
- Graph 算法复杂度需控制在 O(n) 级别（n = commit 数量）
- 虚拟滚动暂不实现，先用简单 overflow scroll，commit 数量限制 200 条
