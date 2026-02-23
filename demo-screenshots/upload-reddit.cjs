const { chromium } = require('playwright-core');
const path = require('path');

const VIDEO_PATH = path.join(__dirname, 'promo-video.mp4');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Connecting to Chrome...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  
  // Find the current Reddit submit page
  const pages = context.pages();
  let page = null;
  for (const p of pages) {
    const url = p.url();
    if (url.includes('reddit.com') && url.includes('submit')) {
      page = p;
      break;
    }
  }
  if (!page) {
    console.log('No Reddit submit page found!');
    process.exit(1);
  }
  
  console.log('Found Reddit submit page:', page.url());
  
  // Use fileChooser event to upload via the Upload files button
  console.log('Setting up file chooser listener...');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('button', { name: 'Upload files' }).click()
  ]);
  
  console.log('File chooser opened, setting file...');
  await fileChooser.setFiles(VIDEO_PATH);
  console.log('Video file set! Waiting for upload processing...');
  
  // Wait for upload
  await sleep(45000);
  console.log('Upload wait done.');
  
  await page.screenshot({ path: path.join(__dirname, 'reddit-preview.png') });
  console.log('Preview screenshot saved.');
}

main().catch(console.error);
