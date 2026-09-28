// Run with the server up (npm start, port 3000): node scripts/verify-contrast.mjs [--theme=light]
// Opens every portal view and measures the rendered contrast of each visible
// text element against its real background (translucent layers composited up
// the ancestor chain). Fails on anything below WCAG AA: 4.5:1 for normal text,
// 3:1 for large text (>= 24px, or >= 18.66px bold). Backend is mocked.
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng } from './lib-capture-mocks.mjs';

const BASE = 'http://127.0.0.1:3000';
const THEME = (process.argv.find(a => a.startsWith('--theme=')) || '--theme=dark').split('=')[1];
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const ADMIN = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'admin', course: 'BSCoE', year_level: '3' };
const SUBJECTS = [];
for (let y = 1; y <= 4; y++) for (let k = 1; k <= 4; k++) SUBJECTS.push({ id: `s${y}${k}`, code: `CPE ${y}${k}`, title: `Subject ${y}.${k}`, units: 3, year_level: y, semester: 1 + (k % 2) });

const PAGES = [
  { name: 'login', url: '/', views: [], noSession: true },
  { name: 'student', url: '/', views: ['dashboard', 'events', 'transactions', 'income', 'reports', 'units', 'enrollment', 'admin'] },
  { name: 'officer', url: '/officer.html', views: null },
  { name: 'feedback', url: '/feedback/', views: [], noSession: true },
];

// Runs in the page: returns failing text elements in the current viewport
function scan() {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // A positioned earlier sibling painted under the text (e.g. a sliding tab
  // highlight) is the real backdrop even though it is not an ancestor.
  function underlay(e, x, y) {
    for (let s = e.previousElementSibling; s; s = s.previousElementSibling) {
      const cs = getComputedStyle(s);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
      const r = s.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) return c;
    }
    return null;
  }
  function background(el) {
    const layers = [];
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    for (let e = el; e; e = e.parentElement) {
      const under = underlay(e, cx, cy);
      if (under) { layers.push(under); if (under.a >= 1) break; }
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) return null; // images: cannot judge
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const htmlBg = parse(getComputedStyle(document.body).backgroundColor);
    if (htmlBg && htmlBg.a >= 1) base = htmlBg;
    return layers.reverse().reduce((acc, l) => over(l, acc), base);
  }
  const fails = []; let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    let hidden = false; for (let e = el; e; e = e.parentElement) { if (Number(getComputedStyle(e).opacity) < 0.35) { hidden = true; break; } } if (hidden) continue;
    const hit = document.elementFromPoint(Math.min(Math.max(r.left + Math.min(r.width, 20) / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue; // covered
    if (el.closest('input, textarea, select, [disabled], .skeleton, .sk-bone, canvas, svg, iconify-icon')) continue;
    const fg = parse(cs.color); const bg = background(el);
    if (!fg || !bg) continue;
    const color = fg.a < 1 ? over(fg, bg) : fg;
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const cr = ratio(color, bg);
    checked++;
    if (cr < need) fails.push({ text: n.textContent.trim().slice(0, 40), cls: String(el.className || el.tagName).split(' ')[0], ratio: Math.round(cr * 100) / 100, need, fg: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
  }
  return { checked, fails };
}

const browser = await chromium.launch({ headless: true });
const receipt = await receiptPng();
const all = new Map(); let checked = 0;

for (const P of PAGES) {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, THEME);
    await page.route(/\/sw\.js/, r => r.fulfill({ status: 404, body: '' }));
    if (!P.noSession) {
      await seedSession(page); await routeMocks(page, receipt);
      await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
        r.fulfill(json((r.request().headers()['accept'] || '').includes('vnd.pgrst.object') ? ADMIN : [ADMIN]));
      });
      await page.route(/\/api\/units\/checklists/, r => r.fulfill(json({ subjects: SUBJECTS, requirements: [] })));
      await page.route(/\/api\/units\/my/, r => r.fulfill(json([])));
      await page.route(/\/api\/enrollment\/submissions\/my/, r => r.fulfill(json({ submissions: [{ id: 'sub1', school_year: '2026-2027', semester: 1, status: 'draft', enrollment_submission_items: [] }] })));
    } else {
      await page.route(/supabase\.co/, r => r.fulfill(json({})));
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
            } else document.querySelector(`.nav-item[data-of="${v}"]`)?.click();
          } catch { }
        }, view);
        await page.waitForTimeout(800);
      }
      const r = await page.evaluate(scan);
      checked += r.checked;
      for (const f of r.fails) {
        const key = `${f.cls} "${f.text}" ${f.fg} on ${f.bg}`;
        if (!all.has(key)) all.set(key, { ...f, where: `${P.name}/${view || 'initial'} ${w}px` });
      }
    }
    await page.close();
  }
}
await browser.close();
const fails = [...all.values()].sort((a, b) => a.ratio - b.ratio);
for (const f of fails) console.log(`LOW ${f.ratio}:1 (needs ${f.need})  ${f.where}  .${f.cls} "${f.text}"  ${f.fg} on ${f.bg}`);
console.log(`\ntheme: ${THEME}, text elements checked: ${checked}, below AA: ${fails.length}`);
process.exit(fails.length ? 1 : 0);
