// Run with the server up (npm start, port 3000): node scripts/verify-student-experience.mjs [outDir]
// Asserts the student-experience spec (docs/superpowers/specs/2026-09-28-student-experience-design.md)
// as a mocked third-year BSCoE student, on desktop and phone.
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng } from './lib-capture-mocks.mjs';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || `reports/ui-verification/${new Date().toISOString().slice(0, 10)}-student-experience`;
fs.mkdirSync(OUT, { recursive: true });
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

const STUDENT = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'student', course: 'BSCoE', year_level: '3', enrollment_year: 2024, is_verified: true, avatar_url: null };
const S = (id, code, y, s, units = 3) => ({ id, code, title: `${code} title`, units, lec_units: units, lab_units: 0, program: 'BSCoE', year_level: y, semester: s });
const SUBJECTS = [S('sub-111', 'CPE 111', 1, 1), S('sub-122', 'CPE 122', 1, 2), S('sub-211', 'CPE 211', 2, 1), S('sub-221', 'CPE 221', 2, 2),
  S('sub-311', 'CPE 311', 3, 1), S('sub-312', 'CPE 312', 3, 1, 4), S('sub-313', 'CPE 313', 3, 1, 4), S('sub-314', 'CPE 314', 3, 1, 5), S('sub-315', 'CPE 315', 3, 1, 5), S('sub-316', 'CPE 316', 3, 1, 5), S('sub-321', 'CPE 321', 3, 2)];
const RECORDS = [
  { id: 'r1', status: 'enrolled', subjects: SUBJECTS[4] },
  { id: 'r2', status: 'passed', subjects: SUBJECTS[2] },
  { id: 'r3', status: 'failed', subjects: SUBJECTS[0] },   // CPE 111, year 1 sem 1: the retake
  { id: 'r4', status: 'passed', subjects: SUBJECTS[1] },
];
const PREREQS = [{ id: 1, subject_id: 'sub-313', depends_on_subject_id: { code: 'CPE 221' }, kind: 'prerequisite', detail: null }];
let draft = { id: 'sub1', school_year: '2026-2027', semester: 1, status: 'draft', enrollment_submission_items: [] };
let submitPayloadUnits = null;

async function setup(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  await page.route(/\/sw\.js/, r => r.fulfill({ status: 404, body: '' }));
  await seedSession(page);
  await routeMocks(page, await receiptPng());
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const obj = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object');
    r.fulfill(json(obj ? STUDENT : [STUDENT]));
  });
  await page.route(/\/api\/units\/checklists/, r => r.fulfill(json({ subjects: SUBJECTS, requirements: [{ program: 'BSCoE', total_units: 189, total_subjects: 67, max_units_per_term: 12 }], prerequisites: PREREQS })));
  await page.route(/\/api\/units\/my/, r => r.fulfill(json(RECORDS)));
  await page.route(/\/api\/enrollment\/pilot-status/, r => r.fulfill(json({ pilot: true })));
  await page.route(/\/api\/enrollment\/submissions\/my/, r => r.fulfill(json({ submissions: [draft] })));
  await page.route(/\/api\/enrollment\/submissions\/sub1\/items\/[^/]+$/, r => { const id = r.request().url().split('/').pop(); draft.enrollment_submission_items = draft.enrollment_submission_items.filter(i => i.id !== id); r.fulfill(json({ ok: true })); });
  await page.route(/\/api\/enrollment\/submissions\/sub1\/items$/, r => { const b = JSON.parse(r.request().postData() || '{}'); const s = SUBJECTS.find(x => x.id === b.subject_id); const item = { id: 'it-' + b.subject_id, subject_id: b.subject_id, item_state: 'proposed', origin: 'student', subjects: s }; draft.enrollment_submission_items.push(item); r.fulfill(json({ item })); });
  await page.route(/\/api\/enrollment\/submissions\/sub1\/submit/, r => { submitPayloadUnits = draft.enrollment_submission_items.reduce((a, i) => a + i.subjects.units, 0); draft = { ...draft, status: 'submitted', submitted_at: new Date().toISOString() }; r.fulfill(json({ submission: draft })); });
  await page.route(/\/api\/notifications\/read/, r => r.fulfill(json({ ok: true })));
  await page.route(/\/api\/notifications/, r => r.fulfill(json({ total_unread: 2, unread_by_category: { events: 0, transactions: 0, reports: 0, announcements: 1, units: 0, system: 1 }, notifications: [
    { id: 'n1', category: 'announcements', title: 'Engineering Week liquidation is complete', message: 'All receipts verified.', created_at: '2026-08-28T09:00:00Z', is_read: false },
    { id: 'n2', category: 'system', title: 'Your load is waiting for your Program Head', message: 'Submitted Sep 20.', created_at: '2026-09-20T08:10:00Z', is_read: false },
    { id: 'n3', category: 'events', title: 'Intramurals schedule posted', message: '', created_at: '2026-07-01T08:00:00Z', is_read: true },
  ] })));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  return errors;
}
const show = async (page, v) => { await page.evaluate(v => window.navigateTo(v), v); await page.waitForTimeout(1200); };

