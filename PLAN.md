# "作品" Tab 改造计划：作品管理 + 产物日志

## 需求

将"产物" tab 改为真正的"作品"概念：
1. **作品** — 用户主动创建的项目（如贪吃蛇游戏、落地页），可预览、可编辑
2. **产物日志** — 当前已有的文件操作历史，作为辅助信息保留

## 设计

### 页面结构

```
┌─ 作品 Tab ──────────────────────────────────────────────┐
│                                                          │
│  [+ 创建作品]           搜索...        [卡片] [列表]      │
│                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │
│  │ 🐍      │  │ 🌐      │  │ 📊      │                  │
│  │ 贪吃蛇   │  │ 落地页   │  │ 数据面板 │                  │
│  │ 游戏     │  │         │  │         │                  │
│  │ 3个文件  │  │ 1个文件  │  │ 2个文件  │                  │
│  │ 今天     │  │ 昨天     │  │ 3月12日  │                  │
│  │ [预览]   │  │ [预览]   │  │ [编辑]   │                  │
│  └─────────┘  └─────────┘  └─────────┘                  │
│                                                          │
│  ── 最近变更 ──────────────────────────────────────────  │
│  ▸ 你看截图，报错怎么是英文的  12个文件 · 27次操作  17:01  │
│  ▸ 你看截图，这里的渲染...     3个文件 · 6次操作   16:37  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 数据模型

```typescript
interface Work {
  id: string;                    // UUID
  name: string;                  // 用户起的名称
  description?: string;          // 可选描述
  icon?: string;                 // emoji 图标
  files: string[];               // 关联的文件路径（相对路径）
  entryFile?: string;            // 主入口文件（用于预览，如 index.html）
  createdAt: number;
  updatedAt: number;
  sessionIds?: string[];         // 关联的会话（可选，自动记录）
}
```

### 存储

- **路径**: `~/.axon/works.json` — 简单 JSON 文件，存放所有 Work 定义
- 不用 SQLite，因为数据量小（几十个作品）且结构简单

### 后端 API

新建 `src/web/server/routes/works-api.ts`:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/works` | 列出所有作品 |
| POST | `/api/works` | 创建作品 |
| PUT | `/api/works/:id` | 更新作品（名称、描述、文件列表） |
| DELETE | `/api/works/:id` | 删除作品 |

保留现有 `artifacts-api.ts`（产物日志），不改动。

### 前端组件

重写 `AppsPage/index.tsx`，分两个区域：

**上半部分：作品卡片区**
- 卡片网格布局，每个卡片显示：图标、名称、文件数、更新时间
- 卡片操作：预览（如果有 entryFile）、编辑（跳转到对话发指令）、删除
- "+ 创建作品" 按钮 → 弹窗：填名称、选文件、选图标
- 点击卡片 → 展开详情（文件列表 + 操作按钮）

**下半部分：最近变更（产物日志）**
- 复用当前已有的按会话分组视图
- 折叠区域，标题"最近变更"，默认展开
- 数据来自现有 `/api/artifacts`

### 预览能力

- HTML 文件：已有 `/api/files/preview?path=` + iframe sandbox 预览
- 其他文件：跳转到文件 tab 直接查看
- 未来可扩展：Markdown 渲染、图片预览等

### 创建作品的交互流程

1. 用户点击 "+ 创建作品"
2. 弹窗：输入名称，可选描述
3. 选择文件：显示当前项目文件树，勾选相关文件
4. 选择图标：从常用 emoji 中选或输入
5. 可选：指定入口文件（用于预览）
6. 保存 → 卡片出现在列表中

或者更简单：用户在聊天中让 AI 创建了文件后，在聊天界面弹出"保存为作品？"的提示。

### Nav 标签名

- 改回"作品" — `nav.apps` = "作品" / "Works"
- Tab 内部小标题：上方"我的作品"，下方"最近变更"

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/web/server/routes/works-api.ts` | 新建 | 作品 CRUD API |
| `src/web/server/routes/__tests__/works-api.test.ts` | 新建 | API 测试 |
| `src/web/server/index.ts` | 编辑 | 注册 works-api 路由 |
| `src/web/client/src/pages/AppsPage/index.tsx` | 重写 | 作品卡片 + 产物日志双区域 |
| `src/web/client/src/pages/AppsPage/AppsPage.css` | 重写 | 新的卡片布局样式 |
| `src/web/client/src/pages/AppsPage/CreateWorkDialog.tsx` | 新建 | 创建作品弹窗组件 |
| `src/web/client/src/i18n/locales/en/apps.ts` | 编辑 | 新增 works 相关翻译 |
| `src/web/client/src/i18n/locales/zh/apps.ts` | 编辑 | 新增 works 相关翻译 |
| `src/web/client/src/i18n/locales/en/nav.ts` | 编辑 | nav.apps → 'Works' |
| `src/web/client/src/i18n/locales/zh/nav.ts` | 编辑 | nav.apps → '作品' |

## 执行顺序

1. 后端 works-api.ts + 测试
2. 前端 CreateWorkDialog 组件
3. 前端 AppsPage 重写（上方作品卡片 + 下方产物日志）
4. i18n 更新
5. 注册路由、构建、验证
