// =============================================
// capture-presentation-shots.mjs
// Captures real UI screenshots of the system for the presentation deck.
// Runs the actual client (served separately) with a mocked Supabase session
// and mocked API data, so no real account or database access is needed.
//
// Usage:
//   1. python -m http.server 8123 --directory client
//   2. node scripts/capture-presentation-shots.mjs
// Output: presentation/shots/*.png
// =============================================
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { receiptPng, routeMocks, seedSession, BASE } from './lib-capture-mocks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'presentation', 'shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const USER_EMAIL = 'alex.reyes@g.cjc.edu.ph';

async function main() {
  const browser = await chromium.launch();
  const receipt = await receiptPng();

  // ---- Context 1: login screen (no session) ----
  const ctxLogin = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
  });
  const loginPage = await ctxLogin.newPage();
  await routeMocks(loginPage, receipt);
  await loginPage.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await loginPage.waitForTimeout(1500);
  await loginPage.screenshot({ path: path.join(OUT_DIR, 'login.png') });
  console.log('captured login.png');
  await ctxLogin.close();

  // ---- Context 2: authenticated admin session ----
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await routeMocks(page, receipt);
  await seedSession(page);

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('app-screen');
    return el && getComputedStyle(el).display !== 'none';
  }, { timeout: 30000 });
  await page.waitForFunction(() => (document.getElementById('stat-income')?.textContent || '').length > 1, { timeout: 15000 });
  await page.waitForTimeout(1800); // splash fade-out
  await page.screenshot({ path: path.join(OUT_DIR, 'dashboard.png') });
  console.log('captured dashboard.png');

  // Events view
  await page.click('.nav-item[data-view="events"]');
  await page.waitForSelector('#events-grid .event-card', { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT_DIR, 'events.png') });
  console.log('captured events.png');

  // Transactions ledger
  await page.click('.nav-item[data-view="transactions"]');
  await page.waitForSelector('table.data-table tbody tr', { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT_DIR, 'transactions.png') });
  console.log('captured transactions.png');

  // Receipt modal (digital receipt vault)
  const receiptBtn = page.locator('.receipt-link').first();
  if (await receiptBtn.count()) {
    await receiptBtn.click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT_DIR, 'receipt-modal.png') });
    console.log('captured receipt-modal.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // Reports view (charts)
  await page.click('.nav-item[data-view="reports"]');
  await page.waitForSelector('#monthly-chart', { timeout: 10000 });
  await page.waitForTimeout(1900); // chart.js animation
  await page.screenshot({ path: path.join(OUT_DIR, 'reports.png') });
  console.log('captured reports.png');

  // Grizz AI: welcome state, then a financial answer
  await page.click('.nav-item[data-view="dashboard"]');
  await page.waitForTimeout(600);
  const launcher = page.locator('#ursa-launcher-btn');
  if (await launcher.count()) {
    await launcher.click();
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(OUT_DIR, 'grizz-open.png') });
    console.log('captured grizz-open.png');

    // Run the "Explain Funds" action (JS click to bypass any overlay)
    await page.evaluate(() => {
      document.querySelector('.grizz-prompt-pill[data-action="financial-summary"]')?.click();
    });
    await page.waitForTimeout(2600); // streaming/typing animation
    await page.screenshot({ path: path.join(OUT_DIR, 'grizz-answer.png') });
    console.log('captured grizz-answer.png');
  }

  // Admin view (audit trail)
  await page.evaluate(() => { window.navigateTo && window.navigateTo('admin'); });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT_DIR, 'admin.png') });
  console.log('captured admin.png');

  await browser.close();
  console.log('DONE — shots in presentation/shots/');
}

main().catch(err => { console.error(err); process.exit(1); });
