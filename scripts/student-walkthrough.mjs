// Run with the server up (npm start, port 3000): node scripts/student-walkthrough.mjs [outDir]
// Walks the portal as a plain third-year BSCoE student (role: student) with a
// realistic academic record, on desktop and phone, and records what a student
// sees and hits: screenshots, page text, errors, stuck loaders, empty states,
// staff-only leaks, and the outcome of each action. Backend is mocked.
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng, EVENTS, TXS, ANNOUNCEMENTS } from './lib-capture-mocks.mjs';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || `reports/ui-verification/${new Date().toISOString().slice(0, 10)}-student-walkthrough`;
fs.mkdirSync(OUT, { recursive: true });
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

// ---------- the student ----------
const STUDENT = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'student', course: 'BSCoE', year_level: '3', enrollment_year: 2024, is_verified: true, avatar_url: null };

// BSCoE curriculum subset: 4 years x 2 semesters x 3 subjects
const SUBJECTS = [];
const TITLES = ['Calculus', 'Physics', 'Programming', 'Circuits', 'Digital Logic', 'Data Structures', 'Microprocessors', 'Signals', 'Embedded Systems', 'Networks', 'Design Project', 'Practicum'];
let t = 0;
for (let y = 1; y <= 4; y++) for (let s = 1; s <= 2; s++) for (let k = 1; k <= 3; k++) {
  const code = `CPE ${y}${s}${k}`;
  SUBJECTS.push({ id: `sub-${y}${s}${k}`, code, title: `${TITLES[t++ % TITLES.length]} ${y}.${s}`, units: k === 3 ? 4 : 3, lec_units: 3, lab_units: k === 3 ? 1 : 0, program: 'BSCoE', year_level: y, semester: s });
}
// Record: years 1 and 2 passed except one failed, one enrolled now in year 3
const MY_UNITS = SUBJECTS.filter(s => s.year_level <= 2).map((s, i) => ({
  id: `su-${s.id}`, school_year: s.year_level === 1 ? '2024-2025' : '2025-2026', semester: s.semester,
  grade: i === 4 ? '5.0' : ['1.25', '1.50', '1.75', '2.00', '2.25'][i % 5], status: i === 4 ? 'failed' : 'passed',
  lec_grade: null, lab_grade: null, lec_status: null, lab_status: null, instructor: 'Engr. Dela Cruz', schedule: 'MWF 9:00-10:00', subjects: s,
})).concat([{ id: 'su-cur', school_year: '2026-2027', semester: 1, grade: null, status: 'enrolled', lec_grade: null, lab_grade: null, lec_status: null, lab_status: null, instructor: 'Engr. Santos', schedule: 'TTh 1:00-2:30', subjects: SUBJECTS.find(s => s.code === 'CPE 311') }]);

let draft = { id: 'sub1', school_year: '2026-2027', semester: 1, status: 'draft', created_at: '2026-09-20T08:00:00Z', enrollment_submission_items: [
  { id: 'it1', subject_id: 'sub-312', item_state: 'proposed', origin: 'student', subjects: SUBJECTS.find(s => s.id === 'sub-312') },
] };
const NOTIFS = [
  { id: 'n1', category: 'announcement', title: 'Engineering Week liquidation is complete', body: 'All 28 receipts have been verified.', created_at: '2026-08-28T09:00:00Z', read: false },
  { id: 'n2', category: 'enrollment', title: 'Your load is waiting for your Program Head', body: 'Submitted on Sep 20.', created_at: '2026-09-20T08:10:00Z', read: true },
];

const findings = [];
const note = (view, kind, text) => findings.push({ view, kind, text });

