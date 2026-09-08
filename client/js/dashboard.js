// =============================================
// dashboard.js - Dashboard View Module
// =============================================

const Dashboard = (() => {

  let realtimeChannel = null;

  async function load() {
    await Promise.all([loadStats(), loadRecentTransactions(), loadAnnouncements()]);
    subscribeRealtime();
    bindPopovers();

    // Listen for local updates (e.g. from Income tab)
    document.addEventListener('transaction-updated', () => {
      loadStats();
      loadRecentTransactions();
    });
  }

  function bindPopovers() {
    const cards = Array.from(document.querySelectorAll('.stat-card'));
    if (!cards.length) return;

    let activeCard = null;
    let longPressTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchInteracting = false;
    let hasLongPressed = false;
    let suppressClickUntil = 0;

    function adjustPosition(card) {
      const popover = card.querySelector('.stat-popover');
      if (!popover) return;
      popover.style.transform = '';
      const rect = popover.getBoundingClientRect();
      const pad = 12;
      const vw = window.innerWidth;

      if (rect.right > vw - pad) {
        const overflow = rect.right - (vw - pad);
        popover.style.transform = `translateY(12px) translateX(-${overflow}px)`;
      } else if (rect.left < pad) {
        const overflow = pad - rect.left;
        popover.style.transform = `translateY(12px) translateX(${overflow}px)`;
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

    function hideCard(card) {
      if (card) {
        card.classList.remove('hover-active');
        if (activeCard === card) activeCard = null;
      }
    }

    function hideAll() {
      cards.forEach(c => c.classList.remove('hover-active'));
      activeCard = null;
    }

    cards.forEach(card => {
      // Desktop mouse hover
      card.addEventListener('mouseenter', () => {
        if (!isTouchInteracting) showCard(card);
      });
      card.addEventListener('mouseleave', () => {
        if (!isTouchInteracting) hideCard(card);
      });

      // Mobile touch interactions: Touch & Hold + Finger Slide
      card.addEventListener('touchstart', (e) => {
        if (!e.touches || !e.touches[0]) return;
        isTouchInteracting = true;
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
        }, 220); // 220ms hold trigger
      }, { passive: true });

      card.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches[0]) return;
        const touch = e.touches[0];
        const dist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);

        // Cancel long-press timer if finger moves > 10px before firing (allows smooth natural scrolling)
        if (dist > 10 && !hasLongPressed) {
          clearTimeout(longPressTimer);
        }

        // Finger slide scrubbing: switch popover to whichever card the finger slides over
        if (hasLongPressed || activeCard) {
          const el = document.elementFromPoint(touch.clientX, touch.clientY);
          const hoveredCard = el ? el.closest('.stat-card') : null;
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
          // Keep popover open on release; suppress the immediate synthetic click
          suppressClickUntil = Date.now() + 350;
        }
        setTimeout(() => { isTouchInteracting = false; }, 350);
      });

      card.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimer);
        isTouchInteracting = false;
      });

      // Tap / Click Handler
      card.addEventListener('click', (e) => {
        const actionLink = e.target.closest('.stat-pop-action');
        if (actionLink) {
          e.stopPropagation();
          const targetView = actionLink.dataset.nav || card.dataset.nav;
          hideAll();
          if (targetView && typeof window.navigateTo === 'function') {
            window.navigateTo(targetView);
          }
          return;
        }

        // If long-press just ended, suppress navigation so user can view dropdown
        if (Date.now() < suppressClickUntil) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }

        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 768);

        if (isTouch) {
          // On touch: first tap reveals the dropdown popover!
          if (activeCard !== card) {
            e.stopPropagation();
            e.preventDefault();
            showCard(card);
            return;
          }
        }

        // If already active or mouse click on desktop: navigate to target view
        const targetView = card.dataset.nav;
        if (targetView && typeof window.navigateTo === 'function') {
          e.stopPropagation();
          hideAll();
          window.navigateTo(targetView);
        }
      });
    });

    // Close any open popovers when tapping or clicking elsewhere
    const handleOutside = (e) => {
      if (!e.target.closest('.stat-card')) {
        hideAll();
      }
    };
    document.addEventListener('click', handleOutside);
    document.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.stat-card')) {
        hideAll();
      }
    }, { passive: true });
  }

  async function loadStats() {
    try {
      const summary = await Api.reports.summary();
      document.getElementById('stat-income').textContent    = UI.currency(summary.totalIncome);
      document.getElementById('stat-expense').textContent   = UI.currency(summary.totalExpense);
      document.getElementById('stat-balance').textContent   = UI.currency(summary.remainingBalance);
      document.getElementById('stat-donations').textContent = UI.currency(summary.breakdown.donation);

      // Populate popover breakdowns with 1-tap action links
      document.getElementById('pop-income').innerHTML = `
        <div class="stat-pop-row"><span>Donations</span> <span>${UI.currency(summary.breakdown.donation)}</span></div>
        <div class="stat-pop-row"><span>Collections</span> <span>${UI.currency(summary.breakdown.collection)}</span></div>
        <div class="stat-pop-row"><span>Allocations In</span> <span>${UI.currency(summary.breakdown.allocation)}</span></div>
        <div class="stat-pop-row total"><span>Total Income</span> <span>${UI.currency(summary.totalIncome)}</span></div>
        <a class="stat-pop-action" data-nav="income"><span>View Total Income Tracker</span> <iconify-icon icon="solar:arrow-right-linear"></iconify-icon></a>
      `;

      const eventExpense = summary.totalExpense - summary.generalExpense;
      document.getElementById('pop-expense').innerHTML = `
        <div class="stat-pop-row"><span>General/Misc</span> <span>${UI.currency(summary.generalExpense)}</span></div>
        <div class="stat-pop-row"><span>Event Spending</span> <span>${UI.currency(eventExpense)}</span></div>
        <div class="stat-pop-row total"><span>Total Spent</span> <span>${UI.currency(summary.totalExpense)}</span></div>
        <a class="stat-pop-action" data-nav="transactions"><span>View Transactions Ledger</span> <iconify-icon icon="solar:arrow-right-linear"></iconify-icon></a>
      `;

      const netCashBalance = summary.totalIncome - summary.totalExpense;
      document.getElementById('pop-balance').innerHTML = `
        <div class="stat-pop-row income"><span>Total Income</span> <span>${UI.currency(summary.totalIncome)}</span></div>
        <div class="stat-pop-row expense"><span>Total Expenses</span> <span>-${UI.currency(summary.totalExpense)}</span></div>
        <div class="stat-pop-row" style="border-top:1px dashed var(--border);margin-top:0.25rem;padding-top:0.25rem;font-weight:600;"><span>Net Cash Balance</span> <span>${UI.currency(netCashBalance)}</span></div>
        <div class="stat-pop-row" style="color:var(--status-neutral)"><span>Unspent Envelopes</span> <span>-${UI.currency(Math.max(0, (summary.breakdown.reserved_envelopes || 0) - (summary.totalExpense - summary.generalExpense)))}</span></div>
        <div class="stat-pop-row total"><span>Available General Fund</span> <span>${UI.currency(summary.remainingBalance)}</span></div>
        <p style="font-size:0.65rem;color:var(--text-tertiary);margin-top:0.4rem;line-height:1.2;">Available General Fund = Net Cash Balance − unspent event envelopes.</p>
        <a class="stat-pop-action" data-nav="reports"><span>View Financial Reports & Trends</span> <iconify-icon icon="solar:arrow-right-linear"></iconify-icon></a>
      `;

      document.getElementById('pop-donations').innerHTML = `
        <div class="stat-pop-row" style="color:var(--col-text);line-height:1.4;">Total value of sponsorships and community contributions.</div>
        <a class="stat-pop-action" data-nav="income"><span>View Donations in Income Tracker</span> <iconify-icon icon="solar:arrow-right-linear"></iconify-icon></a>
      `;
    } catch (err) {
      console.error('Stats load error:', err);
    }
  }

  async function loadRecentTransactions() {
    const container = document.getElementById('recent-tx-list');
    try {
      const txs = await Api.transactions.list({ limit: 8 });
      if (!txs.length) { UI.setEmpty('recent-tx-list', 'solar:card-transfer-linear', 'No transactions yet.'); return; }

      container.innerHTML = txs.map(tx => `
        <div class="tx-item">
          ${UI.renderStatusBadge(tx.type)}
          <span class="tx-desc" title="${tx.description}">${tx.description}</span>
          <div>
            <div class="tx-amount ${tx.type}">
              ${tx.type === 'expense' ? '-' : '+'}${UI.currency(tx.amount)}
            </div>
            <div class="tx-meta">${UI.dateStr(tx.transaction_date)}</div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = `<div class="loading-state"><iconify-icon icon="solar:danger-triangle-linear"></iconify-icon> Failed to load transactions.</div>`;
    }
  }

  async function loadAnnouncements() {
    const container = document.getElementById('announcement-list');
    try {
      const { data } = await window.supabaseClient
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!data?.length) { UI.setEmpty('announcement-list', 'solar:bell-linear', 'No announcements yet.'); return; }

      container.innerHTML = data.map(a => `
        <div class="announce-item">
          <h4>${a.title}</h4>
          <p class="announce-body">${a.body.replace(/\n/g, '<br>')}</p>
          ${a.body.length > 200 ? '<button class="announce-expand-btn" type="button">Show more</button>' : ''}
          <div class="announce-date">${UI.dateStr(a.created_at)}</div>
        </div>
      `).join('');

      container.querySelectorAll('.announce-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const bodyEl = btn.closest('.announce-item').querySelector('.announce-body');
          const expanded = bodyEl.classList.toggle('expanded');
          btn.textContent = expanded ? 'Show less' : 'Show more';
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="loading-state"><iconify-icon icon="solar:danger-triangle-linear"></iconify-icon> Failed to load announcements.</div>`;
    }
  }

  async function subscribeRealtime() {
    if (!window.supabaseClient || typeof window.supabaseClient.channel !== 'function') return;

    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const token = session?.access_token || window.SUPABASE_ANON;
      if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
        return;
      }
    } catch {
      return;
    }

    if (realtimeChannel) window.supabaseClient.removeChannel(realtimeChannel);

    realtimeChannel = window.supabaseClient
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        if (typeof Api !== 'undefined' && Api.invalidateCache) {
          Api.invalidateCache('/reports', '/transactions', '/dashboard', '/income', '/events');
        }
        loadStats();
        loadRecentTransactions();
        document.dispatchEvent(new CustomEvent('transaction-updated'));
        UI.toast('Dashboard updated with a new transaction.', 'info');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => {
        loadAnnouncements();
        UI.toast('New announcement posted!', 'info');
      })
      .subscribe();
  }

  function destroy() {
    if (realtimeChannel && window.supabaseClient) {
      try { window.supabaseClient.removeChannel(realtimeChannel); } catch {}
    }
    realtimeChannel = null;
  }

  return { load, destroy };
})();
