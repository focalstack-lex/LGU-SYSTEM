import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
        splash.style.opacity = '1';
        splash.style.visibility = 'visible';
      }
    });

    await page.screenshot({ path: 'reports/mobile-skeleton-student.png', fullPage: false });
    console.log('Saved reports/mobile-skeleton-student.png');

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

    await page.screenshot({ path: 'reports/mobile-skeleton-officer.png', fullPage: false });
    console.log('Saved reports/mobile-skeleton-officer.png');
  } finally {
    await browser.close();
  }
}

run();
