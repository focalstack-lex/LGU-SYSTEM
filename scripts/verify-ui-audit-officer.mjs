// Run with the server up (npm start, port 3000): node scripts/verify-ui-audit-officer.mjs [outDir]
// Officer + faculty smoke checks for the audit fixes (mocked backend).
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng } from './lib-capture-mocks.mjs';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || `reports/ui-verification/${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const browser = await chromium.launch({ headless: true });
const receipt = await receiptPng();

// ---------- Officer portal ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await seedSession(page);
  await routeMocks(page, receipt);
  await page.route(/\/api\/roster(\?.*)?$/, r => r.fulfill(json([{ id: 'r1', full_name: 'Dela Cruz, Juan', course: 'BSCoE', year_level: 3, sex: 'M' }])));
  // .single() asks PostgREST for an object (Accept: application/vnd.pgrst.object+json)
  const ADMIN = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'admin', course: 'BSCoE', year_level: '4' };
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const wantsObject = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object');
    r.fulfill(json(wantsObject ? ADMIN : [ADMIN]));
  });
  await page.goto(BASE + '/officer.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const gated = await page.evaluate(() => document.body.innerText.includes('Restricted Access'));
  check('officer portal renders for mocked admin', !gated);
  const f = await page.evaluate(() => ({
    novalidate: document.getElementById('of-tx-form')?.noValidate,
    labels: ['of-tx-event', 'of-tx-amount', 'of-tx-date', 'of-tx-desc'].every(id => document.querySelector(`label[for="${id}"]`)),
    removeLabel: document.getElementById('of-tx-receipt-remove')?.getAttribute('aria-label'),
    toastLive: document.getElementById('of-toast-holder')?.getAttribute('aria-live'),
    heading: [...document.querySelectorAll('#of-tx-form')].length && document.querySelector('.of-record-layout h3')?.textContent,
  }));
  check('officer tx form: novalidate + labelled fields', f.novalidate && f.labels, JSON.stringify(f));
  check('officer receipt remove button named', f.removeLabel === 'Remove attached receipt');
  check('officer toast holder is a live region', f.toastLive === 'polite');
  check('officer form heading renamed', f.heading === 'New Transaction', f.heading);
  // Inline validation: pick first real event, leave amount empty
  const ev = await page.evaluate(() => {
    document.getElementById('of-tx-event').value = '';
    document.getElementById('of-tx-form').requestSubmit();
    return { text: document.getElementById('of-tx-error').textContent, invalid: document.getElementById('of-tx-event').getAttribute('aria-invalid') };
  });
  check('officer tx form: missing event marked aria-invalid', ev.invalid === 'true' && /event/i.test(ev.text), JSON.stringify(ev));
  const v = await page.evaluate(() => {
    const sel = document.getElementById('of-tx-event');
    if (![...sel.options].some(o => o.value)) sel.add(new Option('Engineering Week 2026', 'ev1'));
    const opt = [...sel.options].find(o => o.value);
    if (opt) sel.value = opt.value;
    document.getElementById('of-tx-amount').value = '';
    document.getElementById('of-tx-form').requestSubmit();
    const err = document.getElementById('of-tx-error');
    return { hasEvent: !!opt, shown: !err.classList.contains('hidden'), text: err.textContent, invalid: document.getElementById('of-tx-amount').getAttribute('aria-invalid') };
  });
  check('officer tx form: amount error is inline and marks the field', v.shown && v.invalid === 'true' && /amount/i.test(v.text), JSON.stringify(v));
  // Danger fill + dark primary text via tokens
  const colors = await page.evaluate(() => {
    const b = document.createElement('button'); b.className = 'of-btn of-btn-danger'; document.body.appendChild(b);
    const p = document.getElementById('of-tx-submit');
    const out = { danger: getComputedStyle(b).backgroundColor, primaryText: getComputedStyle(p).color };
    b.remove(); return out;
  });
  check('officer danger button fill #DC2626', colors.danger === 'rgb(220, 38, 38)', colors.danger);
  check('officer primary button text is charcoal', colors.primaryText === 'rgb(18, 18, 20)', colors.primaryText);
  await page.screenshot({ path: `${OUT}/07-officer-record-validation.png` });
  check('officer: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- Faculty portal ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await seedSession(page);
  await routeMocks(page, receipt);
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => r.fulfill(json([{ id: 'mock-user-0000-1111-2222', email: 'head@g.cjc.edu.ph', full_name: 'Prog Head', role: 'program_head', course: 'BSCoE' }])));
  await page.route(/\/api\/faculty\/submissions(\?.*)?$/, r => r.fulfill(json({ submissions: [] })));
  await page.goto(BASE + '/faculty.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const fa = await page.evaluate(() => ({
    toastLive: document.getElementById('faculty-toast-holder')?.getAttribute('aria-live'),
    noteLabel: document.getElementById('faculty-add-note')?.getAttribute('aria-label'),
    addErr: document.getElementById('faculty-add-error')?.getAttribute('role'),
  }));
  check('faculty toast holder is a live region', fa.toastLive === 'polite');
  check('faculty add note labelled, error box is alert', fa.noteLabel === 'Reason for adding' && fa.addErr === 'alert', JSON.stringify(fa));
  // Validation now inline (no alert dialog)
  let dialogSeen = false;
  page.on('dialog', d => { dialogSeen = true; d.dismiss(); });
  const r = await page.evaluate(() => {
    document.getElementById('faculty-add-btn').click();
    const e = document.getElementById('faculty-add-error');
    return { shown: !e.classList.contains('hidden'), text: e.textContent };
  });
  check('faculty add validation is inline, no alert()', r.shown && !dialogSeen, JSON.stringify(r));
  check('faculty: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
