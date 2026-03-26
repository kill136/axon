/**
 * Axon Cloud 路由
 * 提供注册、登录、余额查询等 API
 */

import { Router, Request, Response } from 'express';
import {
  axonCloudService,
  type AxonCloudSession,
  type AxonCloudTopupInfo,
  type AxonCloudTopupProduct,
  type AxonCloudPayMethod,
} from '../services/axon-cloud-service.js';
import { webConfigService } from '../services/config-service.js';
import { webAuth } from '../web-auth.js';

const router = Router();

/** 内存 session 存储，key = username */
interface StoredSession extends AxonCloudSession {
  username: string;
  apiKey: string;
  createdAt: number;
}

const sessions = new Map<string, StoredSession>();

class AxonCloudRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function getProductHeadline(product: AxonCloudTopupProduct): string {
  if (product.name?.trim()) {
    return product.name.trim();
  }

  const amount = product.price ?? product.amount;
  if (typeof amount === 'number') {
    return `Top up ${formatCurrency(amount, product.currency)}`;
  }

  return `Top up ${product.productId}`;
}

function getProductSubline(product: AxonCloudTopupProduct): string {
  const details: string[] = [];

  if (typeof product.price === 'number') {
    details.push(`支付 ${formatCurrency(product.price, product.currency)}`);
  } else if (typeof product.amount === 'number') {
    details.push(`到账 ${formatCurrency(product.amount, product.currency)}`);
  }

  if (typeof product.bonus === 'number' && product.bonus > 0) {
    details.push(`赠送 ${formatCurrency(product.bonus, product.currency)}`);
  }

  if (product.description?.trim()) {
    details.push(product.description.trim());
  }

  return details.join(' · ') || '选择后将跳转到 Creem 安全支付页';
}

function renderTopupErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Axon Cloud 充值</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f7f7f2;
      color: #1d1d1b;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(circle at top left, rgba(234, 111, 66, 0.14), transparent 32%),
        linear-gradient(180deg, #f8f4ee 0%, #f3efe7 100%);
      padding: 24px;
    }
    .panel {
      width: min(560px, 100%);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(29, 29, 27, 0.08);
      box-shadow: 0 22px 60px rgba(31, 26, 20, 0.12);
      padding: 32px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(29, 29, 27, 0.06);
      color: #6a6257;
      font-size: 13px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    h1 {
      margin: 18px 0 12px;
      font-size: 28px;
      line-height: 1.2;
    }
    p {
      margin: 0;
      color: #5d554a;
      line-height: 1.7;
      font-size: 15px;
    }
    .error {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 16px;
      background: #fff3ef;
      border: 1px solid #f3c9bc;
      color: #9f3f24;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main class="panel">
    <div class="eyebrow">Axon Cloud</div>
    <h1>暂时无法拉起充值</h1>
    <p>浏览器已经接管了充值流程，但当前本地 Axon 无法生成 Creem 支付链接。通常重新登录一次 Axon Cloud 后即可恢复。</p>
    <div class="error">${escapeHtml(message)}</div>
  </main>
</body>
</html>`;
}

function getPayMethodLabel(method: AxonCloudPayMethod): string {
  if (method.name?.trim()) {
    return method.name.trim();
  }

  if (method.type === 'alipay') {
    return '支付宝';
  }
  if (method.type === 'wxpay') {
    return '微信支付';
  }

  return method.type;
}

function getPayMethodBadge(method: AxonCloudPayMethod): string {
  if (method.type === 'alipay') {
    return '易支付 · 支付宝';
  }
  if (method.type === 'wxpay') {
    return '易支付 · 微信支付';
  }
  return getPayMethodLabel(method);
}

function getPayMethodHint(method: AxonCloudPayMethod, amountOptions: number[], minTopup?: number): string {
  const details: string[] = ['提交后将跳转到官方支付页'];
  const effectiveMinTopup = method.minTopup ?? minTopup;
  if (typeof effectiveMinTopup === 'number' && effectiveMinTopup > 0) {
    details.unshift(`最低充值 ${effectiveMinTopup}`);
  }
  if (amountOptions.length > 0) {
    details.push(`推荐档位：${amountOptions.join(' / ')}`);
  }
  return details.join(' · ');
}

function renderEpayCard(method: AxonCloudPayMethod, amountOptions: number[], defaultAmount?: number): string {
  const label = escapeHtml(getPayMethodLabel(method));
  const badge = escapeHtml(getPayMethodBadge(method));
  const hint = escapeHtml(getPayMethodHint(method, amountOptions, method.minTopup));
  const amountValue = typeof defaultAmount === 'number' && defaultAmount > 0
    ? String(defaultAmount)
    : '';
  const options = amountOptions.map((amount) =>
    `<button type="button" data-amount-preset="${amount}">${amount}</button>`
  ).join('');
  const amountPicker = options
    ? `<div class="preset-row">${options}</div>`
    : '<p class="method-note">请输入充值数量后继续。</p>';

  return `<form method="POST" action="/api/axon-cloud/topup/checkout" class="card card-epay">
    <input type="hidden" name="paymentMethod" value="${escapeHtml(method.type)}" />
    <input type="hidden" name="provider" value="epay" />
    <div class="card-content">
      <span class="pill">${badge}</span>
      <h2>${label}</h2>
      <p>${hint}</p>
      ${amountPicker}
      <label class="amount-field">
        <span>自定义数量</span>
        <input type="number" name="amount" min="${Math.max(1, Math.floor(method.minTopup ?? 1))}" step="1" value="${amountValue}" placeholder="输入充值数量" />
      </label>
    </div>
    <button type="submit">继续到安全支付</button>
  </form>`;
}

function renderCreemCard(product: AxonCloudTopupProduct): string {
  const headline = escapeHtml(getProductHeadline(product));
  const subline = escapeHtml(getProductSubline(product));

  return `<form method="POST" action="/api/axon-cloud/topup/checkout" class="card">
    <input type="hidden" name="productId" value="${escapeHtml(product.productId)}" />
    <input type="hidden" name="provider" value="creem" />
    <div class="card-content">
      <span class="pill">Creem</span>
      <h2>${headline}</h2>
      <p>${subline}</p>
    </div>
    <button type="submit">继续到安全支付</button>
  </form>`;
}

function renderTopupPage(info: AxonCloudTopupInfo): string {
  const epayMethods = info.enableOnlineTopup
    ? info.payMethods.filter((method) => method.type === 'alipay' || method.type === 'wxpay')
    : [];
  const defaultAmount = info.amountOptions[0] ?? info.minTopup;
  const productCards = [
    ...epayMethods.map((method) => renderEpayCard(method, info.amountOptions, defaultAmount)),
    ...info.creemProducts.map((product) => renderCreemCard(product)),
  ].join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Axon Cloud 充值</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f7f4ed;
      color: #1b1a17;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 15% 20%, rgba(222, 135, 77, 0.18), transparent 28%),
        radial-gradient(circle at 85% 0%, rgba(103, 150, 143, 0.12), transparent 26%),
        linear-gradient(180deg, #f8f4ee 0%, #f1ece2 100%);
      padding: 28px 18px 40px;
    }
    .shell {
      width: min(960px, 100%);
      margin: 0 auto;
    }
    .hero {
      padding: 18px 4px 30px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(27, 26, 23, 0.06);
      color: #665d50;
      font-size: 13px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    h1 {
      margin: 18px 0 12px;
      font-size: clamp(32px, 5vw, 54px);
      line-height: 0.98;
      font-weight: 700;
      letter-spacing: -0.04em;
      max-width: 760px;
    }
    .hero p {
      margin: 0;
      max-width: 680px;
      color: #5d554a;
      line-height: 1.75;
      font-size: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 18px;
      margin-top: 12px;
    }
    .card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 220px;
      padding: 22px;
      border-radius: 24px;
      border: 1px solid rgba(27, 26, 23, 0.08);
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 18px 45px rgba(27, 26, 23, 0.08);
      backdrop-filter: blur(8px);
    }
    .card h2 {
      margin: 0 0 12px;
      font-size: 26px;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }
    .pill {
      display: inline-flex;
      align-self: flex-start;
      margin-bottom: 12px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(27, 26, 23, 0.06);
      color: #665d50;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .preset-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 16px 0 14px;
    }
    .preset-row button {
      border: 1px solid rgba(27, 26, 23, 0.12);
      background: rgba(255, 255, 255, 0.92);
      color: #3c362d;
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .amount-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
      color: #5d554a;
      font-size: 14px;
    }
    .amount-field input {
      border: 1px solid rgba(27, 26, 23, 0.12);
      border-radius: 14px;
      padding: 12px 14px;
      font-size: 15px;
      background: rgba(255, 255, 255, 0.92);
      color: #1b1a17;
    }
    .method-note {
      margin: 16px 0 10px;
      color: #72695d;
      font-size: 14px;
      line-height: 1.6;
    }
    .card p {
      margin: 0;
      color: #635a4e;
      line-height: 1.7;
      font-size: 15px;
    }
    .card button {
      margin-top: 24px;
      border: none;
      border-radius: 16px;
      padding: 14px 18px;
      background: linear-gradient(135deg, #d85f34 0%, #ea8c52 100%);
      color: #fffdf9;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 140ms ease, box-shadow 140ms ease;
      box-shadow: 0 12px 24px rgba(216, 95, 52, 0.24);
    }
    .card button:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(216, 95, 52, 0.28);
    }
    .hint {
      margin-top: 20px;
      color: #72695d;
      font-size: 14px;
      line-height: 1.7;
    }
    @media (max-width: 640px) {
      body {
        padding: 18px 14px 28px;
      }
      .card {
        min-height: 0;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="eyebrow">Axon Cloud Payments</div>
      <h1>浏览器已接管充值流程，无需再回 NewAPI 控制台登录。</h1>
      <p>请选择支付方式与充值档位。Axon 会直接用你当前的 Axon Cloud 登录态创建支付订单，并跳转到官方支付页。</p>
    </section>
    <section class="grid">
      ${productCards}
    </section>
    <p class="hint">支付完成后可以回到 Axon，余额通常会很快刷新。如果当前页面报会话过期，只需要在 Axon 里重新登录一次 Axon Cloud。</p>
  </main>
  <script>
    document.querySelectorAll('[data-amount-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const form = button.closest('form');
        const input = form?.querySelector('input[name="amount"]');
        const amount = button.getAttribute('data-amount-preset') || '';
        if (input) {
          input.value = amount;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  </script>
</body>
</html>`;
}

function getLatestSession(): StoredSession | null {
  const allSessions = Array.from(sessions.values());
  if (allSessions.length === 0) {
    return null;
  }

  return allSessions.sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
}

function resolveCurrentSession(): StoredSession {
  if (!webAuth.isAxonCloudUser()) {
    throw new AxonCloudRouteError(400, 'Current account is not using Axon Cloud');
  }

  const credentials = webAuth.getCredentials();
  if (!credentials.apiKey) {
    const fallbackSession = getLatestSession();
    if (fallbackSession) {
      return fallbackSession;
    }
    throw new AxonCloudRouteError(400, 'No Axon Cloud API key configured');
  }

  const session = Array.from(sessions.values()).find((item) => item.apiKey === credentials.apiKey);
  if (session) {
    return session;
  }

  const fallbackSession = getLatestSession();
  if (fallbackSession) {
    return fallbackSession;
  }

  throw new AxonCloudRouteError(
    401,
    'Axon Cloud session expired. Please sign in again inside Axon, then retry top-up.',
  );
}

function normalizePositiveNumberInput(value: unknown): number {
  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    const text = String(candidate ?? '').trim();
    if (!text) {
      continue;
    }

    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function getErrorStatus(error: unknown, fallback = 500): number {
  return error instanceof AxonCloudRouteError ? error.statusCode : fallback;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// 清理过期 session（30 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      sessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

/** 注册/登录成功后的公共处理：存 session + 配 API */
async function handleAuthSuccess(result: { username: string; quota: number; apiKey: string; apiBaseUrl: string; session?: AxonCloudSession }) {
  if (result.session) {
    sessions.set(result.username, {
      ...result.session,
      username: result.username,
      apiKey: result.apiKey,
      createdAt: Date.now(),
    });
  }

  try {
    await webConfigService.updateApiConfig({
      apiKey: result.apiKey,
      apiBaseUrl: result.apiBaseUrl,
      authPriority: 'apiKey',
      runtimeBackend: 'axon-cloud',
      customModelName: '',  // NewAPI 支持模型别名路由，不需要硬编码模型名
    });
    console.log('[AxonCloud] API config updated');
  } catch (e) {
    console.error('[AxonCloud] Failed to update config:', e);
  }
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, email, verificationCode } = req.body as {
      username: string;
      password: string;
      email: string;
      verificationCode?: string;
    };
    if (!username || !password || !email) {
      return res.status(400).json({ success: false, error: 'Username, password, and email are required' });
    }

    const result = await axonCloudService.register({ username, password, email, verificationCode });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    if (!result.requiresLogin) {
      await handleAuthSuccess(result);
    }

    res.json({
      success: true,
      username: result.username,
      quota: result.quota,
      requiresLogin: result.requiresLogin ?? false,
      message: result.message,
      apiKey: result.apiKey || undefined,
    });
  } catch (error) {
    console.error('[AxonCloud] Register error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

router.get('/verification', async (req: Request, res: Response) => {
  try {
    const email = String(req.query.email ?? '').trim();
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    await axonCloudService.sendVerificationCode(email);
    res.json({ success: true });
  } catch (error) {
    console.error('[AxonCloud] Send verification code error:', error);
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to send verification code' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username: string; password: string };
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const result = await axonCloudService.login({ username, password });
    if (!result.success) {
      return res.status(401).json({ success: false, error: result.error });
    }

    await handleAuthSuccess(result);
    res.json({ success: true, username: result.username, quota: result.quota });
  } catch (error) {
    console.error('[AxonCloud] Login error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

router.get('/balance', async (req: Request, res: Response) => {
  try {
    const username = req.query.username as string;
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required' });
    }

    const session = sessions.get(username);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session expired, please login again' });
    }

    const balance = await axonCloudService.getBalance(session.accessToken, session.userId);
    res.json({ success: true, quota: balance.quota, used: balance.used, remaining: balance.quota - balance.used });
  } catch (error) {
    console.error('[AxonCloud] Balance error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

/**
 * GET /api/axon-cloud/quota
 * 通过已保存的 API Key 查询 Axon Cloud 余额（兼容 OpenAI billing API）
 * 不依赖内存 session，直接读 settings.json 中的 apiKey
 */
router.get('/quota', async (req: Request, res: Response) => {
  try {
    if (!webAuth.isAxonCloudUser()) {
      return res.status(400).json({ success: false, error: 'Not an Axon Cloud user' });
    }

    const creds = webAuth.getCredentials();
    if (!creds.apiKey) {
      return res.status(400).json({ success: false, error: 'No API key configured' });
    }

    const headers = { 'Authorization': `Bearer ${creds.apiKey}` };
    const baseUrl = (creds.baseUrl || 'https://api.chatbi.site').replace(/\/+$/, '');

    // NewAPI 兼容 OpenAI 的 billing 接口
    const subRes = await fetch(`${baseUrl}/v1/dashboard/billing/subscription`, { headers });
    if (!subRes.ok) {
      throw new Error(`Billing API returned ${subRes.status}`);
    }
    const sub = await subRes.json() as any;

    // hard_limit_usd = 总额度, 用 usage 接口获取已用额度
    const totalQuota = sub.hard_limit_usd ?? sub.system_hard_limit_usd ?? 0;

    // 获取当月用量
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    let usedQuota = 0;
    try {
      const usageRes = await fetch(`${baseUrl}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`, { headers });
      if (usageRes.ok) {
        const usage = await usageRes.json() as any;
        usedQuota = (usage.total_usage ?? 0) / 100; // OpenAI 返回的是 cents
      }
    } catch {
      // usage 接口可能不支持，忽略
    }

    res.json({
      success: true,
      total: totalQuota,
      used: usedQuota,
      remaining: totalQuota - usedQuota,
    });
  } catch (error) {
    console.error('[AxonCloud] Quota error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to query quota' });
  }
});

router.get('/topup/info', async (req: Request, res: Response) => {
  try {
    const session = resolveCurrentSession();
    const info = await axonCloudService.getTopupInfo(session.accessToken, session.userId);
    res.json({
      success: true,
      enableCreemTopup: info.enableCreemTopup,
      creemProducts: info.creemProducts,
      enableOnlineTopup: info.enableOnlineTopup,
      payMethods: info.payMethods,
      minTopup: info.minTopup,
      amountOptions: info.amountOptions,
    });
  } catch (error) {
    console.error('[AxonCloud] Top-up info error:', error);
    res.status(getErrorStatus(error)).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get top-up info'),
    });
  }
});

router.get('/topup', async (req: Request, res: Response) => {
  try {
    const session = resolveCurrentSession();
    const info = await axonCloudService.getTopupInfo(session.accessToken, session.userId);

    if (!info.enableCreemTopup && !info.enableOnlineTopup) {
      throw new AxonCloudRouteError(400, 'No supported top-up methods are enabled for this account');
    }
    if (info.creemProducts.length === 0 && info.payMethods.length === 0) {
      throw new AxonCloudRouteError(400, 'No top-up products or payment methods are available right now');
    }

    res.send(renderTopupPage(info));
  } catch (error) {
    console.error('[AxonCloud] Top-up page error:', error);
    res.status(getErrorStatus(error)).send(
      renderTopupErrorPage(getErrorMessage(error, 'Failed to load top-up page')),
    );
  }
});

router.post('/topup/checkout', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      provider?: string;
      productId?: string;
      product_id?: string;
      paymentMethod?: string;
      payment_method?: string;
      amount?: string | number | Array<string | number>;
      total_amount?: string | number | Array<string | number>;
    };
    const provider = String(body.provider ?? '').trim().toLowerCase();
    const productId = String(body.productId ?? body.product_id ?? '').trim();
    const paymentMethod = String(body.paymentMethod ?? body.payment_method ?? '').trim();
    const amount = typeof body.amount === 'number'
      ? body.amount
      : normalizePositiveNumberInput(body.amount ?? body.total_amount);

    const session = resolveCurrentSession();

    if (provider === 'epay' || paymentMethod) {
      if (!paymentMethod) {
        throw new AxonCloudRouteError(400, 'Missing paymentMethod');
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AxonCloudRouteError(400, 'Missing amount');
      }

      const checkoutUrl = await axonCloudService.createEpayCheckout(
        session.accessToken,
        session.userId,
        amount,
        paymentMethod,
      );
      return res.redirect(302, checkoutUrl);
    }

    if (!productId) {
      throw new AxonCloudRouteError(400, 'Missing productId');
    }

    const checkoutUrl = await axonCloudService.createCreemCheckout(
      session.accessToken,
      session.userId,
      productId,
    );

    res.redirect(302, checkoutUrl);
  } catch (error) {
    console.error('[AxonCloud] Top-up checkout error:', error);
    res.status(getErrorStatus(error)).send(
      renderTopupErrorPage(getErrorMessage(error, 'Failed to create top-up checkout')),
    );
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username?: string };
    if (username) sessions.delete(username);
    res.json({ success: true });
  } catch (error) {
    console.error('[AxonCloud] Logout error:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

export default router;
