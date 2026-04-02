const path = require('path');
const PptxGenJS = require(process.env.PATH.split(':')[0] + '/../pptxgenjs');

const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'CUSTOM', width: 13.333, height: 7.5 });
pptx.layout = 'CUSTOM';
pptx.author = 'Axon';
pptx.company = '王果软件';
pptx.subject = '制造企业数字化统一门户与低代码平台方案';
pptx.title = '王果软件-制造企业数字化统一门户与低代码平台方案';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Droid Sans Fallback',
  bodyFontFace: 'Droid Sans Fallback',
  lang: 'zh-CN',
};

const SW = 13.333;
const SH = 7.5;
const FONT = 'Droid Sans Fallback';
const FONT_EN = 'Arial';

const C = {
  navy: '2F3943',
  blue: '36454F',
  cyan: '8A959F',
  teal: '5E6A75',
  ink: '25313A',
  muted: '708090',
  bg: 'F3F4F6',
  white: 'FFFFFF',
  line: 'D3D3D3',
  soft: 'EEF1F4',
};

const base = '/tmp/claude-code-uploads/wangguo_assets';
const output = '/tmp/claude-code-uploads/王果软件_制造企业数字化统一门户方案.pptx';

const asset = (name) => path.join(base, name);
const shadow = () => ({ type: 'outer', color: '36454F', blur: 2, offset: 1, angle: 45, opacity: 0.08 });

function footer(slide, num, note = '王果软件 · 制造企业数字化统一门户与低代码平台方案') {
  slide.addText(note, {
    x: 0.65, y: 7.02, w: 5.8, h: 0.2,
    fontFace: FONT, fontSize: 9.5, color: C.muted, margin: 0,
  });
  slide.addText(String(num).padStart(2, '0'), {
    x: 12.35, y: 6.95, w: 0.45, h: 0.22,
    align: 'right', fontFace: FONT_EN, fontSize: 11, bold: true, color: C.blue, margin: 0,
  });
}

function sectionTitle(slide, kicker, title, desc) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.65, y: 0.48, w: 0.24, h: 0.24,
    rectRadius: 0.03,
    fill: { color: C.blue },
    line: { color: C.blue, transparency: 100 },
  });
  slide.addText(kicker, {
    x: 1.0, y: 0.38, w: 3.0, h: 0.22,
    fontFace: FONT_EN, fontSize: 10, bold: true, color: C.blue, margin: 0,
  });
  slide.addText(title, {
    x: 0.65, y: 0.72, w: 7.2, h: 0.48,
    fontFace: FONT, fontSize: 24, bold: true, color: C.ink, margin: 0,
  });
  if (desc) {
    slide.addText(desc, {
      x: 0.65, y: 1.14, w: 8.4, h: 0.32,
      fontFace: FONT, fontSize: 10.5, color: C.muted, margin: 0,
    });
  }
}

function pill(slide, text, x, y, w, fill = C.soft, color = C.blue) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: 0.34, rectRadius: 0.08,
    fill: { color: fill },
    line: { color: fill, transparency: 100 },
  });
  slide.addText(text, {
    x: x + 0.1, y: y + 0.04, w: w - 0.2, h: 0.2,
    align: 'center', fontFace: FONT, fontSize: 9.5, bold: true, color, margin: 0,
  });
}

function card(slide, x, y, w, h, title, body, opts = {}) {
  const fill = opts.fill || C.white;
  const line = opts.line || C.line;
  const titleColor = opts.titleColor || C.ink;
  const bodyColor = opts.bodyColor || C.muted;
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill, transparency: opts.transparency || 0 },
    line: { color: line, width: 1 },
    shadow: shadow(),
  });
  slide.addText(title, {
    x: x + 0.18, y: y + 0.16, w: w - 0.36, h: 0.28,
    fontFace: FONT, fontSize: opts.titleSize || 16, bold: true, color: titleColor, margin: 0,
  });
  slide.addText(body, {
    x: x + 0.18, y: y + 0.5, w: w - 0.36, h: h - 0.66,
    fontFace: FONT, fontSize: opts.bodySize || 10.5, color: bodyColor, margin: 0,
    valign: 'top',
  });
}

