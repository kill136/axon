const {chromium} = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    executablePath: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    headless: true
  });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 675 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:9876/twitter-promo.html', { waitUntil: 'networkidle' });
  await p.screenshot({ path: String.raw`F:\axon\demo-screenshots\twitter-card.png`, type: 'png' });
  await b.close();
  console.log('DONE');
})();
