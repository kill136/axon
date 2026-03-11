# 指令墙功能实现计划

## 需求
- 欢迎页新增"指令墙"，替换现有的建议列表（"当前状态"、"我能帮你"等区域）
- 三个分组 Tab：**上班族**（默认）、**学生族**、**程序员**
- 每个 Tab 内部是多行跑马灯横向无限滚动的指令标签
- 不同行速度/方向可以不同，营造动态感
- 点击任一标签直接发送对应指令

## 修改文件

### 1. `src/web/client/src/components/WelcomeScreen.tsx`
- 新增 `CommandWall` 子组件
- 定义三组指令数据（上班族、学生族、程序员）
- Tab 切换逻辑 + 跑马灯渲染
- 替换现有 suggestions/capabilities/frequentTasks 区域

### 2. `src/web/client/src/styles/index.css`
- 新增 `.command-wall-*` 系列样式
- Tab 样式、跑马灯动画（CSS @keyframes scroll-left / scroll-right）
- 标签 pill 样式

### 3. `src/web/client/src/i18n/locales/en/chat.ts` + `zh/chat.ts`
- 新增 Tab 名称翻译 key

## 指令内容设计

### 上班族（Office Worker）
- 写周报、写日报、写会议纪要、写邮件回复、做 PPT 大纲、Excel 数据分析
- 写工作总结、写述职报告、写项目方案、翻译文档、整理会议记录
- 写请假条、写加班申请、分析竞品、写需求文档、做 SWOT 分析
- 写OKR、做数据报表、写培训材料、写通知公告、润色文案

### 学生族（Student）
- 写论文大纲、改论文语法、翻译英文文献、解数学题、写读书笔记
- 做课程笔记、写实验报告、准备考试重点、写个人陈述、分析案例
- 写演讲稿、做思维导图、学英语语法、写简历、准备面试
- 解编程作业、写课程总结、做文献综述、写开题报告、学术润色

### 程序员（Developer）— 沿用现有
- 帮我理解这个项目、帮我调试问题、重构代码、运行并修复测试
- 创建 React 组件、写单元测试、代码审查、分析项目架构
- 修复 Bug、添加新功能、解释代码、写 API 接口、优化性能
- 写技术文档、做数据库设计、配置 CI/CD、写 Docker 配置

## 跑马灯实现
- 每个 Tab 内分 3-4 行，每行一组指令
- CSS animation: `scroll-left` (向左) 和 `scroll-right` (向右) 交替
- 内容复制一份拼接实现无缝循环
- 不同行不同速度（20s / 25s / 30s）
- hover 暂停动画