function numberBadge(slide, n, x, y, fill = C.blue) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y, w: 0.38, h: 0.38,
    fill: { color: fill },
    line: { color: fill, transparency: 100 },
  });
  slide.addText(String(n).padStart(2, '0'), {
    x, y: y + 0.06, w: 0.38, h: 0.18,
    align: 'center', fontFace: FONT_EN, fontSize: 9.5, bold: true, color: C.white, margin: 0,
  });
}

function addCover() {
  const slide = pptx.addSlide();
  slide.background = { path: asset('cover.jpg') };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SW, h: SH,
    fill: { color: C.navy, transparency: 24 },
    line: { color: C.navy, transparency: 100 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 6.2, h: SH,
    fill: { color: '232B32', transparency: 4 },
    line: { color: '232B32', transparency: 100 },
  });
  pill(slide, 'WANGGUO SOFTWARE', 0.78, 0.72, 1.95, '4B5862', C.white);
  slide.addText('制造企业数字化统一门户\n与低代码平台方案', {
    x: 0.78, y: 1.45, w: 5.7, h: 1.52,
    fontFace: FONT, fontSize: 25, bold: true, color: C.white, margin: 0,
  });
  slide.addText('基于 JEECG 能力底座，面向统一门户、单点登录、业务系统集成与运营可视化建设。', {
    x: 0.78, y: 3.18, w: 4.95, h: 0.72,
    fontFace: FONT, fontSize: 12.5, color: 'E5E7EB', margin: 0,
  });
  pill(slide, '统一门户', 0.78, 4.25, 1.1, '36454F', C.white);
  pill(slide, 'SSO', 1.98, 4.25, 0.82, '5E6A75', C.white);
  pill(slide, '低代码平台', 2.9, 4.25, 1.38, '66727C', C.white);
  pill(slide, '系统集成', 4.38, 4.25, 1.18, '7C8894', C.white);
  slide.addText('王果软件', {
    x: 0.8, y: 6.28, w: 2.0, h: 0.3,
    fontFace: FONT, fontSize: 14, bold: true, color: C.white, margin: 0,
  });
  slide.addText('汇报材料 / Proposal Deck', {
    x: 0.8, y: 6.62, w: 2.6, h: 0.22,
    fontFace: FONT_EN, fontSize: 9.5, color: 'D1D5DB', margin: 0,
  });
  slide.addText('01', {
    x: 12.2, y: 6.86, w: 0.45, h: 0.2,
    align: 'right', fontFace: FONT_EN, fontSize: 12, bold: true, color: C.white, margin: 0,
  });
}

function addPositioning() {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  sectionTitle(slide, 'POSITIONING', '王果软件方案定位', '聚焦制造业数字化底座建设，避免使用未经核实的工商或认证信息。');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.7, y: 1.7, w: 5.1, h: 4.85, rectRadius: 0.08,
    fill: { color: 'FFFFFF' },
    line: { color: C.line, width: 1 },
    shadow: shadow(),
  });
  slide.addText('面向甲方的交付导向型方案公司', {
    x: 0.95, y: 1.98, w: 4.5, h: 0.35,
    fontFace: FONT, fontSize: 22, bold: true, color: C.ink, margin: 0,
  });
  slide.addText('王果软件本次呈现的核心角色，不是单纯的软件实施商，而是围绕“统一门户 + 单点登录 + 低代码平台 + 系统集成”构建可持续数字化底座的方案交付方。\n\n在制造业场景下，这类建设的价值不在于上线一个孤立页面，而在于形成统一入口、统一身份、统一待办、统一数据展示与后续业务快速扩展能力。\n\n因此本方案重点强调：优先搭底座、先接核心场景、保留后续演进空间。', {
    x: 0.95, y: 2.48, w: 4.35, h: 2.65,
    fontFace: FONT, fontSize: 12, color: C.muted, margin: 0,
    valign: 'top',
  });
  pill(slide, '统一入口', 0.95, 5.45, 1.05);
  pill(slide, '统一身份', 2.12, 5.45, 1.05);
  pill(slide, '业务协同', 3.29, 5.45, 1.05);
  pill(slide, '持续扩展', 4.46, 5.45, 1.05);

  card(slide, 6.1, 1.75, 2.15, 1.35, '平台化建设', '从账号体系、门户首页、待办中心、报表看板出发，形成可复制的数字化框架。');
  card(slide, 8.5, 1.75, 2.15, 1.35, '快速交付', '依托低代码与成熟组件体系，先完成首批场景落地，再逐步扩容。');
  card(slide, 10.9, 1.75, 1.75, 1.35, '演进能力', '不是一次性项目，而是后续流程、表单、集成的扩展底座。');

  card(slide, 6.1, 3.45, 2.15, 1.55, '统一门户', '统一展示生产、园区、智能产线、能耗等系统展示能力。', { fill: 'F6F7F8' });
  card(slide, 8.5, 3.45, 2.15, 1.55, '低代码应用', '支持表单、流程、报表与轻应用快速构建。', { fill: 'F6F7F8' });
  card(slide, 10.9, 3.45, 1.75, 1.55, '系统集成', '打通 ERP、MES、WMS、OA 等存量系统。', { fill: 'F6F7F8' });

  card(slide, 6.1, 5.32, 6.55, 1.22, '本次汇报建议的建设原则', '先统一账号与入口，再构建待办与工作台；先接入关键系统，再逐步扩展到报表、流程与更多业务模块。', { titleSize: 15, bodySize: 10.5 });

  footer(slide, 2);
}

