// =============================================
// notifications.js - Real-time Contextual Notification System
// =============================================

const Notifications = (() => {
  let state = {
    total_unread: 0,
    unread_by_category: {
      events: 0,
      transactions: 0,
      reports: 0,
      announcements: 0,
      units: 0,
      system: 0
    },
    notifications: []
  };

  let isInitialized = false;
  let pollingInterval = null;
  let realtimeChannel = null;

  // The student portal exposes `Api` (api.js); the executive portal's legacy
  // helper is `API`. Use whichever this page loaded.
  function client() {
    if (typeof Api !== 'undefined' && Api.notifications) {
      return { get: () => Api.notifications.list(), read: (category) => Api.notifications.markRead(category) };
    }
    if (typeof API !== 'undefined' && API.get) {
      return { get: () => API.get('/api/notifications'), read: (category) => API.post('/api/notifications/read', { category }) };
    }
    return null;
  }

  async function fetchNotifications() {
    try {
      const api = client();
      if (!api) return;
      const data = await api.get();
      if (data && typeof data.total_unread === 'number') {
        state = data;
        updateUI();
      }
    } catch (err) {
      console.debug('[Notifications] Fetch failed:', err.message);
    }
  }

  function updateUI() {
    // 1. Update Student Portal Nav Highlights
    updateStudentNav();

    // 2. Update Executive Portal Nav Highlights
    updateExecutiveNav();
  }

  function updateStudentNav() {
    // Mapping of category to student nav item IDs
    const studentCategoryMap = {
      events: ['nav-events'],
      transactions: [],
      reports: [],
      announcements: ['bottom-nav-more-btn'],
      units: []
    };

    // Grouped sidebar entries light up when any view inside them has unread items
    const groupNavMap = {
      'nav-money': ['transactions', 'reports'],
      'nav-academics': ['units']
    };
    Object.keys(groupNavMap).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const count = groupNavMap[id].reduce((n, cat) => n + (state.unread_by_category[cat] || 0), 0);
      el.classList.toggle('has-unread', count > 0);
    });

    // The Updates entry carries the total, in the sidebar and the More sheet.
    ['nav-updates', 'bottom-nav-notifications'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('has-unread', state.total_unread > 0);
      el.setAttribute('data-unread', state.total_unread);
    });

    // Update desktop & mobile bottom nav elements
    Object.keys(studentCategoryMap).forEach(cat => {
      const unreadCount = state.unread_by_category[cat] || 0;

      // Find bottom nav item matching category
      let bottomEl = null;
      if (cat === 'announcements') {
        bottomEl = document.getElementById('bottom-nav-more-btn');
      } else {
        bottomEl = document.querySelector(`.bottom-nav-item[data-view="${cat}"]`);
      }

      if (bottomEl) {
        bottomEl.classList.toggle('has-unread', unreadCount > 0);
        bottomEl.setAttribute('data-unread', unreadCount);
      }

      // Find sidebar nav link
      const ids = studentCategoryMap[cat] || [];
      ids.forEach(id => {
        const sideEl = document.getElementById(id);
        if (sideEl) {
          sideEl.classList.toggle('has-unread', unreadCount > 0);
        }
      });

      // Pill tabs for this view (the same bar repeats in each grouped view)
      document.querySelectorAll(`.view-tab[data-view="${cat}"]`).forEach(tab => {
        tab.classList.toggle('has-unread', unreadCount > 0);
      });
    });
  }

  function updateExecutiveNav() {
    // Mapping of category to officer nav buttons
    const officerCategoryMap = {
      events: 'events',
      transactions: 'record',
      reports: 'reports',
      announcements: 'more'
    };

    const unread = state.unread_by_category;

    // Executive bottom nav buttons
    const execBottomBtns = document.querySelectorAll('.of-bottom-nav > button, .of-bottom-nav > a');
    execBottomBtns.forEach(btn => {
      const ofTarget = btn.getAttribute('data-of') || (btn.id === 'of-bottom-nav-more-btn' ? 'more' : null);
      if (!ofTarget) return;

      let isUnread = false;
      if (ofTarget === 'overview') isUnread = (unread.transactions > 0 || unread.events > 0);
      else if (ofTarget === 'record') isUnread = unread.transactions > 0;
      else if (ofTarget === 'events') isUnread = unread.events > 0;
      else if (ofTarget === 'reports') isUnread = unread.reports > 0;
      else if (ofTarget === 'more') isUnread = (unread.announcements > 0 || unread.system > 0);

      btn.classList.toggle('has-unread', isUnread);
    });

    // Executive sidebar nav buttons
    const execSideBtns = document.querySelectorAll('.of-nav .nav-item');
    execSideBtns.forEach(btn => {
      const ofTarget = btn.getAttribute('data-of');
      if (!ofTarget) return;

      let isUnread = false;
      if (ofTarget === 'overview') isUnread = (unread.transactions > 0 || unread.events > 0);
      else if (ofTarget === 'record') isUnread = unread.transactions > 0 || (btn.dataset.ofGroup === 'finance' && unread.reports > 0);
      else if (ofTarget === 'events') isUnread = unread.events > 0;
      else if (ofTarget === 'reports') isUnread = unread.reports > 0;
      else if (ofTarget === 'announcements') isUnread = unread.announcements > 0;

      btn.classList.toggle('has-unread', isUnread);
    });
  }

  async function markCategoryRead(category) {
    if (!category) return;
    
    // Immediately clear local state for instant UX responsiveness
    if (state.unread_by_category[category] > 0) {
      state.total_unread = Math.max(0, state.total_unread - state.unread_by_category[category]);
      state.unread_by_category[category] = 0;
      updateUI();
    }

    try {
      const api = client();
      if (api) await api.read(category);
    } catch (err) {
      console.debug('[Notifications] Mark read failed:', err.message);
    }
  }

  function setupViewClickListener() {
    // Student Portal View Switching Listener
    document.body.addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item, .bottom-nav-item, .view-tab');
      if (!navItem) return;

      const view = navItem.getAttribute('data-view') || navItem.id?.replace('nav-', '');
      if (!view) return;

      let cat = view;
      if (view === 'dashboard') cat = null;
      if (navItem.id === 'bottom-nav-more-btn') cat = 'announcements';

      if (cat) markCategoryRead(cat);
    });

    // Executive Portal View Switching Listener
    document.body.addEventListener('click', (e) => {
      const ofBtn = e.target.closest('[data-of], #of-bottom-nav-more-btn');
      if (!ofBtn) return;

      const ofTarget = ofBtn.getAttribute('data-of') || (ofBtn.id === 'of-bottom-nav-more-btn' ? 'more' : null);
      if (!ofTarget) return;

      let cat = ofTarget;
      if (ofTarget === 'record') cat = 'transactions';
      if (ofTarget === 'more') cat = 'announcements';

      if (cat && cat !== 'overview') markCategoryRead(cat);
    });
  }

  async function setupRealtimeListener() {
    try {
      if (!window.supabaseClient || typeof window.supabaseClient.channel !== 'function') return;

      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const token = session?.access_token;
      if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
        return;
      }

      if (realtimeChannel) {
        window.supabaseClient.removeChannel(realtimeChannel);
      }

      realtimeChannel = window.supabaseClient
        .channel('public:notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
          const newNotif = payload.new;
          if (newNotif) {
            fetchNotifications();
            if (typeof UI !== 'undefined' && UI.toast) {
              UI.toast(`${newNotif.title}`, 'info');
            }
          }
        })
        .subscribe();
    } catch (err) {
      console.debug('[Notifications] Realtime subscription skipped:', err.message);
    }
  }

  async function init() {
    if (isInitialized) return;

    if (window.supabaseClient?.auth) {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) return;
    }

    isInitialized = true;

    fetchNotifications();
    setupViewClickListener();
    setupRealtimeListener();

    // SWR Polling fallback every 30s
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchNotifications, 30000);
  }

  function destroy() {
    if (realtimeChannel && window.supabaseClient) {
      try { window.supabaseClient.removeChannel(realtimeChannel); } catch {}
      realtimeChannel = null;
    }
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    isInitialized = false;
  }

  return {
    init,
    destroy,
    fetch: fetchNotifications,
    markCategoryRead,
    getState: () => state
  };
})();

// Auto-boot notifications when auth is ready (safe guarded if session exists)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Notifications.init());
} else {
  Notifications.init();
}

// Module build (Vite): the page scripts are ES modules, so this namespace is
// published on window for the other scripts and the HTML to reach it.
window.Notifications = Notifications;
