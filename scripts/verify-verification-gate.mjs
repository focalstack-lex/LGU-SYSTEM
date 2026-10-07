// Run with the server up (npm start, port 3000): node scripts/verify-verification-gate.mjs
// Drives the student login gate with the mocked backend and asserts:
//  A. a profile with is_verified = true enters the portal even when the roster has no
//     matching name and no verification request exists (the bug: officer-verified
//     accounts were sent back to "Enrollment Verification Required");
//  B. an unverified profile with no roster match and no request is still gated;
//  C. an unverified profile whose name is in the roster still enters (legacy path).
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng, PROFILE } from './lib-capture-mocks.mjs';

const BASE = 'http://127.0.0.1:3000';
const json = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
const CASES = [
  { name: 'A verified profile, empty roster, no request', is_verified: true, roster: [], expectApp: true },
  { name: 'B unverified profile, empty roster, no request', is_verified: false, roster: [], expectApp: false },
  { name: 'C unverified profile, name in roster', is_verified: false, roster: [{ id: 'r1', full_name: 'REYES, ALEX', sex: 'M', course: 'BSCoE', year_level: '4' }], expectApp: true },
];
let failures = 0;
const browser = await chromium.launch();
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await seedSession(page);
  await routeMocks(page, await receiptPng());
  // Later routes win in Playwright, so these override the library's answers.
  const profile = { ...PROFILE, role: 'student', is_verified: c.is_verified };
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => r.fulfill(json([profile])));
  await page.route(/supabase\.co\/rest\/v1\/enrolled_students/, r => r.fulfill(json(c.roster)));
  await page.route(/supabase\.co\/rest\/v1\/enrollment_verification_requests/, r => r.fulfill(json([])));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const app = document.getElementById('app-screen');
    const title = document.getElementById('onboarding-modal-title');
    const modal = title ? title.closest('.modal-overlay, .modal, [role="dialog"]') || title : null;
    const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    return { appActive: !!app && app.classList.contains('active'), gateVisible: visible(modal), gateTitle: title ? title.textContent.trim() : '' };
  });
  const gated = !m.appActive && m.gateTitle === 'Enrollment Verification Required';
  const ok = c.expectApp ? (m.appActive && !gated) : gated;
  if (!ok) failures++;
  console.log(ok ? 'PASS ' : 'FAIL ', c.name, JSON.stringify(m));
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} failing case(s)` : 'verification gate behaves');
process.exit(failures ? 1 : 0);
