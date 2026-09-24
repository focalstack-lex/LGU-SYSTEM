// =============================================
// events.js - Events View Module
// =============================================

const Events = (() => {

  let allEvents = [];
  let _statusFilter = 'all';
  let _isInitialized = false;

  function init() {
    if (_isInitialized) return;
    const searchInput = document.getElementById('events-search');
    const sortSelect  = document.getElementById('events-sort');
    const filterTabs  = document.getElementById('events-filter-tabs');

    if (searchInput) {
      searchInput.addEventListener('input', () => applyFilters());
    }
    if (sortSelect) {
      sortSelect.addEventListener('change', () => applyFilters());
    }
    if (filterTabs) {
      filterTabs.querySelectorAll('.events-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _statusFilter = btn.dataset.status;
          filterTabs.querySelectorAll('.events-filter-btn').forEach(b =>
            b.classList.toggle('active', b === btn)
          );
          applyFilters();
        });
      });
    }
    _isInitialized = true;
  }

  async function load() {
    init(); // Ensure listeners are bound
    const hasCached = Api.hasCache('/events');
    const grid = document.getElementById('events-grid');
    if (!hasCached && (!allEvents.length || !grid?.children?.length)) {
      UI.setLoading('events-grid', 'Loading events…');
    }
    try {
      const events = await Api.events.list();
      // Admins receive archived events from the API (for the Manage tab);
      // the events grid itself never shows them.
      allEvents = events.filter(ev => ev.status !== 'archived');
      applyFilters(); // Apply current search/sort to newly loaded data
    } catch (err) {
      if (!allEvents.length) {
        UI.setEmpty('events-grid', 'caution', 'Failed to load events.');
      }
    }
  }

  function applyFilters() {
    const searchVal = document.getElementById('events-search')?.value.toLowerCase() || '';
    const sortVal   = document.getElementById('events-sort')?.value || 'newest';

    // 1. Status filter (archived events never reach students - filtered server-side)
    let filtered = allEvents;
    if (_statusFilter !== 'all') {
      filtered = filtered.filter(ev => ev.status === _statusFilter);
    }

    // 2. Search
    filtered = filtered.filter(ev =>
      ev.event_name.toLowerCase().includes(searchVal) ||
      (ev.description || '').toLowerCase().includes(searchVal)
    );

    // 3. Sort
    filtered.sort((a, b) => {
      if (sortVal === 'name-asc') {
        return a.event_name.localeCompare(b.event_name);
      } else if (sortVal === 'date-asc') {
        // Soonest event date first; undated events sink to the end
        if (!a.event_date && !b.event_date) return 0;
        if (!a.event_date) return 1;
        if (!b.event_date) return -1;
        return new Date(a.event_date) - new Date(b.event_date);
      } else if (sortVal === 'budget-desc') {
        return b.allocated_budget - a.allocated_budget;
      } else if (sortVal === 'budget-asc') {
        return a.allocated_budget - b.allocated_budget;
      } else {
        // newest (created_at desc)
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

    renderEventCards(filtered, searchVal.length > 0);
  }

  // Budget bar state shared by the grid cards and the detail view
  function budgetStats(ev) {
    const spent   = Number(ev.computed_expenses) || 0;
    const budget  = Number(ev.allocated_budget) || 0;
    const over    = budget > 0 && spent > budget;
    const pct     = over ? 100 : (budget > 0 ? Math.min((spent / budget) * 100, 100) : 0);
    return { spent, budget, over, pct };
  }

  function renderEventCards(events, isSearching = false) {
    const grid = document.getElementById('events-grid');
    if (!events.length) {
      if (isSearching) {
        UI.setEmpty('events-grid', 'search', 'No events match your search.');
      } else if (_statusFilter !== 'all') {
        UI.setEmpty('events-grid', 'target', `No ${_statusFilter} events.`);
      } else {
        UI.setEmpty('events-grid', 'target', 'No events posted yet.');
      }
      return;
    }

    grid.innerHTML = events.map(ev => {
      const { spent, budget, over, pct } = budgetStats(ev);
      const dateLine = ev.event_date
        ? `<div class="event-card-date"><iconify-icon icon="solar:calendar-date-linear"></iconify-icon> ${UI.dateStr(ev.event_date)}</div>`
        : '';
      const overNote = over
        ? `<div class="event-over-note">Over budget by <strong>${UI.currency(spent - budget)}</strong></div>`
        : '';
      return `
        <div class="event-card" data-id="${ev.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
            ${UI.renderStatusBadge(ev.status)}
            <span style="font-size:0.72rem;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:12px;color:var(--text-tertiary,#94a3b8);display:inline-flex;align-items:center;gap:4px;">
              <iconify-icon icon="solar:vault-linear" style="font-size:12px;color:var(--brand-accent,#B23A0A)"></iconify-icon>
              ${ev.funding_source || 'General Fund'}
            </span>
          </div>
          <h3>${ev.event_name}</h3>
          ${dateLine}
          <p>${ev.description || 'No description provided.'}</p>
          <div class="event-budget-bar">
            <div class="event-budget-fill${over ? ' over' : ''}" style="width:${pct}%"></div>
          </div>
          <div class="event-budget-labels">
            <span>Total Event Spending: <strong>${UI.currency(spent)}</strong></span>
            <span>Budget: <strong>${UI.currency(budget)}</strong></span>
          </div>
          ${overNote}
        </div>`;
    }).join('');

    // Attach click handlers for event detail
    grid.querySelectorAll('.event-card').forEach(card => {
      card.addEventListener('click', () => loadEventDetail(card.dataset.id));
    });
}

  async function loadEventDetail(id) {
    UI.showView('event-detail');
    const container = document.getElementById('event-detail-content');
    container.innerHTML = '<div class="loading-state">Loading event details…</div>';

    try {
      const ev = await Api.events.get(id);
      const { spent, budget, over, pct } = budgetStats(ev);
      const overNote = over
        ? `<div class="event-over-note" style="margin:-0.5rem 0 1.5rem;">Over budget by <strong>${UI.currency(spent - budget)}</strong></div>`
        : '';

      container.innerHTML = `
        <div style="margin-bottom:1.5rem">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:0.4rem;">
            ${UI.renderStatusBadge(ev.status)}
            <span style="font-size:0.75rem;background:rgba(255,255,255,0.08);padding:3px 10px;border-radius:12px;color:var(--text-secondary,#94a3b8);display:inline-flex;align-items:center;gap:4px;">
              <iconify-icon icon="solar:vault-linear" style="font-size:13px;color:var(--brand-accent,#B23A0A)"></iconify-icon>
              Source: ${ev.funding_source || 'General Fund'}
            </span>
          </div>
          <h2 style="font-size:1.75rem;margin:0.5rem 0">${ev.event_name}</h2>
          <p style="color:var(--text-secondary)">${ev.description || ''}</p>
          ${ev.event_date ? `<p style="font-size:0.85rem;margin-top:0.4rem;color:var(--text-secondary);display:flex;align-items:center;gap:0.3rem;"><iconify-icon icon="solar:calendar-date-linear" style="font-size:15px"></iconify-icon> ${UI.dateStr(ev.event_date)}</p>` : ''}
        </div>

        <div class="stats-grid" style="margin-bottom:1.5rem">
          <div class="stat-card stat-balance">
            <div class="stat-icon"><iconify-icon icon="solar:wallet-money-linear"></iconify-icon></div>
            <div class="stat-body">
              <p class="stat-label">Initial Allocation</p>
              <h3 class="stat-value">${UI.currency(budget)}</h3>
            </div>
          </div>
          <div class="stat-card stat-expense">
            <div class="stat-icon"><iconify-icon icon="solar:chart-square-linear"></iconify-icon></div>
            <div class="stat-body">
              <p class="stat-label">Total Event Spending</p>
              <h3 class="stat-value">${UI.currency(spent)}</h3>
            </div>
          </div>
          <div class="stat-card stat-income">
            <div class="stat-icon"><iconify-icon icon="solar:wallet-2-linear"></iconify-icon></div>
            <div class="stat-body">
              <p class="stat-label">Budget Utilization</p>
              <h3 class="stat-value">${UI.currency(Math.max(0, budget - Number(ev.computed_remaining)))}</h3>
              <p class="stat-sublabel" style="font-size:0.75rem;color:var(--text-secondary)">Remaining: ${UI.currency(ev.computed_remaining)}</p>
            </div>
          </div>
        </div>

        <div class="event-budget-bar" style="margin-bottom:1.5rem;height:8px">
          <div class="event-budget-fill${over ? ' over' : ''}" style="width:${pct}%"></div>
        </div>
        ${overNote}

        <div class="dashboard-card">
          <h3>Transaction History</h3>
          <div class="tx-list">
            ${ev.transactions && ev.transactions.length
              ? ev.transactions.map(tx => `
                <div class="tx-item">
                  ${UI.renderStatusBadge(tx.type)}
                  <span class="tx-desc">${tx.description}</span>
                  <div>
                    <div class="tx-amount ${tx.type === 'expense' ? 'expense' : 'income'}">
                      ${tx.type === 'expense' ? '-' : '+'}${UI.currency(tx.amount)}
                    </div>
                    <div class="tx-meta">${UI.dateStr(tx.transaction_date)}</div>
                  </div>
                  ${tx.receipt_url ? `<button type="button" class="receipt-link" data-receipt-url="${tx.receipt_url}" data-desc="${(tx.description || '').replace(/"/g, '&quot;')}" data-amount="${tx.amount}" data-date="${tx.transaction_date}" data-type="${tx.type}" data-event="${(ev.event_name || '').replace(/"/g, '&quot;')}" style="display:flex;align-items:center;gap:0.3rem;"><iconify-icon icon="solar:paperclip-linear" style="font-size:15px"></iconify-icon> Receipt</button>` : ''}
                </div>`).join('')
              : '<div class="empty-state"><span class="empty-icon"><iconify-icon icon="solar:card-transfer-linear"></iconify-icon></span><p>No transactions recorded yet.</p></div>'
            }
          </div>
        </div>`;
} catch (err) {
      container.innerHTML = `<div class="loading-state">Failed to load event details.</div>`;
    }
  }

  function bindBackButton() {
    const btn = document.getElementById('back-to-events');
    if (btn) {
      btn.addEventListener('click', e => {
        e.preventDefault();
        UI.showView('events');
      });
    }
  }

  return { load, bindBackButton };
})();
