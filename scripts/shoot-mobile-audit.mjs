/** Screenshot the forced app shell + officer portal across the dead zone (read-only). */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:3000';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'mobile-responsive', 'shots');
mkdirSync(OUT, { recursive: true });

const FORCE_APP = () => {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-screen');
  if (auth) { auth.classList.remove('active'); auth.style.display = 'none'; }
  if (app) { app.classList.add('active'); app.style.display = 'block'; }
  document.querySelectorAll('.skeleton-overlay, #skeleton-overlay').forEach((s) => (s.style.display = 'none'));
  // mimic the JS nav reveal so the mobile nav is in its real runtime state
  document.querySelector('.bottom-nav')?.classList.add('visible');
  document.querySelector('.app-mobile-header')?.classList.add('visible');
};

const main = async () => {
  const browser = await chromium.launch();
  for (const [w, h, tag] of [[390, 844, 'iphone'], [600, 900, 'deadzone-600'], [768, 1024, 'deadzone-768'], [769, 1024, 'just-above-769']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w <= 480, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.evaluate(FORCE_APP);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, `student-shell-${tag}-${w}.png`) });
    console.log(`student-shell-${tag}-${w}.png`);
    await ctx.close();
  }
  // officer gate screen at a phone width
  for (const [w, h, tag] of [[390, 844, 'iphone']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/officer.html', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(OUT, `officer-${tag}-${w}.png`) });
    console.log(`officer-${tag}-${w}.png`);
    await ctx.close();
  }
  await browser.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
