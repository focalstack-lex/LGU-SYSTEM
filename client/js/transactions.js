// =============================================
// transactions.js - Transactions View Module
// =============================================

const Transactions = (() => {

  let allTxs = [];
  let _isAdmin = false;
  let _currentPage = 1;
  let _totalPages = 1;
  let _totalCount = 0;
  let _searchDebounce = null;

  async function load() {
    // Check admin status from the in-memory profile object
    const profile = await Auth.getProfile();
    _isAdmin = profile?.role === 'admin';
    bindFilter();
    bindPagination();
    bindTableEvents();
    await populateEventFilter();
    await fetchPage(1);
  }

  async function fetchPage(page = 1) {
    _currentPage = Math.max(1, page);
    const typeEl   = document.getElementById('filter-type');
    const eventEl  = document.getElementById('filter-event');
    const searchEl = document.getElementById('tx-search');

    const params = {
      page: _currentPage,
      limit: 100
    };
    if (typeEl && typeEl.value !== 'all') params.type = typeEl.value;
    if (eventEl && eventEl.value !== 'all') params.event_id = eventEl.value;
    if (searchEl && searchEl.value.trim()) params.search = searchEl.value.trim();

    try {
      const res = await Api.transactions.list(params);
      if (Array.isArray(res)) {
        allTxs = res;
        _totalCount = res.length;
        _totalPages = 1;
      } else {
        allTxs = res.data || [];
        _totalCount = res.total || 0;
        _totalPages = res.totalPages || Math.max(1, Math.ceil(_totalCount / 100));
      }
      renderTable(allTxs);
      updatePagination();
    } catch (err) {
      console.error('Transactions load failed:', err);
      renderLoadError(err);
    }
  }

  // Shown in both the desktop table and the mobile card list, so mobile users
  // never stay stuck on the skeleton when the request fails.
  function renderLoadError(err) {
    const reason = err?.message ? UI.esc(err.message) : 'Check your connection and try again.';
    const block = `<div class="empty-state" role="alert">
        <span class="empty-icon"><iconify-icon icon="solar:danger-triangle-linear"></iconify-icon></span>
        <p>Could not load transactions. ${reason}</p>
        <button type="button" class="btn btn-ghost tx-retry-btn">Retry</button>
      </div>`;
    const tbody = document.getElementById('tx-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="${_isAdmin ? 8 : 7}">${block}</td></tr>`;
    const cards = document.getElementById('tx-mobile-cards');
    if (cards) cards.innerHTML = block;
    document.querySelectorAll('.tx-retry-btn').forEach(btn =>
      btn.addEventListener('click', () => fetchPage(_currentPage))
    );
  }

  function updatePagination() {
    const pageInfo = document.getElementById('tx-page-info');
    const prevBtn  = document.getElementById('tx-prev-btn');
    const nextBtn  = document.getElementById('tx-next-btn');

    if (pageInfo) {
      pageInfo.textContent = `Page ${_currentPage} of ${_totalPages} (${_totalCount} transaction${_totalCount === 1 ? '' : 's'})`;
    }
    if (prevBtn) prevBtn.disabled = _currentPage <= 1;
    if (nextBtn) nextBtn.disabled = _currentPage >= _totalPages;
  }

  function renderTable(txs) {
    const tbody = document.getElementById('tx-table-body');

    if (!txs.length) {
      const colSpan = _isAdmin ? 8 : 7;
      tbody.innerHTML = `<tr><td colspan="${colSpan}"><div class="empty-state"><span class="empty-icon"><iconify-icon icon="solar:card-transfer-linear"></iconify-icon></span><p>No transactions found.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = txs.map(tx => `
      <tr>
        <td class="td-date">${UI.dateStr(tx.transaction_date)}</td>
        <td style="color:var(--text-secondary);font-size:0.82rem">${UI.esc(tx.events?.event_name || '-')}</td>
        <td>${UI.renderStatusBadge(tx.type)}</td>
        <td>${UI.esc(tx.description)}</td>
        <td class="tx-amount ${tx.type}">
          ${tx.type === 'expense' ? '-' : (tx.type === 'transfer' ? '' : '+')}${UI.currency(tx.amount)}
        </td>
        <td>${tx.receipt_url
          ? `<button type="button" class="receipt-link" data-receipt-url="${UI.esc(tx.receipt_url)}" data-desc="${UI.esc(tx.description)}" data-amount="${tx.amount}" data-date="${tx.transaction_date}" data-type="${tx.type}" data-event="${UI.esc(tx.events?.event_name)}" style="display:flex;align-items:center;gap:0.3rem;"><iconify-icon icon="solar:paperclip-linear" style="font-size:15px"></iconify-icon> View</button>`
          : '<span style="color:var(--text-tertiary)">-</span>'}</td>
        <td style="color:var(--text-secondary);font-size:0.82rem">${UI.esc(tx.profiles?.full_name || '-')}</td>
        ${_isAdmin ? `
        <td style="text-align:center;">
          <div style="display:inline-flex;gap:.4rem;">
            <button type="button" class="tx-action-btn tx-edit-btn" aria-label="Edit transaction: ${UI.esc(tx.description)}"
              data-txid="${tx.id}"
              data-desc="${UI.esc(tx.description)}"
              data-amount="${tx.amount}"
              data-date="${tx.transaction_date}"
              data-receipt="${UI.esc(tx.receipt_url)}"><iconify-icon icon="solar:pen-linear" style="font-size:15px"></iconify-icon></button>
            <button type="button" class="tx-action-btn tx-del-btn" aria-label="Delete transaction: ${UI.esc(tx.description)}"
              data-txid="${tx.id}"
              data-desc="${UI.esc(tx.description)}"><iconify-icon icon="solar:trash-bin-trash-linear" style="font-size:15px"></iconify-icon></button>
          </div>
        </td>` : ''}
      </tr>
    `).join('');

    // ---- Mobile Cards ----
    const cardContainer = document.getElementById('tx-mobile-cards');
    if (cardContainer) {
      cardContainer.innerHTML = txs.map(tx => `
        <div class="data-card">
          <div class="data-card-header">
            ${UI.renderStatusBadge(tx.type)}
            <span style="font-size:0.75rem;color:var(--text-secondary);">${UI.dateStr(tx.transaction_date)}</span>
          </div>
          <div class="data-card-body">
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:0.15rem;">${UI.esc(tx.description)}</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">
               <span class="tx-amount ${tx.type}" style="font-size:1.2rem;font-weight:800;">
                ${tx.type === 'expense' ? '-' : '+'}${UI.currency(tx.amount)}
              </span>
              ${tx.receipt_url ? `<button type="button" class="receipt-link" data-receipt-url="${UI.esc(tx.receipt_url)}" data-desc="${UI.esc(tx.description)}" data-amount="${tx.amount}" data-date="${tx.transaction_date}" data-type="${tx.type}" data-event="${UI.esc(tx.events?.event_name)}" style="font-size:0.8rem;"><iconify-icon icon="solar:paperclip-linear" style="font-size:15px"></iconify-icon> Receipt</button>` : ''}
            </div>
            <div style="font-size:0.72rem;color:var(--text-secondary);display:flex;align-items:center;gap:0.3rem;">
              <iconify-icon icon="solar:user-linear" style="font-size:12px"></iconify-icon> ${UI.esc(tx.profiles?.full_name || 'System')}
            </div>
          </div>
          ${_isAdmin ? `
          <div class="data-card-actions" style="margin-top:0.75rem;padding-top:0.5rem;">
            <button type="button" class="tx-action-btn tx-edit-btn" style="padding:0.4rem 0.8rem;" aria-label="Edit transaction: ${UI.esc(tx.description)}"
              data-txid="${tx.id}"
              data-desc="${UI.esc(tx.description)}"
              data-amount="${tx.amount}"
              data-date="${tx.transaction_date}"
              data-receipt="${UI.esc(tx.receipt_url)}"><iconify-icon icon="solar:pen-linear"></iconify-icon></button>
            <button type="button" class="tx-action-btn tx-del-btn" style="padding:0.4rem 0.8rem;" aria-label="Delete transaction: ${UI.esc(tx.description)}"
              data-txid="${tx.id}"
              data-desc="${UI.esc(tx.description)}"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button>
          </div>` : ''}
        </div>
      `).join('');
    }
  }

  function bindTableEvents() {
    const tbody = document.getElementById('tx-table-body');
    const mobContainer = document.getElementById('tx-mobile-cards');
    if (!tbody || tbody._bound) return;

    const handleClick = e => {
      const editBtn = e.target.closest('.tx-edit-btn');
      const delBtn  = e.target.closest('.tx-del-btn');
      if (editBtn) {
        editModal(editBtn.dataset.txid, editBtn.dataset.desc, editBtn.dataset.amount, editBtn.dataset.date, editBtn.dataset.receipt);
      } else if (delBtn) {
        deleteModal(delBtn.dataset.txid, delBtn.dataset.desc);
      }
    };

    tbody.addEventListener('click', handleClick);
    if (mobContainer) mobContainer.addEventListener('click', handleClick);
    tbody._bound = true;
  }

  function bindPagination() {
    const prevBtn = document.getElementById('tx-prev-btn');
    const nextBtn = document.getElementById('tx-next-btn');

    if (prevBtn && !prevBtn._bound) {
      prevBtn.addEventListener('click', () => {
        if (_currentPage > 1) fetchPage(_currentPage - 1);
      });
      prevBtn._bound = true;
    }
    if (nextBtn && !nextBtn._bound) {
      nextBtn.addEventListener('click', () => {
        if (_currentPage < _totalPages) fetchPage(_currentPage + 1);
      });
      nextBtn._bound = true;
    }
  }

  function bindFilter() {
    const typeEl   = document.getElementById('filter-type');
    const eventEl  = document.getElementById('filter-event');
    const searchEl = document.getElementById('tx-search');

    function triggerFilter() {
      fetchPage(1);
    }

    if (typeEl && !typeEl._bound) {
      typeEl.addEventListener('change', triggerFilter);
      typeEl._bound = true;
    }
    if (eventEl && !eventEl._bound) {
      eventEl.addEventListener('change', triggerFilter);
      eventEl._bound = true;
    }
    if (searchEl && !searchEl._bound) {
      searchEl.addEventListener('input', () => {
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => fetchPage(1), 300);
      });
      searchEl._bound = true;
    }
  }

  async function populateEventFilter() {
    const eventEl = document.getElementById('filter-event');
    if (!eventEl || eventEl._populated) return;

    try {
      const events = await Api.events.list();
      const currentVal = eventEl.value;
      eventEl.innerHTML = '<option value="all">All Events</option>' +
        '<option value="GENERAL">General Fund (No Event)</option>' +
        (events || []).map(e => `<option value="${UI.esc(e.id)}">${UI.esc(e.event_name)}</option>`).join('');
      if (currentVal) eventEl.value = currentVal;
      eventEl._populated = true;
    } catch { /* ignore */ }
  }

  // ── Edit Modal ──────────────────────────────────────────────────────────
  function editModal(id, desc, amount, date, receipt) {
    const existing = document.getElementById('tx-edit-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tx-edit-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="tx-edit-title">
        <h3 id="tx-edit-title" style="margin:0 0 1rem;font-size:1.1rem;">Edit Transaction</h3>
        <div class="form-group">
          <label for="edit-desc">Description</label>
          <input id="edit-desc" type="text" value="${UI.esc(desc)}" maxlength="500" />
        </div>
        <div class="form-group">
          <label for="edit-amount">Amount (₱)</label>
          <input id="edit-amount" type="number" step="0.01" min="0" value="${UI.esc(amount)}" />
        </div>
        <div class="form-group">
          <label for="edit-date">Date</label>
          <input id="edit-date" type="date" value="${UI.esc(date)}" />
        </div>
        <div class="form-group">
          <label for="edit-receipt">Receipt URL (G-Drive Link)</label>
          <input id="edit-receipt" type="url" value="${UI.esc(receipt)}" placeholder="Paste Google Drive/Receipt link here" />
        </div>
        <div class="form-group">
          <label for="edit-reason">Reason for Edit <span style="color:var(--error)" aria-hidden="true">*</span></label>
          <input id="edit-reason" type="text" required aria-describedby="edit-error" placeholder="Required - why are you editing this?" />
        </div>
        <div class="auth-error hidden" id="edit-error" role="alert"></div>
        <div style="display:flex;gap:.75rem;margin-top:1rem;">
          <button type="button" class="btn btn-primary" style="flex:1;" id="edit-submit-btn">Save Changes</button>
          <button type="button" class="btn btn-ghost" style="flex:1;" id="edit-cancel-btn">Cancel</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const dialog = UI.trapDialog(modal, { initialFocus: '#edit-desc' });
    document.getElementById('edit-cancel-btn').addEventListener('click', dialog.close);

    document.getElementById('edit-submit-btn').addEventListener('click', async () => {
      const btn    = document.getElementById('edit-submit-btn');
      const errEl  = document.getElementById('edit-error');
      const reasonEl = document.getElementById('edit-reason');
      const reason = reasonEl.value.trim();
      errEl.classList.add('hidden');
      reasonEl.removeAttribute('aria-invalid');

      if (!reason || reason.length < 5) {
        errEl.textContent = 'Please provide a reason (min 5 characters).';
        errEl.classList.remove('hidden');
        reasonEl.setAttribute('aria-invalid', 'true');
        reasonEl.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await Api.transactions.update(id, {
          description:      document.getElementById('edit-desc').value,
          amount:           document.getElementById('edit-amount').value,
          transaction_date: document.getElementById('edit-date').value,
          receipt_url:      document.getElementById('edit-receipt').value,
          reason,
        });
        dialog.close();
        UI.toast('Transaction updated successfully.', 'success');
        document.dispatchEvent(new CustomEvent('transaction-updated'));
        load();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });
  }

  // ── Delete Modal ────────────────────────────────────────────────────────
  function deleteModal(id, desc) {
    const existing = document.getElementById('tx-delete-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tx-delete-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="tx-delete-title" aria-describedby="tx-delete-desc">
        <h3 id="tx-delete-title" style="margin:0 0 .5rem;font-size:1.1rem;color:var(--error);">Delete Transaction</h3>
        <p id="tx-delete-desc" style="color:var(--text-secondary);margin-bottom:1rem;font-size:.9rem;">
          You are about to delete: <strong>${UI.esc(desc)}</strong>.<br>This action is permanent and recorded.
        </p>
        <div class="form-group">
          <label for="delete-reason">Reason for Deletion <span style="color:var(--error)" aria-hidden="true">*</span></label>
          <input id="delete-reason" type="text" required aria-describedby="delete-error" placeholder="Required - why are you deleting this?" />
        </div>
        <div class="auth-error hidden" id="delete-error" role="alert"></div>
        <div style="display:flex;gap:.75rem;margin-top:1rem;">
          <button type="button" class="btn btn-danger" style="flex:1;" id="delete-submit-btn">Confirm Delete</button>
          <button type="button" class="btn btn-ghost" style="flex:1;" id="delete-cancel-btn">Cancel</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const dialog = UI.trapDialog(modal, { initialFocus: '#delete-reason' });
    document.getElementById('delete-cancel-btn').addEventListener('click', dialog.close);

    document.getElementById('delete-submit-btn').addEventListener('click', async () => {
      const btn    = document.getElementById('delete-submit-btn');
      const errEl  = document.getElementById('delete-error');
      const reasonEl = document.getElementById('delete-reason');
      const reason = reasonEl.value.trim();
      errEl.classList.add('hidden');
      reasonEl.removeAttribute('aria-invalid');

      if (!reason || reason.length < 5) {
        errEl.textContent = 'Please provide a reason (min 5 characters).';
        errEl.classList.remove('hidden');
        reasonEl.setAttribute('aria-invalid', 'true');
        reasonEl.focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        await Api.transactions.remove(id, { reason });
        dialog.close();
        UI.toast('Transaction deleted.', 'success');
        document.dispatchEvent(new CustomEvent('transaction-updated'));
        load();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Confirm Delete';
      }
    });
  }

  return { load, editModal, deleteModal };
})();

// Module build (Vite): the page scripts are ES modules, so this namespace is
// published on window for the other scripts and the HTML to reach it.
window.Transactions = Transactions;
