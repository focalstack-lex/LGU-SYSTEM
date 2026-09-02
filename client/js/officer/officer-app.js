// =============================================
// officer-app.js - Executive Portal Application
//
// Runs as a separate full-window app (/officer.html) sharing the main
// system's login, API layer, and receipt camera. Requires role
// governor / cashier / admin; everyone else hits the access gate.
// =============================================

const OfficerApp = (() => {

  const OFFICER_ROLES = ['admin', 'governor', 'cashier', 'officer'];
  const ROLE_LABELS   = { admin: 'Admin', governor: 'Governor', cashier: 'Cashier', officer: 'Officer', student: 'Student' };
  const isExecutive   = () => _profile && (_profile.role === 'admin' || _profile.role === 'governor');

  function applyRolePermissionsUI() {
    const exec = isExecutive();
    const execEventActions = $('of-exec-event-actions');
    if (execEventActions) execEventActions.style.display = exec ? '' : 'none';
    const announceFormCard = $('of-exec-announce-card');
    if (announceFormCard) announceFormCard.style.display = exec ? '' : 'none';
  }

  let _profile   = null;
  let _events    = [];
  let _txs       = [];
  let _loaded    = {};   // section -> loaded once
  let _receipt   = null; // pending receipt for the record form

  let _monthlyData = null;
  let _summaryBreakdownData = null;
  let _chartInstances = {};
  let _eventStatusFilter = 'all';
  const _eventDetailCache = new Map();

  // ---------- Helpers ----------

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `of-toast ${type}`;
    el.textContent = message;
    $('of-toast-holder').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function showGate(message) {
    $('of-shell').classList.add('hidden');
    $('of-bottom-nav').classList.add('hidden');
    $('of-gate').classList.remove('hidden');
    $('of-gate-message').textContent = message;
  }

  function fmtNum(n) { return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Skeleton placeholders matching the main student portal
  function skeletonStack(lines = 3) {
    const rows = Array.from({ length: lines }, (_, i) =>
      `<div class="sk-bone sk-list-row" style="height:${i === 0 ? '16px' : '12px'};width:${i === lines - 1 ? '60%' : '100%'};margin-bottom:0.5rem;"></div>`).join('');
    return `<div class="sk-content-card" style="padding:1rem;gap:0.5rem;" role="status" aria-label="Loading">${rows}</div>`;
  }

  function skeletonRows(colspan, rows = 4) {
    return Array.from({ length: rows }, () =>
      `<tr><td colspan="${colspan}"><div class="sk-bone sk-list-row" style="height:16px;margin:0.45rem 0;"></div></td></tr>`).join('');
  }

  function skeletonStatCards(n = 4) {
    return Array.from({ length: n }, () => `
      <div class="sk-stat-card">
        <div class="sk-bone sk-circle" style="width:38px;height:38px;flex-shrink:0;"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <div class="sk-bone" style="height:10px;width:60%;border-radius:4px;"></div>
          <div class="sk-bone" style="height:22px;width:80%;border-radius:5px;"></div>
        </div>
      </div>
    `).join('');
  }

  function skeletonEventCards(n = 6) {
    return Array.from({ length: n }, () => `
      <div class="sk-content-card" style="min-height:190px;padding:1.25rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div class="sk-bone" style="height:16px;width:50%;border-radius:4px;"></div>
          <div class="sk-bone" style="height:14px;width:20%;border-radius:100px;"></div>
        </div>
        <div class="sk-bone" style="height:12px;width:80%;border-radius:4px;margin-bottom:0.5rem;"></div>
        <div class="sk-bone" style="height:12px;width:65%;border-radius:4px;margin-bottom:1rem;"></div>
        <div class="sk-bone" style="height:8px;width:100%;border-radius:999px;margin-bottom:0.75rem;"></div>
        <div style="display:flex;gap:0.5rem;margin-top:auto;">
          <div class="sk-bone" style="height:28px;flex:1;border-radius:6px;"></div>
          <div class="sk-bone" style="height:28px;flex:1;border-radius:6px;"></div>
        </div>
      </div>
    `).join('');
  }

  function getThemeColor(varName, fallback) {
    const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return color || fallback;
  }

  // ---------- Boot ----------

  async function boot() {
    const splash = document.getElementById('splash-screen');
    const splashStart = Date.now();
    if (splash) {
      const savedSection = window.location.hash.slice(1) || localStorage.getItem('officer_last_view') || 'overview';
      const shape = (['record', 'events', 'reports', 'people', 'announcements'].includes(savedSection)) ? 'list' : 'default';
      splash.classList.remove('splash-view-list', 'splash-view-default');
      splash.classList.add(`splash-view-${shape}`);
      splash.style.opacity = '1';
      splash.style.visibility = 'visible';
      splash.classList.remove('hidden');
    }

    if (!window.supabaseClient?.auth) {
      if (splash) splash.classList.add('hidden');
      return showGate('Authentication is unavailable. Check your internet connection and reload.');
    }

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
      if (splash) splash.classList.add('hidden');
      return showGate('Please log in through the main system first.');
    }
    window._authToken = session.access_token;

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
      if (splash) splash.classList.add('hidden');
      return showGate('Session expired. Log in again through the main system.');
    }

    const { data: profile } = await window.supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile || !OFFICER_ROLES.includes(profile.role)) {
      if (splash) splash.classList.add('hidden');
      return showGate('This portal is for council officers only. Ask an admin or governor to assign you an officer role.');
    }

    _profile = profile;
    applyRolePermissionsUI();

    // Header identity
    const name = profile.full_name || user.email;
    const roleLabel = ROLE_LABELS[profile.role] || profile.role;
    $('of-user-name').textContent = name;
    $('of-user-role').textContent = roleLabel;
    if ($('of-mobile-user-role')) {
      $('of-mobile-user-role').textContent = roleLabel;
    }

    bindTheme();
    bindLogout();
    bindNav();
    Dropdowns.bindAll('body');
    if (typeof ProfileModal !== 'undefined') {
      ProfileModal.init();
      ProfileModal.populateFields(profile, { user });
      ProfileModal.syncAvatars(profile.avatar_url, name);
    } else {
      if (profile.avatar_url) {
        $('of-avatar').innerHTML = `<img src="${profile.avatar_url}" alt="${esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      } else {
        $('of-avatar').textContent = (name[0] || '?').toUpperCase();
      }
    }
    bindRecordForm();
    bindEventForms();
    bindEventFilters();
    bindTransferForm();
    bindPeopleSearch();
    bindAuditSearch();
    bindAnnouncementForm();
    bindRosterForm();

    if (typeof Api !== 'undefined' && Api.prefetchAll) {
      Api.prefetchAll(profile.role);
    }

    document.addEventListener('transaction-updated', async () => {
      _eventDetailCache.clear();
      await refreshCoreData();
      const currentActive = document.querySelector('.of-view.active')?.id?.replace('of-view-', '');
      if (currentActive === 'overview') await loadOverview(true);
      if (currentActive === 'reports')  await loadReports(true);
      if (currentActive === 'events')   await renderEventsGrid();
      if (currentActive === 'people')   await loadPeople(true);
      if (currentActive === 'announcements') await loadAnnouncements(true);
    });

    document.addEventListener('api:cache-updated', async (e) => {
      const path = e.detail?.path || '';
      const currentActive = document.querySelector('.of-view.active')?.id?.replace('of-view-', '');
      if (path.startsWith('/reports') && (currentActive === 'overview' || currentActive === 'reports')) {
        if (currentActive === 'overview') await loadOverview(true);
        if (currentActive === 'reports')  await loadReports(true);
      } else if (path.startsWith('/events') && currentActive === 'events') {
        await renderEventsGrid();
      } else if (path.startsWith('/admin/users') && currentActive === 'people') {
        await loadPeople(true);
      }
    });

    $('of-shell').classList.remove('hidden');

    try {
      await refreshCoreData();
      const savedSection = window.location.hash.slice(1) || localStorage.getItem('officer_last_view') || 'overview';
      const validSections = ['overview', 'record', 'events', 'reports', 'people', 'announcements', 'roster'];
      const targetSection = validSections.includes(savedSection) ? savedSection : 'overview';
      await switchSection(targetSection);
    } catch (err) {
      toast('Could not load initial data: ' + err.message, 'error');
    } finally {
      if (splash) {
        const elapsed = Date.now() - splashStart;
        const remaining = Math.max(0, 300 - elapsed);
        setTimeout(() => {
          splash.style.opacity = '0';
          setTimeout(() => {
            splash.style.visibility = 'hidden';
            splash.classList.add('hidden');
          }, 300);
        }, remaining);
      }
    }
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1);
    const validSections = ['overview', 'record', 'events', 'reports', 'people', 'announcements', 'roster'];
    if (validSections.includes(hash)) {
      switchSection(hash);
    }
  });

  function bindTheme() {
    const toggleBtns = document.querySelectorAll('[data-theme-toggle]');
    const updateIcon = () => {
      const currentTheme = localStorage.getItem('theme') || 'light';
      const icon = currentTheme === 'dark' ? 'solar:sun-linear' : 'solar:moon-linear';
      const title = currentTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
      toggleBtns.forEach(btn => {
        const iconEl = btn.querySelector('iconify-icon');
        if (iconEl) iconEl.setAttribute('icon', icon);
        btn.setAttribute('title', title);
      });
    };

    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const cur = localStorage.getItem('theme') || 'light';
        const next = cur === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', next);
        document.documentElement.setAttribute('data-theme', next);
        if (typeof UI !== 'undefined' && UI.syncThemeColor) UI.syncThemeColor(next);
        updateIcon();
        reloadCharts();
      });
    });
    updateIcon();
  }

  function bindLogout() {
    const handleLogout = async (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to sign out of the system?')) {
        try {
          await window.supabaseClient.auth.signOut();
        } catch (err) {
          console.error('Sign out error:', err);
        } finally {
          window.location.href = '/';
        }
      }
    };

    const mobileLogoutBtn = document.getElementById('of-mobile-logout-btn');
    const desktopLogoutBtn = document.getElementById('of-logout-btn');

    if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);
    if (desktopLogoutBtn) desktopLogoutBtn.addEventListener('click', handleLogout);
  }

  async function refreshCoreData() {
    const [events, txs] = await Promise.all([
      Api.events.list(),
      Api.transactions.list({ limit: 200 })
    ]);
    _events = events;
    _txs = txs;
  }

  // ---------- Navigation ----------

  function bindNav() {
    document.querySelectorAll('[data-of]').forEach(btn => {
      btn.addEventListener('click', () => switchSection(btn.dataset.of));
    });
    bindAutoHideBottomNav();
    bindOfficerMobileMoreSheet();
  }

  function bindOfficerMobileMoreSheet() {
    const moreBtn = $('of-bottom-nav-more-btn');
    const sheet = $('of-mobile-more-sheet');
    const backdrop = $('of-mobile-more-sheet-backdrop');
    const closeBtn = $('of-mobile-sheet-close-btn');
    const dragHandle = $('of-mobile-sheet-drag-handle');

    function preventScrollOutsideSheet(e) {
      if (!sheet || sheet.classList.contains('hidden')) return;
      if (!sheet.contains(e.target)) {
        e.preventDefault();
      }
    }

    function openSheet() {
      if (!sheet || !backdrop) return;
      sheet.classList.remove('hidden');
      backdrop.classList.remove('hidden');
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('more-sheet-open');
      const ofMain = document.querySelector('.of-main');
      if (ofMain) {
        ofMain.style.overflow = 'hidden';
        ofMain.style.touchAction = 'none';
      }
      document.addEventListener('touchmove', preventScrollOutsideSheet, { passive: false });
    }

    function closeSheet() {
      if (!sheet || !backdrop) return;
      sheet.classList.add('hidden');
      backdrop.classList.add('hidden');
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('more-sheet-open');
      const ofMain = document.querySelector('.of-main');
      if (ofMain) {
        ofMain.style.overflow = '';
        ofMain.style.touchAction = '';
      }
      document.removeEventListener('touchmove', preventScrollOutsideSheet);
    }

    if (moreBtn) moreBtn.addEventListener('click', e => {
      e.preventDefault();
      if (sheet && sheet.classList.contains('hidden')) openSheet();
      else closeSheet();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    if (backdrop) {
      backdrop.addEventListener('click', closeSheet);
      backdrop.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    }

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    if (dragHandle) {
      dragHandle.addEventListener('click', closeSheet);
      dragHandle.addEventListener('touchstart', e => {
        if (!e.touches || !e.touches[0]) return;
        startY = e.touches[0].clientY;
        currentY = startY;
        isDragging = true;
      }, { passive: true });

      dragHandle.addEventListener('touchmove', e => {
        if (!isDragging || !e.touches || !e.touches[0]) return;
        currentY = e.touches[0].clientY;
        const diffY = currentY - startY;
        if (diffY > 0) {
          sheet.style.transform = `translateY(${diffY}px)`;
        }
      }, { passive: true });

      dragHandle.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        const diffY = currentY - startY;
        sheet.style.transform = '';
        if (diffY > 50) {
          closeSheet();
        }
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (sheet && !sheet.classList.contains('hidden')) {
          closeSheet();
          return;
        }
        const rModal = $('of-roster-modal');
        if (rModal && !rModal.classList.contains('hidden')) {
          rModal.classList.add('hidden');
          document.body.classList.remove('modal-open');
          return;
        }
        const impModal = $('of-roster-import-modal');
        if (impModal && !impModal.classList.contains('hidden')) {
          impModal.classList.add('hidden');
          document.body.classList.remove('modal-open');
          return;
        }
      }
    });

    if (sheet) {
      sheet.querySelectorAll('[data-of-sheet-action], [data-action="open-profile"]').forEach(el => {
        el.addEventListener('click', () => {
          closeSheet();
          if (el.dataset.of) {
            switchSection(el.dataset.of);
          }
        });
      });
    }
  }

  function bindAutoHideBottomNav() {
    const bottomNav = $('of-bottom-nav');
    if (!bottomNav) return;

    const scrollTargets = [
      document.querySelector('.of-main'),
      window
    ].filter(Boolean);

    let lastScrollTop = 0;
    let ticking = false;
    const HIDE_THRESHOLD = 15;
    const SHOW_THRESHOLD = 8;

    function handleScroll(e) {
      const target = (e.target === document || e.target === window) ? (document.documentElement || document.body) : e.target;
      const currentScrollTop = target.scrollTop || window.scrollY || 0;
      const clientHeight = target.clientHeight || window.innerHeight || 0;
      const scrollHeight = target.scrollHeight || document.documentElement.scrollHeight || 0;
      const isAtBottom = (currentScrollTop + clientHeight >= scrollHeight - 32);

      if (!ticking) {
        window.requestAnimationFrame(() => {
          const diff = currentScrollTop - lastScrollTop;

          if (currentScrollTop <= 25 || isAtBottom) {
            // At the top OR reached the bottom -> Always reveal floating bottom nav!
            bottomNav.classList.remove('nav-hidden');
          } else if (diff > HIDE_THRESHOLD) {
            // Scrolling DOWN -> Hide floating nav
            bottomNav.classList.add('nav-hidden');
          } else if (diff < -SHOW_THRESHOLD) {
            // Scrolling UP -> Reveal floating nav
            bottomNav.classList.remove('nav-hidden');
          }

          lastScrollTop = Math.max(0, currentScrollTop);
          ticking = false;
        });
        ticking = true;
      }
    }

    scrollTargets.forEach(target => {
      target.addEventListener('scroll', handleScroll, { passive: true });
    });

    document.querySelectorAll('.of-bottom-nav > button, .of-bottom-nav > a, .of-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        bottomNav.classList.remove('nav-hidden');
      });
    });
  }

  async function switchSection(section) {
    if (!section || !$(`of-view-${section}`)) section = 'overview';

    const moreSections = ['roster', 'people', 'announcements'];
    const isMoreActive = moreSections.includes(section);
    const moreBtn = $('of-bottom-nav-more-btn');
    if (moreBtn) moreBtn.classList.toggle('active', isMoreActive);

    document.querySelectorAll('.of-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('[data-of]').forEach(b => {
      if (b !== moreBtn) b.classList.toggle('active', b.dataset.of === section);
    });
    $(`of-view-${section}`).classList.add('active');

    // Remember view across page refreshes and keep URL hash in sync
    localStorage.setItem('officer_last_view', section);
    if (window.location.hash.slice(1) !== section) {
      history.replaceState(null, '', `#${section}`);
    }

    const isFirstLoad = !_loaded[section];

    try {
      if (section === 'overview')          { await loadOverview(!isFirstLoad); }
      else if (section === 'record')       { await loadRecord(); }
      else if (section === 'events')       { await loadEvents(!isFirstLoad); }
      else if (section === 'reports')      { await loadReports(!isFirstLoad); }
      else if (section === 'people')       { await loadPeople(!isFirstLoad); }
      else if (section === 'announcements') { await loadAnnouncements(!isFirstLoad); }
      else if (section === 'roster')       { await loadRoster(!isFirstLoad); }
    } catch (err) {
      if (isFirstLoad) toast(err.message || 'Failed to load section.', 'error');
    } finally {
      _loaded[section] = true;
    }
  }

  const activeEvents = () => _events.filter(ev => ev.status !== 'archived');

  // ---------- Interactive Charts ----------

  function renderChartInstance(canvasId, config) {
    const canvas = $(canvasId);
    if (!canvas || !window.Chart) return;
    if (_chartInstances[canvasId]) {
      _chartInstances[canvasId].destroy();
    }
    _chartInstances[canvasId] = new Chart(canvas, config);
  }

  function drawMonthlyChart(canvasId, monthly) {
    if (!monthly || !monthly.length) return;
    const labels = monthly.map(m => {
      const [y, mo] = m.month.split('-');
      return new Date(y, mo - 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    });

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textColor = isLight ? '#64748B' : '#94A3B8';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)';
    const tooltipBg = isLight ? '#FFFFFF' : '#0F172A';
    const tooltipText = isLight ? '#0F172A' : '#F8FAFC';
    const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

    renderChartInstance(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Income',
            data: monthly.map(m => m.income),
            backgroundColor: '#F97316',
            hoverBackgroundColor: '#FB923C',
            borderRadius: { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 },
            borderSkipped: 'bottom',
            maxBarThickness: 32,
            categoryPercentage: 0.75,
            barPercentage: 0.85
          },
          {
            label: 'Expenses',
            data: monthly.map(m => m.expense),
            backgroundColor: isLight ? '#94A3B8' : '#475569',
            hoverBackgroundColor: isLight ? '#CBD5E1' : '#64748B',
            borderRadius: { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 },
            borderSkipped: 'bottom',
            maxBarThickness: 32,
            categoryPercentage: 0.75,
            barPercentage: 0.85
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: textColor,
              font: { family: 'Inter, sans-serif', size: 12, weight: '500' },
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 7,
              boxHeight: 7,
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            titleFont: { family: 'Outfit, sans-serif', size: 12, weight: '600' },
            bodyFont: { family: 'Inter, sans-serif', size: 12 },
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
              afterBody: items => {
                const idx = items[0]?.dataIndex;
                if (idx == null || !monthly[idx]) return '';
                const net = (monthly[idx].income || 0) - (monthly[idx].expense || 0);
                return `\nNet Cashflow: ${net >= 0 ? '+' : '-'}₱${Math.abs(net).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
              }
            }
          }
        },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'Inter, sans-serif', size: 11, weight: '500' },
              padding: 6
            }
          },
          y: {
            border: { display: false },
            grid: {
              color: gridColor,
              borderDash: [4, 6],
              drawTicks: false
            },
            ticks: {
              color: textColor,
              font: { family: 'Inter, sans-serif', size: 11 },
              padding: 8,
              callback: v => `₱${(v / 1000).toFixed(0)}k`
            }
          }
        }
      }
    });
  }

  function drawBreakdownChart(canvasId, breakdown) {
    if (!breakdown) return;
    const typeMap = [
      { key: 'expense',    label: 'Expenses',   color: '#EF4444' },
      { key: 'allocation', label: 'Allocation', color: '#64748B' },
      { key: 'donation',   label: 'Donations',  color: '#10B981' },
      { key: 'collection', label: 'Collection', color: '#F97316' },
    ];

    const active = typeMap.filter(t => (breakdown[t.key] || 0) > 0);
    const hasData = active.length > 0;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textColor = isLight ? '#64748B' : '#94A3B8';
    const tooltipBg = isLight ? '#FFFFFF' : '#0F172A';
    const tooltipText = isLight ? '#0F172A' : '#F8FAFC';
    const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

    renderChartInstance(canvasId, {
      type: 'doughnut',
      data: {
        labels: hasData ? active.map(t => t.label) : ['No Data'],
        datasets: [{
          data: hasData ? active.map(t => breakdown[t.key]) : [1],
          backgroundColor: hasData ? active.map(t => t.color) : ['#334155'],
          borderWidth: 0,
          spacing: 3,
          borderRadius: 3,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '74%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: textColor,
              font: { family: 'Inter, sans-serif', size: 12, weight: '500' },
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 7,
              boxHeight: 7
            }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            titleFont: { family: 'Outfit, sans-serif', size: 12, weight: '600' },
            bodyFont: { family: 'Inter, sans-serif', size: 12 },
            callbacks: {
              label: ctx => ` ${ctx.label}: ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
            }
          }
        }
      }
    });
  }

  function reloadCharts() {
    if (_monthlyData) {
      drawMonthlyChart('of-monthly-chart', _monthlyData);
      drawMonthlyChart('of-reports-monthly-chart', _monthlyData);
    }
    if (_summaryBreakdownData) {
      drawBreakdownChart('of-breakdown-chart', _summaryBreakdownData);
      drawBreakdownChart('of-reports-breakdown-chart', _summaryBreakdownData);
    }
  }

  // ---------- 1. Fund Overview ----------

  async function loadOverview(isSilent = false) {
    if (!isSilent && !_loaded.overview) {
      $('of-overview-stats').innerHTML = skeletonStatCards();
      $('of-overview-alerts').innerHTML = skeletonStack();
      $('of-overview-recent').innerHTML = skeletonStack();
    }

    await refreshCoreData();
    const [summary, monthly] = await Promise.all([
      Api.reports.summary(),
      Api.reports.monthly()
    ]);

    _monthlyData = monthly;
    _summaryBreakdownData = summary.breakdown;

    const reserved = Number(summary.breakdown?.reserved_envelopes || 0);
    const total    = Number(summary.remainingBalance || 0) + reserved;

    // Month-to-date net from the transaction list
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let mtdIn = 0, mtdOut = 0;
    (_txs || []).forEach(tx => {
      if ((tx.transaction_date || '').startsWith(monthPrefix)) {
        if (tx.type === 'expense') mtdOut += Number(tx.amount);
        else mtdIn += Number(tx.amount);
      }
    });

    $('of-overview-stats').innerHTML = `
      <div class="of-stat">
        <div class="of-stat-label"><span>Total Council Funds</span><iconify-icon icon="solar:info-circle-linear"></iconify-icon></div>
        <div class="of-stat-value">₱${fmtNum(total)}</div>
        <div class="of-stat-sub">Available + Reserved Envelopes</div>
        <div class="stat-popover">
          <div class="stat-pop-row income"><span>Available Cash</span> <span>₱${fmtNum(summary.remainingBalance)}</span></div>
          <div class="stat-pop-row" style="color:var(--status-neutral)"><span>Reserved (Events)</span> <span>₱${fmtNum(reserved)}</span></div>
          <div class="stat-pop-row total"><span>Total Council Net</span> <span>₱${fmtNum(total)}</span></div>
        </div>
      </div>
      <div class="of-stat is-green">
        <div class="of-stat-label"><span>General Fund Available</span><iconify-icon icon="solar:info-circle-linear"></iconify-icon></div>
        <div class="of-stat-value">₱${fmtNum(summary.remainingBalance)}</div>
        <div class="of-stat-sub">Unreserved cash</div>
        <div class="stat-popover">
          <div class="stat-pop-row income"><span>Total Income</span> <span>₱${fmtNum(summary.totalIncome)}</span></div>
          <div class="stat-pop-row expense"><span>Misc Expenses</span> <span>-₱${fmtNum(summary.generalExpense || 0)}</span></div>
          <div class="stat-pop-row" style="color:var(--status-neutral)"><span>Event Allocations</span> <span>-₱${fmtNum(reserved)}</span></div>
          <div class="stat-pop-row total"><span>Available Fund</span> <span>₱${fmtNum(summary.remainingBalance)}</span></div>
        </div>
      </div>
      <div class="of-stat">
        <div class="of-stat-label"><span>Reserved in Events</span><iconify-icon icon="solar:info-circle-linear"></iconify-icon></div>
        <div class="of-stat-value">₱${fmtNum(reserved)}</div>
        <div class="of-stat-sub">${_events.filter(e => e.status !== 'archived').length} active events</div>
        <div class="stat-popover">
          ${_events.filter(e => e.status !== 'archived').slice(0, 5).map(e => `
            <div class="stat-pop-row"><span>${esc(e.event_name)}</span> <span>₱${fmtNum(e.allocated_budget)}</span></div>
          `).join('')}
          <div class="stat-pop-row total"><span>Total Envelopes</span> <span>₱${fmtNum(reserved)}</span></div>
        </div>
      </div>
      <div class="of-stat ${mtdIn - mtdOut >= 0 ? 'is-green' : 'is-red'}">
        <div class="of-stat-label"><span>This Month, Net</span><iconify-icon icon="solar:info-circle-linear"></iconify-icon></div>
        <div class="of-stat-value">${mtdIn - mtdOut >= 0 ? '+' : '-'}₱${fmtNum(Math.abs(mtdIn - mtdOut))}</div>
        <div class="of-stat-sub">In ₱${fmtNum(mtdIn)} · Out ₱${fmtNum(mtdOut)}</div>
        <div class="stat-popover">
          <div class="stat-pop-row income"><span>Month Inflow</span> <span>+₱${fmtNum(mtdIn)}</span></div>
          <div class="stat-pop-row expense"><span>Month Outflow</span> <span>-₱${fmtNum(mtdOut)}</span></div>
          <div class="stat-pop-row total"><span>Month Net Position</span> <span>${mtdIn - mtdOut >= 0 ? '+' : '-'}₱${fmtNum(Math.abs(mtdIn - mtdOut))}</span></div>
        </div>
      </div>
    `;

    bindStatPopovers();
    updateCreateEventBudgetUI();

    // Render Overview Charts
    requestAnimationFrame(() => {
      drawMonthlyChart('of-monthly-chart', monthly);
      drawBreakdownChart('of-breakdown-chart', summary.breakdown);
    });

    // Alerts: events at or past 90% of allocation
    const alerts = activeEvents().filter(ev => {
      const budget = Number(ev.allocated_budget) || 0;
      if (budget <= 0) return false;
      return Number(ev.computed_expenses) >= budget * 0.9;
    });

    $('of-overview-alerts').innerHTML = alerts.length
      ? alerts.map(ev => {
          const budget = Number(ev.allocated_budget);
          const spent  = Number(ev.computed_expenses);
          const over   = spent > budget;
          return `<div class="of-alert-item ${over ? 'is-over' : ''}">
            <span><strong>${esc(ev.event_name)}</strong></span>
            <strong>${over ? `OVER by ₱${fmtNum(spent - budget)}` : `${fmtNum(((spent / budget) * 100))}% used`}</strong>
          </div>`;
        }).join('')
      : '<div class="of-alert-item" style="color:var(--text-secondary);">No budget alerts. All events are in healthy range.</div>';

    const recent = (_txs || []).slice(0, 8);
    $('of-overview-recent').innerHTML = recent.length
      ? recent.map(tx => `
          <div class="of-recent-item">
            <div class="of-recent-main">
              <div class="of-recent-desc">${esc(tx.description)}</div>
              <span class="of-when">${UI.dateStr(tx.transaction_date)} · ${esc(tx.type)}</span>
            </div>
            <span class="${tx.type === 'expense' ? 'is-neg' : 'is-pos'}">${tx.type === 'expense' ? '-' : '+'}₱${fmtNum(tx.amount)}</span>
          </div>`).join('')
      : '<div class="of-recent-item" style="color:var(--text-secondary);">No transactions recorded yet.</div>';
  }

  function bindStatPopovers() {
    const cards = Array.from(document.querySelectorAll('.of-stat'));
    if (!cards.length) return;

    let activeCard = null;
    let longPressTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let hasLongPressed = false;
    let suppressClickUntil = 0;

    function adjustPosition(card) {
      const popover = card.querySelector('.stat-popover');
      if (!popover) return;
      const rect = popover.getBoundingClientRect();
      if (rect.right > window.innerWidth - 10) {
        popover.style.left = 'auto';
        popover.style.right = '0px';
      } else if (rect.left < 10) {
        popover.style.left = '0px';
        popover.style.right = 'auto';
      }
    }

    function showCard(card) {
      if (!card) return;
      if (activeCard && activeCard !== card) {
        activeCard.classList.remove('hover-active');
      }
      activeCard = card;
      card.classList.add('hover-active');
      adjustPosition(card);
    }

    function hideAll() {
      cards.forEach(c => c.classList.remove('hover-active'));
      activeCard = null;
    }

    const canHover = window.matchMedia?.('(hover: hover)').matches;

    cards.forEach(card => {
      if (canHover) {
        card.addEventListener('mouseenter', () => showCard(card));
        card.addEventListener('mouseleave', () => hideAll());
      }

      // Touch & Hold and Finger Slide
      card.addEventListener('touchstart', (e) => {
        if (!e.touches || !e.touches[0]) return;
        hasLongPressed = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;

        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          hasLongPressed = true;
          showCard(card);
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch {}
          }
        }, 220);
      }, { passive: true });

      card.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches[0]) return;
        const touch = e.touches[0];
        const dist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);

        if (dist > 10 && !hasLongPressed) {
          clearTimeout(longPressTimer);
        }

        if (hasLongPressed || activeCard) {
          const el = document.elementFromPoint(touch.clientX, touch.clientY);
          const hoveredCard = el ? el.closest('.of-stat') : null;
          if (hoveredCard && hoveredCard !== activeCard) {
            showCard(hoveredCard);
            if (navigator.vibrate) {
              try { navigator.vibrate(15); } catch {}
            }
          }
        }
      }, { passive: true });

      card.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
        if (hasLongPressed) {
          suppressClickUntil = Date.now() + 350;
        }
      });

      card.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimer);
      });

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Date.now() < suppressClickUntil) {
          e.preventDefault();
          return;
        }
        const active = card.classList.contains('hover-active');
        if (!active) {
          showCard(card);
        } else {
          hideAll();
        }
      });
    });

    if (!bindStatPopovers._docBound) {
      bindStatPopovers._docBound = true;
      document.addEventListener('click', hideAll);
      document.addEventListener('touchstart', (e) => {
        if (!e.target.closest('.of-stat')) {
          hideAll();
        }
      }, { passive: true });
    }
  }

  // ---------- 2. Record Transaction ----------

  function bindRecordForm() {
    const typeSel  = $('of-tx-type');
    const eventSel = $('of-tx-event');
    const allocField = $('of-tx-alloc-field');

    $('of-tx-date').value = new Date().toISOString().split('T')[0];

    const updateAllocVisibility = () => {
      allocField.style.display = (typeSel.value === 'expense' && eventSel.value) ? 'block' : 'none';
      if (allocField.style.display === 'none') $('of-tx-alloc').checked = true;
      updateEventBalance();
    };
    typeSel.addEventListener('change', updateAllocVisibility);
    eventSel.addEventListener('change', updateAllocVisibility);

    // Receipt capture (shared component)
    $('of-tx-receipt-btn').addEventListener('click', async () => {
      const captured = await ReceiptCapture.open();
      if (!captured) return;
      _receipt = captured;
      $('of-tx-receipt-chip-text').textContent = `${captured.name} (${Math.round(captured.size / 1024)} KB)`;
      $('of-tx-receipt-chip').classList.remove('hidden');
    });
    $('of-tx-receipt-remove').addEventListener('click', () => {
      _receipt = null;
      $('of-tx-receipt-chip').classList.add('hidden');
    });

    $('of-tx-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('of-tx-error');
      errEl.classList.add('hidden');
      if (!eventSel.value) {
        errEl.textContent = 'Please select an event.';
        errEl.classList.remove('hidden');
        return;
      }
      const btn = $('of-tx-submit');
      btn.disabled = true;
      btn.textContent = 'Recording…';

      try {
        let payload;
        if (_receipt) {
          payload = new FormData();
          payload.append('event_id',         eventSel.value);
          payload.append('type',             typeSel.value);
          payload.append('amount',           $('of-tx-amount').value);
          payload.append('description',      $('of-tx-desc').value);
          payload.append('donor_name',       $('of-tx-donor').value);
          payload.append('transaction_date', $('of-tx-date').value);
          payload.append('use_allocation',   (typeSel.value === 'expense' && eventSel.value) ? String($('of-tx-alloc').checked) : 'false');
          payload.append('receipt',          _receipt.blob, _receipt.name);
        } else {
          payload = {
            event_id:         eventSel.value,
            type:             typeSel.value,
            amount:           $('of-tx-amount').value,
            description:      $('of-tx-desc').value,
            donor_name:       $('of-tx-donor').value,
            transaction_date: $('of-tx-date').value,
            use_allocation:   (typeSel.value === 'expense' && eventSel.value) ? $('of-tx-alloc').checked : false
          };
        }

        const tx = await Api.transactions.create(payload);
        if (tx.warning)                            toast(tx.warning, 'warning');
        else if (tx.over_budget_warning)           toast('Recorded, but the event is OVER 90% BUDGET CAPACITY!', 'warning');
        else                                       toast('Transaction recorded.', 'success');

        e.target.reset();
        clearReceiptChip();
        $('of-tx-date').value = new Date().toISOString().split('T')[0];
        if (typeof Api !== 'undefined' && Api.invalidateCache) {
          Api.invalidateCache('/reports', '/transactions', '/dashboard', '/income', '/events');
        }
        await refreshCoreData();
        updateEventBalance();
        populateEventSelects();
        document.dispatchEvent(new CustomEvent('transaction-updated'));
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Record Transaction';
      }
    });
  }

  function clearReceiptChip() {
    _receipt = null;
    $('of-tx-receipt-chip').classList.add('hidden');
  }

  function updateEventBalance() {
    const ev = _events.find(e => e.id === $('of-tx-event').value);
    const box = $('of-record-event-info');
    if (!ev) {
      box.innerHTML = 'Select an event to see its available budget.';
      return;
    }
    const budget = Number(ev.allocated_budget) || 0;
    const spent  = Number(ev.computed_expenses) || 0;
    const rem    = Number(ev.computed_remaining) || 0;
    const over   = budget > 0 && spent > budget;
    box.innerHTML = `
      <strong>${esc(ev.event_name)}</strong><br/>
      Allocated: <strong>₱${fmtNum(budget)}</strong><br/>
      Spent: <strong>₱${fmtNum(spent)}</strong><br/>
      Remaining: <strong style="color:${over || rem < 0 ? 'var(--status-negative)' : 'var(--status-positive)'}">₱${fmtNum(rem)}</strong>
      ${over ? '<br/><em style="color:var(--status-negative)">This event is over budget.</em>' : ''}
    `;
  }

  async function loadRecord() {
    populateEventSelects();
    updateEventBalance();
  }

  function populateEventSelects() {
    const opts = '<option value="">Select Event</option>' +
      activeEvents().map(ev => `<option value="${ev.id}">${esc(ev.event_name)}</option>`).join('');
    $('of-tx-event').innerHTML = opts;
    Dropdowns.syncAll();
  }

  // ---------- 3. Events & Budgets ----------

  function bindEventFilters() {
    const searchInput = $('of-events-search');
    const sortSelect  = $('of-events-sort');
    const filterTabs  = $('of-events-filter-tabs');

    if (searchInput) searchInput.addEventListener('input', () => renderEventsGrid());
    if (sortSelect)  sortSelect.addEventListener('change', () => renderEventsGrid());
    if (filterTabs) {
      filterTabs.querySelectorAll('.of-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _eventStatusFilter = btn.dataset.status;
          filterTabs.querySelectorAll('.of-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
          renderEventsGrid();
        });
      });
    }
  }

  function getAvailableGeneralFundSync() {
    let totalIncome = 0;
    let dashboardExpense = 0;
    let reservedEnvelopes = 0;

    (_events || []).forEach(e => {
      if (e.status !== 'archived') {
        reservedEnvelopes += Number(e.allocated_budget || 0);
      }
    });

    (_txs || []).forEach(tx => {
      if (['donation', 'collection', 'allocation'].includes(tx.type)) {
        totalIncome += Number(tx.amount || 0);
      }
      if (tx.type === 'expense' && !tx.use_allocation) {
        dashboardExpense += Number(tx.amount || 0);
      }
    });

    return Math.max(0, totalIncome - dashboardExpense - reservedEnvelopes);
  }

  function updateCreateEventBudgetUI() {
    const avail = getAvailableGeneralFundSync();
    const availBalEl = $('of-ev-avail-bal');
    if (availBalEl) {
      availBalEl.textContent = `₱${fmtNum(avail)}`;
    }
  }

  function bindEventForms() {
    $('of-event-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('of-ev-error');
      errEl.classList.add('hidden');

      const budgetVal = Number($('of-ev-budget').value) || 0;
      const avail = getAvailableGeneralFundSync();
      if (budgetVal > avail) {
        errEl.textContent = `Insufficient unreserved funds in General Fund. Available: ₱${fmtNum(avail)}, Requested: ₱${fmtNum(budgetVal)}.`;
        errEl.classList.remove('hidden');
        return;
      }

      const btn = $('of-ev-submit');
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        await Api.events.create({
          event_name:       $('of-ev-name').value,
          description:      $('of-ev-desc').value,
          allocated_budget: $('of-ev-budget').value,
          event_date:       $('of-ev-date').value || null,
          status:           $('of-ev-status').value
        });
        toast('Event created.', 'success');
        e.target.reset();
        await refreshCoreData();
        await renderEventsGrid();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Event';
      }
    });
  }

  function bindTransferForm() {
    const fromSel = $('of-transfer-from');
    const toSel   = $('of-transfer-to');
    const amountIn = $('of-transfer-amount');

    const updatePreview = () => {
      const box = $('of-transfer-preview');
      if (!fromSel.value || !toSel.value || fromSel.value === toSel.value) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');
      const fmt = (id) => {
        if (id === 'GENERAL') return `₱${fmtNum(0)} + general fund`;
        const ev = _events.find(e => e.id === id);
        return ev ? `₱${fmtNum(ev.computed_remaining)}` : '—';
      };
      box.innerHTML = `
        <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--text-tertiary)">From</div><strong>${fromSel.value === 'GENERAL' ? 'General Fund' : esc(_events.find(e => e.id === fromSel.value)?.event_name || '')}</strong> · ${fmt(fromSel.value)}</div>
        <div style="text-align:right"><div style="font-size:0.68rem;text-transform:uppercase;color:var(--text-tertiary)">To</div><strong>${esc(_events.find(e => e.id === toSel.value)?.event_name || '')}</strong> · ${fmt(toSel.value)}</div>`;
    };
    fromSel.addEventListener('change', updatePreview);
    toSel.addEventListener('change', updatePreview);
    amountIn.addEventListener('input', updatePreview);

    $('of-transfer-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('of-transfer-error');
      errEl.classList.add('hidden');
      if (!fromSel.value || !toSel.value) {
        errEl.textContent = 'Please choose both the source and target events.';
        errEl.classList.remove('hidden');
        return;
      }
      if (fromSel.value === toSel.value) {
        errEl.textContent = 'Source and target must be different events.';
        errEl.classList.remove('hidden');
        return;
      }
      const btn = $('of-transfer-submit');
      btn.disabled = true;
      btn.textContent = 'Transferring…';
      try {
        const res = await Api.admin.transfer({
          from_event_id: fromSel.value,
          to_event_id:   toSel.value,
          amount:        amountIn.value,
          reason:        $('of-transfer-reason').value
        });
        toast(res.message || 'Transfer complete.', 'success');
        e.target.reset();
        boxHide();
        await refreshCoreData();
        await renderEventsGrid();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm Transfer';
      }
      function boxHide() { $('of-transfer-preview').classList.add('hidden'); }
    });
  }

  async function loadEvents(isSilent = false) {
    if (!isSilent && !_loaded.events) {
      $('of-events-grid').innerHTML = skeletonEventCards();
    }
    const opts = '<option value="">Select Event</option>' +
      activeEvents().map(ev => `<option value="${ev.id}">${esc(ev.event_name)}</option>`).join('');
    $('of-transfer-from').innerHTML = '<option value="GENERAL">GENERAL FUND</option>' + opts;
    $('of-transfer-to').innerHTML   = opts;
    Dropdowns.syncAll();
    await renderEventsGrid();
  }

  async function renderEventsGrid() {
    await refreshCoreData();
    const grid = $('of-events-grid');
    const searchVal = ($('of-events-search')?.value || '').toLowerCase();
    const sortVal = $('of-events-sort')?.value || 'newest';

    let list = activeEvents();

    if (_eventStatusFilter !== 'all') {
      list = list.filter(e => e.status === _eventStatusFilter);
    }

    if (searchVal) {
      list = list.filter(e =>
        e.event_name.toLowerCase().includes(searchVal) ||
        (e.description || '').toLowerCase().includes(searchVal)
      );
    }

    list.sort((a, b) => {
      if (sortVal === 'name-asc') {
        return a.event_name.localeCompare(b.event_name);
      } else if (sortVal === 'budget-desc') {
        return Number(b.allocated_budget) - Number(a.allocated_budget);
      } else if (sortVal === 'budget-asc') {
        return Number(a.allocated_budget) - Number(b.allocated_budget);
      } else {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

    grid.innerHTML = list.length ? list.map(ev => {
      const budget = Number(ev.allocated_budget) || 0;
      const spent  = Number(ev.computed_expenses) || 0;
      const over   = budget > 0 && spent > budget;
      const pct    = over ? 100 : (budget > 0 ? Math.min((spent / budget) * 100, 100) : 0);
      return `
        <div class="of-event-card" data-ev="${ev.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
            ${UI.renderStatusBadge(ev.status)}
            <span style="font-size:0.72rem;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:12px;color:var(--text-tertiary,#94a3b8);display:inline-flex;align-items:center;gap:4px;">
              <iconify-icon icon="solar:vault-linear" style="font-size:12px;color:var(--accent-primary,#f97316)"></iconify-icon>
              ${ev.funding_source || 'General Fund'}
            </span>
          </div>
          <h4>${esc(ev.event_name)}</h4>
          ${ev.event_date ? `<div class="of-event-date"><iconify-icon icon="solar:calendar-date-linear"></iconify-icon> ${UI.dateStr(ev.event_date)}</div>` : ''}
          <p>${esc(ev.description || 'No description provided.')}</p>
          <div class="of-budget-bar"><div class="of-budget-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
          <div class="of-budget-labels"><span>Spent ₱${fmtNum(spent)}</span><span>Alloc ₱${fmtNum(budget)}</span></div>
          ${over ? `<div class="of-over-note">Over budget by ₱${fmtNum(spent - budget)}</div>` : ''}
          <div class="of-event-actions">
            <button class="of-btn of-btn-ghost" data-act="detail">${isExecutive() ? 'Manage' : 'View'}</button>
            ${isExecutive() && ev.status !== 'completed' && ev.status !== 'archived' ? '<button class="of-btn of-btn-ghost" data-act="complete">Complete</button>' : ''}
            ${isExecutive() && ev.status !== 'archived'
              ? '<button class="of-btn of-btn-ghost" data-act="archive">Archive</button>'
              : (isExecutive() ? '<button class="of-btn of-btn-ghost" data-act="restore">Restore</button>' : '')}
          </div>
        </div>`;
    }).join('') : '<p style="color:var(--text-secondary);font-size:0.85rem">No matching events found.</p>';

    grid.querySelectorAll('.of-event-card').forEach(card => {
      const ev = _events.find(e => e.id === card.dataset.ev);
      if (!ev) return;
      card.querySelector('[data-act="detail"]').addEventListener('click', () => renderEventDetail(ev.id));
      const completeBtn = card.querySelector('[data-act="complete"]');
      if (completeBtn) completeBtn.addEventListener('click', () => completeEvent(ev));
      const archiveBtn = card.querySelector('[data-act="archive"]');
      if (archiveBtn) archiveBtn.addEventListener('click', () => archiveEvent(ev, true));
      const restoreBtn = card.querySelector('[data-act="restore"]');
      if (restoreBtn) restoreBtn.addEventListener('click', () => archiveEvent(ev, false));
    });
  }

  function renderEventDetail(id) {
    const ev = _events.find(e => e.id === id);
    if (!ev) return;
    const modal = $('of-event-modal');
    const content = $('of-event-modal-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    content.innerHTML = `
      <div class="of-modal-head">
        <div>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
            ${UI.renderStatusBadge(ev.status)}
            <span style="font-size:0.72rem;color:var(--text-tertiary);font-family:var(--font-mono, monospace);">ID: ${esc(ev.id.slice(0,8))}</span>
          </div>
          <h3>${esc(ev.event_name)}</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">${esc(ev.description || 'No description provided.')}</p>
        </div>
        <button type="button" class="of-modal-close" id="of-detail-close" aria-label="Close dialog" title="Close">
          <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
        </button>
      </div>

      <div class="of-modal-stats">
        <div class="of-modal-stat is-allocated">
          <span class="of-stat-label">Allocated</span>
          <span class="of-stat-value">₱${fmtNum(ev.allocated_budget)}</span>
        </div>
        <div class="of-modal-stat is-spent">
          <span class="of-stat-label">Spent</span>
          <span class="of-stat-value">₱${fmtNum(ev.computed_expenses)}</span>
        </div>
        <div class="of-modal-stat is-remaining">
          <span class="of-stat-label">Remaining</span>
          <span class="of-stat-value">₱${fmtNum(ev.computed_remaining)}</span>
        </div>
      </div>

      <form id="of-detail-form" class="of-form">
        <div class="of-form-row">
          <div class="of-field">
            <label><iconify-icon icon="solar:tag-linear" style="font-size:12px;margin-right:3px;vertical-align:middle;"></iconify-icon>Event Name</label>
            <input type="text" id="of-me-name" value="${esc(ev.event_name)}" required placeholder="Event name" />
          </div>
          <div class="of-field">
            <label><iconify-icon icon="solar:shield-check-linear" style="font-size:12px;margin-right:3px;vertical-align:middle;"></iconify-icon>Status</label>
            <select id="of-me-status">
              ${['upcoming','ongoing','completed','cancelled'].map(s => `<option value="${s}" ${ev.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="of-form-row">
          <div class="of-field">
            <label><iconify-icon icon="solar:wallet-money-linear" style="font-size:12px;margin-right:3px;vertical-align:middle;"></iconify-icon>Allocated Budget (₱)</label>
            <input type="number" id="of-me-budget" min="0" step="0.01" value="${ev.allocated_budget}" required placeholder="0.00" />
          </div>
          <div class="of-field">
            <label><iconify-icon icon="solar:calendar-date-linear" style="font-size:12px;margin-right:3px;vertical-align:middle;"></iconify-icon>Event Date</label>
            <input type="date" id="of-me-date" value="${ev.event_date || ''}" />
          </div>
        </div>
        <div class="of-field">
          <label><iconify-icon icon="solar:document-text-linear" style="font-size:12px;margin-right:3px;vertical-align:middle;"></iconify-icon>Description</label>
          <textarea id="of-me-desc" rows="2" placeholder="Brief event description">${esc(ev.description || '')}</textarea>
        </div>
        <div class="of-error hidden" id="of-me-error"></div>
        <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;margin-top:0.65rem;flex-wrap:wrap;">
          <button class="of-btn of-btn-ghost" type="button" id="of-detail-receipts">
            <iconify-icon icon="solar:history-linear"></iconify-icon> Transaction History <span style="font-size:0.75rem;background:var(--bg-surface);padding:0.15rem 0.45rem;border-radius:999px;border:1px solid var(--border-default);margin-left:0.3rem;" id="of-detail-tx-count">…</span>
          </button>
          <div style="display:flex;gap:0.6rem;">
            <button class="of-btn of-btn-ghost" type="button" id="of-detail-cancel">Cancel</button>
            <button class="of-btn of-btn-primary" type="submit" id="of-detail-save">Save Changes</button>
          </div>
        </div>
      </form>

      <div id="of-detail-txs" class="of-scrollable-list hidden" style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border-default);max-height:220px;"></div>
    `;

    // Bind custom animated dropdown to modal select
    Dropdowns.bindAll('#of-event-modal');

    if (!isExecutive()) {
      ['of-me-name', 'of-me-status', 'of-me-budget', 'of-me-date', 'of-me-desc'].forEach(id => {
        const el = $(id);
        if (el) el.disabled = true;
      });
      const saveBtn = $('of-detail-save');
      if (saveBtn) saveBtn.style.display = 'none';
      const cancelBtn = $('of-detail-cancel');
      if (cancelBtn) cancelBtn.textContent = 'Close';
    }

    const closeModal = () => {
      modal.classList.add('hidden');
      document.body.classList.remove('modal-open');
    };

    $('of-detail-close').addEventListener('click', closeModal);
    $('of-detail-cancel').addEventListener('click', closeModal);

    // Dismiss when clicking backdrop
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    // ESC key closes modal
    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    // Load tx count preview with instant cache check
    const countEl = $('of-detail-tx-count');
    const cachedDetail = _eventDetailCache.get(ev.id);
    if (cachedDetail && countEl) {
      countEl.textContent = cachedDetail.transactions?.length || 0;
    }

    Api.events.get(ev.id).then(detail => {
      _eventDetailCache.set(ev.id, detail);
      if (countEl) countEl.textContent = detail.transactions?.length || 0;
    }).catch(() => {});

    $('of-detail-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('of-me-error');
      errEl.classList.add('hidden');
      const saveBtn = $('of-detail-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await Api.events.update(ev.id, {
          event_name:       $('of-me-name').value,
          description:      $('of-me-desc').value,
          allocated_budget: $('of-me-budget').value,
          event_date:       $('of-me-date').value || null,
          status:           $('of-me-status').value
        });
        _eventDetailCache.delete(ev.id);
        toast('Event updated.', 'success');
        await refreshCoreData();
        await renderEventsGrid();
        closeModal();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    $('of-detail-receipts').addEventListener('click', async () => {
      const box = $('of-detail-txs');
      if (!box.classList.contains('hidden')) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');

      const renderList = (detail) => {
        box.innerHTML = detail.transactions?.length
          ? detail.transactions.map(tx => `
              <div class="of-recent-item">
                <div class="of-recent-main">
                  <div class="of-recent-desc">${esc(tx.description)}</div>
                  <span class="of-when">${UI.dateStr(tx.transaction_date)} · ${esc(tx.type)}</span>
                </div>
                <div style="text-align:right">
                  <span class="${tx.type === 'expense' ? 'is-neg' : 'is-pos'}">${tx.type === 'expense' ? '-' : '+'}₱${fmtNum(tx.amount)}</span>
                  ${tx.receipt_url ? `<div><button type="button" class="receipt-link" data-receipt-url="${tx.receipt_url}" data-desc="${esc(tx.description || '')}" data-amount="${tx.amount}" data-date="${tx.transaction_date}" data-type="${tx.type}" data-event="${esc(ev.event_name || '')}" style="font-size:0.75rem;color:var(--accent);display:inline-flex;align-items:center;gap:2px;"><iconify-icon icon="solar:paperclip-linear"></iconify-icon> Receipt</button></div>` : ''}
                </div>
              </div>`).join('')
          : '<p style="font-size:0.8rem;color:var(--text-secondary)">No transactions for this event yet.</p>';
      };

      const cached = _eventDetailCache.get(ev.id);
      if (cached) {
        renderList(cached);
      } else {
        box.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary)">Loading history…</p>';
      }

      try {
        const detail = await Api.events.get(ev.id);
        _eventDetailCache.set(ev.id, detail);
        renderList(detail);
      } catch (err) {
        if (!cached) {
          box.innerHTML = `<p style="font-size:0.8rem;color:var(--status-negative)">${esc(err.message)}</p>`;
        }
      }
    });
  }

  async function completeEvent(ev) {
    if (!confirm(`Mark "${ev.event_name}" as completed?`)) return;
    try {
      await Api.events.update(ev.id, { status: 'completed' });
      toast(`"${ev.event_name}" marked as completed.`, 'success');
      await refreshCoreData();
      await renderEventsGrid();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function archiveEvent(ev, archiving) {
    if (archiving && !confirm(`Archive "${ev.event_name}"? It will be hidden from students. You can restore it here.`)) return;
    try {
      if (archiving) {
        await Api.events.archive(ev.id);
        toast('Event archived.', 'success');
      } else {
        await Api.events.update(ev.id, { status: 'upcoming' });
        toast('Event restored.', 'success');
      }
      await refreshCoreData();
      await renderEventsGrid();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- 4. Reports & Paper Trail ----------

  async function loadReports(isSilent = false) {
    if (!isSilent && !_loaded.reports) {
      $('of-events-summary-table').querySelector('tbody').innerHTML = skeletonRows(5);
      $('of-audit-table').querySelector('tbody').innerHTML = skeletonRows(4);
    }

    const [summary, monthly, eventsSummary] = await Promise.all([
      Api.reports.summary(),
      Api.reports.monthly(),
      Api.reports.eventsSummary()
    ]);
    _monthlyData = monthly;
    _summaryBreakdownData = summary.breakdown;

    requestAnimationFrame(() => {
      drawMonthlyChart('of-reports-monthly-chart', monthly);
      drawBreakdownChart('of-reports-breakdown-chart', summary.breakdown);
    });

    const tbody = $('of-events-summary-table').querySelector('tbody');
    tbody.innerHTML = eventsSummary.length ? eventsSummary.map(ev => `
      <tr>
        <td><strong>${esc(ev.event_name)}</strong></td>
        <td class="num">₱${fmtNum(ev.allocated_budget)}</td>
        <td class="num">₱${fmtNum((Number(ev.allocated_budget) || 0) + (Number(ev.computed_remaining) || 0) === 0 ? 0 : Math.max(0, (Number(ev.allocated_budget) || 0) - (Number(ev.computed_remaining) || 0)))}</td>
        <td class="num ${Number(ev.computed_remaining) < 0 ? 'is-neg' : 'is-pos'}">₱${fmtNum(ev.computed_remaining)}</td>
        <td>${UI.renderStatusBadge(ev.status)}</td>
      </tr>`).join('')
      : '<tr><td colspan="5">No events found.</td></tr>';

    await loadAudit();
  }

  let _auditRows = [];
  let _auditCurrentPage = 1;
  const AUDIT_PAGE_SIZE = 10;

  async function loadAudit() {
    _auditRows = await Api.admin.auditLogs({ limit: 100 });
    _auditCurrentPage = 1;
    renderAuditTable();
  }

  function bindAuditSearch() {
    $('of-audit-search').addEventListener('input', () => {
      _auditCurrentPage = 1;
      renderAuditTable();
    });
  }

  function renderAuditTable() {
    const q = ($('of-audit-search').value || '').toLowerCase();
    const filtered = _auditRows.filter(l => {
      if (!q) return true;
      const hay = `${l.profiles?.full_name || ''} ${l.action} ${humanizeAction(l.action)} ${JSON.stringify(l.details || {})}`.toLowerCase();
      return hay.includes(q);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / AUDIT_PAGE_SIZE));
    if (_auditCurrentPage > totalPages) _auditCurrentPage = totalPages;
    if (_auditCurrentPage < 1) _auditCurrentPage = 1;

    const startIdx = (_auditCurrentPage - 1) * AUDIT_PAGE_SIZE;
    const pageRows = filtered.slice(startIdx, startIdx + AUDIT_PAGE_SIZE);

    const tbody = $('of-audit-table').querySelector('tbody');
    tbody.innerHTML = pageRows.length ? pageRows.map(log => `
      <tr>
        <td style="white-space:nowrap">${UI.dateStr(log.created_at)}</td>
        <td><strong>${esc(log.profiles?.full_name || 'Unknown')}</strong></td>
        <td>${auditActionCell(log.action)}</td>
        <td style="font-size:0.78rem;color:var(--text-secondary)">${esc(auditDetails(log))}</td>
      </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No matching audit entries.</td></tr>';

    renderAuditPagination(filtered.length, totalPages);
  }

  function renderAuditPagination(totalItems, totalPages) {
    const pag = $('of-audit-pagination');
    if (!pag) return;
    if (totalItems <= AUDIT_PAGE_SIZE) {
      pag.innerHTML = `
        <span class="of-pagination-info">Showing all ${totalItems} entries</span>
        <div></div>
      `;
      return;
    }

    const start = (_auditCurrentPage - 1) * AUDIT_PAGE_SIZE + 1;
    const end = Math.min(_auditCurrentPage * AUDIT_PAGE_SIZE, totalItems);

    let pagesHTML = '';
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= _auditCurrentPage - 1 && p <= _auditCurrentPage + 1)) {
        pagesHTML += `<button type="button" class="of-page-btn ${p === _auditCurrentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      } else if (p === _auditCurrentPage - 2 || p === _auditCurrentPage + 2) {
        pagesHTML += `<span style="color:var(--text-tertiary);padding:0 2px;font-size:0.8rem;">…</span>`;
      }
    }

    pag.innerHTML = `
      <span class="of-pagination-info">Showing ${start}–${end} of ${totalItems} entries</span>
      <div class="of-pagination-controls">
        <button type="button" class="of-page-btn" id="of-audit-prev" ${_auditCurrentPage <= 1 ? 'disabled' : ''}>
          <iconify-icon icon="solar:alt-arrow-left-linear"></iconify-icon> Prev
        </button>
        ${pagesHTML}
        <button type="button" class="of-page-btn" id="of-audit-next" ${_auditCurrentPage >= totalPages ? 'disabled' : ''}>
          Next <iconify-icon icon="solar:alt-arrow-right-linear"></iconify-icon>
        </button>
      </div>
    `;

    const prevBtn = $('of-audit-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (_auditCurrentPage > 1) {
        _auditCurrentPage--;
        renderAuditTable();
      }
    });

    const nextBtn = $('of-audit-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (_auditCurrentPage < totalPages) {
        _auditCurrentPage++;
        renderAuditTable();
      }
    });

    pag.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        _auditCurrentPage = Number(btn.dataset.page);
        renderAuditTable();
      });
    });
  }

  // Raw audit codes read like syntax - present them as plain sentences with
  // the same icon/color language the main system's admin panel uses.
  const AUDIT_ACTIONS = {
    CREATE_TRANSACTION:       { icon: 'solar:add-circle-linear',       color: '#22C55E', label: 'Created a transaction' },
    EDIT_TRANSACTION:         { icon: 'solar:pen-linear',              color: '#F97316', label: 'Edited a transaction' },
    DELETE_TRANSACTION:       { icon: 'solar:trash-bin-trash-linear',  color: '#ef4444', label: 'Deleted a transaction' },
    BULK_IMPORT_TRANSACTIONS: { icon: 'solar:upload-track-linear',     color: '#3b82f6', label: 'Bulk import' },
    CREATE_EVENT:             { icon: 'solar:calendar-add-linear',     color: '#22C55E', label: 'Created an event' },
    UPDATE_EVENT:             { icon: 'solar:calendar-date-linear',    color: '#F97316', label: 'Updated an event' },
    ARCHIVE_EVENT:            { icon: 'solar:box-minimalistic-linear', color: '#8b5cf6', label: 'Archived an event' },
    POST_ANNOUNCEMENT:        { icon: 'solar:bell-linear',             color: '#f59e0b', label: 'Posted an announcement' },
    SET_USER_ROLE:            { icon: 'solar:shield-check-linear',     color: '#6366f1', label: 'Changed a user role' },
    BUDGET_TRANSFER:          { icon: 'solar:card-transfer-linear',    color: '#14b8a6', label: 'Transferred budget' },
    OVER_BUDGET_ALERT:        { icon: 'solar:danger-triangle-linear',  color: '#F59E0B', label: 'Over-budget alert' },
  };

  function humanizeAction(action) {
    const meta = AUDIT_ACTIONS[action];
    if (meta) return meta.label;
    return String(action || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function auditActionCell(action) {
    const meta = AUDIT_ACTIONS[action] || { icon: 'solar:info-circle-linear', color: 'var(--text-secondary)' };
    return `<div style="display:flex;align-items:center;gap:0.5rem;">
      <iconify-icon icon="${meta.icon}" style="font-size:14px;color:${meta.color}"></iconify-icon>
      <span>${esc(humanizeAction(action))}</span>
    </div>`;
  }

  function auditDetails(log) {
    const d = log.details || {};
    switch (log.action) {
      case 'BUDGET_TRANSFER':
        return `₱${fmtNum(d.amount)} from "${d.from_event_name || 'an event'}" to "${d.to_event_name || 'an event'}"${d.reason ? ` — reason: ${d.reason}` : ''}`;
      case 'SET_USER_ROLE':
        return `Set ${d.user_name || 'a user'}'s role to ${d.new_role || '—'}`;
      case 'CREATE_TRANSACTION':
        return `${d.type ? UI.capitalize(String(d.type)) + ' of ' : ''}₱${fmtNum(d.amount)}${d.description ? ` — "${d.description}"` : ''}`;
      case 'EDIT_TRANSACTION':
        return `Reason: ${d.reason || '—'}`;
      case 'DELETE_TRANSACTION':
        return `Deleted "${d.description || 'a transaction'}"${d.reason ? ` — reason: ${d.reason}` : ''}`;
      case 'BULK_IMPORT_TRANSACTIONS':
        return `Imported ${d.count || 0} transactions`;
      case 'CREATE_EVENT':
        return `Created "${d.event_name || 'an event'}" with a budget of ₱${fmtNum(d.allocated_budget)}`;
      case 'UPDATE_EVENT': {
        const changed = Array.isArray(d.changes)
          ? d.changes.filter(c => c !== 'updated_at').map(c => String(c).replace(/_/g, ' ')).join(', ')
          : (d.changes ? String(d.changes) : '');
        return `Updated "${d.event_name || 'an event'}"${changed ? ` — modified ${changed}` : ''}`;
      }
      case 'ARCHIVE_EVENT':
        return `Archived "${d.event_name || 'an event'}"`;
      case 'POST_ANNOUNCEMENT':
        return `Posted "${d.title || 'an announcement'}"`;
      case 'OVER_BUDGET_ALERT':
        return `Only ₱${fmtNum(d.remaining_budget)} remains on an event's allocation`;
      default:
        return summarizeDetails(d);
    }
  }

  function summarizeDetails(d = {}) {
    const parts = [];
    if (d.event_name)       parts.push(d.event_name);
    if (d.description)      parts.push(d.description);
    if (d.title)            parts.push(`"${d.title}"`);
    if (d.count)            parts.push(`${d.count} items`);
    if (d.changes) {
      const ch = Array.isArray(d.changes)
        ? d.changes.filter(c => c !== 'updated_at').map(c => c.replace(/_/g, ' ')).join(', ')
        : String(d.changes);
      if (ch) parts.push(`modified: ${ch}`);
    }
    if (d.reason)           parts.push(`reason: ${d.reason}`);
    if (d.user_name)        parts.push(`user: ${d.user_name}`);
    if (d.new_role)         parts.push(`role → ${d.new_role}`);
    if (d.amount != null)   parts.push(`₱${fmtNum(d.amount)}`);
    if (d.from_event_name)  parts.push(`from ${d.from_event_name}`);
    if (d.to_event_name)    parts.push(`to ${d.to_event_name}`);
    if (!parts.length) {
      const keys = Object.keys(d).filter(k => k !== 'event_id' && k !== 'transaction_id').slice(0, 3);
      parts.push(...keys.map(k => `${k}: ${String(d[k]).slice(0, 40)}`));
    }
    return parts.join(' · ');
  }

  // ---------- 5. People & Access ----------

  let _users = [];
  let _peopleRoleFilter = 'all';

  const canAssignRoles = () => _profile.role === 'admin' || _profile.role === 'governor';
  const assignableRoles = () => _profile.role === 'admin'
    ? ['student', 'officer', 'governor', 'cashier', 'admin']
    : ['student', 'officer', 'governor', 'cashier'];

  function bindPeopleSearch() {
    $('of-people-search')?.addEventListener('input', renderPeopleTable);

    const roleTabs = $('of-people-role-tabs');
    if (roleTabs) {
      roleTabs.querySelectorAll('.of-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          roleTabs.querySelectorAll('.of-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _peopleRoleFilter = btn.dataset.roleFilter || 'all';
          renderPeopleTable();
        });
      });
    }
  }

  async function updatePeopleStats() {
    if (!_allRoster || _allRoster.length === 0) {
      try {
        _allRoster = await Api.roster.list();
      } catch {}
    }

    const total = _users.length;
    const students = _users.filter(u => u.role === 'student').length;
    const officers = _users.filter(u => u.role !== 'student').length;
    const totalEnrolled = _allRoster ? _allRoster.length : 0;

    const bscoe = _users.filter(u => u.course === 'BSCoE').length;
    const bsce = _users.filter(u => u.course === 'BSCE').length;
    const bsece = _users.filter(u => u.course === 'BSECE').length;

    if ($('of-stat-val-users-total')) $('of-stat-val-users-total').textContent = total;
    if ($('of-stat-sub-users-total')) {
      if (totalEnrolled > 0) {
        const pct = Math.round((total / totalEnrolled) * 100);
        $('of-stat-sub-users-total').textContent = `${total} of ${totalEnrolled} students registered (${pct}%)`;
      } else {
        $('of-stat-sub-users-total').textContent = `${total} registered students`;
      }
    }

    if ($('of-stat-val-users-students')) $('of-stat-val-users-students').textContent = students;
    if ($('of-stat-sub-users-students')) {
      $('of-stat-sub-users-students').textContent = `${students} regular student accounts`;
    }

    if ($('of-stat-val-users-officers')) $('of-stat-val-users-officers').textContent = officers;
    if ($('of-stat-sub-users-officers')) {
      $('of-stat-sub-users-officers').textContent = `${officers} admin, governor, officer, cashier`;
    }

    if ($('of-users-bscoe-count')) $('of-users-bscoe-count').textContent = bscoe;
    if ($('of-users-bsce-count')) $('of-users-bsce-count').textContent = bsce;
    if ($('of-users-bsece-count')) $('of-users-bsece-count').textContent = bsece;
  }

  async function loadPeople(isSilent = false) {
    if (!isSilent && !_loaded.people) {
      $('of-people-table').querySelector('tbody').innerHTML = skeletonRows(4);
    }
    _users = await Api.admin.users();
    const canAssign = canAssignRoles();
    $('of-people-sub').textContent = canAssign
      ? `You can assign: ${assignableRoles().join(', ')}` + (_profile.role === 'governor' ? ' (admin accounts are out of your reach)' : '')
      : (_profile.role === 'officer' ? 'Read-only: officers cannot assign roles.' : 'Read-only: cashiers cannot assign roles.');
    $('of-people-action-col').style.display = canAssign ? '' : 'none';
    await updatePeopleStats();
    renderPeopleTable();
  }

  function renderPeopleTable() {
    const q = ($('of-people-search')?.value || '').toLowerCase().trim();
    const rows = _users.filter(u => {
      const matchSearch = !q || `${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(q);
      let matchRole = true;
      if (_peopleRoleFilter === 'student') matchRole = u.role === 'student';
      else if (_peopleRoleFilter === 'officers') matchRole = u.role !== 'student';
      return matchSearch && matchRole;
    });

    const canAssign = canAssignRoles();
    const tbody = $('of-people-table').querySelector('tbody');
    tbody.innerHTML = rows.length ? rows.map(u => {
      const displayName = u.full_name ? formatStudentName(u.full_name) : (u.email?.split('@')[0] || 'User');
      const progBadge = u.course
        ? `<span class="badge" style="background:var(--bg-surface-raised);color:var(--text-primary);border:1px solid var(--border-default);font-size:0.74rem;font-weight:600;padding:2px 6px;border-radius:4px;">${esc(u.course)}</span>`
        : '<span style="color:var(--text-tertiary);font-size:0.75rem;">—</span>';
      const yrText = u.year_level ? `<span style="font-size:0.78rem;color:var(--text-secondary);margin-left:0.25rem;">Yr ${esc(u.year_level)}</span>` : '';
      const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

      return `
      <tr>
        <td>
          <div style="font-weight:600;color:var(--text-primary);font-size:0.86rem;">${esc(displayName)}</div>
        </td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">${esc(u.email)}</td>
        <td>
          ${progBadge}
          ${yrText}
        </td>
        <td>${UI.renderStatusBadge(u.role)}</td>
        <td style="font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;">${dateStr}</td>
        <td style="${canAssign ? '' : 'display:none'};white-space:nowrap;">
          ${canAssign && u.id !== _profile.id && !(_profile.role === 'governor' && u.role === 'admin')
            ? `<div style="display:flex;gap:0.4rem;align-items:center;">
                 <select data-role-for="${u.id}" data-original-role="${u.role}" style="padding:0.35rem;border:1px solid var(--border-default);border-radius:6px;font-size:0.78rem;background:var(--bg-surface-raised);color:var(--text-primary);min-width:96px;">
                   ${assignableRoles().map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
                 </select>
                 <button type="button" class="of-btn of-btn-primary" data-apply="${u.id}" disabled style="padding:0.32rem 0.75rem;font-size:0.76rem;">Save</button>
               </div>`
            : (u.id === _profile.id ? '<span style="color:var(--text-tertiary);font-size:0.75rem">You</span>' : '<span style="color:var(--text-tertiary);font-size:0.75rem">Protected</span>')}
        </td>
      </tr>`;
    }).join('')
      : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-secondary);">No matching accounts found.</td></tr>';

    tbody.querySelectorAll('[data-role-for]').forEach(sel => {
      Dropdowns.bindDropdown(sel);

      sel.addEventListener('change', () => {
        const id = sel.dataset.roleFor;
        const orig = sel.dataset.originalRole;
        const current = sel.value;
        const btn = tbody.querySelector(`[data-apply="${id}"]`);
        if (!btn) return;
        btn.disabled = (current === orig);
      });
    });

    tbody.querySelectorAll('[data-apply]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.apply;
        const select = tbody.querySelector(`[data-role-for="${id}"]`);
        if (!select) return;
        const role = select.value;
        const orig = select.dataset.originalRole;
        if (role === orig) return;

        const targetUser = _users.find(u => u.id === id);
        const nameStr = targetUser?.full_name ? formatStudentName(targetUser.full_name) : 'this user';
        if (!confirm(`Set role for "${nameStr}" to ${ROLE_LABELS[role]}?`)) return;

        btn.disabled = true;
        btn.textContent = 'Saving…';

        try {
          await Api.admin.setRole(id, role);
          toast(`Role updated to ${ROLE_LABELS[role]} successfully.`, 'success');
          _users = await Api.admin.users();
          await updatePeopleStats();
          renderPeopleTable();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Save';
        }
      });
    });
  }

  // ---------- 6. Announcements ----------

  function bindAnnouncementForm() {
    $('of-announce-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('of-announce-error');
      errEl.classList.add('hidden');
      const btn = $('of-announce-submit');
      btn.disabled = true;
      btn.textContent = 'Posting…';
      try {
        await Api.announcements.create({
          title: $('of-announce-title').value,
          body:  $('of-announce-body').value
        });
        toast('Announcement posted.', 'success');
        e.target.reset();
        await loadAnnouncements(true);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Post Announcement';
      }
    });
  }

  async function loadAnnouncements(isSilent = false) {
    if (!isSilent && !_loaded.announcements) {
      $('of-announce-list').innerHTML = skeletonStack(2);
    }
    const list = await Api.announcements.list();
    $('of-announce-list').innerHTML = list.length ? list.map(a => `
      <div class="of-announce-item">
        <strong>${esc(a.title)}</strong>
        <p>${esc(a.body)}</p>
        <span class="of-when">${UI.dateStr(a.created_at)}</span>
      </div>`).join('')
      : '<p style="font-size:0.82rem;color:var(--text-secondary)">No announcements yet.</p>';
  }

  // ---------- Enrolled Roster Management ----------
  let _allRoster = [];
  let _rosterPage = 1;
  const _rosterPerPage = 15;
  let _selectedRosterProg = '';
  let _selectedRosterYear = '';
  let _importedRosterBatch = [];
  let _rosterCurrentView = 'masterlist';
  let _requestsStatusFilter = 'pending';
  let _allVerificationRequests = [];
  let _selectedRequestIds = new Set();

  const COMPOUND_SURNAME_PREFIXES = [
    'DEL ROSARIO',
    'DELA CALZADA',
    'DELA CRUZ',
    'DELA RAMA',
    'DELA TORRE',
    'DELA CERNA',
    'DELA PEÑA',
    'DELA PENA',
    'DELA ROSA',
    'DELA SERNA',
    'DE CASTRO',
    'DE TORRES',
    'DE LOS SANTOS',
    'DE LOS REYES',
    'DE GUZMAN',
    'DE LEON',
    'DE VERA',
    'SAN JUAN',
    'SAN JOSE',
    'SAN PEDRO',
    'SANTA MARIA',
    'STA. MARIA',
    'STA MARIA'
  ];

  function formatStudentName(name) {
    if (!name || typeof name !== 'string') return '';
    let n = name.trim().toUpperCase();
    if (n.includes(',')) {
      // Normalize spacing around comma: "SURNAME, FIRSTNAME MIDDLE"
      const [last, ...rest] = n.split(',');
      return `${last.trim()}, ${rest.join(' ').trim()}`;
    }

    // Check if it starts with a compound surname prefix (e.g. "DELA CRUZ JUAN MIGUEL")
    for (const cp of COMPOUND_SURNAME_PREFIXES) {
      if (n.startsWith(cp + ' ')) {
        return `${cp}, ${n.slice(cp.length + 1).trim()}`;
      }
    }

    // Check if it ends with a compound surname (e.g. "JUAN MIGUEL DELA CRUZ")
    for (const cp of COMPOUND_SURNAME_PREFIXES) {
      if (n.endsWith(' ' + cp)) {
        return `${cp}, ${n.slice(0, n.length - cp.length - 1).trim()}`;
      }
    }

    // Natural "Firstname Lastname" / "Firstname Middle Lastname"
    // e.g. "Marco Navarro" -> "NAVARRO, MARCO"
    // e.g. "Vic Oliver Bungabong" -> "BUNGABONG, VIC OLIVER"
    const parts = n.split(/\s+/);
    if (parts.length > 1) {
      const lastName = parts[parts.length - 1];
      const firstNames = parts.slice(0, parts.length - 1).join(' ');
      return `${lastName}, ${firstNames}`;
    }
    return n;
  }

  function bindRosterForm() {
    bindRosterControls();
    bindRosterModal();
    bindRosterImportModal();
    bindRosterViewTabs();
    bindRequestsStatusTabs();
    bindRequestsBulkActions();
  }

  function bindRosterViewTabs() {
    const masterTab = $('of-tab-roster-master');
    const reqTab = $('of-tab-roster-requests');
    const masterPane = $('of-roster-master-pane');
    const reqPane = $('of-roster-requests-pane');

    if (masterTab && reqTab) {
      masterTab.addEventListener('click', () => {
        masterTab.classList.add('active');
        reqTab.classList.remove('active');
        _rosterCurrentView = 'masterlist';
        if (masterPane) masterPane.classList.remove('hidden');
        if (reqPane) reqPane.classList.add('hidden');
      });

      reqTab.addEventListener('click', () => {
        reqTab.classList.add('active');
        masterTab.classList.remove('active');
        _rosterCurrentView = 'requests';
        if (masterPane) masterPane.classList.add('hidden');
        if (reqPane) reqPane.classList.remove('hidden');
        _selectedRequestIds.clear();
        updateBulkBar();
        loadRosterRequests();
      });
    }
  }

  function bindRequestsStatusTabs() {
    const tabsContainer = $('of-requests-status-tabs');
    if (!tabsContainer) return;

    tabsContainer.querySelectorAll('.of-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tabsContainer.querySelectorAll('.of-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _requestsStatusFilter = btn.dataset.status || 'pending';
        _selectedRequestIds.clear();
        updateBulkBar();
        loadRosterRequests();
      });
    });
  }

  function bindRequestsBulkActions() {
    const approveBtn = $('of-requests-bulk-approve-btn');
    const clearBtn = $('of-requests-bulk-clear-btn');

    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        const count = _selectedRequestIds.size;
        if (count === 0) return;

        if (!confirm(`Are you sure you want to approve ${count} student enrollment verification request(s) and add them to the officially enrolled database?`)) {
          return;
        }

        const ids = Array.from(_selectedRequestIds);
        approveBtn.disabled = true;
        const btnText = $('of-requests-bulk-btn-text');
        if (btnText) btnText.textContent = `Approving ${count}…`;

        try {
          await Api.rosterRequests.bulkApprove(ids);
          toast(`Approved and enrolled ${count} student(s) successfully!`, 'success');
          _selectedRequestIds.clear();
          if (window.Roster && window.Roster.getRoster) window.Roster.getRoster().catch(() => {});
          await loadRosterRequests(true);
          await loadRoster(true);
        } catch (err) {
          toast(`Bulk approval failed: ${err.message}`, 'error');
        } finally {
          approveBtn.disabled = false;
          if (btnText) btnText.textContent = 'Approve Selected';
          updateBulkBar();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        _selectedRequestIds.clear();
        renderRosterRequestsTable();
      });
    }
  }

  function updateBulkBar() {
    const bulkBar = $('of-requests-bulk-bar');
    const countEl = $('of-requests-selected-count');
    const btnText = $('of-requests-bulk-btn-text');
    const selectAllBox = $('of-requests-select-all');

    const pendingRequests = _allVerificationRequests.filter(r => r.status === 'pending');
    const count = _selectedRequestIds.size;

    if (bulkBar) {
      if (count > 0) {
        bulkBar.classList.remove('hidden');
      } else {
        bulkBar.classList.add('hidden');
      }
    }

    if (countEl) {
      countEl.textContent = `${count} selected`;
    }

    if (btnText) {
      btnText.textContent = `Approve Selected (${count})`;
    }

    if (selectAllBox && pendingRequests.length > 0) {
      if (count === pendingRequests.length) {
        selectAllBox.checked = true;
        selectAllBox.indeterminate = false;
      } else if (count > 0 && count < pendingRequests.length) {
        selectAllBox.checked = false;
        selectAllBox.indeterminate = true;
      } else {
        selectAllBox.checked = false;
        selectAllBox.indeterminate = false;
      }
    } else if (selectAllBox) {
      selectAllBox.checked = false;
      selectAllBox.indeterminate = false;
    }
  }

  function bindRosterControls() {
    // Search input
    const searchInput = $('of-roster-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        _rosterPage = 1;
        renderRosterTable();
      });
    }

    // Switch between Enrolled Database & Verification Requests panes
    const viewTabs = $('of-roster-view-tabs');
    if (viewTabs) {
      viewTabs.querySelectorAll('.of-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          viewTabs.querySelectorAll('.of-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const view = btn.dataset.rosterView;
          if (view === 'requests') {
            $('of-roster-master-pane')?.classList.add('hidden');
            $('of-roster-requests-pane')?.classList.remove('hidden');
            loadRosterRequests();
          } else {
            $('of-roster-requests-pane')?.classList.add('hidden');
            $('of-roster-master-pane')?.classList.remove('hidden');
            loadRoster();
          }
        });
      });
    }

    // Status Filter Tabs inside Verification Requests Pane
    const reqStatusTabs = $('of-requests-status-tabs');
    if (reqStatusTabs) {
      reqStatusTabs.querySelectorAll('.of-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          reqStatusTabs.querySelectorAll('.of-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _requestsStatusFilter = btn.dataset.status || 'pending';
          loadRosterRequests();
        });
      });
    }

    // Program Filter Tabs
    const progTabs = $('of-roster-prog-tabs');
    if (progTabs) {
      progTabs.querySelectorAll('.of-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          progTabs.querySelectorAll('.of-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _selectedRosterProg = btn.dataset.prog || '';
          _rosterPage = 1;
          renderRosterTable();
        });
      });
    }

    // Year Filter Dropdown
    const yearFilter = $('of-roster-year-filter');
    if (yearFilter) {
      yearFilter.addEventListener('change', e => {
        _selectedRosterYear = e.target.value;
        _rosterPage = 1;
        renderRosterTable();
      });
    }

    // Open Add Student Modal
    const addBtn = $('of-roster-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        openRosterModal();
      });
    }

    // Open Bulk Import CSV Modal
    const importBtn = $('of-roster-import-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        openRosterImportModal();
      });
    }

    // Export CSV
    const exportBtn = $('of-roster-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportRosterCSV);
    }
  }

  async function updateRequestsBadge() {
    const badge = $('of-roster-pending-badge');
    if (!badge || !Api.rosterRequests) return;
    try {
      const count = await Api.rosterRequests.countPending();
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    } catch {
      if (badge) badge.style.display = 'none';
    }
  }

  function updateRosterStats() {
    const total = _allRoster.length;
    const bsce = _allRoster.filter(s => s.course === 'BSCE').length;
    const bscoe = _allRoster.filter(s => s.course === 'BSCoE').length;
    const bsece = _allRoster.filter(s => s.course === 'BSECE').length;

    if ($('of-stat-val-total')) $('of-stat-val-total').textContent = total;
    if ($('of-stat-val-bsce')) $('of-stat-val-bsce').textContent = bsce;
    if ($('of-stat-sub-bsce')) $('of-stat-sub-bsce').textContent = total ? `${Math.round((bsce / total) * 100)}% of CoE` : '0% of CoE';

    if ($('of-stat-val-bscoe')) $('of-stat-val-bscoe').textContent = bscoe;
    if ($('of-stat-sub-bscoe')) $('of-stat-sub-bscoe').textContent = total ? `${Math.round((bscoe / total) * 100)}% of CoE` : '0% of CoE';

    if ($('of-stat-val-bsece')) $('of-stat-val-bsece').textContent = bsece;
    if ($('of-stat-sub-bsece')) $('of-stat-sub-bsece').textContent = total ? `${Math.round((bsece / total) * 100)}% of CoE` : '0% of CoE';
  }

  async function loadRoster(isSilent = false) {
    const container = $('of-roster-table-container');
    if (!container) return;
    if (!isSilent && !_loaded.roster) {
      container.innerHTML = skeletonStack(3);
    }

    try {
      _allRoster = await Api.roster.list();
      updateRosterStats();
      renderRosterTable();
      updateRequestsBadge();
    } catch (err) {
      container.innerHTML = `<div class="of-error">Failed to load enrolled roster: ${esc(err.message)}</div>`;
    }
  }

  async function loadRosterRequests(isSilent = false) {
    const container = $('of-roster-requests-table-container');
    if (!container) return;
    if (!isSilent) {
      container.innerHTML = skeletonStack(2);
    }

    try {
      _allVerificationRequests = await Api.rosterRequests.list(_requestsStatusFilter);
      renderRosterRequestsTable();
      updateRequestsBadge();
    } catch (err) {
      container.innerHTML = `<div class="of-error">Failed to load verification requests: ${esc(err.message)}</div>`;
    }
  }

  function renderRosterRequestsTable() {
    const container = $('of-roster-requests-table-container');
    if (!container) return;

    const pendingRequests = _allVerificationRequests.filter(r => r.status === 'pending');

    if (_allVerificationRequests.length === 0) {
      _selectedRequestIds.clear();
      updateBulkBar();
      container.innerHTML = `<p style="font-size:0.85rem;color:var(--text-secondary);padding:2rem 1rem;text-align:center;">No ${_requestsStatusFilter === 'all' ? '' : _requestsStatusFilter} verification requests found.</p>`;
      return;
    }

    // Retain only IDs that are still in pendingRequests
    const pendingIds = new Set(pendingRequests.map(r => r.id));
    for (const id of _selectedRequestIds) {
      if (!pendingIds.has(id)) _selectedRequestIds.delete(id);
    }

    let html = `
      <div class="of-table-wrap">
        <table class="of-table">
          <thead>
            <tr>
              <th class="of-col-check">
                ${pendingRequests.length > 0 ? `
                  <input type="checkbox" id="of-requests-select-all" class="of-check-input" title="Select all pending requests" />
                ` : ''}
              </th>
              <th style="min-width:180px;">Student Name</th>
              <th>CJC GSuite Email</th>
              <th>Program &amp; Year</th>
              <th>Date Requested</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    _allVerificationRequests.forEach(req => {
      const displayName = formatStudentName(req.full_name);
      let statusBadge = '';
      if (req.status === 'pending') {
        statusBadge = '<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);font-size:0.72rem;">Pending Review</span>';
      } else if (req.status === 'approved') {
        statusBadge = '<span class="badge" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3);font-size:0.72rem;">Approved</span>';
      } else {
        statusBadge = '<span class="badge" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);font-size:0.72rem;">Rejected</span>';
      }

      const dateStr = req.created_at ? new Date(req.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      const notesHtml = req.notes ? `<div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:2px;">Note: ${esc(req.notes)}</div>` : '';

      let actionsHtml = '';
      let checkColHtml = '';

      if (req.status === 'pending') {
        const isChecked = _selectedRequestIds.has(req.id);
        checkColHtml = `
          <input type="checkbox" class="of-check-input of-request-checkbox" data-id="${req.id}" data-name="${esc(displayName)}" ${isChecked ? 'checked' : ''} aria-label="Select ${esc(displayName)}" />
        `;
        actionsHtml = `
          <button type="button" class="of-btn of-btn-primary approve-req-btn" data-id="${req.id}" data-name="${esc(displayName)}" style="padding:0.25rem 0.6rem;font-size:0.8rem;margin-right:0.35rem;">
            <iconify-icon icon="solar:check-circle-linear"></iconify-icon> Approve
          </button>
          <button type="button" class="of-btn of-btn-ghost reject-req-btn" data-id="${req.id}" data-name="${esc(displayName)}" style="color:var(--col-danger);padding:0.25rem 0.5rem;font-size:0.8rem;">
            <iconify-icon icon="solar:close-circle-linear"></iconify-icon> Reject
          </button>
        `;
      } else {
        checkColHtml = `<span style="color:var(--text-tertiary);font-size:0.75rem;">—</span>`;
        actionsHtml = `<span style="font-size:0.78rem;color:var(--text-tertiary);">${req.reviewed_at ? 'Reviewed' : 'Completed'}</span>`;
      }

      html += `
        <tr class="${_selectedRequestIds.has(req.id) ? 'of-row-selected' : ''}">
          <td class="of-col-check">
            ${checkColHtml}
          </td>
          <td>
            <div style="font-weight:600;color:var(--text-primary);font-size:0.86rem;">${esc(displayName)}</div>
            ${notesHtml}
          </td>
          <td><span style="font-size:0.82rem;color:var(--text-secondary);">${esc(req.email || '—')}</span></td>
          <td>
            <span class="badge" style="background:var(--bg-surface-raised);color:var(--text-primary);border:1px solid var(--border-default);font-size:0.74rem;font-weight:600;padding:2px 6px;border-radius:4px;">${esc(req.course)}</span>
            <span style="font-size:0.8rem;color:var(--text-secondary);margin-left:0.25rem;">Year ${esc(req.year_level)}</span>
          </td>
          <td><span style="font-size:0.8rem;color:var(--text-secondary);">${dateStr}</span></td>
          <td>${statusBadge}</td>
          <td style="text-align:right;white-space:nowrap;">
            ${actionsHtml}
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
    updateBulkBar();

    // Select-all checkbox listener
    const selectAllBox = $('of-requests-select-all');
    if (selectAllBox) {
      selectAllBox.addEventListener('change', () => {
        if (selectAllBox.checked) {
          pendingRequests.forEach(r => _selectedRequestIds.add(r.id));
        } else {
          _selectedRequestIds.clear();
        }
        renderRosterRequestsTable();
      });
    }

    // Row checkbox listeners
    container.querySelectorAll('.of-request-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (cb.checked) {
          _selectedRequestIds.add(id);
        } else {
          _selectedRequestIds.delete(id);
        }
        updateBulkBar();
        cb.closest('tr')?.classList.toggle('of-row-selected', cb.checked);
      });
    });

    // Attach approve / reject click events
    container.querySelectorAll('.approve-req-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (!confirm(`Approve verification request for "${name}" and add to official enrolled roster?`)) return;

        btn.disabled = true;
        btn.textContent = 'Approving…';

        try {
          const formatted = formatStudentName(name);
          await Api.rosterRequests.approve(id, formatted);
          toast(`Approved "${formatted}" and added to officially enrolled database!`, 'success');
          if (window.Roster && window.Roster.getRoster) window.Roster.getRoster().catch(() => {});
          await loadRosterRequests(true);
          await loadRoster(true);
        } catch (err) {
          toast(`Failed to approve request: ${err.message}`, 'error');
          btn.disabled = false;
          btn.innerHTML = '<iconify-icon icon="solar:check-circle-linear"></iconify-icon> Approve';
        }
      });
    });

    container.querySelectorAll('.reject-req-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const reason = prompt(`Optional reason for rejecting "${name}":`);
        if (reason === null) return; // User cancelled

        btn.disabled = true;
        btn.textContent = 'Rejecting…';

        try {
          await Api.rosterRequests.reject(id, reason);
          toast(`Rejected verification request for "${name}".`, 'info');
          await loadRosterRequests(true);
        } catch (err) {
          toast(`Failed to reject request: ${err.message}`, 'error');
          btn.disabled = false;
          btn.innerHTML = '<iconify-icon icon="solar:close-circle-linear"></iconify-icon> Reject';
        }
      });
    });
  }

  function getFilteredRoster() {
    const query = $('of-roster-search')?.value.toLowerCase().trim() || '';
    return _allRoster.filter(s => {
      const matchName = !query || s.full_name.toLowerCase().includes(query);
      const matchProg = !_selectedRosterProg || s.course === _selectedRosterProg;
      const matchYear = !_selectedRosterYear || String(s.year_level) === String(_selectedRosterYear);
      return matchName && matchProg && matchYear;
    });
  }

  function renderRosterTable() {
    const container = $('of-roster-table-container');
    const paginationEl = $('of-roster-pagination');
    if (!container) return;

    const filtered = getFilteredRoster();

    if (filtered.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-secondary);padding:2rem 1rem;text-align:center;">No enrolled students found matching your search or filters.</p>';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    // Pagination calculations
    const totalPages = Math.ceil(filtered.length / _rosterPerPage) || 1;
    if (_rosterPage > totalPages) _rosterPage = totalPages;
    if (_rosterPage < 1) _rosterPage = 1;

    const startIndex = (_rosterPage - 1) * _rosterPerPage;
    const endIndex = Math.min(startIndex + _rosterPerPage, filtered.length);
    const pageItems = filtered.slice(startIndex, endIndex);

    let html = `
      <div class="of-table-wrap">
        <table class="of-table">
          <thead>
            <tr>
              <th style="min-width:180px;">Student Full Name</th>
              <th>Gender</th>
              <th>Program</th>
              <th>Year Level</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    pageItems.forEach(student => {
      const displayName = formatStudentName(student.full_name);
      const genderText = student.sex === 'F' ? 'Female' : 'Male';
      const yrLabel = `${student.year_level}${student.year_level === '1' ? 'st' : student.year_level === '2' ? 'nd' : student.year_level === '3' ? 'rd' : 'th'} Year`;

      html += `
        <tr>
          <td>
            <div style="font-weight:600; color:var(--text-primary); font-size:0.86rem;">${esc(displayName)}</div>
          </td>
          <td style="color:var(--text-secondary); font-size:0.82rem;">${genderText}</td>
          <td><span class="badge" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border-default); font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:4px; letter-spacing:0.02em;">${esc(student.course)}</span></td>
          <td><span style="font-size:0.82rem; color:var(--text-secondary); font-weight:500;">${yrLabel}</span></td>
          <td style="text-align:right; white-space:nowrap;">
            <button type="button" class="of-btn of-btn-ghost edit-roster-btn" data-id="${student.id}" style="padding:0.25rem 0.55rem; font-size:0.8rem; margin-right:0.25rem;" title="Edit Student">
              <iconify-icon icon="solar:pen-2-linear"></iconify-icon> Edit
            </button>
            <button type="button" class="of-btn of-btn-ghost delete-roster-btn" data-id="${student.id}" data-name="${esc(student.full_name)}" style="color:var(--text-tertiary); padding:0.25rem 0.45rem; font-size:0.85rem;" title="Delete Student">
              <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
            </button>
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;

    // Attach row events
    container.querySelectorAll('.edit-roster-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const student = _allRoster.find(s => s.id === btn.dataset.id);
        if (student) openRosterModal(student);
      });
    });

    container.querySelectorAll('.delete-roster-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (!confirm(`Are you sure you want to remove "${name}" from the official enrolled roster?`)) return;

        try {
          await Api.roster.delete(id);
          toast(`Removed "${name}" from enrolled roster.`, 'info');
          if (window.Roster && window.Roster.getRoster) window.Roster.getRoster().catch(() => {});
          await loadRoster(true);
        } catch (err) {
          toast(`Failed to delete student: ${err.message}`, 'error');
        }
      });
    });

    // Render Pagination Bar
    if (paginationEl) {
      let pageButtons = '';
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - _rosterPage) <= 1) {
          pageButtons += `
            <button type="button" class="of-btn ${i === _rosterPage ? 'of-btn-primary' : 'of-btn-ghost'} roster-page-btn" data-page="${i}" style="padding:0.25rem 0.65rem; min-width:30px; font-size:0.8rem;">
              ${i}
            </button>
          `;
        } else if (i === _rosterPage - 2 || i === _rosterPage + 2) {
          pageButtons += '<span style="color:var(--text-tertiary);padding:0 2px;">…</span>';
        }
      }

      paginationEl.innerHTML = `
        <div style="font-size:0.8rem; color:var(--text-secondary);">
          Showing <strong style="color:var(--text-primary);">${startIndex + 1}–${endIndex}</strong> of <strong style="color:var(--text-primary);">${filtered.length}</strong> students
        </div>
        <div style="display:flex; gap:0.35rem; align-items:center;">
          <button type="button" class="of-btn of-btn-ghost" id="of-roster-prev-btn" style="padding:0.25rem 0.6rem; font-size:0.8rem;" ${_rosterPage <= 1 ? 'disabled' : ''}>
            <iconify-icon icon="solar:alt-arrow-left-linear"></iconify-icon> Prev
          </button>
          ${pageButtons}
          <button type="button" class="of-btn of-btn-ghost" id="of-roster-next-btn" style="padding:0.25rem 0.6rem; font-size:0.8rem;" ${_rosterPage >= totalPages ? 'disabled' : ''}>
            Next <iconify-icon icon="solar:alt-arrow-right-linear"></iconify-icon>
          </button>
        </div>
      `;

      $('of-roster-prev-btn')?.addEventListener('click', () => {
        if (_rosterPage > 1) {
          _rosterPage--;
          renderRosterTable();
        }
      });
      $('of-roster-next-btn')?.addEventListener('click', () => {
        if (_rosterPage < totalPages) {
          _rosterPage++;
          renderRosterTable();
        }
      });
      paginationEl.querySelectorAll('.roster-page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _rosterPage = Number(btn.dataset.page);
          renderRosterTable();
        });
      });
    }
  }

  // ---------- Single Student Modal (Add & Edit) ----------

  function bindRosterModal() {
    const form = $('of-roster-modal-form');
    const cancelBtn = $('of-roster-modal-cancel');
    const modal = $('of-roster-modal');

    Dropdowns.bindAll('#of-roster-modal');

    function closeModal() {
      if (modal) modal.classList.add('hidden');
      if (form) form.reset();
      Dropdowns.syncAll();
      document.body.classList.remove('modal-open');
    }

    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
      });
    }

    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const errEl = $('of-modal-roster-error');
        const submitBtn = $('of-roster-modal-submit');
        const id = $('of-roster-edit-id')?.value;
        const name = $('of-modal-roster-name')?.value.trim();
        const sex = $('of-modal-roster-sex')?.value;
        const course = $('of-modal-roster-course')?.value;
        const year = $('of-modal-roster-year')?.value;

        if (errEl) errEl.classList.add('hidden');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving…';
        }

        try {
          if (!name || !course || !year) throw new Error('Please fill in all required fields.');

          const formattedName = formatStudentName(name);

          if (id) {
            await Api.roster.update(id, { full_name: formattedName, sex, course, year_level: year });
            toast(`Updated record for "${formattedName}".`, 'success');
          } else {
            await Api.roster.create({ full_name: formattedName, sex, course, year_level: year });
            toast(`Added "${formattedName}" to enrolled roster!`, 'success');
          }

          if (window.Roster && window.Roster.getRoster) window.Roster.getRoster().catch(() => {});
          closeModal();
          await loadRoster(true);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Failed to save student.';
            errEl.classList.remove('hidden');
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Student';
          }
        }
      });
    }
  }

  function openRosterModal(student = null) {
    const modal = $('of-roster-modal');
    if (!modal) return;
    const title = $('of-roster-modal-title');
    const idInput = $('of-roster-edit-id');
    const nameInput = $('of-modal-roster-name');
    const sexSelect = $('of-modal-roster-sex');
    const courseSelect = $('of-modal-roster-course');
    const yearSelect = $('of-modal-roster-year');
    const errEl = $('of-modal-roster-error');

    if (errEl) errEl.classList.add('hidden');

    if (student) {
      if (title) title.innerHTML = '<iconify-icon icon="solar:pen-2-bold" style="color:var(--accent);"></iconify-icon> Edit Enrolled Student';
      if (idInput) idInput.value = student.id;
      if (nameInput) nameInput.value = formatStudentName(student.full_name);
      if (sexSelect) sexSelect.value = student.sex || 'M';
      if (courseSelect) courseSelect.value = student.course || 'BSCE';
      if (yearSelect) yearSelect.value = student.year_level || '1';
    } else {
      if (title) title.innerHTML = '<iconify-icon icon="solar:user-plus-bold" style="color:var(--accent);"></iconify-icon> Add Enrolled Student';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (sexSelect) sexSelect.value = 'M';
      if (courseSelect) courseSelect.value = 'BSCE';
      if (yearSelect) yearSelect.value = '1';
    }

    Dropdowns.bindAll('#of-roster-modal');
    Dropdowns.syncAll();

    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    nameInput?.focus();
  }

  // ---------- Bulk CSV Import Modal ----------

  function bindRosterImportModal() {
    const modal = $('of-roster-import-modal');
    const closeBtn = $('of-import-modal-close');
    const cancelBtn = $('of-import-cancel-btn');
    const dropzone = $('of-import-dropzone');
    const fileInput = $('of-import-file-input');
    const confirmBtn = $('of-import-confirm-btn');

    const closeModal = () => {
      modal?.classList.add('hidden');
      _importedRosterBatch = [];
      if (fileInput) fileInput.value = '';
      $('of-import-preview-area')?.classList.add('hidden');
      $('of-import-error')?.classList.add('hidden');
      if (confirmBtn) confirmBtn.disabled = true;
      document.body.classList.remove('modal-open');
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
      });
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--accent)';
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'var(--border-hover)';
      });
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border-hover)';
        if (e.dataTransfer.files?.length) {
          handleRosterCSVFile(e.dataTransfer.files[0]);
        }
      });
      fileInput.addEventListener('change', e => {
        if (e.target.files?.length) {
          handleRosterCSVFile(e.target.files[0]);
        }
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (!_importedRosterBatch.length) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = `Importing ${_importedRosterBatch.length} Students…`;

        try {
          await Api.roster.bulkCreate(_importedRosterBatch);
          toast(`Successfully imported ${_importedRosterBatch.length} students into master roster!`, 'success');
          if (window.Roster && window.Roster.getRoster) window.Roster.getRoster().catch(() => {});
          closeModal();
          await loadRoster(true);
        } catch (err) {
          const errEl = $('of-import-error');
          if (errEl) {
            errEl.textContent = err.message || 'Failed to bulk import roster.';
            errEl.classList.remove('hidden');
          }
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Import Students';
        }
      });
    }
  }

  function openRosterImportModal() {
    const modal = $('of-roster-import-modal');
    if (!modal) return;
    $('of-import-preview-area')?.classList.add('hidden');
    $('of-import-error')?.classList.add('hidden');
    const confirmBtn = $('of-import-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function handleRosterCSVFile(file) {
    const errEl = $('of-import-error');
    if (errEl) errEl.classList.add('hidden');

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        let rows = [];
        if (window.Papa) {
          const parsed = Papa.parse(text, { skipEmptyLines: true });
          rows = parsed.data || [];
        } else {
          rows = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(l => l.split(','));
        }
        if (rows.length < 2) throw new Error('CSV file appears empty or missing header row.');

        const headers = rows[0].map(h => String(h || '').trim().toLowerCase().replace(/[^a-z]/g, ''));
        const nameIdx = headers.findIndex(h => h.includes('name'));
        const sexIdx = headers.findIndex(h => h.includes('sex') || h.includes('gender'));
        const courseIdx = headers.findIndex(h => h.includes('course') || h.includes('program'));
        const yearIdx = headers.findIndex(h => h.includes('year') || h.includes('level'));

        if (nameIdx === -1 || courseIdx === -1 || yearIdx === -1) {
          throw new Error('CSV must contain headers for Name, Course (Program), and Year.');
        }

        const records = [];
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].map(c => String(c || '').trim());
          const rawName = cols[nameIdx];
          if (!rawName) continue;

          let course = (cols[courseIdx] || 'BSCE').toUpperCase();
          if (!['BSCE', 'BSCOE', 'BSECE'].includes(course)) {
            if (course.includes('CIVIL')) course = 'BSCE';
            else if (course.includes('COMP')) course = 'BSCoE';
            else if (course.includes('ELEC')) course = 'BSECE';
            else course = 'BSCE';
          }
          if (course === 'BSCOE') course = 'BSCoE';

          let year = (cols[yearIdx] || '1').replace(/[^0-9]/g, '');
          if (!year) year = '1';

          let sex = sexIdx !== -1 ? (cols[sexIdx] || 'M').toUpperCase()[0] : 'M';
          if (sex !== 'F' && sex !== 'M') sex = 'M';

          records.push({
            full_name: formatStudentName(rawName),
            sex,
            department: 'CoE',
            course,
            year_level: year
          });
        }

        if (!records.length) throw new Error('No valid student records found in CSV.');

        _importedRosterBatch = records;

        // Show preview
        $('of-import-summary').textContent = `✓ Found ${records.length} student records ready to import:`;
        const tbody = $('of-import-preview-table')?.querySelector('tbody');
        if (tbody) {
          tbody.innerHTML = records.slice(0, 5).map(r => `
            <tr>
              <td><strong>${esc(r.full_name)}</strong></td>
              <td>${r.sex}</td>
              <td><span class="badge" style="background:var(--bg-surface-raised); border:1px solid var(--border-default);">${esc(r.course)}</span></td>
              <td>Year ${r.year_level}</td>
            </tr>
          `).join('');
          if (records.length > 5) {
            tbody.innerHTML += `<tr><td colspan="4" style="text-align:center; color:var(--text-tertiary); font-size:0.75rem;">… and ${records.length - 5} more students</td></tr>`;
          }
        }

        $('of-import-preview-area')?.classList.remove('hidden');
        const confirmBtn = $('of-import-confirm-btn');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Import ${records.length} Students`;
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Failed to parse CSV file.';
          errEl.classList.remove('hidden');
        }
      }
    };
    reader.readAsText(file);
  }

  function exportRosterCSV() {
    const list = getFilteredRoster();
    if (!list.length) {
      toast('No enrolled students to export.', 'info');
      return;
    }

    let csvContent = 'Name,Sex,Department,Course,Year\n';
    list.forEach(s => {
      const formatted = formatStudentName(s.full_name);
      const safeName = `"${formatted.replace(/"/g, '""')}"`;
      csvContent += `${safeName},${s.sex || 'M'},CoE,${s.course},${s.year_level}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `coe_enrolled_roster_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast(`Exported ${list.length} student records as CSV!`, 'success');
  }

  // ---------- Start ----------

  document.addEventListener('DOMContentLoaded', boot);

  return { boot };
})();
