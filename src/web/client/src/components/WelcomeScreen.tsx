import { useState, useRef, useEffect } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useLanguage } from '../i18n';

interface WelcomeScreenProps {
  onBlueprintCreated?: (blueprintId: string) => void;
  onQuickPrompt?: (prompt: string) => void;
  onOpenFolder?: () => void;
}

interface QuickTemplate {
  icon: string;
  labelKey: string;
  promptKey: string;
}

interface CommandItem {
  icon: string;
  label: string;
  labelEn: string;
  prompt: string;
  promptEn: string;
}

type TabId = 'office' | 'student' | 'developer';

interface TabDef {
  id: TabId;
  labelKey: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: 'office', labelKey: 'welcome.tab.office', icon: '💼' },
  { id: 'student', labelKey: 'welcome.tab.student', icon: '🎓' },
  { id: 'developer', labelKey: 'welcome.tab.developer', icon: '💻' },
];

const COMMAND_DATA: Record<TabId, CommandItem[][]> = {
  office: [
    [
      { icon: '📝', label: '写周报', labelEn: 'Weekly Report', prompt: '帮我写一份本周的工作周报，包含本周完成的工作、遇到的问题和下周计划', promptEn: 'Help me write a weekly work report including completed tasks, issues encountered, and next week\'s plan' },
      { icon: '📋', label: '写日报', labelEn: 'Daily Report', prompt: '帮我写一份今天的工作日报', promptEn: 'Help me write a daily work report for today' },
      { icon: '🎤', label: '写会议纪要', labelEn: 'Meeting Minutes', prompt: '帮我整理一份会议纪要，我来告诉你会议的主要内容', promptEn: 'Help me organize meeting minutes, I\'ll tell you the main content' },
      { icon: '✉️', label: '写邮件回复', labelEn: 'Email Reply', prompt: '帮我写一封专业的工作邮件回复', promptEn: 'Help me write a professional work email reply' },
      { icon: '📊', label: '做 PPT 大纲', labelEn: 'PPT Outline', prompt: '帮我做一份 PPT 演示文稿的大纲', promptEn: 'Help me create a PPT presentation outline' },
      { icon: '📈', label: 'Excel 数据分析', labelEn: 'Excel Analysis', prompt: '帮我分析 Excel 数据并给出洞察', promptEn: 'Help me analyze Excel data and provide insights' },
      { icon: '🏆', label: '写工作总结', labelEn: 'Work Summary', prompt: '帮我写一份工作总结', promptEn: 'Help me write a work summary' },
    ],
    [
      { icon: '🎯', label: '写述职报告', labelEn: 'Performance Review', prompt: '帮我写一份述职报告，展示我的工作成果和贡献', promptEn: 'Help me write a performance review report showcasing my achievements' },
      { icon: '📑', label: '写项目方案', labelEn: 'Project Proposal', prompt: '帮我写一份项目方案书', promptEn: 'Help me write a project proposal' },
      { icon: '🌐', label: '翻译文档', labelEn: 'Translate Doc', prompt: '帮我翻译一份文档', promptEn: 'Help me translate a document' },
      { icon: '📒', label: '整理会议记录', labelEn: 'Organize Notes', prompt: '帮我整理散乱的会议记录，提取关键信息和行动项', promptEn: 'Help me organize scattered meeting notes, extract key info and action items' },
      { icon: '🔍', label: '分析竞品', labelEn: 'Competitor Analysis', prompt: '帮我做一份竞品分析报告', promptEn: 'Help me create a competitor analysis report' },
      { icon: '📄', label: '写需求文档', labelEn: 'Requirements Doc', prompt: '帮我写一份产品需求文档', promptEn: 'Help me write a product requirements document' },
      { icon: '📐', label: '做 SWOT 分析', labelEn: 'SWOT Analysis', prompt: '帮我做一份 SWOT 分析', promptEn: 'Help me create a SWOT analysis' },
    ],
    [
      { icon: '🎯', label: '写 OKR', labelEn: 'Write OKR', prompt: '帮我制定本季度的 OKR 目标', promptEn: 'Help me set OKR goals for this quarter' },
      { icon: '📊', label: '做数据报表', labelEn: 'Data Report', prompt: '帮我制作一份数据分析报表', promptEn: 'Help me create a data analysis report' },
      { icon: '📚', label: '写培训材料', labelEn: 'Training Material', prompt: '帮我写一份培训材料', promptEn: 'Help me write training materials' },
      { icon: '📢', label: '写通知公告', labelEn: 'Announcement', prompt: '帮我写一份通知公告', promptEn: 'Help me write an announcement' },
      { icon: '✨', label: '润色文案', labelEn: 'Polish Copy', prompt: '帮我润色一段文案，使其更加专业和有说服力', promptEn: 'Help me polish a piece of copy to make it more professional and persuasive' },
      { icon: '📧', label: '写请假条', labelEn: 'Leave Request', prompt: '帮我写一份请假申请', promptEn: 'Help me write a leave request' },
      { icon: '⏰', label: '写加班申请', labelEn: 'Overtime Request', prompt: '帮我写一份加班申请', promptEn: 'Help me write an overtime request' },
    ],
  ],
  student: [
    [
      { icon: '📝', label: '写论文大纲', labelEn: 'Thesis Outline', prompt: '帮我写一份论文大纲，我来告诉你论文主题', promptEn: 'Help me write a thesis outline, I\'ll tell you the topic' },
      { icon: '✏️', label: '改论文语法', labelEn: 'Grammar Check', prompt: '帮我检查和修改论文的语法错误', promptEn: 'Help me check and fix grammar errors in my paper' },
      { icon: '🌐', label: '翻译英文文献', labelEn: 'Translate Paper', prompt: '帮我翻译一篇英文学术文献', promptEn: 'Help me translate an English academic paper' },
      { icon: '🔢', label: '解数学题', labelEn: 'Solve Math', prompt: '帮我解一道数学题，我来告诉你题目', promptEn: 'Help me solve a math problem, I\'ll give you the question' },
      { icon: '📖', label: '写读书笔记', labelEn: 'Reading Notes', prompt: '帮我写一份读书笔记', promptEn: 'Help me write reading notes' },
      { icon: '📋', label: '做课程笔记', labelEn: 'Course Notes', prompt: '帮我整理课程笔记，提取重点知识', promptEn: 'Help me organize course notes and extract key knowledge' },
      { icon: '🧪', label: '写实验报告', labelEn: 'Lab Report', prompt: '帮我写一份实验报告', promptEn: 'Help me write a lab report' },
    ],
    [
      { icon: '📚', label: '准备考试重点', labelEn: 'Exam Prep', prompt: '帮我整理考试重点和复习提纲', promptEn: 'Help me organize exam key points and review outline' },
      { icon: '💌', label: '写个人陈述', labelEn: 'Personal Statement', prompt: '帮我写一份留学/升学的个人陈述', promptEn: 'Help me write a personal statement for school application' },
      { icon: '📊', label: '分析案例', labelEn: 'Case Analysis', prompt: '帮我分析一个案例，我来描述案例内容', promptEn: 'Help me analyze a case, I\'ll describe the content' },
      { icon: '🎤', label: '写演讲稿', labelEn: 'Speech Draft', prompt: '帮我写一份演讲稿', promptEn: 'Help me write a speech draft' },
      { icon: '🧠', label: '做思维导图', labelEn: 'Mind Map', prompt: '帮我做一份思维导图的文字版大纲', promptEn: 'Help me create a text-based mind map outline' },
      { icon: '🗣️', label: '学英语语法', labelEn: 'English Grammar', prompt: '帮我讲解一个英语语法知识点', promptEn: 'Help me explain an English grammar concept' },
      { icon: '📄', label: '写简历', labelEn: 'Resume', prompt: '帮我写一份求职/实习简历', promptEn: 'Help me write a resume for job/internship' },
    ],
    [
      { icon: '🎯', label: '准备面试', labelEn: 'Interview Prep', prompt: '帮我准备面试，模拟面试官提问', promptEn: 'Help me prepare for an interview with mock questions' },
      { icon: '💻', label: '解编程作业', labelEn: 'Coding Homework', prompt: '帮我解一道编程作业题', promptEn: 'Help me solve a coding homework problem' },
      { icon: '📝', label: '写课程总结', labelEn: 'Course Summary', prompt: '帮我写一份课程学习总结', promptEn: 'Help me write a course learning summary' },
      { icon: '📚', label: '做文献综述', labelEn: 'Literature Review', prompt: '帮我做一份文献综述', promptEn: 'Help me create a literature review' },
      { icon: '📋', label: '写开题报告', labelEn: 'Proposal Report', prompt: '帮我写一份毕业论文的开题报告', promptEn: 'Help me write a thesis proposal report' },
      { icon: '✨', label: '学术润色', labelEn: 'Academic Polish', prompt: '帮我润色一段学术论文，使其更加学术规范', promptEn: 'Help me polish an academic paper to meet academic standards' },
      { icon: '🔬', label: '解释概念', labelEn: 'Explain Concept', prompt: '帮我用通俗易懂的方式解释一个学术概念', promptEn: 'Help me explain an academic concept in simple terms' },
    ],
  ],
  developer: [
    [
      { icon: '🔍', label: '帮我理解这个项目', labelEn: 'Understand Project', prompt: '帮我理解这个项目的工作原理——架构、关键文件、以及各部分是怎么连接的。', promptEn: 'Help me understand how this project works — the architecture, key files, and how everything connects.' },
      { icon: '🐛', label: '帮我调试问题', labelEn: 'Debug Issue', prompt: '有些东西不对劲。检查最近的改动、错误日志和测试结果，找出问题。', promptEn: 'Something is not working right. Check recent changes, error logs, and test results to find what went wrong.' },
      { icon: '🔄', label: '重构代码', labelEn: 'Refactor Code', prompt: '找出可以重构的地方，提升代码质量和可维护性。', promptEn: 'Suggest refactoring opportunities to improve code quality and maintainability.' },
      { icon: '🧪', label: '运行并修复测试', labelEn: 'Fix Tests', prompt: '运行测试，找出失败的测试并修复它们。', promptEn: 'Run tests, find failing tests and fix them.' },
      { icon: '⚛️', label: '创建 React 组件', labelEn: 'React Component', prompt: '帮我创建一个 React 组件', promptEn: 'Help me create a React component' },
      { icon: '📝', label: '写单元测试', labelEn: 'Unit Tests', prompt: '分析项目，为需要测试覆盖的关键模块编写单元测试。', promptEn: 'Analyze the project and write unit tests for the key modules that need coverage.' },
    ],
    [
      { icon: '👀', label: '代码审查', labelEn: 'Code Review', prompt: '审查最近的代码改动，检查质量、正确性和潜在问题。', promptEn: 'Review recent code changes for quality, correctness, and potential issues.' },
      { icon: '🏗️', label: '分析项目架构', labelEn: 'Analyze Architecture', prompt: '分析这个项目的结构和架构，识别关键模块和依赖关系。', promptEn: 'Analyze the structure and architecture of this project, identify key modules and dependencies.' },
      { icon: '🐞', label: '修复 Bug', labelEn: 'Fix Bug', prompt: '帮我查找和修复代码中的 Bug，应该从哪里开始？', promptEn: 'Help me find and fix bugs in the codebase. Where should I start?' },
      { icon: '✨', label: '添加新功能', labelEn: 'Add Feature', prompt: '我想给这个项目加一个新功能。帮我规划和实现。', promptEn: 'I want to add a new feature to this project. Help me plan and implement it.' },
      { icon: '💡', label: '解释代码', labelEn: 'Explain Code', prompt: '解释这个项目的工作原理，包括主要入口和数据流。', promptEn: 'Explain how this project works, including the main entry points and data flow.' },
      { icon: '🔌', label: '写 API 接口', labelEn: 'Write API', prompt: '帮我设计和实现 REST API 接口', promptEn: 'Help me design and implement REST API endpoints' },
    ],
    [
      { icon: '⚡', label: '优化性能', labelEn: 'Optimize Performance', prompt: '分析项目性能瓶颈并提出优化方案', promptEn: 'Analyze project performance bottlenecks and suggest optimizations' },
      { icon: '📖', label: '写技术文档', labelEn: 'Tech Docs', prompt: '帮我写技术文档，包括架构说明和 API 文档', promptEn: 'Help me write technical documentation including architecture and API docs' },
      { icon: '🗄️', label: '做数据库设计', labelEn: 'DB Design', prompt: '帮我设计数据库结构和表关系', promptEn: 'Help me design database structure and table relationships' },
      { icon: '🔧', label: '配置 CI/CD', labelEn: 'Setup CI/CD', prompt: '帮我配置 CI/CD 流水线', promptEn: 'Help me set up a CI/CD pipeline' },
      { icon: '🐳', label: '写 Docker 配置', labelEn: 'Dockerfile', prompt: '帮我写 Dockerfile 和 docker-compose 配置', promptEn: 'Help me write Dockerfile and docker-compose configuration' },
      { icon: '🔒', label: '安全审查', labelEn: 'Security Audit', prompt: '帮我审查代码中的安全隐患', promptEn: 'Help me audit security vulnerabilities in the code' },
    ],
  ],
};

