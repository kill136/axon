# 输入框重设计提案

这版不是纯视觉稿，而是基于现有 [`src/web/client/src/components/InputArea.tsx`](F:/claude-code-open/src/web/client/src/components/InputArea.tsx) 的真实能力，做一轮信息层级收敛。

## 目标

- 把输入区从“多段面板 + 常驻控制条”改成“一块主输入面 + 一个轻量底栏”。
- 让用户第一眼只看到输入、附件、发送，不被调试和状态信息打断。
- 保留现有核心能力，不做功能删减，只重排优先级。

## 首层保留

- 附件入口
- 模型选择
- 思考强度
- 模式预设
- 语音入口
- 发送 / 停止

## 下沉到更多抽屉

- 新对话
- 锁定输入框
- Debug Probe
- Logs
- Git
- Terminal
- Transcript 切换
- Context / API 额度的详细信息

## 关键判断

- 当前组件的主要负担不是功能太多，而是这些功能几乎都在首层常驻。
- Codex 风格里最值得借鉴的不是“白色卡片”，而是“输入区只有一个主视觉重心”。
- AXON 当前是深色主界面，真正实现时可以沿用深色 token，但结构建议先按这张稿子收敛。

## 风险与取舍

- 把次级控制收进抽屉后，老用户会多一步点击。
- 这个代价是值得的，因为现在的新用户成本更高，而且主输入区确实被切得过碎。
- 如果后续验证发现某个按钮使用频率极高，可以再从抽屉里拉回首层，但必须用真实使用场景证明。

## 落地建议

- 第一步只改布局层级和样式，不改消息发送逻辑。
- 第二步再处理抽屉开合、状态摘要压缩、移动端布局。
- 第三步补齐 [`src/web/client/src/components/__tests__/InputArea.test.tsx`](F:/claude-code-open/src/web/client/src/components/__tests__/InputArea.test.tsx) 的结构与交互测试。