async function setup(page, viewportLabel) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', r => { const u = r.url(); if ((u.includes('/api/') || u.includes('supabase.co')) && r.status() >= 400) note('network', 'error', `${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
  await page.route(/\/sw\.js/, r => r.fulfill({ status: 404, body: '' }));
  await seedSession(page);
  await routeMocks(page, await receiptPng());
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (r.request().method() === 'PATCH') { note('profile', 'action', 'PATCH profiles sent: ' + r.request().postData()?.slice(0, 120)); return r.fulfill(json([STUDENT])); }
    const obj = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object');
    r.fulfill(json(obj ? STUDENT : [STUDENT]));
  });
  await page.route(/\/api\/units\/checklists/, r => r.fulfill(json({ subjects: SUBJECTS, requirements: [{ program: 'BSCoE', required_units: 160 }] })));
  await page.route(/\/api\/units\/my/, r => r.fulfill(json(MY_UNITS)));
  await page.route(/\/api\/units\/(enroll|update|drop|batch-enroll)/, r => { note('units', 'action', `${r.request().method()} ${r.request().url().replace(BASE, '')} ${r.request().postData() || ''}`.slice(0, 160)); r.fulfill(json({ ok: true })); });
  await page.route(/\/api\/enrollment\/pilot-status/, r => r.fulfill(json({ pilot: true })));
  await page.route(/\/api\/enrollment\/submissions\/my/, r => r.fulfill(json({ submissions: [draft] })));
  await page.route(/\/api\/enrollment\/submissions\/sub1\/items\/[^/]+$/, r => { const id = r.request().url().split('/').pop(); draft.enrollment_submission_items = draft.enrollment_submission_items.filter(i => i.id !== id); note('enrollment', 'action', 'DELETE item ' + id); r.fulfill(json({ ok: true })); });
  await page.route(/\/api\/enrollment\/submissions\/sub1\/items$/, r => { const b = JSON.parse(r.request().postData() || '{}'); const s = SUBJECTS.find(x => x.id === b.subject_id); const item = { id: 'it-' + b.subject_id, subject_id: b.subject_id, item_state: 'proposed', origin: b.origin || 'student', subjects: s }; draft.enrollment_submission_items.push(item); note('enrollment', 'action', 'POST item ' + s?.code); r.fulfill(json({ item })); });
  await page.route(/\/api\/enrollment\/submissions\/sub1\/submit/, r => { draft = { ...draft, status: 'submitted', submitted_at: new Date().toISOString() }; note('enrollment', 'action', 'POST submit'); r.fulfill(json({ submission: draft })); });
  await page.route(/\/api\/notifications\/read/, r => r.fulfill(json({ ok: true })));
  await page.route(/\/api\/notifications/, r => r.fulfill(json(NOTIFS)));
  await page.route(/\/api\/transactions\/receipt/, r => r.fulfill(json({ ok: true })));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  return errors;
}

async function snapshot(page, name, view) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  const info = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const active = document.querySelector('.view.active') || document.body;
    const text = active.innerText.replace(/\s+\n/g, '\n').trim();
    const buttons = [...active.querySelectorAll('button, a.btn, [role="button"]')].filter(vis).map(b => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean);
    const loaders = [...active.querySelectorAll('.loading-state, .skeleton, .sk-bone, .skeleton-stack')].filter(vis).length;
    const empties = [...active.querySelectorAll('.empty-state, .enrollment-empty, .muted')].filter(vis).map(e => e.innerText.trim().slice(0, 80));
    const staffLeak = [...document.querySelectorAll('.admin-only, .officer-only, #nav-admin, #nav-executive-portal, #bottom-nav-admin, #bottom-nav-executive-portal')].filter(vis).map(e => e.id || e.className.split(' ')[0]);
    const headings = [...active.querySelectorAll('h1, h2, h3')].filter(vis).map(h => h.innerText.trim().slice(0, 50));
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const dashes = (text.match(/[–—]/g) || []).length;
    const tiny = [...active.querySelectorAll('*')].filter(e => vis(e) && e.children.length === 0 && e.innerText?.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length;
    const smallTargets = [...active.querySelectorAll('button, a, input, select')].filter(vis).filter(e => { const r = e.getBoundingClientRect(); return r.width < 32 || r.height < 32; }).map(e => ((e.getAttribute('aria-label') || e.innerText || e.id || e.tagName).trim().slice(0, 30)) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    return { headings, buttons: buttons.slice(0, 40), loaders, empties, staffLeak, overflow, dashes, tiny, smallTargets: smallTargets.slice(0, 12), text: text.slice(0, 1600) };
  });
  fs.writeFileSync(`${OUT}/${name}.txt`, JSON.stringify(info, null, 1));
  if (info.loaders) note(view, 'stuck', `${info.loaders} loader(s) still showing after wait`);
  if (info.staffLeak.length) note(view, 'leak', 'staff-only UI visible to student: ' + info.staffLeak.join(', '));
  if (info.overflow) note(view, 'layout', 'horizontal overflow');
  if (info.dashes) note(view, 'copy', `${info.dashes} em/en dash(es) in visible copy`);
  if (info.tiny) note(view, 'type', `${info.tiny} text node(s) under 11px`);
  for (const e of info.empties) note(view, 'empty', e);
  return info;
}

