// =============================================
// lib-capture-mocks.mjs
// Shared mock layer for capturing real UI screenshots without
// touching the production database. Mocks Supabase auth + REST and
// the Express API with realistic COE student-council data.
// =============================================
import sharp from 'sharp';

export const BASE = 'http://localhost:8123';

export const USER = {
  id: 'mock-user-0000-1111-2222',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'alex.reyes@g.cjc.edu.ph',
  email_confirmed_at: '2025-06-01T00:00:00Z',
  phone_confirmed_at: null,
  confirmed_at: '2025-06-01T00:00:00Z',
  identities: [{ provider: 'email' }],
  user_metadata: { full_name: 'Alex Reyes' },
  app_metadata: { provider: 'email', providers: ['email'] },
  created_at: '2025-06-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

export const PROFILE = {
  id: USER.id,
  email: USER.email,
  full_name: 'Alex Reyes',
  role: 'admin',
  course: 'BSCoE',
  year_level: '4',
  enrollment_year: 2022,
  avatar_url: null,
  created_at: '2025-06-01T00:00:00Z',
};

// Valid structural mock JWT (header.payload.signature) to prevent Supabase Realtime MalformedJWT errors
const MOCK_JWT_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const MOCK_JWT_PAYLOAD = Buffer.from(JSON.stringify({
  iss: 'supabase',
  ref: 'hchkfunaofyoualrdnkk',
  role: 'authenticated',
  userId: USER.id,
  exp: 2094081683
})).toString('base64url');
const MOCK_JWT_SIGNATURE = 'mock_signature_for_local_testing_only';
export const MOCK_JWT = `${MOCK_JWT_HEADER}.${MOCK_JWT_PAYLOAD}.${MOCK_JWT_SIGNATURE}`;

export const session = () => ({
  access_token: MOCK_JWT,
  token_type: 'bearer',
  expires_in: 60 * 60 * 24 * 30,
  expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  refresh_token: 'mock-refresh-token',
  user: USER,
});

// ---- Mock data (realistic COE student-council figures, PHP) ----
export const EVENTS = [
  { id: 'ev1', event_name: 'Engineering Week 2026', description: 'Annual week-long celebration with competitions, exhibits, and industry linkages.', status: 'ongoing', event_date: '2026-08-24', allocated_budget: 85000, computed_expenses: 71400, computed_remaining: 13600, funding_source: 'Student Council Allocation' },
  { id: 'ev2', event_name: 'Intramurals 2026', description: 'Inter-department sports fest — venue, officials, medals, and team funds.', status: 'completed', event_date: '2026-07-15', allocated_budget: 60000, computed_expenses: 58275, computed_remaining: 1725, funding_source: 'General Fund' },
  { id: 'ev3', event_name: 'Tienda Eng\'g Fund Raising', description: 'Food bazaar and merchandise booth during the foundation anniversary.', status: 'completed', event_date: '2026-06-20', allocated_budget: 40000, computed_expenses: 36150, computed_remaining: 3850, funding_source: 'General Fund' },
  { id: 'ev4', event_name: 'Research Colloquium', description: 'Student research presentation with invited industry panelists.', status: 'upcoming', event_date: '2026-09-18', allocated_budget: 30000, computed_expenses: 0, computed_remaining: 30000, funding_source: 'Student Council Allocation' },
  { id: 'ev5', event_name: 'Community Outreach — Barrio Tipan', description: 'Adopt-a-school visit: learning materials and feeding program.', status: 'upcoming', event_date: '2026-10-05', allocated_budget: 25000, computed_expenses: 0, computed_remaining: 25000, funding_source: 'Donations' },
];

export const TXS = [
  { id: 't01', type: 'expense', description: 'Stage & sounds rental — Engineering Week', amount: 18500, transaction_date: '2026-08-26', events: { event_name: 'Engineering Week 2026' }, profiles: { full_name: 'M. Santos' }, receipt_url: '/mock-receipt.png' },
  { id: 't02', type: 'income', description: 'Sponsorship — MegaSoft Corp.', amount: 25000, transaction_date: '2026-08-24', events: { event_name: 'Engineering Week 2026' }, profiles: { full_name: 'A. Reyes' }, receipt_url: '/mock-receipt.png' },
  { id: 't03', type: 'expense', description: 'Printing — banners, tarpaulins & certificates', amount: 8250, transaction_date: '2026-08-22', events: { event_name: 'Engineering Week 2026' }, profiles: { full_name: 'J. Cruz' }, receipt_url: '/mock-receipt.png' },
  { id: 't04', type: 'expense', description: 'Medals & trophies — Intramurals', amount: 12750, transaction_date: '2026-07-16', events: { event_name: 'Intramurals 2026' }, profiles: { full_name: 'M. Santos' }, receipt_url: '/mock-receipt.png' },
  { id: 't05', type: 'expense', description: 'First aid & sports supplies', amount: 4325, transaction_date: '2026-07-15', events: { event_name: 'Intramurals 2026' }, profiles: { full_name: 'J. Cruz' }, receipt_url: '/mock-receipt.png' },
  { id: 't06', type: 'income', description: 'Collection — local fees (2nd sem)', amount: 103750, transaction_date: '2026-07-10', events: null, profiles: { full_name: 'A. Reyes' }, receipt_url: null },
  { id: 't07', type: 'expense', description: 'Booth materials — Tienda Eng\'g', amount: 15900, transaction_date: '2026-06-21', events: { event_name: 'Tienda Eng\'g Fund Raising' }, profiles: { full_name: 'L. Dizon' }, receipt_url: '/mock-receipt.png' },
  { id: 't08', type: 'income', description: 'Booth sales — Tienda Eng\'g (gross)', amount: 42300, transaction_date: '2026-06-20', events: { event_name: 'Tienda Eng\'g Fund Raising' }, profiles: { full_name: 'L. Dizon' }, receipt_url: null },
  { id: 't09', type: 'expense', description: 'Coordinator honorarium — Intramurals', amount: 3000, transaction_date: '2026-07-17', events: { event_name: 'Intramurals 2026' }, profiles: { full_name: 'A. Reyes' }, receipt_url: '/mock-receipt.png' },
  { id: 't10', type: 'expense', description: 'General supplies — council office', amount: 2740, transaction_date: '2026-06-12', events: null, profiles: { full_name: 'M. Santos' }, receipt_url: '/mock-receipt.png' },
  { id: 't11', type: 'income', description: 'Donation — Eng\'g Alumni Batch 2010', amount: 20000, transaction_date: '2026-05-30', events: null, profiles: { full_name: 'A. Reyes' }, receipt_url: null },
  { id: 't12', type: 'expense', description: 'Transportation — outreach planning visit', amount: 1850, transaction_date: '2026-05-21', events: { event_name: 'Community Outreach — Barrio Tipan' }, profiles: { full_name: 'J. Cruz' }, receipt_url: '/mock-receipt.png' },
];

export const SUMMARY = {
  totalIncome: 191300,
  totalExpense: 84315,
  remainingBalance: 94685,
  generalExpense: 4540,
  breakdown: { donation: 20000, collection: 103750, allocation: 67550, reserved_envelopes: 12000 },
};

export const MONTHLY = [
  { month: '2025-09', income: 42000, expense: 31500 },
  { month: '2025-10', income: 38500, expense: 41200 },
  { month: '2025-11', income: 45200, expense: 28900 },
  { month: '2025-12', income: 30800, expense: 35400 },
  { month: '2026-01', income: 51600, expense: 30200 },
  { month: '2026-02', income: 36400, expense: 39800 },
  { month: '2026-03', income: 44100, expense: 26500 },
  { month: '2026-04', income: 39800, expense: 33100 },
  { month: '2026-05', income: 47300, expense: 21900 },
  { month: '2026-06', income: 68300, expense: 36150 },
  { month: '2026-07', income: 103750, expense: 20075 },
  { month: '2026-08', income: 25000, expense: 46750 },
];

export const ANNOUNCEMENTS = [
  { title: 'Engineering Week liquidation is complete', body: 'All 28 receipts for Engineering Week 2026 have been submitted and verified. Full breakdown is now visible under Reports.', created_at: '2026-08-28T09:00:00Z' },
  { title: 'Budget allocation approved for 1st Semester', body: 'The Executive Board has approved the semester budget allocation. Per-event envelopes are now visible in the Events page.', created_at: '2026-08-15T14:30:00Z' },
  { title: 'General Assembly — September 12', body: 'All engineering students are encouraged to attend the semester General Assembly at the AVR.', created_at: '2026-08-10T08:00:00Z' },
];

export const ADMIN_USERS = [
  { id: 'u1', full_name: 'Alex Reyes', email: 'alex.reyes@g.cjc.edu.ph', role: 'admin', course: 'BSCoE', year_level: '4' },
  { id: 'u2', full_name: 'Miguel Santos', email: 'miguel.santos@g.cjc.edu.ph', role: 'cashier', course: 'BSCoE', year_level: '3' },
  { id: 'u3', full_name: 'Julia Cruz', email: 'julia.cruz@g.cjc.edu.ph', role: 'governor', course: 'BSCoE', year_level: '4' },
  { id: 'u4', full_name: 'Liza Dizon', email: 'liza.dizon@g.cjc.edu.ph', role: 'officer', course: 'BSECE', year_level: '3' },
  { id: 'u5', full_name: 'Marco Torres', email: 'marco.torres@g.cjc.edu.ph', role: 'student', course: 'BSME', year_level: '2' },
];

export const AUDIT_LOGS = [
  { id: 'a1', action: 'CREATE_TRANSACTION', details: 'Expense ₱18,500 — Stage & sounds rental', created_at: '2026-08-26T15:12:00Z', profiles: { full_name: 'Miguel Santos' } },
  { id: 'a2', action: 'APPROVE_EVENT', details: 'Approved event: Research Colloquium (₱30,000)', created_at: '2026-08-25T10:40:00Z', profiles: { full_name: 'Alex Reyes' } },
  { id: 'a3', action: 'UPLOAD_RECEIPT', details: 'Receipt attached to tx #t03', created_at: '2026-08-22T13:05:00Z', profiles: { full_name: 'Julia Cruz' } },
  { id: 'a4', action: 'BUDGET_TRANSFER', details: '₱5,000 — General Fund → Engineering Week', created_at: '2026-08-20T09:22:00Z', profiles: { full_name: 'Alex Reyes' } },
  { id: 'a5', action: 'EXPORT_REPORT', details: 'Monthly report exported (PDF)', created_at: '2026-08-18T16:47:00Z', profiles: { full_name: 'Miguel Santos' } },
  { id: 'a6', action: 'UPDATE_TRANSACTION', details: 'Corrected amount on tx #t10', created_at: '2026-08-15T11:30:00Z', profiles: { full_name: 'Julia Cruz' } },
];

const json = (data, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(data) });

