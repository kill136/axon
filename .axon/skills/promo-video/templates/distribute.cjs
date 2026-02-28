/**
 * Upload promo video to social media platforms using Playwright.
 * Connects to the existing Chrome browser instance.
 */
const { chromium } = require('playwright-core');
const path = require('path');

const VIDEO_PATH = path.join(__dirname, 'promo-video.mp4');
const SCREENSHOT_PATH = path.join(__dirname, '01-main.png');

// CDP endpoint for the running Chrome
const CDP_URL = 'http://127.0.0.1:9222';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function postToTwitter(browser) {
  console.log('\n=== Twitter/X ===');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  
  await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  
  // Click "添加照片或视频" button / file input
  const fileInput = page.locator('input[type="file"][accept*="video/mp4"]').first();
  await fileInput.setInputFiles(VIDEO_PATH);
  console.log('Video file set, waiting for upload & processing...');
  
  // Wait for video to be uploaded and processed (16MB can take a while)
  // Look for the video thumbnail / progress indicator to finish
  await sleep(30000);
  console.log('Upload wait done. Typing text...');
  
  // Type the tweet text using keyboard (contenteditable doesn't support fill)
  const textbox = page.locator('[data-testid="tweetTextarea_0"]');
  await textbox.click();
  await sleep(500);
  
  const tweetText = `Open-sourced: Axon

Full AI coding platform with Web IDE + Multi-Agent + 37+ Tools

MIT licensed. Runs locally.

github.com/kill136/axon

#OpenSource #AI #Axon`;
  
  await page.keyboard.type(tweetText, { delay: 15 });
  await sleep(2000);
  
  // Take a screenshot before posting
  await page.screenshot({ path: path.join(__dirname, 'twitter-preview.png') });
  console.log('Preview saved. Posting...');
  
  // Click post button
  const postBtn = page.locator('[data-testid="tweetButton"]');
  await postBtn.click();
  await sleep(3000);
  
  console.log('Twitter post sent!');
  await page.screenshot({ path: path.join(__dirname, 'twitter-posted.png') });
}

async function postToReddit(browser, subreddit, title, body) {
  console.log(`\n=== Reddit r/${subreddit} ===`);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  
  await page.goto(`https://www.reddit.com/r/${subreddit}/submit?type=link`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: path.join(__dirname, `reddit-${subreddit}-page.png`) });
  console.log(`Navigated to r/${subreddit} submit page`);
  
  return page;
}

async function main() {
  console.log('Connecting to Chrome CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log('Connected!');
  
  const action = process.argv[2] || 'twitter';
  
  switch (action) {
    case 'twitter':
      await postToTwitter(browser);
      break;
    case 'reddit':
      const sub = process.argv[3] || 'programming';
      await postToReddit(browser, sub);
      break;
    default:
      console.log('Usage: node upload-video.cjs [twitter|reddit] [subreddit]');
  }
  
  // Don't disconnect - keep browser alive
  console.log('\nDone!');
}

main().catch(console.error);
