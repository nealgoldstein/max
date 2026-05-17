const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  await page.goto('http://localhost:8765/index.html');
  await page.waitForFunction(() => typeof window.localLoad === 'function', { timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => ({
    localLoad: typeof window.localLoad,
    enterApp: typeof window.enterApp,
    buildFromCandidates: typeof window.buildFromCandidates,
    addBufferNight: typeof window.addBufferNight,
    MaxEngineTrip: typeof window.MaxEngineTrip,
  }));
  console.log('STATE:', JSON.stringify(state, null, 2));
  console.log('ERRORS:', errors.join('\n') || '(none)');
  await browser.close();
})();
