// Run with the server up (npm start, port 3000): node scripts/verify-ui-audit-fixes.mjs [outDir]
// End-to-end UI verification for the audit fixes. Mocks Supabase + API
// (scripts/lib-capture-mocks.mjs); never touches the real backend.
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

// ---------- 1. Login page (no session) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/\/sw\.js/, r => r.fulfill({ status: 404, body: '' }));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const form = await page.evaluate(() => ({
    isForm: document.getElementById('login-form')?.tagName,
    emailAc: document.getElementById('login-email').autocomplete,
    passAc: document.getElementById('login-password').autocomplete,
    passPlaceholder: document.getElementById('login-password').placeholder,
    errRole: document.getElementById('login-error').getAttribute('role'),
    noticeInline: document.querySelector('.auth-password-notice').getAttribute('style'),
    btnColor: getComputedStyle(document.getElementById('login-btn')).color,
    btnBg: getComputedStyle(document.getElementById('login-btn')).backgroundColor,
  }));
  check('login is a <form>', form.isForm === 'FORM', form.isForm);
  check('login autocomplete email/current-password', form.emailAc === 'email' && form.passAc === 'current-password', `${form.emailAc}/${form.passAc}`);
  check('no fake password placeholder', form.passPlaceholder === '', JSON.stringify(form.passPlaceholder));
  check('login error has role=alert', form.errRole === 'alert');
  check('notice has no inline style', form.noticeInline === null);
  check('primary button: charcoal on soft coral', form.btnColor === 'rgb(26, 26, 28)' && form.btnBg === 'rgb(242, 132, 92)', `${form.btnColor} on ${form.btnBg}`);
  // Enter from the EMAIL field now submits (implicit form submission)
  await page.fill('#login-email', '');
  await page.focus('#login-email');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const afterEnter = await page.evaluate(() => ({
    errVisible: !document.getElementById('login-error').classList.contains('hidden'),
    text: document.getElementById('login-error').textContent,
    invalid: document.getElementById('login-email').getAttribute('aria-invalid'),
    url: location.href,
  }));
  check('Enter in email field runs validation (no reload)', afterEnter.errVisible && afterEnter.url === BASE + '/', afterEnter.text);
  check('empty email marked aria-invalid', afterEnter.invalid === 'true');
  await page.screenshot({ path: `${OUT}/01-login-desktop-error.png` });

  for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      btnBottom: document.getElementById('login-btn').getBoundingClientRect().bottom,
      googleBottom: document.getElementById('google-login-btn').getBoundingClientRect().bottom,
      descShown: getComputedStyle(document.querySelector('.auth-brand-desc')).display !== 'none',
    }));
    check(`login ${w}x${h}: no horizontal overflow`, m.sw <= m.cw, `${m.sw} vs ${m.cw}`);
    if (w <= 480) check(`login ${w}x${h}: school Google sign-in above the fold`, m.googleBottom <= h, `google bottom ${Math.round(m.googleBottom)} / ${h}`);
    if (w === 375) check(`login ${w}x${h}: Sign In button above the fold`, m.btnBottom <= h, `button bottom ${Math.round(m.btnBottom)} / ${h}`);
    if (w <= 480) check(`login ${w}x${h}: tagline removed on phones`, !m.descShown);
    await page.screenshot({ path: `${OUT}/02-login-${w}x${h}.png` });
  }
  check('login: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 2. Authenticated student/admin portal ----------
async function portal(extraRoutes) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await seedSession(page);
  await routeMocks(page, receipt);
  if (extraRoutes) await extraRoutes(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

{
  const { ctx, page, errors } = await portal();
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { tertiary: cs.getPropertyValue('--text-tertiary').trim(), on: cs.getPropertyValue('--accent-text-on').trim() };
  });
  check('--text-tertiary is the soft palette #8E8D97', tokens.tertiary.toUpperCase() === '#8E8D97', tokens.tertiary);

  await page.evaluate(() => { UI.showView('transactions'); return Transactions.load(); });
  await page.waitForTimeout(600);
  const labels = await page.$$eval('#tx-table-body .tx-del-btn', b => b.map(x => x.getAttribute('aria-label')));
  check('delete icon buttons have aria-label', labels.length > 0 && labels.every(Boolean), labels[0]);

  // Keyboard focus ring on the icon button
  await page.focus('#tx-table-body .tx-edit-btn');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { cls: el.className, style: cs.outlineStyle, width: cs.outlineWidth }; });
  check('tx action button shows focus-visible ring', ring.style === 'solid' && parseFloat(ring.width) >= 2, JSON.stringify(ring));

  // Delete modal: dialog semantics, focus, Escape, focus return, Cancel
  const trigger = page.locator('#tx-table-body .tx-del-btn').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const dlg = await page.evaluate(() => ({
    role: document.querySelector('#tx-delete-modal .modal-card')?.getAttribute('role'),
    modal: document.querySelector('#tx-delete-modal .modal-card')?.getAttribute('aria-modal'),
    focused: document.activeElement?.id,
    labelFor: document.querySelector('label[for="delete-reason"]') !== null,
    btnBg: getComputedStyle(document.getElementById('delete-submit-btn')).backgroundColor,
    inlineOnclick: document.querySelectorAll('#tx-delete-modal [onclick]').length,
  }));
  check('delete modal is an aria-modal alertdialog', dlg.role === 'alertdialog' && dlg.modal === 'true');
  check('delete modal focuses the reason field', dlg.focused === 'delete-reason', dlg.focused);
  check('delete reason label is associated', dlg.labelFor);
  check('danger button uses soft #BD4C45 fill', dlg.btnBg === 'rgb(189, 76, 69)', dlg.btnBg);
  check('delete modal has no inline handlers', dlg.inlineOnclick === 0);
  await page.screenshot({ path: `${OUT}/03-delete-modal.png` });
  // Tab trap: tabbing past the last control wraps inside the dialog
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement.closest('#tx-delete-modal'));
  check('Tab stays inside the delete modal', inside);
  // Empty reason: inline error + aria-invalid
  await page.click('#delete-submit-btn');
  const v = await page.evaluate(() => ({ err: !document.getElementById('delete-error').classList.contains('hidden'), inv: document.getElementById('delete-reason').getAttribute('aria-invalid') }));
  check('short reason shows inline error and aria-invalid', v.err && v.inv === 'true');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const esc = await page.evaluate(() => ({ gone: !document.getElementById('tx-delete-modal'), focusIsDel: document.activeElement?.classList.contains('tx-del-btn') }));
  check('Escape closes delete modal', esc.gone);
  check('focus returns to the delete button', esc.focusIsDel);
  // Cancel button works (was an inline onclick blocked by CSP)
  await trigger.click();
  await page.click('#delete-cancel-btn');
  check('Cancel closes delete modal', await page.evaluate(() => !document.getElementById('tx-delete-modal')));
  await page.locator('#tx-table-body .tx-edit-btn').first().click();
  await page.click('#edit-cancel-btn');
  check('Cancel closes edit modal', await page.evaluate(() => !document.getElementById('tx-edit-modal')));

  // Event cards keyboard access
  await page.evaluate(() => { UI.showView('events'); return Events && Events.load(); });
  await page.waitForTimeout(600);
  const card = page.locator('#events-grid .event-card').first();
  const cardAttrs = await card.evaluate(el => ({ role: el.getAttribute('role'), tab: el.tabIndex }));
  check('event cards are focusable buttons', cardAttrs.role === 'button' && cardAttrs.tab === 0, JSON.stringify(cardAttrs));
  await card.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('Enter on event card opens detail', await page.evaluate(() => document.getElementById('view-event-detail')?.classList.contains('active')));

  // Profile modal focus trap and return
  const pill = page.locator('#user-pill');
  if (await pill.count()) {
    await pill.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const inModal = await page.evaluate(() => !!document.activeElement.closest('#profile-modal'));
    check('profile modal moves focus inside', inModal);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('profile modal returns focus on Escape', await page.evaluate(() => document.activeElement?.id === 'user-pill'), await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
  } else {
    check('profile trigger present', false, '#user-pill not found');
  }

  // Shared confirm dialog (units remove path uses it)
  const cd = await page.evaluate(async () => {
    const p = UI.confirmDialog({ title: 'Remove?', message: 'Test', confirmLabel: 'Remove', danger: true, reason: { label: 'Why', required: true } });
    await new Promise(r => setTimeout(r, 50));
    const card = document.querySelector('.modal-overlay:last-child .modal-card');
    const snapshot = { role: card.getAttribute('role'), focused: document.activeElement.tagName, labelled: !!card.querySelector('label[for]') };
    card.querySelector('[data-action="confirm"]').click(); // empty reason, should stay open
    snapshot.stillOpen = !!document.querySelector('.modal-overlay:last-child .modal-card');
    snapshot.errShown = !card.querySelector('.auth-error').classList.contains('hidden');
    card.querySelector('input').value = '  because  ';
    card.querySelector('[data-action="confirm"]').click();
    snapshot.value = await p;
    return snapshot;
  });
  check('confirmDialog: alertdialog, focuses input, labelled', cd.role === 'alertdialog' && cd.focused === 'INPUT' && cd.labelled, JSON.stringify(cd));
  check('confirmDialog: required reason enforced, trimmed value returned', cd.stillOpen && cd.errShown && cd.value === 'because', JSON.stringify(cd.value));
  const cancelled = await page.evaluate(async () => {
    const p = UI.confirmDialog({ title: 'x' });
    await new Promise(r => setTimeout(r, 30));
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return p;
  });
  check('confirmDialog: Escape resolves false', cancelled === false);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => { UI.showView('transactions'); });
  await page.waitForTimeout(300);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check('portal transactions 375px: no horizontal overflow', ov);
  await page.screenshot({ path: `${OUT}/04-transactions-mobile.png` });
  check('portal: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 3. Transactions load failure reaches mobile cards ----------
{
  const { ctx, page, errors } = await portal(async p => {
    await p.route(/\/api\/transactions/, r => r.fulfill(json({ error: 'Service unavailable' }, 503)));
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => { UI.showView('transactions'); return Transactions.load(); });
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({
    cards: document.getElementById('tx-mobile-cards')?.innerText || '',
    retry: document.querySelectorAll('#tx-mobile-cards .tx-retry-btn').length,
    skeleton: document.querySelectorAll('#tx-mobile-cards .skeleton, #tx-mobile-cards .sk-bone').length,
  }));
  check('tx failure shown in mobile cards with Retry', /Could not load transactions/.test(st.cards) && st.retry === 1 && st.skeleton === 0, st.cards.slice(0, 90));
  await page.screenshot({ path: `${OUT}/05-transactions-error-mobile.png` });
  await ctx.close();
}

// ---------- 4. Enrollment double submit ----------
{
  let submitHits = 0;
  const now = new Date();
  const sy = now.getMonth() >= 5 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
  const draft = { id: 'sub1', school_year: sy, semester: 1, status: 'draft', enrollment_submission_items: [
    { id: 'it1', subject_id: 'subj1', item_state: 'proposed', origin: 'student', subjects: { id: 'subj1', code: 'CPE 311', title: 'Microprocessors', units: 3, year_level: 3 } },
  ] };
  const { ctx, page, errors } = await portal(async p => {
    await p.route(/\/api\/units\/my/, r => r.fulfill(json([])));
    await p.route(/\/api\/enrollment\/submissions\/my/, r => r.fulfill(json({ submissions: [draft] })));
    await p.route(/\/api\/enrollment\/submissions\/sub1\/submit/, async r => {
      submitHits++;
      await new Promise(res => setTimeout(res, 800));
      r.fulfill(json({ submission: { ...draft, status: 'submitted' } }));
    });
  });
  page.on('dialog', d => d.accept());
  await page.evaluate(async () => { UI.showView('enrollment'); await window.Enrollment.ensureReady(); });
  await page.waitForTimeout(600);
  const btn = page.locator('#enrollment-submit-btn');
  if (await btn.count()) {
    await btn.dblclick();
    await page.waitForTimeout(1500);
    check('enrollment double click sends exactly one submit', submitHits === 1, `submit requests: ${submitHits}`);
  } else {
    check('enrollment submit button rendered', false, 'button not found');
  }
  check('enrollment: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 5. Feedback page loads vendored Supabase ----------
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const cdn = [];
  page.on('request', r => { if (r.url().includes('jsdelivr')) cdn.push(r.url()); });
  await page.route(/supabase\.co/, r => r.fulfill(json({})));
  await page.goto(BASE + '/feedback/', { waitUntil: 'networkidle' });
  const fb = await page.evaluate(() => ({
    supabase: typeof supabase !== 'undefined',
    err: document.getElementById('fb-login-error')?.textContent || '',
    btnBg: getComputedStyle(document.querySelector('#fb-login-form button[type="submit"]') || document.body).backgroundColor,
    linkColor: getComputedStyle(document.querySelector('.fb-copyright a')).color,
  }));
  check('feedback: Supabase loaded from /vendor (no CDN request)', fb.supabase && cdn.length === 0, `cdn requests: ${cdn.length}`);
  check('feedback: no "Supabase failed" error shown', !/Supabase failed/.test(fb.err), fb.err);
  check('feedback: accent matches portal soft coral', fb.btnBg === 'rgb(242, 132, 92)' && fb.linkColor === 'rgb(242, 132, 92)', `${fb.btnBg} / ${fb.linkColor}`);
  await page.screenshot({ path: `${OUT}/06-feedback-mobile.png` });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
