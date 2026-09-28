// Run with the server up (npm start, port 3000): node scripts/verify-icons-offline.mjs
// Blocks the online Iconify API, opens every portal view, and fails if any
// visible <iconify-icon> has no rendered SVG (misspelled name, or an icon
// missing from client/vendor/icons-bundle.js). Backend is mocked.
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng } from './lib-capture-mocks.mjs';

const BASE = 'http://127.0.0.1:3000';
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const ADMIN = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'admin', course: 'BSCoE', year_level: '3' };
const SUBJECTS = [];
for (let y = 1; y <= 4; y++) for (let k = 1; k <= 4; k++) SUBJECTS.push({ id: `s${y}${k}`, code: `CPE ${y}${k}`, title: `Subject ${y}.${k}`, units: 3, year_level: y, semester: 1 + (k % 2) });

const PAGES = [
  { name: 'student', url: '/', views: ['dashboard', 'events', 'transactions', 'income', 'reports', 'units', 'enrollment', 'admin'] },
  { name: 'officer', url: '/officer.html', views: null },
  { name: 'faculty', url: '/faculty.html', views: [] },
  { name: 'login', url: '/', views: [], noSession: true },
];

const browser = await chromium.launch({ headless: true });
const receipt = await receiptPng();
const missing = [];
let checked = 0;
let apiCalls = 0;

for (const P of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/api\.iconify\.design/, r => { apiCalls++; r.abort(); });
  if (!P.noSession) {
    await seedSession(page);
    await routeMocks(page, receipt);
    await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
      const obj = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object');
      r.fulfill(json(obj ? ADMIN : [ADMIN]));
    });
    await page.route(/\/api\/units\/checklists/, r => r.fulfill(json({ subjects: SUBJECTS, requirements: [] })));
    await page.route(/\/api\/units\/my/, r => r.fulfill(json([])));
    await page.route(/\/api\/enrollment\/submissions\/my/, r => r.fulfill(json({ submissions: [{ id: 'sub1', school_year: '2026-2027', semester: 1, status: 'draft', enrollment_submission_items: [] }] })));
  } else {
    await page.route(/\/sw\.js/, r => r.fulfill({ status: 404, body: '' }));
  }
  await page.goto(BASE + P.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const views = P.views ?? await page.evaluate(() => [...document.querySelectorAll('.nav-item[data-of]')].map(e => e.dataset.of));
  for (const view of [null, ...views]) {
    if (view) {
      await page.evaluate(async (v) => {
        try {
          if (typeof UI !== 'undefined' && document.getElementById(`view-${v}`)) {
            UI.showView(v);
            const loaders = { events: typeof Events !== 'undefined' ? Events : null, transactions: typeof Transactions !== 'undefined' ? Transactions : null, reports: window.Reports || null, admin: typeof Admin !== 'undefined' ? Admin : null };
            if (v === 'enrollment' && window.Enrollment) await window.Enrollment.ensureReady();
            else if (loaders[v]) await (loaders[v].load || loaders[v].init)?.();
          } else {
            document.querySelector(`.nav-item[data-of="${v}"]`)?.click();
          }
        } catch { /* load failures are not icon failures */ }
      }, view);
      await page.waitForTimeout(700);
    }
    // <iconify-icon> renders lazily once on screen, so scroll through the page
    // and judge only icons inside the viewport at each step.
    const found = [];
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 800) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(Number(process.env.ICON_WAIT || 250));
      found.push(...await page.evaluate(() => [...document.querySelectorAll('iconify-icon')]
        .filter(i => {
          // A blank icon has zero size, so judge placement by its parent
          const host = i.parentElement;
          if (!host) return false;
          const r = host.getBoundingClientRect();
          if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
          const cs = getComputedStyle(i);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(getComputedStyle(host).opacity) === 0) return false;
          // Must actually be seen: not clipped by an inner scroll container or covered
          const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
          return !!hit && (hit === host || host.contains(hit));
        })
        .map(i => ({ icon: i.getAttribute('icon'), rendered: !!i.shadowRoot?.querySelector('svg') }))));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    checked += found.length;
    for (const f of found) if (!f.rendered) missing.push(`${P.name}/${view || 'initial'}: ${f.icon}`);
  }
  await page.close();
}
await browser.close();
const unique = [...new Set(missing)];
unique.forEach(m => console.log('BLANK ' + m));
console.log(`\nicons checked: ${checked}, blank: ${unique.length}, blocked Iconify API calls: ${apiCalls}`);
process.exit(unique.length ? 1 : 0);