// Navigate the way the app does (loads each view's module), so no view is
// left on its loading state by the harness itself.
async function show(page, view) {
  await page.evaluate(v => window.navigateTo(v), view);
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({ headless: true });

// ================= DESKTOP =================
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = await setup(page, 'desktop');

  // First impression + nav as the student sees it
  const nav = await page.evaluate(() => [...document.querySelectorAll('.sidebar .nav-item, .nav-item')].filter(n => n.getBoundingClientRect().width).map(n => n.innerText.trim().replace(/\s+/g, ' ')));
  note('nav', 'info', 'sidebar items: ' + nav.join(' | '));
  const initial = await snapshot(page, 'd01-first-screen', 'dashboard');
  note('dashboard', 'info', 'headings: ' + initial.headings.join(' | '));

  // Keyboard: how many Tabs to reach the first nav item and the first main-content control
  const tabs = await page.evaluate(async () => {
    document.body.focus(); const seq = []; let el;
    for (let i = 0; i < 40; i++) { const ev = new KeyboardEvent('keydown', { key: 'Tab' }); document.dispatchEvent(ev); break; }
    return seq;
  });
  let tabCount = 0, firstMain = null, firstNav = null;
  for (let i = 0; i < 45 && !firstMain; i++) {
    await page.keyboard.press('Tab'); tabCount++;
    const f = await page.evaluate(() => { const a = document.activeElement; return { id: a.id, cls: String(a.className).split(' ')[0], inMain: !!a.closest('.main-content, .view'), inNav: !!a.closest('.sidebar, nav'), text: (a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 30) }; });
    if (f.inNav && firstNav === null) firstNav = { tabCount, ...f };
    if (f.inMain && !firstMain) firstMain = { tabCount, ...f };
  }
  note('keyboard', 'info', `first nav item reached after ${firstNav?.tabCount ?? '>45'} Tabs (${firstNav?.text || ''}); first main-content control after ${firstMain?.tabCount ?? '>45'} Tabs (${firstMain?.text || firstMain?.cls || ''})`);

  // Dashboard content checks
  await show(page, 'dashboard');
  const dash = await snapshot(page, 'd02-dashboard', 'dashboard');
  note('dashboard', 'info', 'buttons: ' + dash.buttons.join(' | '));

  // Events: open detail, back
  await show(page, 'events');
  const ev = await snapshot(page, 'd03-events', 'events');
  await page.locator('#events-grid .event-card').first().click();
  await page.waitForTimeout(900);
  const evd = await snapshot(page, 'd04-event-detail', 'event-detail');
  note('event-detail', 'info', 'headings: ' + evd.headings.join(' | ') + ' | buttons: ' + evd.buttons.join(' | '));
  const backOk = await page.evaluate(() => !!document.getElementById('back-to-events'));
  if (backOk) { await page.click('#back-to-events'); await page.waitForTimeout(400); }
  note('event-detail', backOk ? 'info' : 'flow', backOk ? 'back link present' : 'no back link');

  // Transactions: search miss, filter, receipt
  await show(page, 'transactions');
  await snapshot(page, 'd05-transactions', 'transactions');
  await page.fill('#tx-search', 'zzzz-no-such-thing');
  await page.waitForTimeout(700);
  const miss = await page.evaluate(() => document.querySelector('#tx-table-body')?.innerText.trim().slice(0, 120));
  note('transactions', 'flow', 'search with no match shows: "' + miss + '"');
  await page.fill('#tx-search', '');
  await page.waitForTimeout(600);
  const rl = page.locator('#tx-table-body .receipt-link').first();
  if (await rl.count()) {
    await rl.click(); await page.waitForTimeout(900);
    const rv = await page.evaluate(() => { const o = document.querySelector('.receipt-viewer, #receipt-viewer-overlay, [class*="receipt-viewer"]'); return o ? { shown: getComputedStyle(o).display !== 'none' && !o.classList.contains('hidden'), text: o.innerText.replace(/\s+/g, ' ').slice(0, 200) } : null; });
    note('transactions', rv?.shown ? 'info' : 'flow', 'receipt viewer: ' + JSON.stringify(rv));
    await snapshot(page, 'd06-receipt-viewer', 'transactions');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  } else note('transactions', 'flow', 'no receipt link rendered for a student');
  const txAdminBtns = await page.evaluate(() => document.querySelectorAll('#tx-table-body .tx-edit-btn, #tx-table-body .tx-del-btn').length);
  note('transactions', txAdminBtns ? 'leak' : 'info', `edit/delete buttons visible to student: ${txAdminBtns}`);

  // Income (is it student-facing?) and Reports
  await show(page, 'income');
  await snapshot(page, 'd07-income', 'income');
  await show(page, 'reports');
  const rep = await snapshot(page, 'd08-reports', 'reports');
  note('reports', 'info', 'buttons: ' + rep.buttons.join(' | '));

  // Academic progress (units)
  await show(page, 'units');
  const un = await snapshot(page, 'd09-units', 'units');
  note('units', 'info', 'headings: ' + un.headings.join(' | ') + ' | buttons: ' + un.buttons.slice(0, 15).join(' | '));
  const yr3 = page.locator('.units-tab-btn[data-year="3"]');
  if (await yr3.count()) { await yr3.click(); await page.waitForTimeout(500); await snapshot(page, 'd10-units-year3', 'units'); }
  const logBtn = page.locator('.unit-log-btn, [data-log-subject], .units-log-btn').first();
  if (await logBtn.count()) {
    await logBtn.click(); await page.waitForTimeout(700);
    const modal = await page.evaluate(() => { const m = document.querySelector('#units-modal, .units-modal, [id*="units-modal"]'); return m ? { visible: !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none', fields: [...m.querySelectorAll('label')].map(l => l.innerText.trim()).slice(0, 10) } : null; });
    note('units', 'flow', 'log subject modal: ' + JSON.stringify(modal));
    await snapshot(page, 'd11-units-log-modal', 'units');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelectorAll('.modal-overlay, #units-modal').forEach(m => m.classList.add('hidden')));
  } else note('units', 'flow', 'no "log subject" control found for the student');

  // Enrollment: add a subject, remove it, submit
  await show(page, 'enrollment');
  const en = await snapshot(page, 'd12-enrollment', 'enrollment');
  note('enrollment', 'info', 'headings: ' + en.headings.join(' | ') + ' | buttons: ' + en.buttons.slice(0, 12).join(' | '));
  const addBtn = page.locator('#view-enrollment [data-add-subject], #view-enrollment .btn-add-course').first();
  if (await addBtn.count()) {
    await addBtn.click(); await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.querySelectorAll('.enrollment-item-row').length);
    note('enrollment', 'flow', `after Add to Load: ${after} item(s) in proposed load`);
    await snapshot(page, 'd13-enrollment-added', 'enrollment');
    const rm = page.locator('[data-remove-item]').last();
    if (await rm.count()) {
      await rm.click(); await page.waitForTimeout(400);
      const confirmBtn = page.locator('.modal-overlay [data-action="confirm"]');
      note('enrollment', 'flow', `remove asks for confirmation: ${await confirmBtn.count() ? 'yes (in-app dialog)' : 'no'}`);
      if (await confirmBtn.count()) { await confirmBtn.click(); await page.waitForTimeout(700); }
      note('enrollment', 'flow', `after Remove: ${await page.evaluate(() => document.querySelectorAll('.enrollment-item-row').length)} item(s)`);
    }
  } else note('enrollment', 'flow', 'no Add to Load button found');
  page.on('dialog', d => { note('enrollment', 'flow', 'native confirm: "' + d.message().slice(0, 100) + '"'); d.accept(); });
  const submitBtn = page.locator('#enrollment-submit-btn');
  if (await submitBtn.count()) {
    await submitBtn.click(); await page.waitForTimeout(400);
    const confirmBtn = page.locator('.modal-overlay [data-action="confirm"]');
    note('enrollment', 'flow', `submit asks for confirmation: ${await confirmBtn.count() ? 'yes (in-app dialog)' : 'no'}`);
    if (await confirmBtn.count()) await confirmBtn.click();
    await page.waitForTimeout(1200);
    await snapshot(page, 'd14-enrollment-submitted', 'enrollment');
    note('enrollment', 'flow', 'after submit, status copy: ' + await page.evaluate(() => (document.querySelector('.ev-status-copy, .ev-track')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160)));
  } else note('enrollment', 'flow', 'no submit button (state: ' + await page.evaluate(() => document.getElementById('enrollment-action-area')?.innerText.trim().slice(0, 100)) + ')');

  // Notifications
  const bell = page.locator('#notif-bell, [id*="notif"] button:visible, button[aria-label*="otification"]').first();
  if (await bell.count()) { await bell.click(); await page.waitForTimeout(700); await snapshot(page, 'd15-notifications', 'notifications'); note('notifications', 'info', 'panel text: ' + await page.evaluate(() => (document.querySelector('[id*="notif"][class*="panel"], .notif-panel, #notif-dropdown')?.innerText || 'NOT FOUND').replace(/\s+/g, ' ').slice(0, 220))); await page.keyboard.press('Escape'); }
  else note('notifications', 'flow', 'no notification bell found');

  // Profile modal as a student
  const pill = page.locator('#user-pill');
  if (await pill.count()) {
    await pill.click(); await page.waitForTimeout(800);
    const prof = await page.evaluate(() => { const m = document.getElementById('profile-modal'); return { fields: [...m.querySelectorAll('label')].map(l => l.innerText.trim()).slice(0, 14), disabled: [...m.querySelectorAll('input:disabled, select:disabled, .dd-disabled')].map(e => e.id || e.className).slice(0, 8), tabs: [...m.querySelectorAll('.profile-tab-btn')].map(b => b.innerText.trim()) }; });
    note('profile', 'info', JSON.stringify(prof));
    await snapshot(page, 'd16-profile', 'profile');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }

  // Grizz assistant
  const grizz = page.locator('#ursa-launcher-btn');
  if (await grizz.count()) {
    await grizz.click(); await page.waitForTimeout(1000);
    await snapshot(page, 'd17-grizz', 'grizz');
    note('grizz', 'info', 'prompts: ' + await page.evaluate(() => [...document.querySelectorAll('#ursa-prompts-list button, .ursa-prompt-card')].map(b => b.innerText.trim().replace(/\s+/g, ' ').slice(0, 50)).join(' | ')));
    const inp = page.locator('#ursa-input, textarea[id*="ursa"], input[id*="ursa"]').first();
    if (await inp.count()) { await inp.fill('What subjects can I take next semester?'); await page.keyboard.press('Enter'); await page.waitForTimeout(2500); await snapshot(page, 'd18-grizz-answer', 'grizz'); note('grizz', 'flow', 'reply: ' + await page.evaluate(() => [...document.querySelectorAll('.ursa-msg, .ursa-message, [class*="ursa-bubble"]')].slice(-1).map(m => m.innerText.replace(/\s+/g, ' ').slice(0, 260)).join(''))); }
    await page.keyboard.press('Escape');
  } else note('grizz', 'flow', 'no Grizz launcher');

  // Theme toggle
  const themeBtn = page.locator('[data-theme-toggle]:visible').first();
  try {
    if (await themeBtn.count()) { await themeBtn.click({ timeout: 3000 }); await page.waitForTimeout(600); await show(page, 'dashboard'); await snapshot(page, 'd19-dashboard-light', 'dashboard-light'); await themeBtn.click({ timeout: 3000 }); }
    else note('theme', 'flow', 'no visible theme toggle on desktop');
  } catch (e) { note('theme', 'flow', 'theme toggle click failed: ' + e.message.split('\n')[0]); }

  // Career passport link target
  const cvHref = await page.evaluate(() => document.querySelector('.view-tab[href="/cv-builder"]')?.getAttribute('href'));
  note('career', 'info', 'Career Passport nav href: ' + cvHref);
  await page.goto(BASE + '/cv-builder', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await snapshot(page, 'd20-cv-builder', 'cv-builder');
  await page.goto(BASE + '/feedback/', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  await snapshot(page, 'd21-feedback', 'feedback');

  for (const e of [...new Set(errors)]) note('errors', 'error', e);
  await page.close();
}

// ================= PHONE =================
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = await setup(page, 'mobile');
  await snapshot(page, 'm01-first-screen', 'mobile-dashboard');
  const bottom = await page.evaluate(() => [...document.querySelectorAll('#bottom-nav .bottom-nav-item, #bottom-nav a, #bottom-nav button')].filter(n => n.getBoundingClientRect().width).map(n => ((n.getAttribute('aria-label') || n.innerText).trim().replace(/\s+/g, ' ')) + ` ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}`));
  note('mobile-nav', 'info', 'bottom nav: ' + bottom.join(' | '));
  for (const v of ['events', 'transactions', 'reports', 'units', 'enrollment']) {
    await show(page, v);
    const s = await snapshot(page, `m02-${v}`, 'mobile-' + v);
    if (s.smallTargets.length) note('mobile-' + v, 'touch', 'targets under 32px: ' + s.smallTargets.join(', '));
  }
  // "More" sheet
  const more = page.locator('#bottom-nav .bottom-nav-item:visible, #bottom-nav button:visible').last();
  try {
    if (await more.count()) { await more.click({ timeout: 3000 }); await page.waitForTimeout(700); await snapshot(page, 'm03-more-sheet', 'mobile-more'); note('mobile-more', 'info', 'sheet rows: ' + await page.evaluate(() => [...document.querySelectorAll('.mobile-sheet-row')].filter(r => r.getBoundingClientRect().width).map(r => r.innerText.trim().replace(/\s+/g, ' ').slice(0, 40)).join(' | '))); }
    else note('mobile-more', 'flow', 'no visible bottom-nav items');
  } catch (e) { note('mobile-more', 'flow', 'More sheet click failed: ' + e.message.split('\n')[0]); }
  for (const e of [...new Set(errors)]) note('mobile-errors', 'error', e);
  await page.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 1));
for (const f of findings) console.log(`[${f.kind}] ${f.view}: ${f.text}`);
console.log(`\n${findings.length} observations, screenshots in ${OUT}`);
