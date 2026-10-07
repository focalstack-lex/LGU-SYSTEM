// Run with the server up (npm start, port 3000): node scripts/verify-cv-builder-header.mjs [outDir]
// Captures the CV builder header at phone widths in three save states with the mocked
// session, prints layout metrics, and fails if a header button is under 40px or the
// right group leaves the viewport. Evidence lands in reports/ui-verification/<date>-cv-builder-header/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { routeMocks, seedSession, receiptPng } from './lib-capture-mocks.mjs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || `reports/ui-verification/${new Date().toISOString().slice(0, 10)}-cv-builder-header`;
let failures = 0;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const w of [320, 360, 375, 414]) {
  const page = await browser.newPage({ viewport: { width: w, height: 740 }, deviceScaleFactor: 2 });
  await seedSession(page);
  await routeMocks(page, await receiptPng());
  await page.goto(BASE + '/cv-builder', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  for (const state of ['saved', 'offline', 'error']) {
    await page.evaluate((s) => {
      const el = document.getElementById('cv-status');
      const t = document.getElementById('cv-status-text');
      const TXT = { saved: 'All changes saved', offline: 'Offline: kept in this browser', error: 'Not saved. Tap to retry' };
      el.dataset.state = s; t.textContent = TXT[s];
    }, state);
    const m = await page.evaluate(() => {
      const inner = document.querySelector('.cv-header-inner');
      const right = document.querySelector('.cv-header-right');
      const status = document.getElementById('cv-status');
      const text = document.getElementById('cv-status-text');
      const btns = [...document.querySelectorAll('.cv-header-btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      return {
        docOverflow: document.documentElement.scrollWidth > window.innerWidth,
        innerW: Math.round(inner.getBoundingClientRect().width),
        rightRight: Math.round(right.getBoundingClientRect().right),
        statusW: Math.round(status.getBoundingClientRect().width),
        textClipped: text.scrollWidth > text.clientWidth + 1,
        btns
      };
    });
    const ok = !m.docOverflow && m.rightRight <= w && m.btns.every(([bw, bh]) => bw >= 40 && bh >= 40);
    if (!ok) failures++;
    console.log(ok ? 'PASS ' : 'FAIL ', w, state, JSON.stringify(m));
    await page.locator('.cv-app-header').screenshot({ path: `${OUT}/header-${w}-${state}.png` });
  }
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} failing capture(s)` : 'all captures pass');
process.exit(failures ? 1 : 0);
