import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { receiptPng, routeMocks, seedSession } from '../scripts/lib-capture-mocks.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.join(__dirname, '..', 'client');

async function run() {
  const app = express();
  app.use(express.static(clientDir));
  const server = createServer(app);
  await new Promise(r => server.listen(8130, r));
  console.log('Server started on 8130');

  const browser = await chromium.launch();
  const receipt = receiptPng();

  // 1. Check Auth Screen 50/50 on iPhone 14 Pro
  {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await routeMocks(page, receipt);
    await page.goto('http://localhost:8130/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const authPath = `C:/Users/User/.gemini/antigravity-ide/brain/e2f6c339-d965-4ba2-9d7c-b7d39068e7cd/verify_auth_50_50.png`;
    await page.screenshot({ path: authPath });
    console.log('Saved auth screenshot:', authPath);
    await ctx.close();
  }

  // 2. Check Logged In App Screen (Ensure Auth Screen is completely gone!)
  {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await seedSession(page);
    await routeMocks(page, receipt);
    await page.goto('http://localhost:8130/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const appPath = `C:/Users/User/.gemini/antigravity-ide/brain/e2f6c339-d965-4ba2-9d7c-b7d39068e7cd/verify_app_no_leak.png`;
    await page.screenshot({ path: appPath });
    console.log('Saved app dashboard screenshot:', appPath);

    const isAuthHidden = await page.evaluate(() => {
      const auth = document.getElementById('auth-screen');
      const style = window.getComputedStyle(auth);
      return style.display === 'none';
    });
    console.log('Is #auth-screen display: none when logged in?', isAuthHidden);
    await ctx.close();
  }

  await browser.close();
  server.close();
}

run().catch(console.error);
