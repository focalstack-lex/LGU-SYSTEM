// Run with the server up (npm start, port 3000): node scripts/verify-nav-consolidation.mjs
// Drives the grouped navigation in both portals (student sidebar and bottom
// nav, officer sidebar and bottom nav, the pill tabs inside grouped views)
// on desktop and phone, with a mocked backend. Evidence lands in
// reports/ui-verification/<date>-nav-consolidation/.
import { chromium } from 'playwright';
import { routeMocks, seedSession, receiptPng, PROFILE, EVENTS } from './lib-capture-mocks.mjs';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = `reports/ui-verification/${new Date().toISOString().slice(0, 10)}-nav-consolidation`;
fs.mkdirSync(OUT, { recursive: true });
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

const STUDENT = { id: 'mock-user-0000-1111-2222', email: 'alex.reyes@g.cjc.edu.ph', full_name: 'Alex Reyes', role: 'student', course: 'BSCoE', year_level: '3', enrollment_year: 2024, is_verified: true, avatar_url: null };

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

async function newPage(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/\/sw\.js/, r => r.fulfill({ status: 404, body: '' }));
  await seedSession(page);
  await routeMocks(page, await receiptPng());
  await page.route(/\/api\/notifications\/read/, r => r.fulfill(json({ ok: true })));
  await page.route(/\/api\/notifications/, r => r.fulfill(json({ total_unread: 2, unread_by_category: { events: 0, transactions: 1, reports: 0, announcements: 1, units: 0, system: 0 }, notifications: [] })));
  return { page, errors };
}

