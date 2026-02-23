/**
 * Test: Extension relay + Playwright connectOverCDP
 * 
 * Prerequisites:
 * 1. Chrome extension installed and enabled
 * 2. User opens a tab (e.g. https://claude.ai/new)
 * 3. User clicks extension button to attach tab
 * 
 * This script:
 * 1. Starts relay server
 * 2. Waits for extension to connect
 * 3. Waits for targets
 * 4. Connects Playwright via connectOverCDP
 * 5. Tests page.url(), page.title(), page.evaluate()
 */

import { ensureChromeExtensionRelayServer } from './dist/browser/extension-relay.js';

async function main() {
  console.log('=== Extension Relay + Playwright Test ===\n');

  // 1. Start relay
  console.log('1. Starting relay server...');
  const relay = await ensureChromeExtensionRelayServer({ cdpUrl: 'http://127.0.0.1:18792' });
  console.log(`   Relay started: ${relay.baseUrl}`);
  console.log(`   CDP WS: ${relay.cdpWsUrl}`);

  // 2. Wait for extension
  console.log('\n2. Waiting for extension to connect...');
  console.log('   (Click the extension button in Chrome on a tab you want to control)');
  
  const maxWait = 120000;
  const pollInterval = 1000;
  let waited = 0;
  while (waited < maxWait) {
    if (relay.extensionConnected()) break;
    await new Promise(r => setTimeout(r, pollInterval));
    waited += pollInterval;
    if (waited % 10000 === 0) {
      console.log(`   Still waiting... (${waited/1000}s)`);
    }
  }
  if (!relay.extensionConnected()) {
    console.error('   Extension did not connect within timeout');
    await relay.stop();
    process.exit(1);
  }
  console.log(`   Extension connected after ${waited/1000}s`);

  // 3. Wait for targets
  console.log('\n3. Waiting for targets...');
  waited = 0;
  while (waited < 30000) {
    if (relay.targetCount() > 0) break;
    await new Promise(r => setTimeout(r, 500));
    waited += 500;
  }
  if (relay.targetCount() === 0) {
    console.error('   No targets found');
    await relay.stop();
    process.exit(1);
  }
  console.log(`   Got ${relay.targetCount()} target(s)`);

  // 4. Connect Playwright
  console.log('\n4. Connecting Playwright via connectOverCDP...');
  const { chromium } = await import('playwright-core');
  
  try {
    const browser = await chromium.connectOverCDP(relay.cdpWsUrl, { timeout: 30000 });
    console.log('   Connected!');
    
    const contexts = browser.contexts();
    console.log(`   Contexts: ${contexts.length}`);
    
    if (contexts.length === 0) {
      console.error('   No contexts found');
      await browser.close();
      await relay.stop();
      process.exit(1);
    }

    const pages = contexts[0].pages();
    console.log(`   Pages: ${pages.length}`);
    
    if (pages.length === 0) {
      console.error('   No pages found');
      await browser.close();
      await relay.stop();
      process.exit(1);
    }

    const page = pages[0];

    // 5. Test page operations
    console.log('\n5. Testing page operations...');
    
    // Test page.url()
    const url = page.url();
    console.log(`   page.url(): "${url}"`);
    if (!url || url === '') {
      console.error('   FAIL: page.url() returned empty string!');
    } else {
      console.log('   PASS: page.url() returned a valid URL');
    }

    // Test page.title()
    console.log('   Testing page.title()...');
    try {
      const title = await Promise.race([
        page.title(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);
      console.log(`   page.title(): "${title}"`);
      console.log('   PASS: page.title() returned a value');
    } catch (e) {
      console.error(`   FAIL: page.title() failed: ${e.message}`);
    }

    // Test page.evaluate()
    console.log('   Testing page.evaluate()...');
    try {
      const result = await Promise.race([
        page.evaluate(() => ({ 
          title: document.title, 
          url: location.href, 
          webdriver: navigator.webdriver 
        })),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);
      console.log(`   page.evaluate() result:`, JSON.stringify(result));
      if (result.webdriver === false) {
        console.log('   PASS: navigator.webdriver === false (anti-detection working!)');
      } else {
        console.log('   INFO: navigator.webdriver =', result.webdriver);
      }
    } catch (e) {
      console.error(`   FAIL: page.evaluate() failed: ${e.message}`);
    }

    // Test ariaSnapshot (needed for ref system)
    console.log('   Testing locator.ariaSnapshot()...');
    try {
      const snap = await Promise.race([
        page.locator('body').ariaSnapshot({ timeout: 10000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
      ]);
      if (snap) {
        const lines = snap.split('\n');
        console.log(`   ariaSnapshot: ${lines.length} lines`);
        console.log(`   First 3 lines:\n${lines.slice(0, 3).map(l => '     ' + l).join('\n')}`);
        console.log('   PASS: ariaSnapshot() returned content');
      } else {
        console.log('   WARN: ariaSnapshot() returned null/empty');
      }
    } catch (e) {
      console.error(`   FAIL: ariaSnapshot() failed: ${e.message}`);
    }

    // Test screenshot
    console.log('   Testing page.screenshot()...');
    try {
      const buf = await Promise.race([
        page.screenshot(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
      ]);
      console.log(`   screenshot: ${buf.length} bytes`);
      console.log('   PASS: screenshot() returned a buffer');
    } catch (e) {
      console.error(`   FAIL: screenshot() failed: ${e.message}`);
    }

    console.log('\n=== Test Complete ===');
    
    await browser.close().catch(() => {});
  } catch (e) {
    console.error(`   Playwright connection failed: ${e.message}`);
    console.error(e.stack);
  }

  await relay.stop();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
