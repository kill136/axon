const { chromium } = require('playwright-core');
const path = require('path');

const DEMO_URL = 'http://voicegpt.site:3456/';
const OUT_DIR = path.join(__dirname);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  
  const context = await browser.newContext({
    viewport: { width: 1400, height: 800 },
    deviceScaleFactor: 2,
  });
  
  const page = await context.newPage();
  
  console.log('1. Navigating to demo...');
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  
  // Screenshot 1: Main page - clean welcome
  console.log('2. Screenshot 1: Main page...');
  await page.screenshot({ path: path.join(OUT_DIR, '01-main.png') });
  
  // Screenshot 2: Click Blueprint tab
  console.log('3. Screenshot 2: Blueprint tab...');
  try {
    const blueprintBtn = page.locator('button', { hasText: '蓝图' }).first();
    await blueprintBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT_DIR, '02-blueprint.png') });
  } catch(e) { console.log('  Skipped blueprint:', e.message.split('\n')[0]); }
  
  // Screenshot 3: Swarm tab
  console.log('4. Screenshot 3: Swarm tab...');
  try {
    const swarmBtn = page.locator('button', { hasText: '蜂群' }).first();
    await swarmBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT_DIR, '03-swarm.png') });
  } catch(e) { console.log('  Skipped swarm:', e.message.split('\n')[0]); }
  
  // Go back to chat
  console.log('5. Back to chat...');
  try {
    const chatBtn = page.locator('button', { hasText: '聊天' }).first();
    await chatBtn.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch(e) { console.log('  Skipped chat:', e.message.split('\n')[0]); }
  
  // Screenshot 4: Settings panel
  console.log('6. Screenshot 4: Settings...');
  try {
    const settingsBtn = page.locator('button[aria-label="设置"], button:has(> img)', { hasText: '设置' }).first();
    await settingsBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT_DIR, '04-settings.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch(e) { console.log('  Skipped settings:', e.message.split('\n')[0]); }
  
  // Screenshot 5: Type a message
  console.log('7. Screenshot 5: Typing...');
  try {
    // Try textarea first, then any editable
    let textarea = page.locator('textarea').first();
    const isVisible = await textarea.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      textarea = page.locator('[contenteditable="true"]').first();
    }
    await textarea.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.keyboard.type('Create a React dashboard with charts and dark theme', { delay: 40 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, '05-typing.png') });
  } catch(e) { console.log('  Skipped typing:', e.message.split('\n')[0]); }
  
  console.log('Done! Screenshots saved to', OUT_DIR);
  await browser.close();
})();