// ---------------- Student portal ----------------
async function student(browser, viewport, label) {
  const { page, errors } = await newPage(browser, viewport);
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    const single = /Accept.*vnd\.pgrst\.object/i.test(JSON.stringify(r.request().headers()));
    r.fulfill(json(single ? STUDENT : [STUDENT]));
  });
  // One future event so the Next Event card has something to show
  await page.route(/\/api\/events(\?.*)?$/, r => r.fulfill(json([...EVENTS, { id: 'ev9', event_name: 'Hackathon 2026', description: 'Overnight build sprint.', status: 'upcoming', event_date: '2026-12-05', allocated_budget: 20000, computed_expenses: 0, remaining_budget: 20000 }])));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => { const el = document.getElementById('app-screen'); return el && getComputedStyle(el).display !== 'none'; }, { timeout: 20000 });
  await page.waitForTimeout(800);

  const activeView = () => page.evaluate(() => document.querySelector('.view.active')?.id);
  const activeNav = () => page.evaluate(() => [...document.querySelectorAll('.sidebar-nav .nav-item.active, .bottom-nav-item.active')].filter(n => n.offsetParent).map(n => n.textContent.trim()).join('|'));
  const activeTabs = () => page.evaluate(() => [...document.querySelectorAll('.view.active .view-tab')].map(t => `${t.textContent.trim()}${t.classList.contains('active') ? '*' : ''}${t.getAttribute('aria-selected') === 'true' ? '!' : ''}`).join(' '));
  const click = async (sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(500); };

  if (label === 'desktop') {
    const nav = await page.evaluate(() => [...document.querySelectorAll('.sidebar-nav .nav-item')].filter(n => n.offsetParent).map(n => n.textContent.trim()));
    check('student sidebar is Dashboard, Money, Events, Updates, Academics', nav.join('|') === 'Dashboard|Money|Events|Updates|Academics', nav.join('|'));
    check('student sidebar has no staff entries for a student', !nav.includes('Admin') && !nav.includes('Executive Portal'));
    check('dashboard has no tab bar', (await page.evaluate(() => document.querySelectorAll('#view-dashboard .view-tabs').length)) === 0);
    const home = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#view-dashboard .dashboard-card h3')].map(h => h.textContent.trim());
      return {
        cards,
        donations: !!document.getElementById('stat-donations'),
        nextEvent: document.getElementById('stat-next-event')?.textContent.trim(),
        nextDate: document.getElementById('stat-next-event-date')?.textContent.trim(),
        sublabels: [...document.querySelectorAll('.stat-balance .stat-sublabel')].length,
        monthLines: [document.getElementById('stat-income-month')?.textContent.trim(), document.getElementById('stat-expense-month')?.textContent.trim()],
        txRows: document.querySelectorAll('#recent-tx-list .tx-item').length,
        announcements: document.querySelectorAll('#announcement-list .announce-item').length,
        ledgerLink: !!document.querySelector('#recent-tx-view-all[data-nav="transactions"]'),
      };
    });
    check('home: Next Event card replaces Total Donations and shows the mocked upcoming event with a countdown', !home.donations && home.nextEvent === 'Hackathon 2026' && /^Dec 5, 2026 · in \d+ days$/.test(home.nextDate), JSON.stringify([home.nextEvent, home.nextDate]));
    check('home: Announcements come before Recent Transactions', home.cards.join('|') === 'Announcements|Recent Transactions', home.cards.join('|'));
    check('home: two announcements, three transactions, ledger link, no hero sublabel', home.announcements === 2 && home.txRows === 3 && home.ledgerLink && home.sublabels === 0, JSON.stringify(home));
    check('home: income and expense cards carry this month\'s figures', home.monthLines.every(t => /^₱[\d,]+\.\d{2} this month$/.test(t || '')), JSON.stringify(home.monthLines));
    await shot(page, `${label}-student-dashboard`);
    await click('#view-dashboard .stat-event');
    check('home: Next Event card opens Events', (await activeView()) === 'view-events', await activeView());
    await click('#nav-dashboard');

    // Unread badges, before any click marks a category read
    const badged = await page.waitForFunction(() => document.getElementById('nav-money').classList.contains('has-unread')
      && !!document.querySelector('#view-transactions .view-tab[data-view="transactions"].has-unread')
      && document.getElementById('nav-updates').classList.contains('has-unread'), null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('unread dots: Money entry, Ledger tab and Updates entry carry badges on load', badged);

    // Money group
    await click('#nav-money');
    check('Money opens the ledger', (await activeView()) === 'view-transactions', await activeView());
    check('Money entry is active while on the ledger', (await activeNav()) === 'Money', await activeNav());
    check('ledger shows Money tabs with Ledger selected', (await activeTabs()) === 'Ledger*! Income Reports', await activeTabs());
    check('opening the ledger clears the Money badge', await page.evaluate(() => !document.getElementById('nav-money').classList.contains('has-unread')));
    const placement = await page.evaluate(() => {
      const header = document.querySelector('#view-transactions .view-header');
      const tabs = header.querySelector(':scope > .view-tabs');
      const title = header.querySelector('h2');
      if (!tabs) return { inHeader: false };
      const t = tabs.getBoundingClientRect(), h = title.getBoundingClientRect();
      const filters = header.querySelector('.tx-filter-bar').getBoundingClientRect();
      return { inHeader: tabs === header.firstElementChild, sameLeft: Math.abs(t.left - h.left) < 1, gap: Math.round(h.top - t.bottom), sticky: getComputedStyle(header).position === 'sticky', trackWidth: Math.round(t.width), filtersBesideTitle: Math.abs(filters.top + filters.height / 2 - (h.top + h.height / 2)) < 24 };
    });
    check('tabs sit in the sticky header as a content-width first row; title left, filters right beneath', placement.inHeader && placement.sameLeft && placement.sticky && placement.gap >= 8 && placement.gap <= 24 && placement.trackWidth < 420 && placement.filtersBesideTitle, JSON.stringify(placement));
    await shot(page, `${label}-student-money-ledger`);
    await click('#view-transactions .view-tab[data-view="income"]');
    check('Income tab opens the income view', (await activeView()) === 'view-income', await activeView());
    check('Money entry stays active on Income', (await activeNav()) === 'Money', await activeNav());
    check('income view tabs mark Income selected', (await activeTabs()) === 'Ledger Income*! Reports', await activeTabs());
    await click('#view-income .view-tab[data-view="reports"]');
    check('Reports tab opens the reports view', (await activeView()) === 'view-reports', await activeView());
    check('reports view loaded its content', await page.evaluate(() => (document.getElementById('reports-content')?.innerText || '').includes('Per-Event')));
    await shot(page, `${label}-student-money-reports`);

    // Updates group
    await click('#nav-updates');
    check('Updates opens announcements', (await activeView()) === 'view-announcements', await activeView());
    await click('#view-announcements .view-tab[data-view="notifications"]');
    check('For you tab opens notifications', (await activeView()) === 'view-notifications', await activeView());
    check('Updates entry stays active on notifications', (await activeNav()) === 'Updates', await activeNav());
    await shot(page, `${label}-student-updates-notifications`);

    // Academics group
    await click('#nav-academics');
    check('Academics opens progress', (await activeView()) === 'view-units', await activeView());
    await click('#view-units .view-tab[data-view="enrollment"]');
    check('Enrollment tab opens enrollment', (await activeView()) === 'view-enrollment', await activeView());
    check('Academics entry stays active on enrollment', (await activeNav()) === 'Academics', await activeNav());
    check('Career Passport is a link tab to the CV builder', (await page.evaluate(() => document.querySelector('#view-enrollment .view-tab[href="/cv-builder"]')?.offsetParent !== null)));
    await shot(page, `${label}-student-academics-enrollment`);

    // Plain entries and deep links still work
    await click('#nav-events');
    check('Events entry opens events', (await activeView()) === 'view-events', await activeView());
    check('no group entry is active on Events', (await activeNav()) === 'Events', await activeNav());
    await click('#nav-dashboard');
    await click('#view-dashboard [data-nav="income"]');
    check('dashboard shortcut to income lands on Income with Money active', (await activeView()) === 'view-income' && (await activeNav()) === 'Money', `${await activeView()} / ${await activeNav()}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => { const el = document.getElementById('app-screen'); return el && getComputedStyle(el).display !== 'none'; }, { timeout: 20000 });
    await page.waitForTimeout(800);
    check('refresh returns to the last grouped view with its entry active', (await activeView()) === 'view-income' && (await activeNav()) === 'Money', `${await activeView()} / ${await activeNav()}`);
  } else {
    const bottom = await page.evaluate(() => [...document.querySelectorAll('#bottom-nav .bottom-nav-item')].filter(n => n.offsetParent).map(n => n.textContent.trim()));
    check('phone bottom nav is Home, Money, Events, Academic, More', bottom.join('|') === 'Home|Money|Events|Academic|More', bottom.join('|'));
    const labels = await page.evaluate(() => [...document.querySelectorAll('#bottom-nav .bottom-nav-item span:not(.nav-icon)')].map(s => ({ t: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth })));
    check('phone: no bottom nav label is truncated', labels.every(l => !l.clipped), JSON.stringify(labels.filter(l => l.clipped)));
    const labelPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#bottom-nav .bottom-nav-item span:not(.nav-icon)')).fontSize));
    check('phone: bottom nav labels are at least 11px', labelPx >= 11, String(labelPx));
    const sheetHues = await page.evaluate(() => [...document.querySelectorAll('#mobile-more-sheet .mobile-sheet-row-icon')].filter(i => i.getAttribute('style')).length);
    check('phone: More sheet icons use token classes, no inline colors', sheetHues === 0, String(sheetHues));
    check('phone: no status strip; the fund hero is the first block under the heading', await page.evaluate(() => !document.getElementById('student-status') && document.querySelector('#view-dashboard .view-header').nextElementSibling.classList.contains('stats-summary-wrapper')));
    const eventCard = await page.evaluate(() => { const c = document.querySelector('.stats-secondary-grid .stat-event').getBoundingClientRect(); const g = document.querySelector('.stats-secondary-grid').getBoundingClientRect(); return { card: Math.round(c.width), grid: Math.round(g.width) }; });
    check('phone: Next Event spans the full row', eventCard.card >= eventCard.grid - 2, JSON.stringify(eventCard));
    await shot(page, `${label}-student-dashboard`);
    await click('#bottom-nav .bottom-nav-item[data-group="money"]');
    check('phone: Money opens the ledger', (await activeView()) === 'view-transactions', await activeView());
    const tabW = await page.evaluate(() => { const bar = document.querySelector('#view-transactions .view-tabs'); const main = document.querySelector('.main-content'); return { bar: bar.getBoundingClientRect().width, main: main.clientWidth, tabH: bar.querySelector('.view-tab').getBoundingClientRect().height }; });
    check('phone: tab bar spans the content width and tabs are at least 40px tall', tabW.bar >= tabW.main * 0.85 && tabW.tabH >= 40, JSON.stringify(tabW));
    check('phone: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(page, `${label}-student-money-ledger`);
    await click('#view-transactions .view-tab[data-view="reports"]');
    check('phone: Reports tab opens reports with Money still active', (await activeView()) === 'view-reports' && (await activeNav()).includes('Money'), await activeNav());
    await click('#bottom-nav .bottom-nav-item[data-group="academics"]');
    check('phone: Academics opens progress', (await activeView()) === 'view-units', await activeView());
    await shot(page, `${label}-student-academics`);
    await click('#bottom-nav-more-btn');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#mobile-more-sheet .mobile-sheet-row')].filter(r => r.offsetParent).map(r => r.querySelector('.mobile-sheet-row-title').textContent.trim()));
    check('phone More sheet is Announcements, Notifications, Profile, Feedback', rows.join('|') === 'Announcements|Notifications|Profile & Settings|Send Feedback', rows.join('|'));
    await shot(page, `${label}-student-more-sheet`);
    await click('#bottom-nav-notifications');
    check('phone: More sheet row opens notifications with More active', (await activeView()) === 'view-notifications' && (await page.evaluate(() => document.getElementById('bottom-nav-more-btn').classList.contains('active'))));
    check('phone: notifications view shows the Updates tabs', (await activeTabs()) === 'Announcements For you*!', await activeTabs());
    await shot(page, `${label}-student-updates`);
  }
  check(`student ${label}: no page errors`, errors.length === 0, errors[0]);
  await page.close();
}

// ---------------- Officer portal ----------------
async function officer(browser, viewport, label) {
  const { page, errors } = await newPage(browser, viewport);
  // The officer app reads the profile with .single(); answer with one object
  await page.route(/supabase\.co\/rest\/v1\/profiles/, r => {
    const single = /vnd\.pgrst\.object/i.test(JSON.stringify(r.request().headers()));
    r.fulfill(json(single ? PROFILE : [PROFILE]));
  });
  await page.goto(BASE + '/officer.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => { const el = document.getElementById('of-shell'); return el && !el.classList.contains('hidden'); }, { timeout: 20000 });
  await page.waitForTimeout(800);

  const activeView = () => page.evaluate(() => document.querySelector('.of-view.active')?.id);
  const activeNav = () => page.evaluate(() => [...document.querySelectorAll('.of-nav .nav-item.active, .of-bottom-nav > button.active')].filter(n => n.offsetParent).map(n => n.textContent.trim()).join('|'));
  const activeTabs = () => page.evaluate(() => [...document.querySelectorAll('.of-view.active .view-tab')].map(t => `${t.textContent.trim()}${t.classList.contains('active') ? '*' : ''}`).join(' '));
  const click = async (sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(500); };

  if (label === 'desktop') {
    const nav = await page.evaluate(() => [...document.querySelectorAll('.of-nav .nav-item')].filter(n => n.offsetParent).map(n => n.textContent.trim()));
    check('officer sidebar is Overview, Finance, Events, People, Announcements, Curriculum, Main Dashboard', nav.join('|') === 'Fund Overview|Finance|Events & Budgets|People|Announcements|Curriculum|Main Dashboard', nav.join('|'));
    const financeBadged = await page.waitForFunction(() => document.querySelector('.of-nav .nav-item[data-of-group="finance"]').classList.contains('has-unread'), null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('Finance entry carries the transactions badge on load', financeBadged);
    await click('.of-nav .nav-item[data-of-group="finance"]');
    check('Finance opens Record Transaction', (await activeView()) === 'of-view-record', await activeView());
    check('record view shows Finance tabs with Record selected', (await activeTabs()) === 'Record* Reports', await activeTabs());
    check('opening Finance clears its badge', await page.evaluate(() => !document.querySelector('.of-nav .nav-item[data-of-group="finance"]').classList.contains('has-unread')));
    await shot(page, `${label}-officer-finance-record`);
    await click('#of-view-record .view-tab[data-of="reports"]');
    check('Reports tab opens reports', (await activeView()) === 'of-view-reports', await activeView());
    check('Finance entry stays active on reports', (await activeNav()) === 'Finance', await activeNav());
    check('URL hash follows the tab', await page.evaluate(() => location.hash === '#reports'));
    await shot(page, `${label}-officer-finance-reports`);
    await click('.of-nav .nav-item[data-of-group="people"]');
    check('People opens accounts', (await activeView()) === 'of-view-people', await activeView());
    await click('#of-view-people .view-tab[data-of="roster"]');
    check('Enrolled roster tab opens the roster', (await activeView()) === 'of-view-roster', await activeView());
    check('People entry stays active on the roster', (await activeNav()) === 'People', await activeNav());
    check('roster view tabs mark Enrolled roster selected', (await activeTabs()) === 'Accounts Enrolled roster*', await activeTabs());
    await shot(page, `${label}-officer-people-roster`);
    await click('.of-nav .nav-item[data-of="announcements"]');
    check('Announcements entry opens announcements with no group active', (await activeView()) === 'of-view-announcements' && (await activeNav()) === 'Announcements', await activeNav());
    await page.goto(BASE + '/officer.html#roster', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('.of-view.active')?.id === 'of-view-roster', { timeout: 20000 });
    check('deep link #roster lands on the roster with People active', (await activeNav()) === 'People', await activeNav());
  } else {
    const bottom = await page.evaluate(() => [...document.querySelectorAll('#of-bottom-nav > button')].filter(n => n.offsetParent).map(n => n.textContent.trim()));
    check('phone officer bottom nav is Overview, Finance, Events, People, More', bottom.join('|') === 'Overview|Finance|Events|People|More', bottom.join('|'));
    await click('#of-bottom-nav > button[data-of-group="people"]');
    check('phone: People opens accounts', (await activeView()) === 'of-view-people', await activeView());
    await click('#of-view-people .view-tab[data-of="roster"]');
    check('phone: roster tab keeps People active', (await activeNav()).includes('People'), await activeNav());
    check('phone: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const ofLabels = await page.evaluate(() => [...document.querySelectorAll('#of-bottom-nav > button span:last-child')].map(s => ({ t: s.textContent.trim(), px: parseFloat(getComputedStyle(s).fontSize), clipped: s.scrollWidth > s.clientWidth })));
    check('phone: officer bottom nav labels are at least 11px and none is truncated', ofLabels.every(l => l.px >= 11 && !l.clipped), JSON.stringify(ofLabels));
    const seg = await page.evaluate(() => [...document.querySelectorAll('#of-view-roster .of-filter-tabs')].filter(t => t.offsetParent).map(t => { const b = t.querySelector('.of-filter-btn'); return { radius: getComputedStyle(t).borderRadius, btnH: Math.round(b.getBoundingClientRect().height) }; }));
    check('phone: roster segmented controls are pill tracks with 40px options', seg.length > 0 && seg.every(s => s.radius === '9999px' && s.btnH >= 40), JSON.stringify(seg));
    await shot(page, `${label}-officer-people-roster`);
    await click('#of-bottom-nav-more-btn');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#of-mobile-more-sheet .mobile-sheet-row')].filter(r => r.offsetParent).map(r => r.querySelector('.mobile-sheet-row-title').textContent.trim()));
    check('phone officer More sheet is Curriculum, Announcements, Student Portal, Account Settings', rows.join('|') === 'Curriculum Manager|Announcements|Student Portal|Account Settings', rows.join('|'));
    await shot(page, `${label}-officer-more-sheet`);
  }
  check(`officer ${label}: no page errors`, errors.length === 0, errors[0]);
  await page.close();
}

const browser = await chromium.launch();
try {
  await student(browser, { width: 1366, height: 900 }, 'desktop');
  await student(browser, { width: 375, height: 812 }, 'phone');
  await officer(browser, { width: 1366, height: 900 }, 'desktop');
  await officer(browser, { width: 375, height: 812 }, 'phone');
} finally {
  await browser.close();
}
console.log(`\n${pass}/${pass + fail} passed. Evidence: ${OUT}`);
process.exit(fail ? 1 : 0);
