/**
 * Discord Multi-Server Promotional Campaign
 * Posts tailored messages to multiple Discord communities
 * 
 * Usage: node discord-campaign.cjs [--dry-run] [--target <name>]
 *   --dry-run    Print messages without posting
 *   --target     Only post to specific server (e.g. "anthropic", "cursor")
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME_USER_DATA = 'C:\\Users\\wangbj\\.axon\\browser\\default\\user-data';
const PROMO_IMAGE = path.join(__dirname, 'discord-promo.png');
const DEMO_GIF = path.join(__dirname, 'demo.gif');

// ============================================================
// TAILORED MESSAGES PER COMMUNITY
// ============================================================

const TARGETS = [
  {
    id: 'anthropic',
    name: 'Anthropic Community',
    serverText: 'Anthropic',         // text to find server icon in sidebar
    channelText: 'share-projects',   // channel name to click
    attachImage: true,
    message: `**Axon — Open-Source AI Coding Platform with Web IDE**

Hi Anthropic community! I built an open-source AI coding platform that extends the CLI into a full platform:

**What makes it different from the official CLI:**
- **Full Web UI IDE** — Monaco editor, file tree, AI-enhanced code editing, live streaming
- **Blueprint Multi-Agent** — Smart Planner + Lead Agent + Workers running tasks in parallel
- **Self-Evolution** — The AI can modify its own source code and hot-reload
- **Scheduled Task Daemon** — Background AI workflows with natural language scheduling
- **Memory System** — Vector store + BM25 search across sessions
- **Full MCP Protocol** — stdio, HTTP, SSE with auto-discovery

37+ built-in tools, MIT licensed, 129 stars.
One-click install for Windows/macOS/Linux.

**GitHub:** https://github.com/kill136/axon
**Live Demo:** http://voicegpt.site:3456/
**Discord:** https://discord.gg/bNyJKk6PVZ

Would love feedback from fellow Claude developers!`
  },
  {
    id: 'cursor',
    name: 'Cursor',
    serverText: 'Cursor',
    channelText: 'showcase',
    attachImage: true,
    message: `**Open-Source AI Coding Platform — Web IDE + Multi-Agent + 37 Tools**

Built an open-source AI coding platform that takes a different approach:

Instead of a desktop app, it runs as a **Web IDE** accessible from any browser — with Monaco editor, file tree, and real-time AI streaming.

**Highlights:**
- **Blueprint Multi-Agent System** — breaks complex tasks across multiple AI agents working in parallel (Smart Planner → Lead Agent → Autonomous Workers)
- **37+ Built-in Tools** — file ops, code search (ripgrep), browser automation, task scheduling, MCP protocol
- **Self-Evolution** — AI can modify its own source, run TypeScript checks, and hot-reload
- **One-Click Install** — download + double-click on Windows, single curl on Mac/Linux
- **Fully open source (MIT)** — no black boxes, 129⭐ on GitHub

Works with Anthropic API, AWS Bedrock, and Google Vertex AI.

**Try it:** http://voicegpt.site:3456/
**GitHub:** https://github.com/kill136/axon
**Discord:** https://discord.gg/bNyJKk6PVZ`
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    serverText: 'Windsurf',
    channelText: 'showcase',
    attachImage: true,
    message: `**Axon — Open Source AI IDE with Multi-Agent & Self-Evolution**

Sharing my open-source project: a full AI coding platform with Web IDE and multi-agent orchestration.

**What it does:**
- **Browser-based IDE** — Monaco editor, VS Code-style file tree, AI hover tips, code tours
- **Blueprint System** — Multiple AI agents collaborate on complex tasks (planning, executing, reviewing)
- **37+ Tools** — Everything from file ops to browser automation to scheduled tasks
- **Self-Evolution** — The AI can edit its own source code, type-check, and restart itself
- **One-Click Installer** — Handles all deps automatically (Node.js, Git, build tools)

Fully MIT licensed, 129 stars, actively maintained.

**Live Demo:** http://voicegpt.site:3456/
**GitHub:** https://github.com/kill136/axon
**Our Discord:** https://discord.gg/bNyJKk6PVZ

Feedback welcome!`
  },
  {
    id: 'continue',
    name: 'Continue',
    serverText: 'Continue',
    channelText: 'general',
    attachImage: false,
    message: `**Open-Source AI Coding Platform with MCP Protocol & Multi-Agent**

Hey Continue community! Built something you might find interesting — an open-source AI coding platform with full MCP protocol support.

**Key features for the open-source crowd:**
- **Complete MCP implementation** — stdio, HTTP, SSE transports with auto-discovery
- **Web UI IDE** — No desktop app needed, runs in any browser
- **Multi-Agent Blueprint** — Complex tasks split across parallel AI workers
- **Plugin & Hook System** — Extensible architecture with lifecycle hooks
- **MIT Licensed** — Full source, no telemetry, self-hosted

Built with TypeScript, React, Express, WebSocket. 129⭐ 50 forks.

**GitHub:** https://github.com/kill136/axon
**Try it:** http://voicegpt.site:3456/`
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    serverText: 'Hugging Face',
    channelText: 'show-and-tell',
    channelFallback: 'general',
    attachImage: true,
    message: `**Axon — Multi-Agent AI Coding Platform (Open Source)**

Built an open-source AI coding platform featuring a multi-agent system for complex task orchestration:

**Architecture highlights:**
- **Blueprint Multi-Agent** — Smart Planner decomposes tasks → Lead Agent coordinates → Autonomous Workers execute in parallel → Quality Reviewer validates
- **Memory System** — Vector store + BM25 search + intent extraction for persistent conversation memory
- **37+ Tools** — Code parsing (Tree-sitter WASM), ripgrep search, browser automation, LSP integration
- **Self-Evolution** — AI modifies its own TypeScript source, compiles, and hot-reloads
- **MCP Protocol** — Full Model Context Protocol for tool integration

Web IDE with Monaco editor, multi-provider (Anthropic/Bedrock/Vertex), MIT licensed.
129 stars, actively developed.

**GitHub:** https://github.com/kill136/axon
**Live Demo:** http://voicegpt.site:3456/`
  },
  {
    id: 'n8n',
    name: 'n8n',
    serverText: 'n8n',
    channelText: 'general',
    attachImage: false,
    message: `**Open-Source AI Coding Platform with Task Scheduling & Automation**

Built an open-source AI platform that includes a powerful automation layer:

- **Scheduled Task Daemon** — Natural language scheduling ("every day at 9am", "in 2 hours"), file watching, multi-channel notifications (desktop + Feishu/Lark)
- **MCP Protocol** — Full Model Context Protocol for integrating external tools (stdio, HTTP, SSE)
- **Hook System** — Pre/post execution hooks for custom automation scripts
- **37+ Built-in Tools** — File ops, web scraping, browser automation, code analysis
- **Web IDE** — Full browser-based IDE with real-time AI streaming

Think of it as an AI coding assistant with n8n-like automation capabilities built in.
MIT licensed, 129⭐ on GitHub.

**GitHub:** https://github.com/kill136/axon
**Demo:** http://voicegpt.site:3456/`
  },
];

// ============================================================
// DISCORD AUTOMATION
// ============================================================

async function typeInDiscord(page, text) {
  const textbox = page.locator('[role="textbox"][data-slate-editor="true"]').first();
  await textbox.waitFor({ state: 'visible', timeout: 15000 });
  await textbox.click();
  await page.waitForTimeout(300);

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
    }
    if (lines[i].length > 0) {
      const chunks = lines[i].match(/.{1,80}/g) || [];
      for (const chunk of chunks) {
        await page.keyboard.type(chunk, { delay: 3 });
      }
    }
  }
}

async function attachFile(page, filePath) {
  // Click the + button to open attachment menu
  const attachBtn = page.locator('button[aria-label*="Upload"]').first();
  try {
    await attachBtn.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    
    // Click "Upload a File" option
    const uploadOption = page.locator('text=Upload a File').first();
    await uploadOption.click({ timeout: 3000 });
    await page.waitForTimeout(500);
  } catch {
    // Alternative: directly set file input
  }
  
  // Set the file on the hidden input
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(2000);
}

async function navigateToServer(page, serverText) {
  // Try to find server in sidebar by alt text or aria-label
  const selectors = [
    `[data-list-item-id*="guildsnav"] img[alt="${serverText}"]`,
    `[data-list-item-id*="guildsnav"][aria-label*="${serverText}"]`,
    `div[data-list-item-id*="guildsnav"]:has(img[alt*="${serverText}"])`,
  ];
  
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(2000);
      return true;
    } catch { /* try next */ }
  }
  
  // Fallback: search by text
  try {
    const textEl = page.locator(`text=${serverText}`).first();
    await textEl.click({ timeout: 3000 });
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

async function navigateToChannel(page, channelText, fallback) {
  const selectors = [
    `a[href*="/"]:has-text("${channelText}")`,
    `[class*="name"]:has-text("${channelText}")`,
  ];
  
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      return true;
    } catch { /* try next */ }
  }
  
  // Try fallback channel
  if (fallback) {
    try {
      const el = page.locator(`a:has-text("${fallback}")`).first();
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      return true;
    } catch { /* */ }
  }
  
  return false;
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetIdx = args.indexOf('--target');
  const targetFilter = targetIdx >= 0 ? args[targetIdx + 1] : null;

  const targets = targetFilter 
    ? TARGETS.filter(t => t.id === targetFilter)
    : TARGETS;

  if (targets.length === 0) {
    console.error(`Target "${targetFilter}" not found. Available: ${TARGETS.map(t => t.id).join(', ')}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('=== DRY RUN MODE ===\n');
    for (const t of targets) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`SERVER: ${t.name} | CHANNEL: #${t.channelText}`);
      console.log(`IMAGE: ${t.attachImage ? 'Yes' : 'No'}`);
      console.log('='.repeat(60));
      console.log(t.message);
    }
    console.log(`\n\nTotal: ${targets.length} messages ready.`);
    process.exit(0);
  }

  console.log(`Launching browser (${targets.length} targets)...`);
  
  const browser = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = browser.pages()[0] || await browser.newPage();
  
  // Navigate to Discord home
  console.log('Opening Discord...');
  await page.goto('https://discord.com/channels/@me', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const results = [];

  for (const target of targets) {
    console.log(`\n--- ${target.name} (#${target.channelText}) ---`);
    
    try {
      // Navigate to server
      console.log(`  Finding server "${target.serverText}"...`);
      const foundServer = await navigateToServer(page, target.serverText);
      if (!foundServer) {
        console.log(`  ❌ Server not found, skipping`);
        results.push({ name: target.name, status: 'SKIP', reason: 'Server not found' });
        continue;
      }

      // Navigate to channel
      console.log(`  Finding channel #${target.channelText}...`);
      const foundChannel = await navigateToChannel(page, target.channelText, target.channelFallback);
      if (!foundChannel) {
        console.log(`  ❌ Channel not found, skipping`);
        results.push({ name: target.name, status: 'SKIP', reason: 'Channel not found' });
        continue;
      }

      // Attach image if needed
      if (target.attachImage && fs.existsSync(PROMO_IMAGE)) {
        console.log(`  Attaching promo image...`);
        try {
          await attachFile(page, PROMO_IMAGE);
        } catch (e) {
          console.log(`  ⚠️ Image attach failed: ${e.message}`);
        }
      }

      // Type message
      console.log(`  Typing message (${target.message.length} chars)...`);
      await typeInDiscord(page, target.message);
      await page.waitForTimeout(1000);

      // Screenshot before send
      const ssPath = path.join(__dirname, `discord-pre-${target.id}.png`);
      await page.screenshot({ path: ssPath });
      console.log(`  📸 Screenshot: ${ssPath}`);

      // Send
      console.log(`  Sending...`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);

      // Screenshot after send
      const ssPostPath = path.join(__dirname, `discord-posted-${target.id}.png`);
      await page.screenshot({ path: ssPostPath });
      
      console.log(`  ✅ Posted!`);
      results.push({ name: target.name, status: 'OK' });

      // Wait between posts to avoid rate limiting
      console.log(`  Waiting 10s before next post...`);
      await page.waitForTimeout(10000);

    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      results.push({ name: target.name, status: 'FAIL', reason: e.message });
    }
  }

  // Summary
  console.log('\n\n========== CAMPAIGN SUMMARY ==========');
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : r.status === 'SKIP' ? '⏭️' : '❌';
    console.log(`  ${icon} ${r.name}: ${r.status}${r.reason ? ' — ' + r.reason : ''}`);
  }
  console.log(`\nTotal: ${results.filter(r => r.status === 'OK').length}/${results.length} posted`);

  console.log('\nClosing browser...');
  await browser.close();
})();