function addDemand() {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  sectionTitle(slide, 'DEMAND', '甲方需求梳理', '根据你提供的需求截图，核心诉求集中在统一用户、SSO、工厂门户、个人工作台与系统集成。');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.55, y: 1.55, w: 5.08, h: 5.45, rectRadius: 0.08,
    fill: { color: 'FFFFFF' },
    line: { color: C.line, width: 1 },
    shadow: shadow(),
  });
  slide.addImage({ path: asset('demand.jpg'), x: 7.72, y: 1.72, w: 4.74, h: 5.1 });
  pill(slide, '需求截图原件', 10.8, 1.72, 1.35, 'EEF1F4', C.blue);

  const items = [
    ['统一用户管理', '形成集团/平台统一账号基础信息、认证口径与账户管理规则。'],
    ['单点登录接入', '面向多个业务系统接入，提升切换效率，减少多次登录。'],
    ['工厂门户系统', '汇聚生产、园区、智能产线、能耗等系统展示能力。'],
    ['个人工作平台', '承载待办事项、消息通知、信息访问与文档共享能力。'],
    ['系统集成', '将原有业务系统纳入统一门户，实现免登录或少登录切换。'],
  ];

  let y = 1.78;
  items.forEach((it, idx) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.72, y, w: 6.25, h: 0.88, rectRadius: 0.05,
      fill: { color: idx % 2 === 0 ? 'F6F7F8' : 'FFFFFF' },
      line: { color: C.line, width: 1 },
    });
    numberBadge(slide, idx + 1, 0.92, y + 0.24, idx < 2 ? C.blue : (idx < 4 ? C.teal : C.navy));
    slide.addText(it[0], {
      x: 1.4, y: y + 0.16, w: 2.2, h: 0.22,
      fontFace: FONT, fontSize: 14.5, bold: true, color: C.ink, margin: 0,
    });
    slide.addText(it[1], {
      x: 1.4, y: y + 0.43, w: 5.2, h: 0.22,
      fontFace: FONT, fontSize: 10.2, color: C.muted, margin: 0,
    });
    y += 1.0;
  });

  card(slide, 0.72, 6.08, 6.25, 0.84, '结论', '本项目建设目标应定义为“统一数字化工作入口”，而不是单一页面交付。', { fill: 'F0F2F4', line: 'D3D3D3', titleSize: 15 });

  footer(slide, 3);
}

