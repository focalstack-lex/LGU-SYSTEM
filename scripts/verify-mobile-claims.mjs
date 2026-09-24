/**
 * Focused verification of specific audit claims (read-only).
 * Usage: node scripts/verify-mobile-claims.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';

const FORCE_APP = () => {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-screen');
  if (auth) { auth.classList.remove('active'); auth.style.display = 'none'; }
  if (app) { app.classList.add('active'); app.style.display = 'block'; }
  document.querySelectorAll('.skeleton-overlay, #skeleton-overlay').forEach((s) => (s.style.display = 'none'));
};

const report = (sel, label) => ({
  label: label || sel,
  results: [sel].flat().map((s) => {
    const el = document.querySelector(s);
    if (!el) return { sel: s, missing: true };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel: s,
      display: cs.display,
      visibility: cs.visibility,
      rect: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) },
      offscreen: r.right <= 0 || r.left >= innerWidth,
      zeroSize: r.width === 0 || r.height === 0,
    };
  }),
});

const main = async () => {
  const browser = await chromium.launch();

  // ---------- A. index.html nav/account reachability across the 480/768 boundary ----------
  console.log('\n########## A. index.html shell at key widths ##########');
  for (const w of [390, 480, 481, 640, 768, 769]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true, isMobile: w <= 480 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(FORCE_APP);
    await page.waitForTimeout(200);

    const out = await page.evaluate(({ reportSrc }) => {
      const report = eval('(' + reportSrc + ')');
      const nav = report([
        '.sidebar',
        '.app-mobile-header',
        '#user-pill',
        '.sidebar-actions',
        '.bottom-nav',
        '#mobile-more-sheet',
        '#theme-toggle-btn',
      ], 'nav');
      // Which of these are actually visible & on-screen?
      const visible = nav.results.filter((r) => !r.missing && r.display !== 'none' && r.visibility !== 'hidden' && !r.zeroSize && !r.offscreen).map((r) => r.sel);
      // Any way to open the profile from here?
      const profileEntry = document.querySelector('[data-action="open-profile"], #user-pill, .mobile-profile-btn');
      let pv = null;
      if (profileEntry) {
        const r = profileEntry.getBoundingClientRect();
        const cs = getComputedStyle(profileEntry);
        pv = {
          el: profileEntry.id || profileEntry.className,
          display: cs.display,
          onScreen: r.right > 0 && r.left < innerWidth && r.width > 0 && r.height > 0,
          rect: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) },
        };
      }
      return { nav: nav.results, visible, profileEntry: pv };
    }, { reportSrc: report.toString() });

    console.log(`\n--- width ${w}px ---`);
    console.log('  visible nav elements:', out.visible.join(', ') || '(none)');
    console.log('  profile entry:', JSON.stringify(out.profileEntry));
    for (const r of out.nav) {
      if (r.missing) continue;
      console.log(`    ${r.sel.padEnd(24)} display=${String(r.display).padEnd(6)} rect(l=${String(r.rect.l).padStart(5)},r=${String(r.rect.r).padStart(5)},w=${String(r.rect.w).padStart(4)})${r.offscreen ? '  <-- OFFSCREEN' : ''}`);
    }
    await ctx.close();
  }

  // ---------- B. officer.css: are .of-form-row / .of-filter-bar leaking globally? ----------
  console.log('\n########## B. officer.css global-leak check (.of-form-row / .of-filter-bar) ##########');
  for (const w of [1280, 1024, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/officer.html', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const out = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, missing: true };
        const cs = getComputedStyle(el);
        return { sel, gridTemplateColumns: cs.gridTemplateColumns, flexDirection: cs.flexDirection, alignItems: cs.alignItems };
      };
      return [pick('.of-form-row'), pick('.of-filter-bar'), pick('.of-stat-grid')];
    });
    console.log(`\n--- officer.html @ ${w}px (expect of-form-row = 2 columns at >=901px) ---`);
    for (const r of out) console.log('   ', JSON.stringify(r));
    await ctx.close();
  }

  // ---------- C. ai.css: launcher offset in the 641-768 dead zone ----------
  console.log('\n########## C. ai.css launcher offset (dead zone 641-768) ##########');
  for (const w of [390, 500, 641, 700, 769, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const out = await page.evaluate(() => {
      const res = {};
      for (const sel of ['.ursa-launcher', '.grizz-launcher', '.bottom-nav', '.ursa-launcher-text']) {
        const el = document.querySelector(sel);
        if (!el) { res[sel] = 'missing'; continue; }
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        res[sel] = { display: cs.display, bottom: cs.bottom, right: cs.right, width: Math.round(r.width), height: Math.round(r.height) };
      }
      return res;
    });
    const bn = out['.bottom-nav'];
    console.log(`\n--- width ${w}px ---`);
    console.log('   launcher :', JSON.stringify(out['.ursa-launcher'] || out['.grizz-launcher']));
    console.log('   launcher-text:', JSON.stringify(out['.ursa-launcher-text']));
    console.log('   bottom-nav:', JSON.stringify(bn));
    await ctx.close();
  }

  // ---------- D. feedback input font-size ----------
  console.log('\n########## D. feedback page input font-size ##########');
  for (const p of ['/feedback/', '/feedback/view/']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const out = await page.evaluate(() => {
      const rows = [];
      for (const el of document.querySelectorAll('input, select, textarea')) {
        rows.push({ el: el.id || el.name || el.tagName, fs: getComputedStyle(el).fontSize });
      }
      return { body: getComputedStyle(document.body).fontSize, rows };
    });
    console.log(`   ${p}  body font-size: ${out.body}`);
    for (const r of out.rows) console.log(`      ${String(r.el).padEnd(22)} ${r.fs}`);
    await ctx.close();
  }

  await browser.close();
};

main().catch((e) => { console.error('crashed:', e); process.exit(1); });
