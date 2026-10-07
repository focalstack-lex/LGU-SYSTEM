// Run with the server up (npm start, port 3000): node scripts/verify-app-shell-fill.mjs [outDir]
// Reproduces the phone login hand-off: the auth screen is a scrolling document, the app
// screen is a fixed-height shell. If the document is still scrolled when the app screen
// appears, a band of page background shows under the shell. Emulates iPhone 11 (414x896),
// iPhone SE (375x667) and a 360px Android, scrolls the auth document, switches to the app
// screen through UI.showScreen and asserts the shell fills the viewport with scrollY 0.
// Evidence lands in reports/ui-verification/<date>-app-shell-fill/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { routeMocks, receiptPng } from './lib-capture-mocks.mjs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || `reports/ui-verification/${new Date().toISOString().slice(0, 10)}-app-shell-fill`;
mkdirSync(OUT, { recursive: true });
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PHONES = [
  { name: 'iphone-11', width: 414, height: 896 },
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'android-360', width: 360, height: 780 },
];
let failures = 0;
const browser = await chromium.launch();
for (const p of PHONES) {
  const page = await browser.newPage({ viewport: { width: p.width, height: p.height }, isMobile: true, hasTouch: true, userAgent: IOS_UA, deviceScaleFactor: 2 });
  await routeMocks(page, await receiptPng());
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // Make the auth document scrollable the way a focused input and the keyboard do on iOS,
  // then scroll it as the user would have before tapping Sign in.
  await page.evaluate(() => {
    const auth = document.getElementById('auth-screen');
    auth.style.minHeight = (window.innerHeight + 400) + 'px';
    window.scrollTo(0, 160);
  });
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    document.getElementById('auth-screen').style.minHeight = '';
    UI.showScreen('app');
    document.getElementById('bottom-nav')?.classList.add('visible');
  });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const app = document.getElementById('app-screen').getBoundingClientRect();
    let declaresDvh = false;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) if (r.selectorText === '#app-screen' && /100dvh/.test(r.style.cssText)) declaresDvh = true;
    }
    return { declaresDvh, scrollY: window.scrollY, innerH: window.innerHeight, appTop: Math.round(app.top), appBottom: Math.round(app.bottom), appH: Math.round(app.height), docH: document.documentElement.scrollHeight };
  });
  const ok = m.declaresDvh && m.scrollY === 0 && m.appTop === 0 && m.appBottom === m.innerH && m.docH <= m.innerH + 1;
  if (!ok) failures++;
  console.log(ok ? 'PASS ' : 'FAIL ', p.name, `scrolled ${before}px before switch ->`, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/${p.name}-after-login.png`, fullPage: false });
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} failing phone(s)` : 'all phones fill the viewport');
process.exit(failures ? 1 : 0);
