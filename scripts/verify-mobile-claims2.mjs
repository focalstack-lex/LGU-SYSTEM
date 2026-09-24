/** Final targeted measurements (read-only). */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

const FORCE_APP = () => {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-screen');
  if (auth) { auth.classList.remove('active'); auth.style.display = 'none'; }
  if (app) { app.classList.add('active'); app.style.display = 'block'; }
  document.querySelectorAll('.skeleton-overlay, #skeleton-overlay').forEach((s) => (s.style.display = 'none'));
};

const main = async () => {
  const browser = await chromium.launch();

  console.log('\n===== 1. sidebar-footer children in the 481-768 band =====');
  for (const w of [390, 481, 600, 768, 769]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true, isMobile: w <= 480 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(FORCE_APP);
    await page.waitForTimeout(200);
    const out = await page.evaluate(() => {
      const rows = [];
      for (const sel of ['#user-pill', '#theme-toggle-btn', '#profile-settings-btn', '#logout-btn', '.sidebar-actions', '.sidebar']) {
        const el = document.querySelector(sel);
        if (!el) { rows.push({ sel, missing: true }); continue; }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        rows.push({
          sel,
          display: cs.display,
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
          fullyOffscreen: r.right <= 0,
          clippedLeft: r.left < 0 && r.right > 0,
        });
      }
      return rows;
    });
    console.log(`\n--- ${w}px ---`);
    for (const r of out) {
      if (r.missing) { console.log(`   ${r.sel.padEnd(22)} MISSING`); continue; }
      const flag = r.fullyOffscreen ? '  <== FULLY OFF-SCREEN' : r.clippedLeft ? '  <== CLIPPED at left edge' : '';
      console.log(`   ${r.sel.padEnd(22)} display=${String(r.display).padEnd(6)} left=${String(r.left).padStart(5)} right=${String(r.right).padStart(5)} w=${String(r.w).padStart(4)}${flag}`);
    }
    await ctx.close();
  }

  console.log('\n===== 2. .data-card computed style: 400px vs 600px vs 800px =====');
  for (const w of [400, 600, 800]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(FORCE_APP);
    const out = await page.evaluate(() => {
      const host = document.getElementById('tx-mobile-cards');
      if (!host) return { missing: true };
      host.innerHTML = `<div class="data-card"><div class="data-card-header"><strong>Test</strong></div>
        <div class="data-card-body"><div class="data-card-row"><span class="data-card-label">Date</span><span>2026-09-24</span></div></div></div>`;
      const grab = (sel) => {
        const el = host.querySelector(sel);
        if (!el) return 'missing';
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          display: cs.display, background: cs.backgroundColor, borderWidth: cs.borderTopWidth,
          borderRadius: cs.borderTopLeftRadius, padding: cs.paddingTop + '/' + cs.paddingLeft,
          flexDirection: cs.flexDirection, justifyContent: cs.justifyContent, w: Math.round(r.width),
        };
      };
      return {
        containerDisplay: getComputedStyle(host).display,
        card: grab('.data-card'),
        row: grab('.data-card-row'),
        tableWrapper: (() => {
          const tw = document.querySelector('#view-transactions .table-wrapper');
          return tw ? getComputedStyle(tw).display : 'missing';
        })(),
      };
    });
    console.log(`\n--- ${w}px ---`);
    console.log('   #tx-mobile-cards display :', out.containerDisplay);
    console.log('   .table-wrapper display   :', out.tableWrapper);
    console.log('   .data-card               :', JSON.stringify(out.card));
    console.log('   .data-card-row           :', JSON.stringify(out.row));
    await ctx.close();
  }

  console.log('\n===== 3. onboarding modal input font-size (iOS zoom) =====');
  for (const w of [390, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true, isMobile: w <= 480 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const out = await page.evaluate(() => {
      const rows = [];
      for (const el of document.querySelectorAll('.onboarding-card input, .onboarding-card select, .onboarding-grid-row select, #onboarding-name')) {
        const r = el.getBoundingClientRect();
        rows.push({ el: el.id || el.className || el.tagName, fs: getComputedStyle(el).fontSize, w: Math.round(r.width), visible: r.width > 0 });
      }
      const card = document.querySelector('.onboarding-card');
      const grid = document.querySelector('.onboarding-grid-row');
      return {
        rows,
        gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : 'missing',
        cardW: card ? Math.round(card.getBoundingClientRect().width) : 'missing',
      };
    });
    console.log(`\n--- ${w}px ---  onboarding-card width=${out.cardW}  .onboarding-grid-row cols=${out.gridCols}`);
    for (const r of out.rows) console.log(`   ${String(r.el).padEnd(28)} font-size=${r.fs}  (w=${r.w}, visible=${r.visible})`);
    await ctx.close();
  }

  await browser.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
