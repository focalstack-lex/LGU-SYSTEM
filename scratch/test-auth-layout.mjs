import { chromium } from 'playwright';
import { receiptPng, routeMocks } from '../scripts/lib-capture-mocks.mjs';

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.join(__dirname, '..', 'client');

const devices = [
  { name: 'iPhone_SE', width: 375, height: 667, scale: 2 },
  { name: 'iPhone_14_Pro', width: 393, height: 852, scale: 3 },
  { name: 'Pixel_7', width: 412, height: 915, scale: 2.625 }
];

async function run() {
  const app = express();
  app.use(express.static(clientDir));
  const server = createServer(app);
  await new Promise(r => server.listen(8129, r));
  console.log('Static server listening on http://localhost:8129');
  const browser = await chromium.launch();
  const receipt = receiptPng();

  for (const dev of devices) {
    const context = await browser.newContext({
      viewport: { width: dev.width, height: dev.height },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    await routeMocks(page, receipt);

    // Navigate to auth screen (no session seeded, so stays on login)
    await page.goto('http://localhost:8129/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const shotPath = `C:/Users/User/.gemini/antigravity-ide/brain/e2f6c339-d965-4ba2-9d7c-b7d39068e7cd/auth_mobile_${dev.name}.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`Saved screenshot for ${dev.name}: ${shotPath}`);

    // Check if any horizontal overflow exists
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`${dev.name} horizontal overflow:`, overflow);

    await context.close();
  }

  await browser.close();
  server.close();
}

run().catch(console.error);
