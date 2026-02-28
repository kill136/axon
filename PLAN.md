# 代码引用点击跳转到编辑器

## 需求
AI 回复的 Markdown 中包含 `filename.ext:lineNumber` 或 `filename.ext:startLine-endLine` 格式的代码引用（如 `OrderApplicationService.java:107`），点击后应跳转到 CodeView 编辑器中打开对应文件并定位到指定行。

## 实现方案

### 整体思路
1. MarkdownContent 的 `codespan` renderer 检测代码引用模式，渲染为可点击的 `<span>` 元素
2. 使用事件委托（MarkdownContent 的 div 容器上监听 click）捕获点击
3. 点击后通过回调链通知 Root 切换到 CodeView 并打开文件+跳转行号

### 文件改动清单

#### 1. `src/web/client/src/components/MarkdownContent.tsx`
- 在 `codespan` renderer 中增加代码引用检测逻辑
  - 正则：`/^(.+\.\w+):(\d+)(?:-(\d+))?$/`
  - 匹配的内容渲染为带有 `data-code-ref`、`data-file-path`、`data-line` 属性的 `<code>` 元素
  - 添加 CSS 类 `code-ref-link` 使其看起来可点击
- 新增 `onCodeRefClick` 可选 prop
- 在 `useEffect` 中为 `ref.current` 添加事件委托监听：点击 `.code-ref-link` 时解析 data 属性并调用 `onCodeRefClick`

#### 2. `src/web/client/src/components/Message.tsx`
- 把 `onNavigateToCode` 回调转化后传递给 `MarkdownContent` 的 `onCodeRefClick`
- 当 `onCodeRefClick(filePath, line)` 被调用时，调用 `onNavigateToCode({ filePath, line })`

#### 3. `src/web/client/src/Root.tsx`
- `navigateToCodePage` 支持接收 `context?: { filePath?: string; line?: number }` 参数
- 增加 state `pendingCodeRef` 存储待打开的文件引用
- 传给 App 的 prop 增加 `pendingCodeRef`，App 在 CodeView 激活后消费它

#### 4. `src/web/client/src/App.tsx`
- 接收 `pendingCodeRef` prop
- 当 `codeViewActive` 变为 `true` 且存在 `pendingCodeRef` 时，通过 CodeView 的 ref 打开文件并跳转行号
- CodeView 需要暴露一个 `openFileAtLine(filePath, line)` 方法

#### 5. `src/web/client/src/components/CodeView/index.tsx`
- 新增 `openFileAtLine(filePath: string, line?: number)` 方法通过 ref 暴露
- 内部先调用 `codeEditorRef.current.openFile(filePath)`，然后延迟调用 `goToLine(line)`

#### 6. `src/web/client/src/styles/index.css`
- 添加 `.code-ref-link` 样式：可点击外观（cursor: pointer, 下划线, hover 高亮）

#### 7. `src/web/client/src/utils/sanitize.ts`
- `sanitizeHtml` 中增加 `data-code-ref`、`data-file-path`、`data-line` 到 `ADD_ATTR`

### 数据流

```
用户点击 code-ref-link
  → MarkdownContent onClick 事件委托
  → onCodeRefClick(filePath, line) 
  → Message.onNavigateToCode({ filePath, line })
  → App.onNavigateToCode({ filePath, line })
  → Root.navigateToCodePage({ filePath, line })
  → setCodeViewActive(true) + setPendingCodeRef({ filePath, line })
  → App 检测 pendingCodeRef 变化 → codeViewRef.openFileAtLine(filePath, line)
  → CodeView → codeEditorRef.openFile(filePath) + goToLine(line)
```

### 简化方案（推荐）

上面的 `pendingCodeRef` 状态传递链较长。更简洁的方案：

**在 App 中给 CodeView 加 ref，当 `onNavigateToCode` 被调用时：**
1. `onToggleCodeView()` 激活 CodeView
2. 用 `setTimeout` 等待 CodeView 渲染后，直接通过 CodeView ref 调用 `openFileAtLine`

**但这不安全**（setTimeout timing 不可靠）。所以还是用 state + useEffect 方案。

进一步简化：不需要在 Root 层面存储 pendingCodeRef。可以直接在 App 层面处理：
- App 收到 `onNavigateToCode({ filePath, line })` 后，调用 `onToggleCodeView()` 激活 CodeView
- App 自身维护 `pendingCodeRef` state
- App 内的 `useEffect` 监测 `codeViewActive && pendingCodeRef` 时消费它

这样改动更少，只需在 App 内部处理。

### 最终精简的改动清单

| 文件 | 改动 |
|------|------|
| `MarkdownContent.tsx` | 新增 `onCodeRefClick` prop + codespan 检测 + 事件委托 |
| `Message.tsx` | 传递 `onCodeRefClick` 到 MarkdownContent |
| `App.tsx` | 改写 `onNavigateToCode` 处理逻辑，增加 `pendingCodeRef` state |
| `CodeView/index.tsx` | forwardRef + `openFileAtLine` 方法 |
| `sanitize.ts` | ADD_ATTR 增加 data 属性 |
| `index.css` | 新增 `.code-ref-link` 样式 |

共 6 个文件改动，无新增文件。
