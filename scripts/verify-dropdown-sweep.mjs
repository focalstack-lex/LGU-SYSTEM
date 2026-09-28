// Run with the server up (npm start, port 3000): node scripts/verify-dropdown-sweep.mjs [outDir]
// Opens every custom dropdown (.dd) in every portal view at phone and desktop
// sizes, with the trigger placed near the top and near the bottom of the
// screen, and flags menus that leave the viewport, overlap their trigger,
// hide under the bottom nav, or cut off an option in a list short enough to
// show whole. Backend is mocked (scripts/lib-capture-mocks.mjs).
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng } from './lib-capture-mocks.mjs';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || `reports/ui-verification/${new Date().toISOString().replace(/[:.]/g, '-')}-dropdowns`;
fs.mkdirSync(OUT, { recursive: true });
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

const SUBJECTS = [];
for (let y = 1; y <= 4; y++) for (let s = 1; s <= 2; s++) for (let k = 1; k <= 3; k++) {
  SUBJECTS.push({ id: `s${y}${s}${k}`, code: `CPE ${y}${s}${k}`, title: `Engineering Subject ${y}.${s}.${k}`, units: 3, year_level: y, semester: s, program: 'BSCoE' });
}
const now = new Date();
const SY = now.getMonth() >= 5 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
const DRAFT = { id: 'sub1', school_year: SY, semester: 1, status: 'draft', enrollment_submission_items: [] };

const PAGES = [
  { name: 'student', url: '/', views: ['dashboard', 'events', 'transactions', 'income', 'reports', 'units', 'enrollment', 'admin'] },
  { name: 'officer', url: '/officer.html', views: null },
];
const VIEWPORTS = [[375, 812], [320, 640], [1440, 900]];

const browser = await chromium.launch({ headless: true });
const receipt = await receiptPng();
const problems = [];
let opened = 0;
const coverage = {};
const skipped = {};

async function setup(page) {
  await seedSession(page);
  await routeMocks(page, receipt);
  const ADMIN = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'admin', course: 'BSCoE', year_level: '3' };
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const wantsObject = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object');
    r.fulfill(json(wantsObject ? ADMIN : [ADMIN]));
  });
  await page.route(/\/api\/units\/checklists/, r => r.fulfill(json({ subjects: SUBJECTS, requirements: [] })));
  await page.route(/\/api\/units\/my/, r => r.fulfill(json([])));
  await page.route(/\/api\/enrollment\/submissions\/my/, r => r.fulfill(json({ submissions: [DRAFT] })));
}

async function inspectOpenMenu(page, idx) {
  return page.evaluate((i) => {
    const dd = document.querySelectorAll('.dd')[i];
    const menu = dd.querySelector('.dd-menu');
    const t = dd.querySelector('.dd-trigger').getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const issues = [];
    if (m.left < 0 || m.right > vw + 0.5) issues.push(`off-screen horizontally (${Math.round(m.left)}..${Math.round(m.right)} of ${vw})`);
    if (m.top < 0 || m.bottom > vh + 0.5) issues.push(`off-screen vertically (${Math.round(m.top)}..${Math.round(m.bottom)} of ${vh})`);
    const overlapY = Math.min(m.bottom, t.bottom) - Math.max(m.top, t.top);
    const overlapX = Math.min(m.right, t.right) - Math.max(m.left, t.left);
    if (overlapY > 1 && overlapX > 1) issues.push(`overlaps its trigger by ${Math.round(overlapY)}px`);
    for (const id of ['bottom-nav', 'of-bottom-nav']) {
      const nav = document.getElementById(id);
      if (!nav) continue;
      const cs = getComputedStyle(nav); const n = nav.getBoundingClientRect();
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && n.height && n.top < vh && m.bottom > n.top + 1 && m.top < n.top) issues.push(`runs under #${id}`);
    }
    const lis = [...menu.querySelectorAll('li')];
    const coveredBy = new Set();
    const scrolls = menu.scrollHeight > menu.clientHeight + 1;
    if (scrolls && lis.length <= 7) issues.push(`${lis.length}-option list scrolls (clips an option)`);
    // Each option that should be visible must be the top element at its center
    const covered = lis.filter(li => {
      const r = li.getBoundingClientRect();
      if (r.bottom <= m.top || r.top >= m.bottom) return false; // scrolled out, fine
      const y = Math.min(Math.max(r.top + r.height / 2, m.top + 2), m.bottom - 2);
      const el = document.elementFromPoint(r.left + r.width / 2, y);
      if (el && !li.contains(el) && el !== li) { coveredBy.add((el.id ? '#' + el.id : '') + '.' + String(el.className || el.tagName).split(' ')[0]); return true; }
      return false;
    }).length;
    if (covered) issues.push(`${covered} option(s) covered by ${[...coveredBy].join(', ')}`);
    return { label: dd.querySelector('.dd-label')?.textContent?.trim(), options: lis.length, issues };
  }, idx);
}