function MarqueeRow({ items, direction, speed, onItemClick, isZh }: {
  items: CommandItem[];
  direction: 'left' | 'right';
  speed: number;
  onItemClick: (prompt: string) => void;
  isZh: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  return (
    <div className="cw-marquee-row" ref={rowRef}>
      <div
        className={`cw-marquee-track cw-marquee-${direction}`}
        style={{ animationDuration: `${speed}s` }}
      >
        {/* 渲染两份实现无缝循环 */}
        {[0, 1].map(copy => (
          <div className="cw-marquee-group" key={copy} aria-hidden={copy === 1}>
            {items.map((item, i) => (
              <button
                key={`${copy}-${i}`}
                className="cw-command-pill"
                onClick={() => onItemClick(isZh ? item.prompt : item.promptEn)}
                title={isZh ? item.prompt : item.promptEn}
              >
                <span className="cw-pill-icon">{item.icon}</span>
                <span className="cw-pill-label">{isZh ? item.label : item.labelEn}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandWall({ onItemClick, onClose, isZh, t }: {
  onItemClick: (prompt: string) => void;
  onClose: () => void;
  isZh: boolean;
  t: (key: string) => string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('office');
  const [paused, setPaused] = useState(false);
  const rows = COMMAND_DATA[activeTab];
  const speeds = [28, 35, 22];
  const directions: ('left' | 'right')[] = ['left', 'right', 'left'];

  // Tab 自动轮播：每 6 秒切换一次，hover 时暂停
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setActiveTab(prev => {
        const idx = TABS.findIndex(t => t.id === prev);
        return TABS[(idx + 1) % TABS.length].id;
      });
    }, 6000);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <div
      className="command-wall"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <button className="cw-close-btn" onClick={onClose} title={t('welcome.commandWall.close')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>
      <div className="cw-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`cw-tab ${activeTab === tab.id ? 'cw-tab-active' : ''}`}
            onClick={() => { setActiveTab(tab.id); setPaused(true); }}
          >
            <span className="cw-tab-icon">{tab.icon}</span>
            <span className="cw-tab-label">{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>
      <div className="cw-marquee-container" key={activeTab}>
        {rows.map((row, i) => (
          <MarqueeRow
            key={`${activeTab}-${i}`}
            items={row}
            direction={directions[i % directions.length]}
            speed={speeds[i % speeds.length]}
            onItemClick={onItemClick}
            isZh={isZh}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 空项目：直接说想做什么
 */
const EMPTY_TEMPLATES: QuickTemplate[] = [
  { icon: '🚀', labelKey: 'welcome.template.todoApp', promptKey: 'welcome.template.todoApp.prompt' },
  { icon: '🌐', labelKey: 'welcome.template.api', promptKey: 'welcome.template.api.prompt' },
  { icon: '📊', labelKey: 'welcome.template.dashboard', promptKey: 'welcome.template.dashboard.prompt' },
  { icon: '🤖', labelKey: 'welcome.template.cli', promptKey: 'welcome.template.cli.prompt' },
];

const COMMAND_WALL_DISMISSED_KEY = 'axon-command-wall-dismissed';

export function WelcomeScreen({ onBlueprintCreated: _onBlueprintCreated, onQuickPrompt, onOpenFolder }: WelcomeScreenProps) {
  const { state: projectState } = useProject();
  const { t, locale } = useLanguage();
  const isZh = locale === 'zh';
  const [commandWallDismissed, setCommandWallDismissed] = useState(() => {
    return localStorage.getItem(COMMAND_WALL_DISMISSED_KEY) === '1';
  });

  const hasProject = !!projectState.currentProject;
  const isEmptyProject = hasProject && projectState.currentProject?.isEmpty === true;
  const hasBlueprint = projectState.currentProject?.hasBlueprint === true;

  const handlePromptClick = (prompt: string) => {
    onQuickPrompt?.(prompt);
  };

  const handleCommandWallClose = () => {
    setCommandWallDismissed(true);
    localStorage.setItem(COMMAND_WALL_DISMISSED_KEY, '1');
  };

  return (
    <div className="welcome-screen">
      <img src="/logo.png" alt="Axon" className="welcome-logo" />
      <h2 className="welcome-title">Axon</h2>
      <span className="welcome-version">v{__APP_VERSION__}</span>

      {!hasProject ? (
        <>
          <p className="welcome-subtitle">
            {t('welcome.noProject.subtitle')}
          </p>

          <button className="welcome-open-folder-btn" onClick={onOpenFolder}>
            <span className="welcome-open-folder-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5.5A2.5 2.5 0 015.5 3h3.672a1.5 1.5 0 011.06.44L11.354 4.56a1.5 1.5 0 001.06.44H18.5A2.5 2.5 0 0121 7.5v10a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5v-12z" />
                <path d="M12 10v6M9 13h6" />
              </svg>
            </span>
            <span className="welcome-open-folder-text">{t('welcome.noProject.openFolder')}</span>
            <span className="welcome-open-folder-desc">{t('welcome.noProject.openFolderDesc')}</span>
          </button>

          <div className="welcome-hints">
            <div className="welcome-hint-item hint-item-1">
              <span className="hint-icon">📂</span>
              <span className="hint-text">{t('welcome.noProject.hint1')}</span>
            </div>
            <div className="welcome-hint-item hint-item-2">
              <span className="hint-icon">💬</span>
              <span className="hint-text">{t('welcome.noProject.hint2')}</span>
            </div>
            <div className="welcome-hint-item hint-item-3">
              <span className="hint-icon">🚀</span>
              <span className="hint-text">{t('welcome.noProject.hint3')}</span>
            </div>
          </div>
        </>
      ) : isEmptyProject && !hasBlueprint ? (
        <>
          <p className="welcome-subtitle">
            {t('welcome.emptyProject.subtitle')}
          </p>

          <div className="welcome-hints">
            <div className="welcome-hint-item hint-item-1">
              <span className="hint-icon">💡</span>
              <span className="hint-text">{t('welcome.emptyProject.hint1')}</span>
            </div>
            <div className="welcome-hint-item hint-item-2">
              <span className="hint-icon">📋</span>
              <span className="hint-text">{t('welcome.emptyProject.hint2')}</span>
            </div>
            <div className="welcome-hint-item hint-item-3">
              <span className="hint-icon">🚀</span>
              <span className="hint-text">{t('welcome.emptyProject.hint3')}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="welcome-subtitle">
            {t('welcome.project.subtitle')}
          </p>

          {!commandWallDismissed && (
            <CommandWall onItemClick={handlePromptClick} onClose={handleCommandWallClose} isZh={isZh} t={t} />
          )}
        </>
      )}

      {/* Quick templates - 仅在空项目时显示 */}
      {hasProject && isEmptyProject && !hasBlueprint && (
        <div className="welcome-templates">
          {EMPTY_TEMPLATES.map((tpl) => (
            <button
              key={tpl.labelKey}
              className="welcome-template-btn"
              onClick={() => onQuickPrompt?.(t(tpl.promptKey))}
              title={t(tpl.promptKey)}
            >
              <span className="template-icon">{tpl.icon}</span>
              <span className="template-label">{t(tpl.labelKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
