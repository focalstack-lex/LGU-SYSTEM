// =============================================
// income.js - General Income Tracker Module
// =============================================

const Income = (() => {

  async function load() {
    try {
      // Query income types directly from server with pagination support
      const res = await Api.transactions.list({
        type: 'donation,collection,allocation',
        page: 1,
        limit: 100
      });
      const incomes = Array.isArray(res) ? res : (res.data || []);
      renderTable(incomes);
      renderMobileCards(incomes);
    } catch (err) {
      document.getElementById('income-table-body').innerHTML =
        `<tr><td colspan="5" class="loading-state">Failed to load income history.</td></tr>`;
    }
  }

  function renderTable(txs) {
    const tbody = document.getElementById('income-table-body');
    if (!txs.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon"><iconify-icon icon="solar:wallet-money-linear"></iconify-icon></span><p>No income recorded yet.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = txs.map(tx => `
      <tr>
        <td>${UI.dateStr(tx.transaction_date)}</td>
        <td>${UI.renderStatusBadge(tx.type)}</td>
        <td>${tx.description}</td>
        <td class="tx-amount ${tx.type}">+${UI.currency(tx.amount)}</td>
        <td style="color:var(--text-secondary);font-size:0.82rem">${tx.profiles?.full_name || 'System'}</td>
      </tr>
    `).join('');
  }

  // Mobile card layout (≤768px) — table-wrapper is hidden via CSS on phones.
  function renderMobileCards(txs) {
    const container = document.getElementById('income-mobile-cards');
    if (!container) return;
    if (!txs.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon"><iconify-icon icon="solar:wallet-money-linear"></iconify-icon></span><p>No income recorded yet.</p></div>`;
      return;
    }

    container.innerHTML = txs.map(tx => `
      <div class="data-card">
        <div class="data-card-header">
          <strong style="font-size:0.92rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tx.description}</strong>
          ${UI.renderStatusBadge(tx.type)}
        </div>
        <div class="data-card-row">
          <span class="data-card-label">Date</span>
          <span>${UI.dateStr(tx.transaction_date)}</span>
        </div>
        <div class="data-card-row">
          <span class="data-card-label">Added By</span>
          <span>${tx.profiles?.full_name || 'System'}</span>
        </div>
        <div class="data-card-row" style="margin-top:0.35rem;">
          <span class="data-card-label">Amount</span>
          <span class="tx-amount ${tx.type}" style="font-size:1.05rem;">+${UI.currency(tx.amount)}</span>
        </div>
      </div>
    `).join('');
  }

  function bindForm() {
    const form = document.getElementById('add-income-form');
    const errEl = document.getElementById('inc-error');
    if (!form || form._bound) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const btn = document.getElementById('inc-submit');
      
      const type = document.getElementById('inc-type').value;
      const desc = document.getElementById('inc-desc').value;
      const amount = Number(document.getElementById('inc-amount').value);
      const date = document.getElementById('inc-date').value;
      const receiptUrl = document.getElementById('inc-receipt').value || null;

      btn.disabled = true;
      btn.textContent = 'Submitting...';

      try {
        await Api.transactions.create({
          event_id: null,
          use_allocation: false,
          type,
          description: desc,
          amount,
          transaction_date: date,
          receipt_url: receiptUrl
        });

        form.reset();
        document.getElementById('inc-date').value = new Date().toISOString().split('T')[0];
        
        await load(); // refresh table
        // Optional: Trigger dashboard refresh if required by other components
        document.dispatchEvent(new Event('transaction-updated'));
        
        // Use UI.js generic alert or something, or fallback to an alert
        UI.toast('Income added to general fund successfully!', 'success');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add to Total Income';
      }
    });

    form._bound = true;
    document.getElementById('inc-date').value = new Date().toISOString().split('T')[0];
  }

  return { load, bindForm };
})();
