---
name: promote
description: 多平台社交媒体推广 Axon 项目。在 Twitter/X、Reddit、掘金、V2EX、Discord、Hacker News 等平台发布推广内容。Use this skill whenever the user mentions 推广、发帖、社交媒体、Twitter、Reddit、掘金、宣传、营销、social media、post、promote，even if they just say "发一下推特" or "去推广"。
disable-model-invocation: true
argument-hint: [平台名，如 twitter/reddit/juejin/all]
---

# 多平台社交推广

## 支持的平台

| 平台 | 文案路径 | 语言 | 账号 |
|------|---------|------|------|
| Twitter/X | `docs/marketing/twitter.md` | English | @wangbingjie1989 |
| Reddit | `docs/marketing/reddit.md` | English | — |
| 掘金 | `docs/marketing/juejin.md` | 中文 | — |
| V2EX | `docs/marketing/v2ex.md` | 中文 | — |
| Discord | `docs/marketing/discord.md` | English | — |
| Hacker News | `docs/marketing/hacker-news.md` | English | — |
| Product Hunt | `docs/marketing/product-hunt-launch.md` | English | — |

## 流程

### Step 1: 确定推广内容
1. 读取最近的 git log / changelog，提取最新功能亮点
2. 读取对应平台的文案模板（`docs/marketing/<platform>.md`）
3. 根据最新功能更新文案内容
4. 让用户确认文案

### Step 2: 发布到目标平台
- 使用 Browser 工具登录目标平台
- 粘贴/输入文案内容
- 添加标签、分类（如需要）
- 截图确认后发布

### Step 3: 记录结果
- 保存发布链接
- 截图留档
- 更新 Goal 的 metrics（社交媒体帖子发布数）

## 平台特殊规则

### Twitter/X
- 线程模式：主帖 + 回复链
- 首帖要有 hook（吸引点击）
- 可以附加 GIF/截图
- 标签：#AIcoding #OpenSource #DevTools

### Reddit
- **养号策略**：新号不要直接发项目，先在相关社区评论互动
- 每次只发 2-3 条评论，间隔 5 分钟以上
- 目标 subreddits: r/LocalLLaMA, r/ChatGPTCoding, r/SelfHosted
- 发帖选择合适的 flair

### 掘金
- 需要完整的技术文章，不是简短广告
- 添加分类标签（前端、AI、开源）
- 参考 `docs/juejin-article-2026-03-01.md` 的写作风格

### V2EX
- 发到 /t/programmer 或 /t/share 节点
- 避免过度营销语气
- 强调技术实现

### Discord
- 目标服务器：AI/Dev 相关
- 在合适的频道发布（#show-and-tell, #projects）

### Hacker News
- Show HN 格式
- 标题简洁，突出技术差异点
- 准备好回答社区提问

## 风险控制
- Reddit 新号容易被 spam filter，发帖前确认 karma 够用
- 不要在短时间内跨多个平台发完全相同的内容
- 每个平台的语气和深度要有差异