const browser = await chromium.launch({ headless: true });

// ---------- Desktop ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = await setup(page);

  // Skip link and keyboard path
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300); // the link slides in over 150ms
  const first = await page.evaluate(() => ({ cls: document.activeElement.className, text: document.activeElement.textContent.trim(), visible: document.activeElement.getBoundingClientRect().top >= 0 }));
  check('skip link is the first Tab stop and becomes visible', first.cls === 'skip-link' && first.visible, JSON.stringify(first));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('skip link moves focus to main content', await page.evaluate(() => document.activeElement.id === 'main-content'));

  // Student home strip
  const strip = await page.evaluate(() => { const el = document.getElementById('student-status'); return { shown: el && !el.classList.contains('hidden'), tiles: el ? [...el.querySelectorAll('.status-tile-label')].map(l => l.textContent.trim()) : [], enrollment: el?.querySelector('[data-view="enrollment"] .status-tile-value')?.textContent.trim(), notif: el?.querySelector('[data-view="notifications"] .status-tile-value')?.textContent.trim(), feedback: !!el?.querySelector('a[href="/feedback/"]') }; });
  check('student status strip shows for a student', strip.shown && strip.tiles.length === 5, JSON.stringify(strip.tiles));
  check('strip: enrollment step and unread count are real data', strip.enrollment === 'Build your load' && strip.notif === '2 unread', `${strip.enrollment} / ${strip.notif}`);
  check('strip: feedback link present', strip.feedback);
  check('dashboard heading is no longer finance-first', await page.evaluate(() => document.querySelector('#view-dashboard h2').textContent.trim() === 'Dashboard'));
  await page.screenshot({ path: `${OUT}/01-dashboard-student.png` });

  // Nav entries
  const nav = await page.evaluate(() => [...document.querySelectorAll('.sidebar-nav .nav-item')].filter(n => n.offsetParent).map(n => n.textContent.trim()));
  check('sidebar is Dashboard, Money, Events, Updates, Academics', nav.slice(0, 5).join(' | ') === 'Dashboard | Money | Events | Updates | Academics', nav.join(' | '));
  check('sidebar has a feedback link', await page.evaluate(() => !!document.querySelector('#sidebar-feedback-link[href="/feedback/"]')));
  check('notifications nav carries the unread badge', await page.evaluate(() => document.getElementById('nav-updates').classList.contains('has-unread')));

  // Announcements page
  await show(page, 'announcements');
  check('announcements page lists every announcement', await page.evaluate(() => document.querySelectorAll('#announcements-full-list .announce-item').length) === 3);
  await page.screenshot({ path: `${OUT}/02-announcements.png` });
  // Notifications page
  await show(page, 'notifications');
  const notif = await page.evaluate(() => ({ groups: [...document.querySelectorAll('.notif-group-title')].map(g => g.textContent.trim()), unreadFirst: document.querySelector('.notif-item')?.classList.contains('is-unread'), badgeCleared: !document.getElementById('nav-updates').classList.contains('has-unread') }));
  check('notifications page groups by category, unread first', notif.groups.length === 3 && notif.unreadFirst, JSON.stringify(notif.groups));
  check('opening the inbox clears the unread badge', notif.badgeCleared);
  await page.screenshot({ path: `${OUT}/03-notifications.png` });

  // Naming
  await show(page, 'transactions');
  check('transactions page heading matches its nav name', await page.evaluate(() => document.querySelector('#view-transactions h2').textContent.trim() === 'Transactions'));
  await show(page, 'units');
  const units = await page.evaluate(() => ({ h2: document.querySelector('#view-units h2').textContent.trim(), sub: document.querySelector('#view-units .view-sub').textContent }));
  check('academic progress heading and self-reported notice', units.h2 === 'Academic Progress' && /Self-reported/.test(units.sub), units.h2);

  // Reports for a student: no export column
  await show(page, 'reports');
  const rep = await page.evaluate(() => ({ h3: [...document.querySelectorAll('#view-reports h3')].map(h => h.textContent.trim()), exportTh: [...document.querySelectorAll('#view-reports th')].some(th => th.textContent.trim() === 'Export'), adminOnly: document.querySelector('#view-reports')?.innerText.includes('Admin only') }));
  check('reports: per-event table without export column for students', rep.h3.some(h => h.includes('Per-Event Budgets')) && !rep.exportTh && !rep.adminOnly, JSON.stringify(rep.h3));

  // Event detail utilization
  await show(page, 'events');
  await page.locator('#events-grid .event-card').first().click();
  await page.waitForTimeout(800);
  const util = await page.evaluate(() => [...document.querySelectorAll('#event-detail-content .stat-value')].map(v => v.textContent.trim()));
  check('event detail shows utilization as a percentage, not a duplicate amount', util.length === 3 && /%$/.test(util[2]) && util[1] !== util[2], util.join(' | '));

  // Enrollment: semester default, retake, prerequisites, cap, lock after submit
  await show(page, 'enrollment');
  const en = await page.evaluate(() => ({
    sem: document.getElementById('enrollment-sem-select').value,
    codes: [...document.querySelectorAll('.eligible-course-code')].map(c => c.textContent.trim()),
    retake: !!document.querySelector('.eligible-retake-badge'),
    blocked: [...document.querySelectorAll('.course-is-blocked .eligible-course-code')].map(c => c.textContent.trim()),
    blockedNote: document.querySelector('.course-is-blocked .eligible-course-note')?.textContent.trim(),
    term: document.getElementById('enrollment-term-line').textContent,
  }));
  check('semester filter defaults to the load semester', en.sem === '1', en.sem);
  check('failed year-1 subject is offered as a retake', en.codes.includes('CPE 111') && en.retake, en.codes.join(','));
  check('unmet prerequisite greys the card and names the subject', en.blocked.includes('CPE 313') && /Needs CPE 221/.test(en.blockedNote || ''), en.blockedNote);
  check('load header shows units against the cap', /0 of 12 units/.test(en.term), en.term);
  check('other-semester subjects are hidden by the default filter', !en.codes.includes('CPE 321'));
  await page.screenshot({ path: `${OUT}/04-enrollment-eligible.png` });

  // Other-semester subject: refused with a message (switch filter to Both)
  await page.evaluate(() => { const s = document.getElementById('enrollment-sem-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  await page.click('[data-add-subject="sub-321"]');
  await page.waitForTimeout(400);
  const mismatch = await page.evaluate(() => document.getElementById('enrollment-error').textContent);
  check('adding a Semester 2 subject to a Semester 1 load is refused inline', /CPE 321 is a Semester 2 subject; this load is for Semester 1/.test(mismatch), mismatch);
  check('no item was added for the refused subject', draft.enrollment_submission_items.length === 0);

  // Add 3 subjects totalling 14 units (cap 12): the header warns and submit refuses
  for (const id of ['sub-312', 'sub-314', 'sub-315']) { await page.click(`[data-add-subject="${id}"]`); await page.waitForTimeout(500); }
  const over = await page.evaluate(() => ({ term: document.getElementById('enrollment-term-line').textContent, cls: document.getElementById('enrollment-term-line').className }));
  check('over-cap load is flagged in the header', /14 of 12 units \(limit is 12\)/.test(over.term) && /is-over-cap/.test(over.cls), over.term);
  await page.click('#enrollment-submit-btn');
  await page.waitForTimeout(400);
  check('submit is refused over the cap, before any request', /limit for BSCoE is 12/.test(await page.evaluate(() => document.getElementById('enrollment-error').textContent)) && submitPayloadUnits === null);

  // Remove one (confirm dialog), then submit (confirm dialog), then cards are disabled
  const removeBtn = page.locator('[data-remove-item]').last();
  await removeBtn.click(); await page.waitForTimeout(300);
  check('remove asks for confirmation in the in-app dialog', await page.evaluate(() => !!document.querySelector('.modal-overlay [role="alertdialog"]')));
  await page.click('.modal-overlay [data-action="confirm"]'); await page.waitForTimeout(500);
  await page.click('#enrollment-submit-btn'); await page.waitForTimeout(300);
  check('submit uses the in-app dialog, not window.confirm', await page.evaluate(() => !!document.querySelector('.modal-overlay [role="alertdialog"]')));
  await page.click('.modal-overlay [data-action="confirm"]'); await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ status: document.querySelector('.ev-chip')?.textContent.trim(), enabled: [...document.querySelectorAll('.btn-add-course')].filter(b => !b.disabled).length, total: document.querySelectorAll('.btn-add-course').length, hints: (document.getElementById('enrollment-status-body').innerText + document.getElementById('enrollment-action-area').innerText).match(/notified/g)?.length || 0 }));
  check('after submit every Add to Load button is disabled', after.enabled === 0 && after.total > 0, `${after.enabled} of ${after.total} enabled`);
  check('post-submit copy says "notified" once', after.hints === 1, `${after.hints}`);
  check('submit request carried 9 units', submitPayloadUnits === 9, String(submitPayloadUnits));
  await page.screenshot({ path: `${OUT}/05-enrollment-submitted.png` });

  // Profile lock
  await page.click('#user-pill'); await page.waitForTimeout(600);
  const prof = await page.evaluate(() => ({ course: document.getElementById('profile-course-select').disabled, enroll: document.getElementById('profile-enrollment-year').readOnly, year: document.getElementById('profile-year-select').disabled, note: !document.getElementById('profile-lock-note').classList.contains('hidden'), gallery: getComputedStyle(document.getElementById('avatar-gallery-track')).display }));
  check('verified student: program and enrollment year locked, year level editable', prof.course && prof.enroll && !prof.year && prof.note, JSON.stringify(prof));
  check('avatar gallery starts collapsed', prof.gallery === 'none');
  await page.screenshot({ path: `${OUT}/06-profile-locked.png` });
  await page.keyboard.press('Escape');

  // Grizz copy
  await page.click('#ursa-launcher-btn'); await page.waitForTimeout(800);
  const grizz = await page.evaluate(() => document.getElementById('ursa-drawer')?.innerText || '');
  check('Grizz greeting has no filler', !/fully operational|Zero typing|Grizz says/.test(grizz));
  await page.keyboard.press('Escape');

  // Readability floor on the dashboard
  await show(page, 'dashboard');
  const tiny = await page.evaluate(() => [...document.querySelectorAll('#view-dashboard *')].filter(e => e.children.length === 0 && e.textContent.trim() && e.getBoundingClientRect().width && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => (e.className || e.tagName) + '=' + getComputedStyle(e).fontSize).slice(0, 6));
  check('no dashboard text under 12px', tiny.length === 0, tiny.join(', '));

  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- Phone ----------
{
  draft = { id: 'sub1', school_year: '2026-2027', semester: 1, status: 'draft', enrollment_submission_items: [] };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = await setup(page);
  await page.click('#bottom-nav-more-btn'); await page.waitForTimeout(600);
  const sheet = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.mobile-sheet-row')].filter(r => r.offsetParent && getComputedStyle(r).display !== 'none').map(r => r.querySelector('.mobile-sheet-row-title')?.textContent.trim()), labels: [...document.querySelectorAll('.mobile-sheet-section-label')].map(l => l.textContent.trim()) }));
  check('phone More sheet hides the officer and admin rows for a student', !sheet.rows.includes('Executive Portal') && !sheet.rows.includes('Admin Panel'), sheet.rows.join(' | '));
  check('phone More sheet has Updates and Account groups with the new rows', sheet.labels.includes('Updates') && sheet.labels.includes('Account') && sheet.rows.includes('Announcements') && sheet.rows.includes('Notifications') && sheet.rows.includes('Send Feedback'), sheet.labels.join(' | '));
  await page.screenshot({ path: `${OUT}/07-phone-more-sheet.png` });
  await page.click('#mobile-sheet-close-btn'); await page.waitForTimeout(300);

  const small = [];
  for (const v of ['transactions', 'units', 'enrollment']) {
    await show(page, v);
    const found = await page.evaluate(() => [...document.querySelectorAll('.view.active button, .view.active a, .view.active .receipt-link')].filter(e => e.offsetParent && e.getBoundingClientRect().width).filter(e => e.getBoundingClientRect().height < 40).map(e => (e.getAttribute('aria-label') || e.textContent.trim() || e.className).slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px'));
    small.push(...found.map(f => v + ': ' + f));
  }
  check('phone: tap targets in transactions, units and enrollment are at least 40px tall', small.length === 0, small.slice(0, 8).join(', '));
  await page.screenshot({ path: `${OUT}/08-phone-enrollment.png` });
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
