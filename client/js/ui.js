// =============================================
// ui.js - Shared UI Utilities
// =============================================

const UI = (() => {

  // ---- Navigation ----
  function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const view = document.getElementById(`view-${viewId}`);
    const nav  = document.getElementById(`nav-${viewId}`);

    if (view) view.classList.add('active');
    if (nav)  nav.classList.add('active');

    // Remember the last navigable view so a page refresh returns the user
    // here instead of resetting to the dashboard. Sub-views that need their
    // own state (e.g. event-detail) are not stored.
    const NAV_VIEWS = ['dashboard', 'events', 'transactions', 'income', 'reports', 'units', 'admin'];
    if (NAV_VIEWS.includes(viewId)) {
      try { sessionStorage.setItem('lastView', viewId); } catch { /* storage unavailable */ }
    }
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`${screenId}-screen`);
    if (screen) screen.classList.add('active');

    // If switching to auth, strip all admin privileges and app state
    if (screenId === 'auth') {
      setAdminVisibility(false);
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    }

    // Show bottom nav only when app is active (mobile only via CSS)
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) bottomNav.classList.toggle('visible', screenId === 'app');
  }

  // Shape the boot splash skeleton to match the view being loaded, so a
  // refresh on Units doesn't show a dashboard-shaped skeleton.
  function setSplashView(view) {
    const splash = document.getElementById('splash-screen');
    if (!splash) return;
    const shape = view === 'units'
      ? 'units'
      : (['events', 'transactions', 'income', 'admin'].includes(view) ? 'list' : 'default');
    splash.classList.remove('splash-view-units', 'splash-view-list', 'splash-view-default');
    splash.classList.add(`splash-view-${shape}`);
  }

  // ---- Toast Notifications ----
  let toastTimer = null;

  function toast(message, type = 'success') {
    const toastEl  = document.getElementById('toast');
    const iconEl   = document.getElementById('toast-icon');
    const msgEl    = document.getElementById('toast-message');

    const icons = { 
      success: 'solar:check-circle-linear', 
      error: 'solar:close-circle-linear', 
      info: 'solar:info-circle-linear', 
      warning: 'solar:danger-triangle-linear' 
    };
    
    const iconName = icons[type] || 'solar:check-circle-linear';
    iconEl.innerHTML = `<iconify-icon icon="${iconName}" style="font-size:18px;"></iconify-icon>`;
    msgEl.textContent = message;
    
    toastEl.classList.remove('hidden');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
  }

  // ---- Formatters ----
  function currency(amount) {
    return '₱' + Number(amount || 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function dateStr(dateString) {
    if (!dateString) return '-';
    const match = String(dateString).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(year, month, day).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila'
      });
    }
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila'
    });
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function renderStatusBadge(type) {
    const cleanType = type.toLowerCase();
    return `<span class="status-badge"><span class="status-dot status-dot--${cleanType}"></span><span class="status-label">${capitalize(cleanType)}</span></span>`;
  }

  // ---- Admin-only elements ----
  function setAdminVisibility(isAdmin) {
    document.body.classList.toggle('is-admin', isAdmin);
    
    // Explicitly hide/show all protected elements
    document.querySelectorAll('.admin-only').forEach(el => {
      if (isAdmin) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
        // If an unauthorized user is currently looking at a protected view, kick them to dashboard
        if (el.classList.contains('view') && el.classList.contains('active')) {
          showView('dashboard');
        }
      }
    });
  }

  function setOfficerVisibility(isOfficer) {
    document.body.classList.toggle('is-officer', isOfficer);
    document.querySelectorAll('.officer-only').forEach(el => {
      el.classList.toggle('hidden', !isOfficer);
    });
    document.querySelectorAll('.student-only').forEach(el => {
      el.classList.toggle('hidden', isOfficer);
    });
  }

  // ---- Loading / Empty states ----
  function setLoading(containerId, text = 'Loading…') {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `
      <div class="skeleton-stack" role="status" aria-label="${text}">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
      </div>`;
  }

  function setEmpty(containerId, icon = 'solar:box-minimalistic-linear', text = 'No data available.') {
    const el = document.getElementById(containerId);
    if (el) {
      const iconAttr = icon.includes(':') ? icon : `solar:${icon}-linear`;
      el.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon"><iconify-icon icon="${iconAttr}"></iconify-icon></span>
          <p>${text}</p>
        </div>`;
    }
  }

  // Auto-hiding floating bottom navigation on scroll (Facebook / iOS approach)
  let _autoHideNavBound = false;
  function initAutoHideBottomNav() {
    const bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav || _autoHideNavBound) return;
    _autoHideNavBound = true;

    const scrollTargets = [
      document.querySelector('.main-content'),
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

    document.querySelectorAll('.bottom-nav-item, .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        bottomNav.classList.remove('nav-hidden');
      });
    });
  }

  // ---- Sliding Active Indicator (liquid pill that glides between icons) ----
  // One absolutely-positioned pill per bottom nav; instead of each item
  // painting its own background, the pill physically travels to the item
  // that just became active.
  const _navIndicatorPlaced = new WeakSet();
  const _navIndicatorBound = new WeakSet();

  function moveNavIndicator(nav) {
    if (!nav) return;
    let indicator = nav.querySelector(':scope > .nav-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'nav-indicator ' +
        (nav.id === 'of-bottom-nav' ? 'of-bottom-nav-indicator' : 'bottom-nav-indicator');
      indicator.setAttribute('aria-hidden', 'true');
      nav.prepend(indicator);
      nav.classList.add('has-nav-indicator');
    }
    const target = Array.from(nav.children).find(el => el !== indicator && el.classList.contains('active'));
    if (!target) return;
    const x = target.offsetLeft;
    const w = target.offsetWidth;
    if (!w) return; // nav not laid out yet (hidden screen / desktop) — retry on next call
    const firstPlacement = !_navIndicatorPlaced.has(nav);
    if (firstPlacement) {
      // Land instantly on the resting pill so the first reveal doesn't slide in from the edge
      indicator.style.transition = 'none';
    }
    indicator.style.width = `${w}px`;
    indicator.style.transform = `translateX(${x}px)`;
    if (firstPlacement) {
      void indicator.offsetWidth; // flush styles so the next move animates
      indicator.style.transition = '';
      _navIndicatorPlaced.add(nav);
    }
  }

  function initNavIndicators() {
    [document.getElementById('bottom-nav'), document.getElementById('of-bottom-nav')]
      .filter(Boolean)
      .forEach(nav => {
        moveNavIndicator(nav);
        if (!_navIndicatorBound.has(nav)) {
          _navIndicatorBound.add(nav);
          window.addEventListener('resize', () => moveNavIndicator(nav));
        }
      });
  }

  // Keeps the browser/OS chrome color (PWA theme-color meta) in step with the theme
  function syncThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B0F14' : '#F8FAFC');
  }

  // Auto-bind scroll on DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAutoHideBottomNav);
      document.addEventListener('DOMContentLoaded', initNavIndicators);
    } else {
      setTimeout(initAutoHideBottomNav, 100);
      setTimeout(initNavIndicators, 100);
    }
  }

  return { showView, showScreen, setSplashView, toast, currency, dateStr, capitalize, renderStatusBadge, setAdminVisibility, setOfficerVisibility, setLoading, setEmpty, syncThemeColor, initAutoHideBottomNav, moveNavIndicator, initNavIndicators };
})();
