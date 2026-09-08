import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const deck = pathToFileURL(path.resolve('presentation/COE-System-Presentation.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(deck);
await page.waitForTimeout(800);
await page.keyboard.press('End');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'presentation/shots/_verify-thankyou.png' });
console.log('slide counter:', await page.textContent('.slide-counter'));
console.log('qr img count:', await page.locator('img[alt="QR code — feedback form"]').count());
const qrSrc = await page.locator('img[alt="QR code — feedback form"]').getAttribute('src');
console.log('qr is data uri:', qrSrc.startsWith('data:image/png;base64,'));
console.log('qr rendered box:', JSON.stringify(await page.locator('img[alt="QR code — feedback form"]').boundingBox()));
await browser.close();
