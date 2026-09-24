import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function run() {
  console.log('[VERIFY SKELETON] Starting verification against ' + BASE_URL);
  const browser = await chromium.launch({ headless: true });

  const results = [];

  try {
    const page = await browser.newPage();

    // 1. Check Student Portal Mobile Skeleton (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'domcontentloaded' });

    // Force splash-screen visible
    await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
        splash.style.opacity = '1';
        splash.style.visibility = 'visible';
      }
    });

    const mobileSplashMetrics = await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      const mobileHeader = document.querySelector('.sk-mobile-header');
      const sidebar = document.querySelector('.sk-sidebar');
      const heroCard = document.querySelector('.sk-stat-card-hero');
      const secGrid = document.querySelector('.sk-stats-secondary-grid');
      const donationsCard = document.querySelector('.sk-stat-card-donations');
      const bottomNav = document.querySelector('.sk-bottom-nav');
      const activeNavBtn = document.querySelector('.sk-nav-btn--active');

      return {
        splashDisplay: splash ? getComputedStyle(splash).display : null,
        splashFlexDir: splash ? getComputedStyle(splash).flexDirection : null,
        mobileHeaderDisplay: mobileHeader ? getComputedStyle(mobileHeader).display : null,
        mobileHeaderHeight: mobileHeader ? mobileHeader.offsetHeight : null,
        sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
        heroCardWidth: heroCard ? heroCard.offsetWidth : null,
        heroCardHeight: heroCard ? heroCard.offsetHeight : null,
        secGridColumns: secGrid ? getComputedStyle(secGrid).gridTemplateColumns.split(' ').length : null,
        donationsGridCol: donationsCard ? getComputedStyle(donationsCard).gridColumn : null,
        bottomNavDisplay: bottomNav ? getComputedStyle(bottomNav).display : null,
        activeNavBtnPresent: !!activeNavBtn
      };
    });

    console.log('[PORTAL MOBILE METRICS]:', JSON.stringify(mobileSplashMetrics, null, 2));

    const check1 = mobileSplashMetrics.mobileHeaderDisplay === 'flex' &&
                   mobileSplashMetrics.sidebarDisplay === 'none' &&
                   mobileSplashMetrics.secGridColumns === 2 &&
                   mobileSplashMetrics.bottomNavDisplay === 'flex' &&
                   mobileSplashMetrics.activeNavBtnPresent;

    results.push({ test: 'Student Portal Mobile Skeleton Layout', pass: check1, details: mobileSplashMetrics });

    // 2. Check Student Portal Desktop Skeleton (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
        splash.style.opacity = '1';
        splash.style.visibility = 'visible';
      }
    });

    const desktopSplashMetrics = await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      const mobileHeader = document.querySelector('.sk-mobile-header');
      const sidebar = document.querySelector('.sk-sidebar');
      const heroCard = document.querySelector('.sk-stat-card-hero');
      const secGrid = document.querySelector('.sk-stats-secondary-grid');
      const bottomNav = document.querySelector('.sk-bottom-nav');

      return {
        splashDisplay: splash ? getComputedStyle(splash).display : null,
        splashFlexDir: splash ? getComputedStyle(splash).flexDirection : null,
        mobileHeaderDisplay: mobileHeader ? getComputedStyle(mobileHeader).display : null,
        sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
        sidebarWidth: sidebar ? sidebar.offsetWidth : null,
        heroCardWidth: heroCard ? heroCard.offsetWidth : null,
        secGridColumns: secGrid ? getComputedStyle(secGrid).gridTemplateColumns.split(' ').length : null,
        bottomNavDisplay: bottomNav ? getComputedStyle(bottomNav).display : null
      };
    });

    console.log('[PORTAL DESKTOP METRICS]:', JSON.stringify(desktopSplashMetrics, null, 2));

    const check2 = desktopSplashMetrics.mobileHeaderDisplay === 'none' &&
                   desktopSplashMetrics.sidebarDisplay === 'flex' &&
                   desktopSplashMetrics.secGridColumns === 3 &&
                   desktopSplashMetrics.bottomNavDisplay === 'none';

    results.push({ test: 'Student Portal Desktop Skeleton Layout', pass: check2, details: desktopSplashMetrics });

    // 3. Check Officer Portal Mobile Skeleton (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL + '/officer.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
        splash.style.opacity = '1';
        splash.style.visibility = 'visible';
      }
    });

    const officerMobileMetrics = await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      const mobileHeader = document.querySelector('.sk-mobile-header');
      const sidebar = document.querySelector('.sk-sidebar');
      const secGrid = document.querySelector('.sk-stats-secondary-grid');
      const bottomNav = document.querySelector('.sk-bottom-nav');
      const activeNavBtn = document.querySelector('.sk-nav-btn--active');

      return {
        splashDisplay: splash ? getComputedStyle(splash).display : null,
        mobileHeaderDisplay: mobileHeader ? getComputedStyle(mobileHeader).display : null,
        sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
        secGridColumns: secGrid ? getComputedStyle(secGrid).gridTemplateColumns.split(' ').length : null,
        bottomNavDisplay: bottomNav ? getComputedStyle(bottomNav).display : null,
        activeNavBtnPresent: !!activeNavBtn
      };
    });

    console.log('[OFFICER MOBILE METRICS]:', JSON.stringify(officerMobileMetrics, null, 2));

    const check3 = officerMobileMetrics.mobileHeaderDisplay === 'flex' &&
                   officerMobileMetrics.sidebarDisplay === 'none' &&
                   officerMobileMetrics.secGridColumns === 2 &&
                   officerMobileMetrics.bottomNavDisplay === 'flex' &&
                   officerMobileMetrics.activeNavBtnPresent;

    results.push({ test: 'Officer Portal Mobile Skeleton Layout', pass: check3, details: officerMobileMetrics });

  } finally {
    await browser.close();
  }

  console.log('\n==============================');
  console.log('SKELETON VERIFICATION SUMMARY');
  console.log('==============================');
  let allPass = true;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) allPass = false;
    console.log(`[${status}] ${r.test}`);
  }

  if (!allPass) {
    console.error('\nOne or more skeleton verification checks failed.');
    process.exit(1);
  } else {
    console.log('\nAll skeleton verification checks passed successfully.');
  }
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