function addJeecg() {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  sectionTitle(slide, 'JEECG', 'JEECG 产品能力映射', '结合 JEECG 官网与文档，可将其作为统一门户、低代码应用、流程与报表建设的能力底座。');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.0, y: 1.63, w: 4.85, h: 5.1, rectRadius: 0.08,
    fill: { color: 'FFFFFF' },
    line: { color: C.line, width: 1 },
    shadow: shadow(),
  });
  slide.addImage({ path: asset('solution.jpg'), x: 8.15, y: 1.78, w: 4.55, h: 2.75 });
  slide.addText('文档明确提到的关键能力', {
    x: 8.25, y: 4.72, w: 3.8, h: 0.25,
    fontFace: FONT, fontSize: 15.5, bold: true, color: C.ink, margin: 0,
  });
  slide.addText('Vue3 + TypeScript + Vite6 + Ant Design Vue4 + pinia + echarts + vxe-table + qiankun\nSpring Boot / Spring Cloud Alibaba / MybatisPlus\n支持 RBAC、数据权限、多租户、CAS 单点登录、Flowable 工作流\nJimuReport 覆盖报表、大屏、仪表盘、门户设计', {
    x: 8.25, y: 5.06, w: 4.1, h: 1.28,
    fontFace: FONT, fontSize: 10.3, color: C.muted, margin: 0,
  });

  const caps = [
    ['统一门户', '支持自定义首页与门户设计，可作为企业统一工作入口。'],
    ['单点登录与权限', '文档明确提供 CAS 单点登录、RBAC、按钮权限、数据权限。'],
    ['低代码开发', '在线表单、代码生成器、在线增强开发，可提升首批场景落地速度。'],
    ['流程协同', '集成 Flowable，支持流程与表单分离、任务节点灵活配置。'],
    ['报表与大屏', 'JimuReport 覆盖数据报表、打印设计、大屏、仪表盘、门户设计。'],
    ['集成与扩展', '支持 RESTful、Swagger、OpenAPI、多数据源、微服务与网关能力。'],
  ];
  let x1 = 0.72, x2 = 4.25, y1 = 1.82;
  caps.forEach((it, idx) => {
    const x = idx % 2 === 0 ? x1 : x2;
    const y = y1 + Math.floor(idx / 2) * 1.43;
    card(slide, x, y, 3.1, 1.12, it[0], it[1], { titleSize: 14.5, bodySize: 10.1 });
  });

  slide.addText('资料来源：JEECG 官网与官方文档（jeecg.com / help.jeecg.com）', {
    x: 0.74, y: 6.52, w: 5.0, h: 0.18,
    fontFace: FONT, fontSize: 8.8, color: C.muted, margin: 0,
  });

  footer(slide, 4);
}

function addBlueprint() {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  sectionTitle(slide, 'BLUEPRINT', '方案蓝图建议', '建议以“入口层—协同层—平台层—集成层”四层结构推进，先搭底座，再逐步扩展业务。');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.72, y: 1.7, w: 6.7, h: 4.95, rectRadius: 0.08,
    fill: { color: 'F6F7F8' },
    line: { color: C.line, width: 1 },
  });

  const layers = [
    ['统一入口层', '门户首页 / 单点登录 / 待办中心 / 消息通知 / 个人工作台', C.blue],
    ['业务协同层', 'ERP / MES / WMS / OA / EAM / 质量 / 能源等核心业务入口', C.teal],
    ['平台能力层', 'JEECG 低代码表单 / 流程引擎 / 报表大屏 / 权限中心 / API 能力', '55616C'],
    ['集成数据层', '组织用户同步 / 数据接口 / OpenAPI / 日志审计 / 统一标准', C.navy],
  ];
  let ly = 2.0;
  layers.forEach((it) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.0, y: ly, w: 6.1, h: 0.8, rectRadius: 0.05,
      fill: { color: it[2], transparency: 3 },
      line: { color: it[2], transparency: 100 },
    });
    slide.addText(it[0], {
      x: 1.22, y: ly + 0.14, w: 1.55, h: 0.22,
      fontFace: FONT, fontSize: 14.5, bold: true, color: C.white, margin: 0,
    });
    slide.addText(it[1], {
      x: 2.72, y: ly + 0.14, w: 4.0, h: 0.4,
      fontFace: FONT, fontSize: 10.4, color: C.white, margin: 0,
    });
    ly += 1.02;
  });

  card(slide, 0.92, 6.05, 6.3, 0.62, '建设重点', '首批建议优先落地账号体系、统一门户首页、待办中心、关键报表与核心系统接入。', { titleSize: 13.5, bodySize: 10.2, fill: 'F0F2F4', line: 'D3D3D3' });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.82, y: 1.72, w: 4.82, h: 4.98, rectRadius: 0.08,
    fill: { color: 'FFFFFF' },
    line: { color: C.line, width: 1 },
    shadow: shadow(),
  });
  slide.addImage({ path: asset('solution.jpg'), x: 8.02, y: 1.92, w: 4.42, h: 2.55 });
  card(slide, 8.02, 4.75, 1.3, 1.22, '价值一', '统一入口\n减少切换', { fill: 'F6F7F8', titleSize: 14, bodySize: 11 });
  card(slide, 9.55, 4.75, 1.3, 1.22, '价值二', '快速构建\n轻应用', { fill: 'F6F7F8', titleSize: 14, bodySize: 11 });
  card(slide, 11.08, 4.75, 1.3, 1.22, '价值三', '后续模块\n持续扩展', { fill: 'F6F7F8', titleSize: 14, bodySize: 11 });

  footer(slide, 5);
}

