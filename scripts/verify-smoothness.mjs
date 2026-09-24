/**
 * verify-smoothness.mjs — Automated Verification Suite for System Smoothness and Fluidity
 * Usage: node scripts/verify-smoothness.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';

const FORCE_APP = () => {
  const auth = document.getElementById('auth-screen');
  const app = document.getElementById('app-screen');
  if (auth) { auth.classList.remove('active'); auth.style.display = 'none'; }
  if (app) { app.classList.add('active'); app.style.display = 'block'; }
  document.querySelectorAll('.skeleton-overlay, #skeleton-overlay').forEach((s) => (s.style.display = 'none'));
  const dash = document.getElementById('view-dashboard') || document.querySelector('.view');
  if (dash) dash.classList.add('active');
};

const main = async () => {
  console.log('\n=============================================');
  console.log('  System Smoothness & Fluidity Verification');
  console.log('=============================================\n');

  const browser = await chromium.launch();
  let failures = 0;

  // 1. Student Portal Verification
  console.log('--- 1. Student Portal (index.html) ---');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(FORCE_APP);
    await page.waitForTimeout(200);

    const metrics = await page.evaluate(() => {
      const activeView = document.querySelector('.view.active');
      const activeViewCs = activeView ? getComputedStyle(activeView) : null;
      const btn = document.querySelector('button, .btn, .nav-item');
      const btnCs = btn ? getComputedStyle(btn) : null;
      const dataCard = document.createElement('div');
      dataCard.className = 'data-card';
      document.body.appendChild(dataCard);
      const cardCs = getComputedStyle(dataCard);
      const hasSWRCache = typeof window.SWRCache !== 'undefined';
      
      // Test SWR speed
      let swrTestPassed = false;
      if (hasSWRCache) {
        window.SWRCache.set('test_key', { value: 42 });
        const start = performance.now();
        const hit = window.SWRCache.get('test_key');
        const duration = performance.now() - start;
        swrTestPassed = hit && hit.value === 42 && duration < 5;
      }

      // Test scrollbar lock
      let lockTestPassed = false;
      if (typeof UI !== 'undefined' && UI.lockScrollbar && UI.unlockScrollbar) {
        UI.lockScrollbar();
        const locked = document.body.classList.contains('modal-open');
        UI.unlockScrollbar();
        const unlocked = !document.body.classList.contains('modal-open');
        lockTestPassed = locked && unlocked;
      }

      document.body.removeChild(dataCard);

      return {
        viewAnimation: activeViewCs ? activeViewCs.animationName : 'none',
        viewWillChange: activeViewCs ? activeViewCs.willChange : 'auto',
        touchAction: btnCs ? btnCs.touchAction : 'auto',
        cardContentVisibility: cardCs ? cardCs.contentVisibility : 'visible',
        hasSWRCache,
        swrTestPassed,
        lockTestPassed
      };
    });

    console.log(`   View animation name       : ${metrics.viewAnimation}`);
    console.log(`   View will-change          : ${metrics.viewWillChange}`);
    console.log(`   Touch-action              : ${metrics.touchAction}`);
    console.log(`   Card content-visibility   : ${metrics.cardContentVisibility}`);
    console.log(`   SWRCache present          : ${metrics.hasSWRCache}`);
    console.log(`   SWRCache <5ms retrieval   : ${metrics.swrTestPassed}`);
    console.log(`   UI scrollbar lock test    : ${metrics.lockTestPassed}`);

    if (metrics.touchAction !== 'manipulation') {
      console.error('   ❌ FAILED: touch-action is not manipulation');
      failures++;
    }
    if (!metrics.hasSWRCache || !metrics.swrTestPassed) {
      console.error('   ❌ FAILED: SWRCache instant retrieval failed');
      failures++;
    }
    if (!metrics.lockTestPassed) {
      console.error('   ❌ FAILED: lockScrollbar/unlockScrollbar failed');
      failures++;
    }
    await page.close();
  }

  // 2. Officer Executive Portal Verification
  console.log('\n--- 2. Executive Portal (officer.html) ---');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + '/officer.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);

    const metrics = await page.evaluate(() => {
      const activeOfView = document.querySelector('.of-view.active');
      const ofViewCs = activeOfView ? getComputedStyle(activeOfView) : null;
      const ofBtn = document.querySelector('.of-btn, .nav-item, button');
      const ofBtnCs = ofBtn ? getComputedStyle(ofBtn) : null;
      const hasSWRCache = typeof window.SWRCache !== 'undefined';

      return {
        ofViewAnimation: ofViewCs ? ofViewCs.animationName : 'none',
        ofViewWillChange: ofViewCs ? ofViewCs.willChange : 'auto',
        ofTouchAction: ofBtnCs ? ofBtnCs.touchAction : 'auto',
        hasSWRCache
      };
    });

    console.log(`   Of-View animation name    : ${metrics.ofViewAnimation}`);
    console.log(`   Of-View will-change       : ${metrics.ofViewWillChange}`);
    console.log(`   Of-Button touch-action    : ${metrics.ofTouchAction}`);
    console.log(`   SWRCache present in officer: ${metrics.hasSWRCache}`);

    if (metrics.ofTouchAction !== 'manipulation') {
      console.error('   ❌ FAILED: officer touch-action is not manipulation');
      failures++;
    }
    if (!metrics.hasSWRCache) {
      console.error('   ❌ FAILED: SWRCache missing in officer.html');
      failures++;
    }
    await page.close();
  }

  await browser.close();

  if (failures === 0) {
    console.log('\n✅ All System Smoothness and Fluidity checks passed with 100% success!\n');
    process.exit(0);
  } else {
    console.error(`\n❌ Failed with ${failures} defect(s).\n`);
    process.exit(1);
  }
};

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
