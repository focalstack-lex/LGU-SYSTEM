/**
 * Mobile Responsiveness Audit Harness
 * ----------------------------------
 * Measures real rendered layout at phone/tablet viewports and reports:
 *   - horizontal overflow that is CLIPPED (html/body set overflow-x:hidden,
 *     so documentElement.scrollWidth cannot see it -- we compare element rects)
 *   - inputs whose computed font-size < 16px (iOS focus-zoom trigger)
 *   - interactive targets smaller than the 44x44 CSS px touch guideline
 *   - nowrap text that extends past the viewport
 *
 * Read-only: loads pages, never submits forms or writes data.
 *
 * Usage: node scripts/audit-mobile-responsive.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'reports', 'mobile-responsive');

const BASE = process.argv[2] || 'http://localhost:3000';

const VIEWPORTS = [
  { name: '320x568-phone-small', width: 320, height: 568 },
  { name: '360x640-android', width: 360, height: 640 },
  { name: '390x844-iphone14', width: 390, height: 844 },
  { name: '414x896-iphone-xr', width: 414, height: 896 },
  { name: '844x390-phone-landscape', width: 844, height: 390 },
  { name: '768x1024-ipad-portrait', width: 768, height: 1024 },
  { name: '1024x768-ipad-landscape', width: 1024, height: 768 },
  { name: '1280x800-desktop-ref', width: 1280, height: 800 },
];

const PAGES = [
  { name: 'student-portal (auth)', path: '/' },
  { name: 'student-portal (app shell forced)', path: '/', forceApp: true },
  { name: 'cv-verify', path: '/cv-verify' },
  { name: 'cv-builder', path: '/cv-builder' },
  { name: 'feedback', path: '/feedback/' },
  { name: 'feedback-view', path: '/feedback/view/' },
  { name: 'faculty', path: '/faculty' },
];

// Runs inside the page. Returns a structured metric report.
const COLLECT = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const TOL = 1; // sub-pixel tolerance

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return true;
  };

  const describe = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  // Walk up looking for an ancestor that can scroll horizontally, which makes
  // the overflow an intentional scroll region rather than a clipped bug.
  const scrollAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX)) return describe(p);
      p = p.parentElement;
    }
    return null;
  };

  const overflow = [];
  const nowrapOverflow = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();

    // Skip elements whose own horizontal overflow is intentional scrolling.
    const cs = getComputedStyle(el);
    const selfScrolls = /(auto|scroll)/.test(cs.overflowX);

    const beyondRight = r.right - vw;
    const beyondLeft = -r.left;

    if ((beyondRight > TOL || beyondLeft > TOL) && !selfScrolls) {
      // Only report the outermost offender for any given edge to keep the
      // report readable; nested children inherit the parent's problem.
      overflow.push({
        el: describe(el),
        right: Math.round(r.right),
        left: Math.round(r.left),
        width: Math.round(r.width),
        overhangPx: Math.round(Math.max(beyondRight, beyondLeft)),
        scrollAncestor: scrollAncestor(el),
        nowrap: cs.whiteSpace === 'nowrap',
      });
    }
  }

  // Inputs that will trigger iOS focus-zoom.
  const zoomInputs = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!isVisible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) {
      zoomInputs.push({
        el: describe(el),
        fontSizePx: Math.round(fs * 10) / 10,
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        inputmode: el.getAttribute('inputmode') || null,
      });
    }
  }

  // Touch targets under 44px in either dimension.
  const smallTargets = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], .btn')) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      smallTargets.push({
        el: describe(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        hasAriaLabel: !!el.getAttribute('aria-label'),
        text: (el.textContent || '').trim().slice(0, 24),
      });
    }
  }

  return {
    viewport: { vw, vh },
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
    overflow: overflow.slice(0, 25),
    overflowCount: overflow.length,
    nowrapOverflowCount: overflow.filter((o) => o.nowrap).length,
    zoomInputs,
    smallTargets: smallTargets.slice(0, 25),
    smallTargetCount: smallTargets.length,
  };
};

// Force the authenticated shell into view so the app layout (not just the
// login card) can be measured without credentials. Data will be empty; we are
// measuring layout boxes and CSS, not content.
const FORCE_APP = () => {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-screen');
  if (auth) {
    auth.classList.remove('active');
    auth.style.display = 'none';
  }
  if (app) {
    app.classList.add('active');
    app.style.display = 'block';
  }
  const shells = document.querySelectorAll('.skeleton-overlay, #skeleton-overlay');
  shells.forEach((s) => (s.style.display = 'none'));
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  const consoleErrors = [];

  for (const vp of VIEWPORTS) {
    for (const page of PAGES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        isMobile: vp.width <= 480,
        hasTouch: vp.width <= 900,
        userAgent:
          vp.width <= 480
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
            : undefined,
      });
      const tab = await ctx.newPage();
      const errs = [];
      tab.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));

      let metrics = null;
      let note = null;
      try {
        await tab.goto(BASE + page.path, { waitUntil: 'load', timeout: 20000 });
        await tab.waitForTimeout(700);
        if (page.forceApp) {
          await tab.evaluate(FORCE_APP);
          await tab.waitForTimeout(300);
        }
        metrics = await tab.evaluate(COLLECT);
      } catch (e) {
        note = `navigation/collect failed: ${String(e.message).slice(0, 160)}`;
      }

      results.push({
        ...(metrics || {}),
        viewport: vp.name,
        page: page.name,
        path: page.path,
        note,
        pageErrors: errs.slice(0, 3),
      });
      console.log(
        `${vp.name.padEnd(26)} ${page.name.padEnd(34)} ` +
          (metrics
            ? `overflow=${String(metrics.overflowCount).padStart(3)} ` +
              `nowrap=${String(metrics.nowrapOverflowCount).padStart(3)} ` +
              `zoomInputs=${String(metrics.zoomInputs.length).padStart(2)} ` +
              `smallTargets=${String(metrics.smallTargetCount).padStart(3)}`
            : `FAILED (${note})`),
      );

      await ctx.close();
    }
  }

  await browser.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outFile = resolve(OUT_DIR, `raw-metrics-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\nRaw metrics written to ${outFile}`);
};

main().catch((e) => {
  console.error('harness crashed:', e);
  process.exit(1);
});
