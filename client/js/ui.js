// =============================================
// ui.js - Shared UI Utilities
// =============================================

const UI = (() => {

  // ---- Navigation ----
  // Related views share one sidebar entry and switch through pill tabs
  // inside the view. The nav entry carries data-group; the tabs carry
  // data-view. Every view keeps its own id, loader and markup.
  const VIEW_GROUPS = {
    money:     ['transactions', 'income', 'reports'],
    updates:   ['announcements', 'notifications'],
    academics: ['units', 'enrollment']
  };

  function groupOf(viewId) {
    return Object.keys(VIEW_GROUPS).find(g => VIEW_GROUPS[g].includes(viewId)) || null;
  }

  function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const view = document.getElementById(`view-${viewId}`);
    const nav  = document.getElementById(`nav-${viewId}`);

    if (view) view.classList.add('active');
    if (nav)  nav.classList.add('active');

    const group = groupOf(viewId);
    if (group) {
      document.querySelectorAll(`.nav-item[data-group="${group}"]`).forEach(n => n.classList.add('active'));
    }

    // Remember the last navigable view so a page refresh returns the user
    // here instead of resetting to the dashboard. Sub-views that need their
    // own state (e.g. event-detail) are not stored.
    const NAV_VIEWS = ['dashboard', 'events', 'transactions', 'income', 'reports', 'units', 'enrollment', 'admin', 'announcements', 'notifications'];
    if (NAV_VIEWS.includes(viewId)) {
      try { sessionStorage.setItem('lastView', viewId); } catch { /* storage unavailable */ }
    }
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`${screenId}-screen`);
    if (screen) screen.classList.add('active');

    // The auth screen is a scrolling document, the app screen a fixed-height shell. A leftover
    // scroll offset or an open keyboard from the login form would show as a band under the shell.
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    window.scrollTo(0, 0);
    // Installed iOS PWA: the keyboard that was open on the login form leaves the layout
    // viewport short until something forces a re-measure. Sync now and again once the
    // keyboard dismissal animation has finished.
    syncViewportHeight();
    setTimeout(kickViewportRelayout, 50);
    setTimeout(() => { syncViewportHeight(); kickViewportRelayout(); }, 450);

    // If switching to auth, strip all admin privileges and app state, lock theme-color to dark
    if (screenId === 'auth') {
      setAdminVisibility(false);
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      syncThemeColor('dark');
    } else if (screenId === 'app') {
      const currentTheme = localStorage.getItem('theme') || 'dark';
      syncThemeColor(currentTheme);
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

  // Escapes a value for safe interpolation into HTML text or a quoted attribute.
  // Every database-sourced string rendered through innerHTML must pass through this.
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function renderStatusBadge(type) {
    const cleanType = String(type || '').toLowerCase();
    return `<span class="status-badge"><span class="status-dot status-dot--${esc(cleanType)}"></span><span class="status-label">${esc(capitalize(cleanType))}</span></span>`;
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

          // Do not reveal bottom nav if Grizz AI assistant or mobile more drawer is open
          if (document.body.classList.contains('ursa-open') || document.body.classList.contains('more-sheet-open')) {
            ticking = false;
            return;
          }

          const launcher = document.getElementById('ursa-launcher-btn');
          if (currentScrollTop <= 25 || isAtBottom) {
            // At the top OR reached the bottom -> Always reveal floating bottom nav and launcher!
            bottomNav.classList.remove('nav-hidden');
            if (launcher) launcher.classList.remove('launcher-hidden');
          } else if (diff > HIDE_THRESHOLD) {
            // Scrolling DOWN -> Hide floating nav and launcher for unobstructed view
            bottomNav.classList.add('nav-hidden');
            if (launcher) launcher.classList.add('launcher-hidden');
          } else if (diff < -SHOW_THRESHOLD) {
            // Scrolling UP -> Reveal floating nav and launcher
            bottomNav.classList.remove('nav-hidden');
            if (launcher) launcher.classList.remove('launcher-hidden');
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
        const launcher = document.getElementById('ursa-launcher-btn');
        if (launcher) launcher.classList.remove('launcher-hidden');
      });
    });
  }

  // Clean nav indicator handler: indicator pill removed, only the icon is orange on click
  function moveNavIndicator(nav, previewTarget) {
    if (!nav) return;
    const indicator = nav.querySelector(':scope > .nav-indicator');
    if (indicator) indicator.remove();
    nav.classList.remove('has-nav-indicator');
  }

  function initNavIndicators() {
    [document.getElementById('bottom-nav'), document.getElementById('of-bottom-nav')]
      .filter(Boolean)
      .forEach(nav => {
        const indicator = nav.querySelector(':scope > .nav-indicator');
        if (indicator) indicator.remove();
        nav.classList.remove('has-nav-indicator');
      });
  }

  // Keeps the browser/OS chrome color (PWA theme-color meta) in step with the theme
  function syncThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#141416' : '#F4F5F7');
  }

  // iOS standalone PWA quirk (iPhone home-indicator devices): the first layout
  // can be computed against a stale viewport height, leaving a phantom gap at
  // the very bottom of the screen until the user interacts. Nudge WebKit to
  // re-measure shortly after launch and whenever the app becomes visible again.
  // The shell's height on phones is var(--vvh), the visual viewport height measured by
  // the browser itself, which is the only value iOS standalone keeps correct across
  // keyboard open and close, rotation and the stale first layout. Falls back to 100%.
  function syncViewportHeight() {
    const vv = window.visualViewport;
    const h = vv && vv.height ? vv.height : window.innerHeight;
    if (h > 0) document.documentElement.style.setProperty('--vvh', Math.round(h) + 'px');
  }

  function kickViewportRelayout() {
    const body = document.body;
    if (!body) return;
    body.style.setProperty('min-height', 'calc(100dvh + 1px)', 'important');
    // setTimeout instead of rAF: rAF is suspended in occluded tabs, and this
    // must also run when the PWA window is restored from the background
    setTimeout(() => {
      body.style.removeProperty('min-height');
      window.dispatchEvent(new Event('resize'));
    }, 30);
  }

  // Keyboard model for the pill tab tracks (WAI-ARIA tabs): arrow keys move
  // between the tabs of the focused track and activate the target, Home and
  // End jump to the ends. Activation reuses each tab's own click handler, so
  // the student and officer portals need no extra wiring.
  function initTabKeys() {
    if (_tabKeysBound) return;
    _tabKeysBound = true;
    document.addEventListener('keydown', e => {
      const tab = e.target.closest && e.target.closest('.view-tabs .view-tab');
      if (!tab) return;
      const tabs = Array.from(tab.parentElement.querySelectorAll('.view-tab'));
      const i = tabs.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      // A link tab (Career Passport) only takes focus; Enter follows it.
      if (next.tagName === 'A') { next.focus(); return; }
      next.click();
      // The track lives inside the view it belongs to, so after the switch
      // the pressed tab is hidden: focus its twin in the view now showing.
      const key = next.dataset.view ? `[data-view="${next.dataset.view}"]` : `[data-of="${next.dataset.of}"]`;
      requestAnimationFrame(() => {
        const twin = document.querySelector(`.view.active .view-tabs .view-tab${key}, .of-view.active .view-tabs .view-tab${key}`);
        (twin || next).focus();
      });
    });
  }
  let _tabKeysBound = false;

  // Auto-bind scroll on DOM ready
  if (typeof document !== 'undefined') {
    initTabKeys();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAutoHideBottomNav);
      document.addEventListener('DOMContentLoaded', initNavIndicators);
      document.addEventListener('DOMContentLoaded', () => setTimeout(kickViewportRelayout, 350));
    } else {
      setTimeout(initAutoHideBottomNav, 100);
      setTimeout(initNavIndicators, 100);
      setTimeout(kickViewportRelayout, 350);
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(kickViewportRelayout, 150);
    });
    window.addEventListener('pageshow', e => { if (e.persisted) kickViewportRelayout(); });
    syncViewportHeight();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportHeight);
      window.visualViewport.addEventListener('scroll', syncViewportHeight);
    }
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', () => setTimeout(syncViewportHeight, 100));
    window.addEventListener('pageshow', syncViewportHeight);
  }

  // ---- Accessible dialog behaviour ----
  // Moves focus into `container`, keeps Tab inside it, closes on Escape and
  // returns focus to whatever was focused before. Returns { close, release }:
  // close() runs onClose (default: remove the container), release() only
  // detaches the keyboard handling and restores focus (use after a success
  // path that removes the dialog itself).
  function trapDialog(container, { initialFocus = null, onClose = null } = {}) {
    const previous = document.activeElement;
    const focusable = () => [...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null);

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    let released = false;
    function release() {
      if (released) return;
      released = true;
      container.removeEventListener('keydown', onKey);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    }
    function close() {
      release();
      if (onClose) onClose(); else container.remove();
    }

    container.addEventListener('keydown', onKey);
    const target = (typeof initialFocus === 'string' ? container.querySelector(initialFocus) : initialFocus) || focusable()[0];
    if (target) target.focus();
    return { close, release };
  }

  // Accessible replacement for window.confirm / window.prompt.
  // Resolves to true (confirm), the trimmed reason (when `reason` is set) or
  // false (cancel / Escape). Text options are rendered with textContent.
  function confirmDialog({
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    reason = null, // { label, placeholder, required, minLength }
  } = {}) {
    return new Promise(resolve => {
      const uid = `ui-confirm-${Date.now()}`;
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="${uid}-title" aria-describedby="${uid}-text">
          <h3 class="modal-title${danger ? ' is-danger' : ''}" id="${uid}-title"></h3>
          <p class="modal-text" id="${uid}-text"></p>
          ${reason ? `
          <div class="form-group">
            <label for="${uid}-reason"></label>
            <input id="${uid}-reason" type="text" aria-describedby="${uid}-error" />
          </div>` : ''}
          <div class="auth-error hidden" id="${uid}-error" role="alert"></div>
          <div class="modal-actions">
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm"></button>
            <button type="button" class="btn btn-ghost" data-action="cancel"></button>
          </div>
        </div>`;
      overlay.querySelector(`#${uid}-title`).textContent = title;
      overlay.querySelector(`#${uid}-text`).textContent = message;
      overlay.querySelector('[data-action="confirm"]').textContent = confirmLabel;
      overlay.querySelector('[data-action="cancel"]').textContent = cancelLabel;
      const input = reason ? overlay.querySelector(`#${uid}-reason`) : null;
      if (input) {
        overlay.querySelector(`label[for="${uid}-reason"]`).textContent = reason.label || 'Reason';
        input.placeholder = reason.placeholder || '';
        if (reason.required) input.required = true;
      }
      document.body.appendChild(overlay);

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        overlay.remove();
        resolve(value);
      };
      const dialog = trapDialog(overlay, {
        initialFocus: input || overlay.querySelector('[data-action="cancel"]'),
        onClose: () => finish(false),
      });

      overlay.querySelector('[data-action="cancel"]').addEventListener('click', dialog.close);
      // The second click of a double-click on the trigger lands on this
      // backdrop; ignore backdrop clicks until the dialog has settled.
      const openedAt = Date.now();
      overlay.addEventListener('click', e => { if (e.target === overlay && Date.now() - openedAt > 400) dialog.close(); });
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        if (!input) { dialog.release(); finish(true); return; }
        const value = input.value.trim();
        const min = reason.minLength || (reason.required ? 1 : 0);
        if (value.length < min) {
          const errEl = overlay.querySelector(`#${uid}-error`);
          errEl.textContent = min > 1 ? `Please enter a reason (at least ${min} characters).` : 'Please enter a reason.';
          errEl.classList.remove('hidden');
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        dialog.release();
        finish(value);
      });
    });
  }

  // ---- Scrollbar Lock Management (prevents layout jump when modals open) ----
  function lockScrollbar() {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      const stickyHeaders = document.querySelectorAll('.app-mobile-header, .sticky-top');
      stickyHeaders.forEach(el => {
        el.style.paddingRight = `calc(1rem + ${scrollbarWidth}px)`;
      });
    }
    document.body.classList.add('modal-open');
  }

  function unlockScrollbar() {
    document.body.style.paddingRight = '';
    const stickyHeaders = document.querySelectorAll('.app-mobile-header, .sticky-top');
    stickyHeaders.forEach(el => {
      el.style.paddingRight = '';
    });
    document.body.classList.remove('modal-open');
  }

  return { VIEW_GROUPS, groupOf, showView, showScreen, setSplashView, toast, currency, dateStr, esc, capitalize, renderStatusBadge, setAdminVisibility, setOfficerVisibility, setLoading, setEmpty, syncThemeColor, initAutoHideBottomNav, moveNavIndicator, initNavIndicators, lockScrollbar, unlockScrollbar, trapDialog, confirmDialog };
})();
