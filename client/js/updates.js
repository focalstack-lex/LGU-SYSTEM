// =============================================
// updates.js - Announcements and Notifications pages (student portal)
// Both read endpoints that already exist (/announcements, /notifications).
// Opening Notifications marks every category shown as read through
// Notifications.markCategoryRead, which also clears the nav badges.
// =============================================

const Updates = (() => {

  const CATEGORY_LABELS = {
    announcements: 'Announcements',
    events: 'Events',
    transactions: 'Transactions',
    reports: 'Reports',
    units: 'Academic',
    system: 'System',
  };

  function formatTitle(title) {
    if (!title) return '';
    if (title === title.toUpperCase() && title.length > 3) {
      return title.toLowerCase().replace(/(?:^|\s|-|:\s*)\w/g, m => m.toUpperCase());
    }
    return title;
  }

  async function loadAnnouncements() {
    const container = document.getElementById('announcements-full-list');
    if (!container) return;
    try {
      const list = await Api.announcements.list();
      if (!list || !list.length) { UI.setEmpty('announcements-full-list', 'solar:bell-linear', 'No announcements yet.'); return; }
      container.innerHTML = list.map(a => `
        <article class="announce-item announce-item-full">
          <h4 class="announce-title">${UI.esc(formatTitle(a.title))}</h4>
          <p class="announce-body expanded">${UI.esc(a.body || '').replace(/\n/g, '<br>')}</p>
          <div class="announce-meta">
            <span>${UI.esc(a.author || 'Student Council')}</span>
            <span class="announce-meta-dot" aria-hidden="true">•</span>
            <span>${UI.esc(UI.dateStr(a.created_at))}</span>
          </div>
        </article>`).join('');
    } catch (err) {
      console.error('Announcements page load failed:', err);
      container.innerHTML = `<div class="loading-state" role="alert"><iconify-icon icon="solar:danger-triangle-linear" aria-hidden="true"></iconify-icon> Could not load announcements. Check your connection, then refresh.</div>`;
    }
  }

  async function loadNotifications() {
    const container = document.getElementById('notifications-full-list');
    if (!container) return;
    try {
      const data = await Api.notifications.list();
      const items = (data && data.notifications) || [];
      if (!items.length) { UI.setEmpty('notifications-full-list', 'solar:letter-bold', 'No notifications yet. Enrollment updates and council notices will appear here.'); return; }

      // Unread first, then newest first, grouped by category
      const sorted = items.slice().sort((a, b) => (a.is_read === b.is_read ? String(b.created_at).localeCompare(String(a.created_at)) : (a.is_read ? 1 : -1)));
      const groups = new Map();
      sorted.forEach(n => {
        const cat = CATEGORY_LABELS[n.category] ? n.category : 'system';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(n);
      });

      container.innerHTML = [...groups.entries()].map(([cat, list]) => `
        <section class="notif-group" aria-label="${UI.esc(CATEGORY_LABELS[cat])}">
          <h4 class="notif-group-title">${UI.esc(CATEGORY_LABELS[cat])}</h4>
          ${list.map(n => `
            <article class="notif-item${n.is_read ? '' : ' is-unread'}">
              <span class="notif-dot" aria-hidden="true"></span>
              <div class="notif-body">
                <p class="notif-title">${UI.esc(n.title || 'Update')}</p>
                ${n.message || n.body ? `<p class="notif-text">${UI.esc(n.message || n.body)}</p>` : ''}
                <span class="notif-time">${UI.esc(UI.dateStr(n.created_at))}${n.is_read ? '' : ' · new'}</span>
              </div>
            </article>`).join('')}
        </section>`).join('');

      // Everything on screen counts as read
      if (typeof Notifications !== 'undefined') {
        [...groups.keys()].forEach(cat => Notifications.markCategoryRead(cat));
      }
    } catch (err) {
      console.error('Notifications page load failed:', err);
      container.innerHTML = `<div class="loading-state" role="alert"><iconify-icon icon="solar:danger-triangle-linear" aria-hidden="true"></iconify-icon> Could not load notifications. Check your connection, then refresh.</div>`;
    }
  }

  return { loadAnnouncements, loadNotifications };
})();

// Module build (Vite): the page scripts are ES modules, so this namespace is
// published on window for the other scripts and the HTML to reach it.
window.Updates = Updates;