// Cross-origin mocks MUST answer CORS, or the browser blocks them and the
// app falls through to the real servers.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

// Fulfill with CORS headers; answers preflights automatically.
function reply(route, res) {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 200, headers: CORS });
  }
  return route.fulfill({ ...res, headers: { ...CORS, ...(res.headers || {}) } });
}

export async function receiptPng() {
  const svg = `
  <svg width="600" height="780" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="780" fill="#f8f7f4"/>
    <rect x="30" y="30" width="540" height="720" fill="#ffffff" stroke="#d4d0c8" stroke-width="2"/>
    <text x="300" y="90" text-anchor="middle" font-family="Georgia" font-size="26" font-weight="bold" fill="#1e293b">OFFICIAL RECEIPT</text>
    <text x="300" y="120" text-anchor="middle" font-family="Georgia" font-size="15" fill="#64748b">COE Student Council — Digos City</text>
    <line x1="60" y1="150" x2="540" y2="150" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="70" y="195" font-family="Georgia" font-size="15" fill="#334155">Received from:</text>
    <text x="70" y="222" font-family="Georgia" font-size="17" font-weight="bold" fill="#0f172a">MegaSoft Corp. — Sponsorship</text>
    <text x="70" y="262" font-family="Georgia" font-size="15" fill="#334155">For:</text>
    <text x="70" y="289" font-family="Georgia" font-size="17" font-weight="bold" fill="#0f172a">Engineering Week 2026</text>
    <text x="70" y="340" font-family="Georgia" font-size="16" fill="#334155">Amount Received:</text>
    <rect x="70" y="358" width="330" height="52" fill="#fef9c3" stroke="#ca8a04" stroke-width="1.5"/>
    <text x="90" y="393" font-family="Georgia" font-size="26" font-weight="bold" fill="#713f12">₱ 25,000.00</text>
    <text x="70" y="455" font-family="Georgia" font-size="15" fill="#334155">Date:</text>
    <text x="150" y="455" font-family="Georgia" font-size="16" fill="#0f172a">August 24, 2026</text>
    <text x="70" y="490" font-family="Georgia" font-size="15" fill="#334155">Reference No.:</text>
    <text x="200" y="490" font-family="Georgia" font-size="16" fill="#0f172a">OR-2026-0084</text>
    <line x1="60" y1="530" x2="540" y2="530" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="70" y="570" font-family="Georgia" font-size="14" fill="#64748b">Received by:</text>
    <text x="70" y="620" font-family="Georgia" font-size="22" fill="#1e3a5f" font-style="italic">Miguel Santos</text>
    <line x1="70" y1="630" x2="300" y2="630" stroke="#334155" stroke-width="1.5"/>
    <text x="70" y="652" font-family="Georgia" font-size="13" fill="#64748b">Council Treasurer</text>
    <text x="300" y="725" text-anchor="middle" font-family="Georgia" font-size="12" fill="#94a3b8">Digitally recorded — COE Budget Transparency System</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export function attachLogging(page) {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log(`[console:${m.type()}]`, m.text().slice(0, 240)); });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)));
  page.on('response', r => {
    const u = r.url();
    if ((u.includes('supabase.co') || u.includes('/api/')) && !u.includes('jsdelivr')) {
      console.log(`[resp ${r.status()}]`, u.replace(/^https?:\/\//, '').slice(0, 130));
    }
  });
}

export async function routeMocks(page, receipt, { verbose = false } = {}) {
  const hit = (name) => { if (verbose) console.log(`[mock] ${name}`); };

  // Block the service worker so it can't serve cached shells
  await page.route(/\/sw\.js(\?.*)?$/, r => r.fulfill({ status: 404, body: '' }));

  // Abort Realtime websocket requests so mock tests never hit the live Supabase realtime cluster
  await page.route(/supabase\.co\/realtime\/v1\/websocket/, r => r.abort());

  // Supabase auth
  await page.route(/supabase\.co\/auth\/v1\/token/, r => { hit('auth/token'); reply(r, json(session())); });
  await page.route(/supabase\.co\/auth\/v1\/user/, r => { hit('auth/user'); reply(r, json(USER)); });
  await page.route(/supabase\.co\/auth\/v1\/logout/, r => { hit('auth/logout'); reply(r, json({})); });

  // Supabase REST
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => { hit('rest/profiles'); reply(r, json([PROFILE])); });
  await page.route(/supabase\.co\/rest\/v1\/announcements/, r => { hit('rest/announcements'); reply(r, json(ANNOUNCEMENTS)); });
  await page.route(/supabase\.co\/rest\/v1\/enrolled_students/, r => { hit('rest/enrolled_students'); reply(r, json(ADMIN_USERS.map(u => ({ id: u.id, full_name: u.full_name, sex: 'M', department: 'CoE', course: u.course, year_level: u.year_level }))) ); });
  await page.route(/supabase\.co\/rest\/v1\/enrollment_verification_requests/, r => { hit('rest/verification'); reply(r, json([])); });

  // Receipt image (storage mock)
  await page.route(/storage\/v1\/object\//, r => { hit('storage/receipt'); reply(r, { status: 200, contentType: 'image/png', body: receipt }); });
  await page.route(/\/mock-receipt\.png$/, r => { hit('mock-receipt'); reply(r, { status: 200, contentType: 'image/png', body: receipt }); });

  // Express API
  await page.route(/\/api\/public\/status/, r => { hit('api/public/status'); reply(r, json({ enabled: false })); });
  await page.route(/\/api\/reports\/summary/, r => { hit('api/reports/summary'); reply(r, json(SUMMARY)); });
  await page.route(/\/api\/reports\/monthly/, r => { hit('api/reports/monthly'); reply(r, json(MONTHLY)); });
  await page.route(/\/api\/reports\/events-summary/, r => { hit('api/reports/events-summary'); reply(r, json(EVENTS)); });
  await page.route(/\/api\/transactions/, r => { hit('api/transactions'); reply(r, json(TXS)); });
  await page.route(/\/api\/events\/[^/]+$/, r => { hit('api/events/detail'); reply(r, json(EVENTS[0])); });
  await page.route(/\/api\/events(\?.*)?$/, r => { hit('api/events'); reply(r, json(EVENTS)); });
  await page.route(/\/api\/announcements/, r => { hit('api/announcements'); reply(r, json(ANNOUNCEMENTS)); });
  await page.route(/\/api\/units\/my/, r => { hit('api/units/my'); reply(r, json({ subjects: [] })); });
  await page.route(/\/api\/units\/checklists/, r => { hit('api/units/checklists'); reply(r, json({ subjects: [], requirements: [] })); });
  await page.route(/\/api\/admin\/users/, r => { hit('api/admin/users'); reply(r, json(ADMIN_USERS)); });
  await page.route(/\/api\/admin\/audit-logs/, r => { hit('api/admin/audit-logs'); reply(r, json(AUDIT_LOGS)); });
  await page.route(/\/api\/admin\/profile/, r => { hit('api/admin/profile'); reply(r, json(PROFILE)); });
}

export function seedSession(page) {
  // Pre-seed a valid session before any page script runs
  return page.addInitScript((s) => {
    try {
      localStorage.setItem('sb-hchkfunaofyoualrdnkk-auth-token', JSON.stringify(s));
    } catch {}
  }, session());
}