function addCases() {
  const slide = pptx.addSlide();
  slide.background = { color: C.navy };
  slide.addText('SUCCESS CASES', {
    x: 0.72, y: 0.42, w: 2.4, h: 0.18,
    fontFace: FONT_EN, fontSize: 10, bold: true, color: 'D5D9DE', margin: 0,
  });
  slide.addText('成功案例参考', {
    x: 0.72, y: 0.7, w: 4.0, h: 0.38,
    fontFace: FONT, fontSize: 24, bold: true, color: C.white, margin: 0,
  });
  slide.addText('案例名称与客户素材沿用你上传原始 PPT 中的内容，本页仅做现代化重组呈现。', {
    x: 0.72, y: 1.12, w: 6.4, h: 0.22,
    fontFace: FONT, fontSize: 10.5, color: 'E5E7EB', margin: 0,
  });

  ['case1.png', 'case2.png', 'case3.png'].forEach((name, i) => {
    const x = 0.78 + i * 1.95;
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 1.7, w: 1.65, h: 1.0, rectRadius: 0.05,
      fill: { color: 'FFFFFF' },
      line: { color: '66727C', width: 1 },
    });
    slide.addImage({ path: asset(name), x: x + 0.13, y: 1.94, w: 1.39, h: 0.48 });
  });

  card(slide, 0.78, 3.05, 4.2, 2.0, '制造业客户场景', '模塑科技\n北京海纳川汽车部件股份有限公司\n中用\n渤海活塞', { fill: '414D57', line: '66727C', titleColor: C.white, bodyColor: 'EEF0F2', titleSize: 18, bodySize: 13 });
  card(slide, 5.26, 3.05, 3.0, 2.0, '项目案例', '江苏宿迁安置房管理系统', { fill: '414D57', line: '66727C', titleColor: C.white, bodyColor: 'EEF0F2', titleSize: 18, bodySize: 14 });
  card(slide, 8.55, 3.05, 4.0, 2.0, '材料中提到的服务方向', 'ERP 配套\n条码系统\n低代码平台\n管理系统建设', { fill: '414D57', line: '66727C', titleColor: C.white, bodyColor: 'EEF0F2', titleSize: 18, bodySize: 13 });

  card(slide, 0.78, 5.45, 11.77, 0.95, '使用建议', '如需正式对外汇报，建议在最终版中用王果软件真实客户名称、Logo 与项目成果替换本页占位素材。', { fill: '2F3943', line: '5F6B76', titleColor: 'D5D9DE', bodyColor: 'EEF0F2', titleSize: 14.5, bodySize: 10.5 });

  slide.addText('06', {
    x: 12.25, y: 6.86, w: 0.45, h: 0.2,
    align: 'right', fontFace: FONT_EN, fontSize: 12, bold: true, color: C.white, margin: 0,
  });
  slide.addText('王果软件 · 成功案例参考', {
    x: 0.74, y: 7.02, w: 3.0, h: 0.2,
    fontFace: FONT, fontSize: 9.2, color: 'D5D9DE', margin: 0,
  });
}

