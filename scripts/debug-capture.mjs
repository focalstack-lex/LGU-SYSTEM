import { chromium } from 'playwright';
import { receiptPng, routeMocks, seedSession, attachLogging, BASE } from './lib-capture-mocks.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
});
const page = await ctx.newPage();
attachLogging(page);
await routeMocks(page, await receiptPng(), { verbose: true });
await seedSession(page);

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);

const state = await page.evaluate(() => ({
  appScreen: (() => { const el = document.getElementById('app-screen'); return el ? getComputedStyle(el).display : 'missing'; })(),
  loginScreen: (() => { const el = document.getElementById('login-screen'); return el ? getComputedStyle(el).display : 'missing'; })(),
  splash: (() => { const el = document.getElementById('splash-screen'); return el ? getComputedStyle(el).visibility : 'missing'; })(),
  statIncome: document.getElementById('stat-income')?.textContent,
  userName: document.getElementById('user-name')?.textContent,
  lsKeys: Object.keys(localStorage),
  bodyError: document.querySelector('.login-error, #login-error')?.textContent?.slice(0, 150) || null,
}));
console.log('STATE:', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'presentation/shots/debug.png' });
await browser.close();