for (const P of PAGES) {
  for (const [w, h] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await setup(page);
    await page.goto(BASE + P.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const views = P.views || await page.evaluate(() => [...document.querySelectorAll('.nav-item[data-of]')].map(el => el.dataset.of).filter((v, i, a) => v && a.indexOf(v) === i));
    for (const view of views) {
      await page.evaluate(async (v) => {
        try {
          // UI, Events, Transactions and Admin are top-level consts, not window properties
          if (typeof UI !== 'undefined' && document.getElementById(`view-${v}`)) {
            UI.showView(v);
            const loaders = {
              events: typeof Events !== 'undefined' ? Events : null,
              transactions: typeof Transactions !== 'undefined' ? Transactions : null,
              reports: window.Reports || null,
              admin: typeof Admin !== 'undefined' ? Admin : null,
            };
            if (v === 'enrollment' && window.Enrollment) await window.Enrollment.ensureReady();
            else if (loaders[v]) await (loaders[v].load || loaders[v].init)?.();
          } else {
            (document.querySelector(`.nav-item[data-of="${v}"]`) || document.querySelector(`[data-of="${v}"]`))?.click();
          }
        } catch (e) { /* view-level load failures are not dropdown bugs */ }
      }, view);
      await page.waitForTimeout(700);
      const count = await page.evaluate(() => document.querySelectorAll('.dd').length);
      if (process.env.SWEEP_DEBUG) console.log('[debug]', P.name, view, `${w}x${h}`, 'dd total', count, 'visible', await page.evaluate(() => [...document.querySelectorAll('.dd')].filter(d => d.getBoundingClientRect().width > 0).length), await page.evaluate(() => JSON.stringify({ screens: [...document.querySelectorAll('.screen.active')].map(e => e.id), activeView: document.querySelector('.view.active')?.id, body: document.body.className })));
      for (let i = 0; i < count; i++) {
        const visible = await page.evaluate((i) => { const t = document.querySelectorAll('.dd')[i].querySelector('.dd-trigger'); const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(t).visibility !== 'hidden'; }, i);
        if (!visible) continue;
        for (const place of ['top', 'bottom']) {
          await page.evaluate(({ i, place }) => {
            const t = document.querySelectorAll('.dd')[i].querySelector('.dd-trigger');
            t.scrollIntoView({ block: place === 'top' ? 'start' : 'end' });
            if (place === 'top') window.scrollBy(0, -90);
            else window.scrollBy(0, 90);
          }, { i, place });
          await page.waitForTimeout(150);
          // A user can only open a trigger they can see; skip placements that
          // pushed it out of view (inner scroll containers ignore window.scrollBy).
          // ...and one not hidden under a sticky header or the bottom nav:
          // the element at the trigger's centre must be the trigger itself.
          const inView = await page.evaluate((i) => {
            const t = document.querySelectorAll('.dd')[i].querySelector('.dd-trigger');
            const r = t.getBoundingClientRect();
            if (r.top < 0 || r.bottom > window.innerHeight) return 'off-screen';
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit && (hit === t || t.contains(hit))) return true;
            return 'covered by ' + (hit ? (hit.id ? '#' + hit.id : '') + '.' + String(hit.className).split(' ')[0] : 'nothing');
          }, i);
          if (inView !== true) {
            const key = `${P.name}/${view} ${w}x${h}`;
            skipped[key] = skipped[key] || {};
            skipped[key][inView] = (skipped[key][inView] || 0) + 1;
            continue;
          }
          await page.evaluate((i) => document.body.click(), i); // close others
          await page.evaluate((i) => document.querySelectorAll('.dd')[i].querySelector('.dd-trigger').click(), i);
          await page.waitForTimeout(320);
          const r = await inspectOpenMenu(page, i);
          opened++;
          const key = `${P.name}/${view} ${w}x${h}`;
          coverage[key] = (coverage[key] || 0) + 1;
          if (r.issues.length) {
            const shot = `${OUT}/${P.name}-${view}-${w}x${h}-dd${i}-${place}.png`;
            await page.screenshot({ path: shot });
            problems.push({ page: P.name, view, viewport: `${w}x${h}`, dropdown: r.label, place, options: r.options, issues: r.issues, shot });
          }
          await page.evaluate((i) => document.querySelectorAll('.dd')[i].querySelector('.dd-trigger').click(), i);
        }
      }
    }
    await page.close();
  }
}

await browser.close();
fs.writeFileSync(`${OUT}/dropdown-sweep.json`, JSON.stringify({ opened, coverage, problems }, null, 2));
console.log('coverage (menus opened per view):');
for (const [k, v] of Object.entries(coverage)) console.log(`  ${k}: ${v}`);
console.log('skipped placements (trigger not tappable):');
for (const [k, v] of Object.entries(skipped)) console.log(`  ${k}: ${JSON.stringify(v)}`);
for (const p of problems) console.log(`FAIL ${p.page}/${p.view} ${p.viewport} "${p.dropdown}" (${p.place}): ${p.issues.join('; ')}`);
console.log(`\nmenus opened: ${opened}, with problems: ${problems.length}`);
process.exit(problems.length ? 1 : 0);
