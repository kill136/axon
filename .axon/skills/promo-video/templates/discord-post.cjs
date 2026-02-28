/**
 * Post promotion message to Discord channels via Playwright.
 * Uses existing Chrome profile to reuse login session.
 */
const { chromium } = require('playwright-core');

const CHROME_USER_DATA = 'C:\\Users\\wangbj\\.axon\\browser\\default\\user-data';

// Channels to post to (server_id/channel_id)
const TARGETS = [
  {
    name: 'Windsurf #showcase',
    // We need to find the actual channel ID. For now use the server ID approach.
    url: null, // will navigate via sidebar
  },
];

const MESSAGE = `**Axon — Open Source AI Coding Platform with Web IDE & Multi-Agent System**

Built an open-source AI coding platform that goes beyond just CLI:

**Key Features:**
- **Web UI IDE** — Full browser IDE with Monaco editor, file tree, AI-enhanced code editing
- **37+ Built-in Tools** — File ops, search, browser automation, scheduled tasks, MCP protocol
- **Multi-Agent Blueprint System** — Smart Planner + Lead Agent + Autonomous Workers in parallel
- **Self-Evolution** — AI can modify its own source code and hot-reload
- **One-Click Install** — Windows/macOS/Linux with auto dependency detection
- **MIT Licensed** — Fully open source, no black boxes

126 stars on GitHub, actively maintained.

GitHub: https://github.com/kill136/axon
Live Demo: http://voicegpt.site:3456/
Discord: https://discord.gg/bNyJKk6PVZ

Feedback welcome!`;

async function typeInDiscord(page, text) {
  // Discord uses Slate editor, need to find the textbox
  const textbox = page.locator('[role="textbox"][data-slate-editor="true"]').first();
  await textbox.waitFor({ state: 'visible', timeout: 10000 });
  await textbox.click();
  await page.waitForTimeout(300);
  
  // Type line by line, using Shift+Enter for newlines
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
    }
    if (lines[i].length > 0) {
      // Type in chunks to avoid timeout
      const chunks = lines[i].match(/.{1,50}/g) || [];
      for (const chunk of chunks) {
        await page.keyboard.type(chunk, { delay: 5 });
      }
    }
  }
}

(async () => {
  console.log('Launching browser with existing profile...');
  
  const browser = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    viewport: { width: 1400, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  
  const page = browser.pages()[0] || await browser.newPage();
  
  // Navigate to Discord - Windsurf server
  console.log('Navigating to Discord...');
  await page.goto('https://discord.com/channels/@me', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  console.log('Looking for Windsurf server...');
  // Click on Windsurf server in sidebar
  const windsurf = page.locator('[data-list-item-id*="guildsnav"] img[alt="Windsurf"]').first();
  try {
    await windsurf.click({ timeout: 5000 });
  } catch {
    // Try tree item
    const windsurfItem = page.locator('text=Windsurf').first();
    await windsurfItem.click({ timeout: 5000 });
  }
  await page.waitForTimeout(2000);
  
  // Find and click showcase channel
  console.log('Finding #showcase channel...');
  const showcase = page.locator('a', { hasText: 'showcase' }).first();
  await showcase.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  
  // Take screenshot before posting
  await page.screenshot({ path: 'F:/axon/demo-screenshots/pre-post-windsurf.png' });
  
  // Type the message
  console.log('Typing message...');
  await typeInDiscord(page, MESSAGE);
  await page.waitForTimeout(1000);
  
  // Take screenshot of typed message
  await page.screenshot({ path: 'F:/axon/demo-screenshots/typed-windsurf.png' });
  
  console.log('Message typed! Press Enter to send or check the screenshot.');
  console.log('Sending in 3 seconds...');
  await page.waitForTimeout(3000);
  
  // Send the message
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  
  // Take screenshot after posting
  await page.screenshot({ path: 'F:/axon/demo-screenshots/posted-windsurf.png' });
  console.log('Posted to Windsurf #showcase!');
  
  // Now go to Continue server
  console.log('\nNavigating to Continue server...');
  const continueItem = page.locator('[data-list-item-id*="guildsnav"]').filter({ hasText: 'Continue' }).first();
  try {
    await continueItem.click({ timeout: 5000 });
  } catch {
    const contItem = page.locator('text=Continue').first();
    await contItem.click({ timeout: 5000 });
  }
  await page.waitForTimeout(3000);
  
  // Look for general or share channel
  const generalCh = page.locator('a', { hasText: 'general' }).first();
  await generalCh.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  
  console.log('Typing in Continue #general...');
  await typeInDiscord(page, MESSAGE);
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'F:/axon/demo-screenshots/posted-continue.png' });
  console.log('Posted to Continue #general!');
  
  console.log('\nDone! Closing browser...');
  await browser.close();
})();