function addPlan() {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  sectionTitle(slide, 'ROADMAP', '实施路径建议', '建议按“四步走”推进，从账号与门户切入，再逐步完成流程、报表与系统集成。');

  const phases = [
    ['阶段 01', '需求澄清与蓝图', '梳理账号体系、系统边界、门户栏目与首批场景优先级。', C.blue],
    ['阶段 02', '统一门户与 SSO', '完成组织用户同步、统一登录、首页门户和待办中心。', C.teal],
    ['阶段 03', '业务集成与运营看板', '接 ERP / MES / WMS 等关键系统，并建设关键报表与大屏。', '55616C'],
    ['阶段 04', '推广上线与持续迭代', '沉淀流程、表单、报表模板，逐步扩展更多业务模块。', C.navy],
  ];
  let x = 0.78;
  phases.forEach((p, idx) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 2.05, w: 2.8, h: 2.15, rectRadius: 0.08,
      fill: { color: 'FFFFFF' },
      line: { color: C.line, width: 1 },
      shadow: shadow(),
    });
    pill(slide, p[0], x + 0.18, 2.22, 0.92, p[3], C.white);
    slide.addText(p[1], {
      x: x + 0.18, y: 2.72, w: 2.15, h: 0.42,
      fontFace: FONT, fontSize: 17, bold: true, color: C.ink, margin: 0,
    });
    slide.addText(p[2], {
      x: x + 0.18, y: 3.22, w: 2.42, h: 0.62,
      fontFace: FONT, fontSize: 10.6, color: C.muted, margin: 0,
    });
    if (idx < phases.length - 1) {
      slide.addShape(pptx.ShapeType.chevron, {
        x: x + 2.62, y: 2.83, w: 0.42, h: 0.44,
        fill: { color: 'D3D3D3' },
        line: { color: 'D3D3D3', transparency: 100 },
      });
    }
    x += 3.13;
  });

  card(slide, 0.78, 4.75, 5.7, 1.45, '首批交付建议', '优先完成账号体系、统一首页、待办中心、关键报表与 2~3 个核心业务系统接入，先拿到可见成果。', { titleSize: 16, bodySize: 11 });
  card(slide, 6.72, 4.75, 2.8, 1.45, '保障一', '平台先行\n避免烟囱式建设', { titleSize: 16, bodySize: 12 });
  card(slide, 9.72, 4.75, 2.8, 1.45, '保障二', '可扩展设计\n支持后续持续迭代', { titleSize: 16, bodySize: 12 });

  footer(slide, 7);
}

function addThanks() {
  const slide = pptx.addSlide();
  slide.background = { color: C.navy };
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.38, y: 1.18, w: 10.58, h: 5.12, rectRadius: 0.08,
    fill: { color: 'FFFFFF', transparency: 100 },
    line: { color: 'AAB2B9', transparency: 55, width: 1 },
  });
  slide.addText('谢谢', {
    x: 0, y: 2.08, w: SW, h: 0.58,
    align: 'center', fontFace: FONT, fontSize: 28, bold: true, color: C.white, margin: 0,
  });
  slide.addText('期待与甲方共同推进统一门户与数字化平台建设', {
    x: 0, y: 2.82, w: SW, h: 0.28,
    align: 'center', fontFace: FONT, fontSize: 12.5, color: 'E5E7EB', margin: 0,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 4.25, y: 3.5, w: 4.8, h: 0,
    line: { color: 'AAB2B9', width: 1, transparency: 35 },
  });
  pill(slide, 'WANGGUO SOFTWARE', 5.12, 3.9, 3.1, '55616C', C.white);
  slide.addText('08', {
    x: 12.2, y: 6.86, w: 0.45, h: 0.2,
    align: 'right', fontFace: FONT_EN, fontSize: 12, bold: true, color: C.white, margin: 0,
  });
}

async function main() {
  addCover();
  addPositioning();
  addDemand();
  addJeecg();
  addBlueprint();
  addCases();
  addPlan();
  addThanks();
  await pptx.writeFile({ fileName: output });
  console.log(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
