// =============================================
// admin.js - Admin View Module (Phase 4)
// =============================================

const Admin = (() => {

  let _initialized  = false;
  let _currentTab   = 'create';
  let _allEvents    = [];
  let _allUsers     = [];
  let _allLogs      = [];
  let _genFundBalance = 0;

  async function init() {
    await populateEventDropdown();
    await updateEvAvailableBalanceUI();
    if (!_initialized) {
      bindTabSwitching();
      bindEventForm();
      bindManageEventForm();
      bindTransactionForm();
      bindAnnouncementForm();
      bindBulkImportForm();
      bindBudgetTransferForm();
      _initialized = true;
    }
    setTodayDate();
    switchTab(_currentTab);
  }

  // ── Tab Switching ──────────────────────────────────────────────────────────
  function bindTabSwitching() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    _currentTab = tab;
    document.querySelectorAll('.admin-tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab)
    );
    document.querySelectorAll('.admin-tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === `admin-tab-${tab}`)
    );
    if (tab === 'users')  loadUsers();
    if (tab === 'audit')  loadAuditLog();
  }

  // ── Event Dropdown ─────────────────────────────────────────────────────────
  async function populateEventDropdown() {
    try {
      const [events, summary] = await Promise.all([
        Api.events.list(),
        Api.reports.summary()
      ]);
      _allEvents = events;
      _genFundBalance = summary.remainingBalance; // Store available general fund balance
      const activeEvents = _allEvents.filter(ev => ev.status !== 'archived');
      const opts = '<option value="">Select Event</option>' +
        activeEvents.map(ev => `<option value="${ev.id}" data-rem="${ev.computed_remaining}">${ev.event_name}</option>`).join('');
      document.querySelectorAll('.event-select-dropdown').forEach(el => { el.innerHTML = opts; });
      populateManageEventSelect();
      
      // Specifically for Budget Transfer: Add "General Fund" as a source option
      const fromSel = document.getElementById('transfer-from');
      if (fromSel) {
        fromSel.insertAdjacentHTML('afterbegin', '<option value="GENERAL" style="color:var(--col-success);font-weight:700;">GENERAL FUND (Available Total)</option>');
        fromSel.value = ""; // reset to placeholder
      }
    } catch { /* non-fatal */ }
  }

  function setTodayDate() {
    const d = document.getElementById('tx-date');
    if (d) d.value = new Date().toISOString().split('T')[0];
  }

  // ── Create Event ───────────────────────────────────────────────────────────
  function bindEventForm() {
    const form  = document.getElementById('add-event-form');
    const errEl = document.getElementById('ev-error');
    const btn   = document.getElementById('submit-ev-btn');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.classList.add('hidden');
      btn.disabled = true;
      const budgetVal = Number(document.getElementById('ev-budget').value) || 0;
      const availEl = document.getElementById('ev-avail-bal');
      const availBal = Number(availEl?.dataset?.availBal || 0);

      if (availEl && budgetVal > availBal) {
        errEl.textContent = `Insufficient unreserved funds in General Fund. Available: ${UI.currency(availBal)}, Requested: ${UI.currency(budgetVal)}.`;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Create Event';
        return;
      }

      try {
        const ev = await Api.events.create({
          event_name:       document.getElementById('ev-name').value,
          description:      document.getElementById('ev-description').value,
          allocated_budget: document.getElementById('ev-budget').value,
          event_date:       document.getElementById('ev-date').value || null,
          status:           document.getElementById('ev-status').value
        });
        UI.toast('Event created successfully!', 'success');
        form.reset();
        await populateEventDropdown();
        await updateEvAvailableBalanceUI();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Event';
      }
    });
  }

  async function updateEvAvailableBalanceUI() {
    const el = document.getElementById('ev-avail-bal');
    if (!el) return;
    try {
      const summary = await Api.reports.summary();
      const rem = summary.remainingBalance || 0;
      el.textContent = UI.currency(rem);
      el.dataset.availBal = rem;
    } catch {
      el.textContent = '₱0.00';
    }
  }

  // ── Manage Events (edit / archive / restore) ───────────────────────────────
  function populateManageEventSelect() {
    const sel = document.getElementById('me-select');
    if (!sel) return;
    const previous = sel.value;
    sel.innerHTML = '<option value="">Select Event</option>' +
      _allEvents.map(ev => `<option value="${ev.id}">${ev.event_name}${ev.status === 'archived' ? ' (Archived)' : ''}</option>`).join('');
    if (previous && _allEvents.some(ev => ev.id === previous)) {
      sel.value = previous;
    } else {
      resetManageEventForm();
    }
  }

  function resetManageEventForm() {
    document.getElementById('me-name').value       = '';
    document.getElementById('me-status').value     = 'upcoming';
    document.getElementById('me-budget').value     = '';
    document.getElementById('me-date').value       = '';
    document.getElementById('me-description').value = '';
    document.getElementById('me-archive-btn').disabled = true;
    document.getElementById('me-archive-btn').textContent = 'Archive Event';
    document.getElementById('me-complete-btn').disabled = true;
  }

  function bindManageEventForm() {
    const form  = document.getElementById('edit-event-form');
    const sel   = document.getElementById('me-select');
    const errEl = document.getElementById('me-error');
    const saveBtn = document.getElementById('me-save-btn');
    const completeBtn = document.getElementById('me-complete-btn');
    const archiveBtn = document.getElementById('me-archive-btn');

    if (!form || !sel) return;

    const getSelected = () => _allEvents.find(ev => ev.id === sel.value) || null;

    sel.addEventListener('change', () => {
      errEl.classList.add('hidden');
      const ev = getSelected();
      if (!ev) {
        resetManageEventForm();
        return;
      }
      document.getElementById('me-name').value        = ev.event_name;
      document.getElementById('me-status').value      = ev.status === 'archived' ? 'upcoming' : ev.status;
      document.getElementById('me-budget').value      = ev.allocated_budget;
      document.getElementById('me-date').value        = ev.event_date || '';
      document.getElementById('me-description').value = ev.description || '';
      archiveBtn.disabled = false;
      archiveBtn.textContent = ev.status === 'archived' ? 'Restore Event' : 'Archive Event';
      // Already-done or archived events have nothing to complete
      completeBtn.disabled = ev.status === 'completed' || ev.status === 'archived';
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const ev = getSelected();
      if (!ev) return;

      errEl.classList.add('hidden');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      try {
        await Api.events.update(ev.id, {
          event_name:       document.getElementById('me-name').value,
          description:      document.getElementById('me-description').value,
          allocated_budget: document.getElementById('me-budget').value,
          event_date:       document.getElementById('me-date').value || null,
          status:           document.getElementById('me-status').value
        });
        UI.toast('Event updated successfully!', 'success');
        await populateEventDropdown();
        sel.dispatchEvent(new Event('change'));
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    completeBtn.addEventListener('click', async () => {
      const ev = getSelected();
      if (!ev) return;

      errEl.classList.add('hidden');
      completeBtn.disabled = true;

      try {
        await Api.events.update(ev.id, { status: 'completed' });
        UI.toast(`"${ev.event_name}" marked as completed.`, 'success');
        await populateEventDropdown();
        sel.dispatchEvent(new Event('change'));
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        completeBtn.disabled = false;
      }
    });

    archiveBtn.addEventListener('click', async () => {
      const ev = getSelected();
      if (!ev) return;

      const archiving = ev.status !== 'archived';
      if (archiving && !confirm(`Archive "${ev.event_name}"? It will be hidden from students. You can restore it later from this tab.`)) return;

      errEl.classList.add('hidden');
      archiveBtn.disabled = true;

      try {
        if (archiving) {
          await Api.events.archive(ev.id);
          UI.toast('Event archived.', 'success');
        } else {
          await Api.events.update(ev.id, { status: 'upcoming' });
          UI.toast('Event restored.', 'success');
        }
        await populateEventDropdown();
        sel.dispatchEvent(new Event('change'));
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        archiveBtn.disabled = false;
      }
    });
  }

  // ── Add Transaction ────────────────────────────────────────────────────────
  function bindTransactionForm() {
    const form  = document.getElementById('add-tx-form');
    const errEl = document.getElementById('tx-error');
    const btn   = document.getElementById('submit-tx-btn');
    const eventSel = document.getElementById('tx-event-id');
    const typeSel  = document.getElementById('tx-type');
    const fundGrp  = document.getElementById('fund-source-group');
    const useAlloc = document.getElementById('tx-use-allocation');
    let pendingReceipt = null; // { blob, name, size } from the camera modal

    const receiptBtn  = document.getElementById('tx-add-receipt');
    const receiptChip = document.getElementById('tx-receipt-chip');
    const chipText    = document.getElementById('tx-receipt-chip-text');
    const chipRemove  = document.getElementById('tx-receipt-remove');

    const clearReceipt = () => {
      pendingReceipt = null;
      receiptChip.classList.add('hidden');
    };

    receiptBtn.addEventListener('click', async () => {
      const captured = await ReceiptCapture.open();
      if (!captured) return; // user cancelled
      pendingReceipt = captured;
      chipText.textContent = `${captured.name} (${Math.round(captured.size / 1024)} KB)`;
      receiptChip.classList.remove('hidden');
    });

    chipRemove.addEventListener('click', clearReceipt);

    const updateFundToggle = async () => {
      // Only show if it's an expense AND an event is selected
      if (typeSel.value === 'expense' && eventSel.value) {
        fundGrp.style.display = 'block';
      } else {
        fundGrp.style.display = 'none';
        useAlloc.checked = true; // reset to default
      }

      const balInd = document.getElementById('tx-balance-indicator');
      if (typeSel.value === 'expense') {
        balInd.style.display = 'inline';
        if (eventSel.value && useAlloc.checked) {
          const selectedOption = eventSel.options[eventSel.selectedIndex];
          const rem = selectedOption.dataset.rem || 0;
          balInd.textContent = `(Available Event Budget: ${UI.currency(rem)})`;
          balInd.dataset.maxAmount = rem;
        } else {
          // Fetch dashboard balance
          try {
            const summary = await Api.reports.summary();
            const rem = summary.remainingBalance || 0;
            balInd.textContent = `(Available General Fund: ${UI.currency(rem)})`;
            balInd.dataset.maxAmount = rem;
          } catch {
             balInd.textContent = '';
          }
        }
      } else {
        balInd.style.display = 'none';
        delete balInd.dataset.maxAmount;
      }
    };

    eventSel.addEventListener('change', updateFundToggle);
    typeSel.addEventListener('change', updateFundToggle);
    useAlloc.addEventListener('change', updateFundToggle);

    // Initialize visibility
    updateFundToggle();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.classList.add('hidden');
      
      const balInd = document.getElementById('tx-balance-indicator');
      const amount = Number(document.getElementById('tx-amount').value);
      if (typeSel.value === 'expense' && balInd.dataset.maxAmount !== undefined) {
         const maxAmt = Number(balInd.dataset.maxAmount);
         if (amount > maxAmt) {
             errEl.textContent = `Amount (₱${amount.toLocaleString()}) exceeds available balance (₱${maxAmt.toLocaleString()})!`;
             errEl.classList.remove('hidden');
             return;
         }
      }

      btn.disabled = true;
      btn.textContent = 'Submitting…';

      try {
        // With an attached receipt the request must be multipart so the file
        // reaches the server; otherwise a plain JSON body is fine.
        let payload;
        if (pendingReceipt) {
          payload = new FormData();
          payload.append('event_id',        eventSel.value);
          payload.append('type',            typeSel.value);
          payload.append('amount',          document.getElementById('tx-amount').value);
          payload.append('description',     document.getElementById('tx-desc').value);
          payload.append('donor_name',      document.getElementById('tx-donor').value);
          payload.append('transaction_date', document.getElementById('tx-date').value);
          payload.append('use_allocation',  (typeSel.value === 'expense' && eventSel.value) ? String(useAlloc.checked) : 'false');
          payload.append('receipt',         pendingReceipt.blob, pendingReceipt.name);
        } else {
          payload = {
            event_id:         eventSel.value,
            type:             typeSel.value,
            amount:           document.getElementById('tx-amount').value,
            description:      document.getElementById('tx-desc').value,
            donor_name:       document.getElementById('tx-donor').value,
            transaction_date: document.getElementById('tx-date').value,
            use_allocation:   (typeSel.value === 'expense' && eventSel.value) ? useAlloc.checked : false
          };
        }

        const tx = await Api.transactions.create(payload);

        if (tx.warning) {
          UI.toast(tx.warning, 'warning');
        } else if (tx.over_budget_warning) {
          UI.toast('Transaction recorded, but event is OVER 90% BUDGET CAPACITY!', 'warning');
        } else {
          UI.toast('Transaction recorded successfully!', 'success');
        }

        form.reset();
        clearReceipt();
        useAlloc.checked = true;
        updateFundToggle();
        setTodayDate();
        await populateEventDropdown();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Transaction';
      }
    });
  }

  // ── Announcement ───────────────────────────────────────────────────────────
  function bindAnnouncementForm() {
    const form  = document.getElementById('add-announce-form');
    const errEl = document.getElementById('announce-error');
    const btn   = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Posting…';

      try {
        await Api.request('POST', '/announcements', {
          title: document.getElementById('announce-title').value,
          body:  document.getElementById('announce-body').value
        });
        UI.toast('Announcement posted! Students will be notified.', 'success');
        form.reset();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Post Announcement';
      }
    });
  }

  // ── Bulk CSV Import ────────────────────────────────────────────────────────
  function bindBulkImportForm() {
    const form  = document.getElementById('bulk-import-form');
    const errEl = document.getElementById('bulk-error');
    const btn   = document.getElementById('submit-bulk-btn');
    const tpl   = document.getElementById('download-csv-template');

    tpl.addEventListener('click', () => {
      const csvStr = "transaction_date,type,amount,description,donor_name\n" +
                     "2026-05-13,expense,150.00,Sound System Rental,\n" +
                     "2026-05-14,donation,500.00,Alumni Sponsorship,John Doe\n" +
                     "2026-05-15,collection,250.00,Ticket Sales,";
      const blob = new Blob([csvStr], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LGU_Transactions_Template.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.classList.add('hidden');
      
      const fileInput = document.getElementById('bulk-csv-file');
      const eventId   = document.getElementById('bulk-event-id').value;
      if (!fileInput.files.length) return;

      btn.disabled = true;
      btn.textContent = 'Parsing…';

      Papa.parse(fileInput.files[0], {
        header: true,
        skipEmptyLines: true,
        complete: async function(results) {
          try {
            if (results.errors && results.errors.length > 0) {
              throw new Error("CSV Parsing Error: " + results.errors[0].message);
            }
            
            const rows = results.data;
            if (!rows.length) throw new Error("CSV file is empty.");
            if (rows.length > 500) throw new Error("Maximum 500 transactions allowed per import.");

            const bulkData = rows.map((r, i) => {
              if (!r.amount || !r.type || !r.transaction_date || !r.description) {
                throw new Error(`Row ${i+2}: Missing required columns. Ensure the header matches the template.`);
              }
              return {
                event_id: eventId,
                transaction_date: r.transaction_date,
                type: String(r.type).toLowerCase().trim(),
                amount: parseFloat(r.amount),
                description: r.description,
                donor_name: r.donor_name || null
              };
            });

            btn.textContent = 'Importing Data…';
            const res = await Api.transactions.bulkCreate(bulkData);
            UI.toast(`Success! ${res.count} transactions imported.`, 'success');
            
            form.reset();
            await populateEventDropdown();
            // Optional: force a refresh of the transactions list if we were in that view
          } catch (err) {
            errEl.textContent = err.message || 'Import failed.';
            errEl.classList.remove('hidden');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Import Data';
            fileInput.value = ''; // Reset file input
          }
        },
        error: function(err) {
          errEl.textContent = "CSV Error: " + err.message;
          errEl.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Import Data';
        }
      });
    });
  }

  // ── Budget Transfer ───────────────────────────────────────────────────────
  function bindBudgetTransferForm() {
    const form    = document.getElementById('transfer-form');
    if (!form) return;
    const fromSelect = document.getElementById('transfer-from');
    const toSelect   = document.getElementById('transfer-to');
    const amountInp  = document.getElementById('transfer-amount');
    const errEl   = document.getElementById('transfer-error');
    const btn     = document.getElementById('submit-transfer-btn');

    const updatePreview = () => {
      const fromId = fromSelect.value;
      const toId   = toSelect.value;
      const amount = parseFloat(amountInp.value) || 0;
      const preview = document.getElementById('transfer-preview');

      if (!fromId && !toId) {
        preview.classList.add('hidden');
        return;
      }

      preview.classList.remove('hidden');
      const fromEv = _allEvents.find(e => e.id === fromId);
      const toEv   = _allEvents.find(e => e.id === toId);

      const fromBalEl = document.getElementById('tp-from-val');
      const toBalEl   = document.getElementById('tp-to-val');

      if (fromId === 'GENERAL') {
        const newBal = _genFundBalance - amount;
        fromBalEl.innerHTML = `${UI.currency(_genFundBalance)} <iconify-icon icon="solar:arrow-right-linear" style="font-size:12px"></iconify-icon> <span style="color:${newBal < 0 ? '#ef4444' : 'inherit'}">${UI.currency(newBal)}</span>`;
        if (newBal < 0) {
          errEl.textContent = "Insufficient funds in General Fund!";
          errEl.classList.remove('hidden');
          btn.disabled = true;
        } else {
          errEl.classList.add('hidden');
          btn.disabled = false;
        }
      } else if (fromId && fromEv) {
        const newBal = fromEv.remaining_budget - amount;
        fromBalEl.innerHTML = `${UI.currency(fromEv.remaining_budget)} <iconify-icon icon="solar:arrow-right-linear" style="font-size:12px"></iconify-icon> <span style="color:${newBal < 0 ? '#ef4444' : 'inherit'}">${UI.currency(newBal)}</span>`;
        if (newBal < 0) {
          errEl.textContent = "Source event has insufficient funds!";
          errEl.classList.remove('hidden');
          btn.disabled = true;
        } else {
          errEl.classList.add('hidden');
          btn.disabled = false;
        }
      } else {
        fromBalEl.textContent = '-';
      }

      if (toEv) {
        const newBal = toEv.remaining_budget + amount;
        toBalEl.innerHTML = `${UI.currency(toEv.remaining_budget)} <iconify-icon icon="solar:arrow-right-linear" style="font-size:12px"></iconify-icon> <span style="color:#22C55E">${UI.currency(newBal)}</span>`;
      } else {
        toBalEl.textContent = '-';
      }
};

    fromSelect.addEventListener('change', updatePreview);
    toSelect.addEventListener('change', updatePreview);
    amountInp.addEventListener('input', updatePreview);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Transferring…';

      try {
        const result = await Api.admin.transfer({
          from_event_id: fromSelect.value,
          to_event_id:   toSelect.value,
          amount:        amountInp.value,
          reason:        document.getElementById('transfer-reason').value,
        });
        UI.toast(result.message, 'success');
        form.reset();
        preview.classList.add('hidden');
        await populateEventDropdown();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm Transfer';
      }
    });
  }

  // ── Users Tab ─────────────────────────────────────────────────────────────
  async function loadUsers() {
    const container = document.getElementById('admin-tab-users');
    if (!container.innerHTML.includes('tx-search')) {
      container.innerHTML = `
        <div style="margin-bottom:1rem;">
          <input type="text" id="users-search" placeholder="Search users by name, email, or course…" style="width:100%;max-width:400px;padding:0.5rem;border-radius:4px;border:1px solid var(--col-border);background:var(--col-surface);color:white;font-size:0.9rem;" />
        </div>
        <div id="users-table-container"><div class="loading-state">Loading users…</div></div>
      `;
      document.getElementById('users-search').addEventListener('input', e => renderUsersTable(e.target.value.toLowerCase()));
    } else {
      document.getElementById('users-table-container').innerHTML = '<div class="loading-state">Loading users…</div>';
    }

    try {
      _allUsers = await Api.admin.users();
      renderUsersTable(document.getElementById('users-search').value.toLowerCase());
    } catch (err) {
      document.getElementById('users-table-container').innerHTML = `<div class="empty-state"><iconify-icon icon="solar:danger-triangle-linear"></iconify-icon> ${err.message}</div>`;
    }
  }

  function renderUsersTable(searchTerm = '') {
    const container = document.getElementById('users-table-container');
    const filtered = _allUsers.filter(u => 
      (u.full_name || '').toLowerCase().includes(searchTerm) ||
      (u.email || '').toLowerCase().includes(searchTerm) ||
      (u.course || '').toLowerCase().includes(searchTerm)
    );

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state">No users found.</div>`;
      return;
    }

    container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Course</th><th>Year</th><th>Role</th><th>Verification</th><th style="text-align:center;">Action</th></tr></thead>
            <tbody>
              ${filtered.map(u => `
                <tr>
                  <td><strong>${u.full_name || '-'}</strong></td>
                  <td style="font-size:.8rem;color:var(--text-secondary)">${u.email || '-'}</td>
                  <td style="font-size:.8rem">${u.course || '-'}</td>
                  <td style="font-size:.8rem">${u.year_level || '-'}</td>
                  <td>${UI.renderStatusBadge(u.role)}</td>
                  <td>
                    ${u.is_verified 
                      ? '<span style="font-size:0.75rem;padding:3px 10px;border-radius:12px;background:rgba(34,197,94,0.15);color:#22c55e;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><iconify-icon icon="solar:check-circle-bold"></iconify-icon> Verified</span>'
                      : '<span style="font-size:0.75rem;padding:3px 10px;border-radius:12px;background:rgba(245,158,11,0.15);color:#f59e0b;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><iconify-icon icon="solar:clock-circle-bold"></iconify-icon> Pending</span>'
                    }
                  </td>
                  <td style="text-align:center;">
                    <div style="display:flex;gap:4px;justify-content:center;">
                      ${!u.is_verified ? `
                        <button class="tx-action-btn" style="font-size:.8rem;padding:.3rem .7rem;background:#16a34a;color:white;border:none;border-radius:6px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;"
                          onclick="Admin.verifyUser('${u.id}', this)">
                          <iconify-icon icon="solar:letter-bold"></iconify-icon> Approve Account
                        </button>
                      ` : ''}
                      <button class="tx-action-btn" style="font-size:.8rem;padding:.3rem .7rem;"
                        onclick="Admin.toggleRole('${u.id}', '${u.role}', this)">
                        ${u.role === 'admin' ? 'Demote' : 'Promote to Admin'}
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
  }

  async function verifyUser(userId, btn) {
    if (!confirm('Are you sure you want to verify this user account? An automated approval email will be sent to their Gmail address.')) return;
    btn.disabled = true;
    btn.textContent = 'Sending Email…';
    try {
      const res = await Api.admin.verifyUser(userId);
      UI.toast(res.message || 'User account verified and approval email sent!', 'success');
      await loadUsers();
    } catch (err) {
      UI.toast(err.message || 'Failed to verify user account.', 'error');
      btn.disabled = false;
      btn.textContent = 'Approve Account';
    }
  }

  async function toggleRole(userId, currentRole, btn) {
    const newRole = currentRole === 'admin' ? 'student' : 'admin';
    if (!confirm(`Are you sure you want to ${newRole === 'admin' ? 'promote this user to Admin' : 'demote this user to Student'}?`)) return;
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await Api.admin.setRole(userId, newRole);
      UI.toast(`User role updated to "${newRole}".`, 'success');
      loadUsers();
    } catch (err) {
      UI.toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = currentRole === 'admin' ? 'Demote' : 'Promote to Admin';
    }
  }

  // ── Audit Log Tab ─────────────────────────────────────────────────────────
  let _auditPage = 1;
  const ADMIN_AUDIT_PAGE_SIZE = 10;

  async function loadAuditLog() {
    const container = document.getElementById('admin-tab-audit');
    if (!container.innerHTML.includes('audit-search')) {
      container.innerHTML = `
        <div style="margin-bottom:1rem;">
          <input type="text" id="audit-search" placeholder="Search by action, name, or detail snippets…" style="width:100%;max-width:400px;padding:0.5rem;border-radius:4px;border:1px solid var(--col-border);background:var(--col-surface);color:white;font-size:0.9rem;" />
        </div>
        <div id="audit-table-container"><div class="loading-state">Loading audit log…</div></div>
      `;
      document.getElementById('audit-search').addEventListener('input', e => {
        _auditPage = 1;
        renderAuditTable(e.target.value.toLowerCase());
      });
    } else {
      document.getElementById('audit-table-container').innerHTML = '<div class="loading-state">Loading audit log…</div>';
    }

    try {
      _allLogs = await Api.admin.auditLogs({ limit: 100 });
      _auditPage = 1;
      renderAuditTable(document.getElementById('audit-search').value.toLowerCase());
    } catch (err) {
      document.getElementById('audit-table-container').innerHTML = `<div class="empty-state"><iconify-icon icon="solar:danger-triangle-linear"></iconify-icon> ${err.message}</div>`;
    }
  }

  function renderAuditTable(searchTerm = '') {
    const container = document.getElementById('audit-table-container');
    const filtered = _allLogs.filter(log => 
      (log.action || '').toLowerCase().includes(searchTerm) ||
      (log.profiles?.full_name || '').toLowerCase().includes(searchTerm) ||
      JSON.stringify(log.details || {}).toLowerCase().includes(searchTerm)
    );

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state">No audit log entries matched.</div>';
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / ADMIN_AUDIT_PAGE_SIZE));
    if (_auditPage > totalPages) _auditPage = totalPages;
    if (_auditPage < 1) _auditPage = 1;

    const startIdx = (_auditPage - 1) * ADMIN_AUDIT_PAGE_SIZE;
    const pageRows = filtered.slice(startIdx, startIdx + ADMIN_AUDIT_PAGE_SIZE);

    const fmtDate = d => new Date(d).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const actionLabel = a => {
      const icons = {
        CREATE_TRANSACTION:       { icon: 'solar:add-circle-linear', color: '#22C55E', label: 'Created Transaction' },
        EDIT_TRANSACTION:         { icon: 'solar:pen-linear', color: '#F97316', label: 'Edited Transaction' },
        DELETE_TRANSACTION:       { icon: 'solar:trash-bin-trash-linear', color: '#ef4444', label: 'Deleted Transaction' },
        BULK_IMPORT_TRANSACTIONS: { icon: 'solar:upload-track-linear', color: '#3b82f6', label: 'Bulk Import' },
        CREATE_EVENT:             { icon: 'solar:calendar-add-linear', color: '#22C55E', label: 'Created Event' },
        UPDATE_EVENT:             { icon: 'solar:calendar-date-linear', color: '#F97316', label: 'Updated Event' },
        ARCHIVE_EVENT:            { icon: 'solar:box-minimalistic-linear', color: '#8b5cf6', label: 'Archived Event' },
        POST_ANNOUNCEMENT:        { icon: 'solar:bell-linear', color: '#f59e0b', label: 'Posted Announcement' },
        SET_USER_ROLE:            { icon: 'solar:shield-check-linear', color: '#6366f1', label: 'Changed User Role' },
        BUDGET_TRANSFER:          { icon: 'solar:card-transfer-linear', color: '#14b8a6', label: 'Budget Transfer' },
        OVER_BUDGET_ALERT:        { icon: 'solar:danger-triangle-linear', color: '#F59E0B', label: 'Over Budget Alert' },
      };
      const item = icons[a] || { icon: 'solar:info-circle-linear', color: 'var(--text-secondary)', label: a };
      return `
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <iconify-icon icon="${item.icon}" style="font-size:14px;color:${item.color}"></iconify-icon>
          <span style="font-size:.82rem">${item.label}</span>
        </div>`;
    };

    const formatDetails = (log) => {
      const d = log.details || {};
      try {
        switch (log.action) {
          case 'BUDGET_TRANSFER':
            return `₱${Number(d.amount).toLocaleString()} from "${d.from_event_name || 'Event'}" to "${d.to_event_name || 'Event'}". Reason: ${d.reason}`;
          case 'SET_USER_ROLE':
            return `Changed ${d.user_name || 'user'}'s role to ${UI.capitalize(d.new_role)}`;
          case 'CREATE_TRANSACTION':
            return `Added ${d.type}: "${d.description}" for ₱${Number(d.amount).toLocaleString()}`;
          case 'EDIT_TRANSACTION':
            return `Edited transaction. Reason: ${d.reason}`;
          case 'DELETE_TRANSACTION':
            return `Deleted "${d.description || 'Transaction'}". Reason: ${d.reason}`;
          case 'BULK_IMPORT_TRANSACTIONS':
            return `Bulk imported ${d.count || 0} transactions`;
          case 'CREATE_EVENT':
            return `Created event "${d.event_name}" with budget ₱${Number(d.allocated_budget).toLocaleString()}`;
          case 'UPDATE_EVENT': {
            const evName = d.event_name ? `"${d.event_name}"` : 'event';
            const changed = Array.isArray(d.changes)
              ? d.changes.filter(c => c !== 'updated_at').map(c => c.replace(/_/g, ' ')).join(', ')
              : (d.changes ? String(d.changes) : '');
            return `Updated ${evName}${changed ? `: modified ${changed}` : ''}`;
          }
          case 'ARCHIVE_EVENT':
            return `Archived event "${d.event_name}"`;
          case 'POST_ANNOUNCEMENT':
            return `Posted: "${d.title}"`;
          case 'OVER_BUDGET_ALERT':
            return `Budget Alert: ₱${Number(d.remaining_budget).toLocaleString()} remaining`;
          default:
            return JSON.stringify(d);
        }
      } catch (e) {
        return JSON.stringify(d);
      }
    };

    const start = (_auditPage - 1) * ADMIN_AUDIT_PAGE_SIZE + 1;
    const end = Math.min(_auditPage * ADMIN_AUDIT_PAGE_SIZE, filtered.length);

    let pagesHTML = '';
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= _auditPage - 1 && p <= _auditPage + 1)) {
        pagesHTML += `<button type="button" class="btn btn-ghost ${p === _auditPage ? 'active' : ''}" style="padding:0.25rem 0.6rem;font-size:0.8rem;${p === _auditPage ? 'background:var(--primary);color:#fff;font-weight:700;' : ''}" data-admin-page="${p}">${p}</button>`;
      } else if (p === _auditPage - 2 || p === _auditPage + 2) {
        pagesHTML += `<span style="color:var(--text-tertiary);padding:0 2px;">…</span>`;
      }
    }

    container.innerHTML = `
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              ${pageRows.map(log => `
                <tr>
                  <td style="font-size:.8rem;white-space:nowrap">${fmtDate(log.created_at)}</td>
                  <td style="font-size:.8rem">${log.profiles?.full_name || '-'}</td>
                  <td>${actionLabel(log.action)}</td>
                  <td style="font-size:.78rem;color:var(--text-secondary);max-width:300px;line-height:1.4;" title='${JSON.stringify(log.details || {}).replace(/'/g, '&apos;')}'>
                    ${formatDetails(log)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:0.5rem;">
          <span style="font-size:0.8rem;color:var(--text-secondary)">Showing ${start}–${end} of ${filtered.length} entries</span>
          <div style="display:flex;gap:0.35rem;align-items:center;">
            <button type="button" class="btn btn-ghost" id="admin-audit-prev" style="padding:0.25rem 0.6rem;font-size:0.8rem;" ${_auditPage <= 1 ? 'disabled' : ''}>Prev</button>
            ${pagesHTML}
            <button type="button" class="btn btn-ghost" id="admin-audit-next" style="padding:0.25rem 0.6rem;font-size:0.8rem;" ${_auditPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>`;

    document.getElementById('admin-audit-prev')?.addEventListener('click', () => {
      if (_auditPage > 1) { _auditPage--; renderAuditTable(searchTerm); }
    });
    document.getElementById('admin-audit-next')?.addEventListener('click', () => {
      if (_auditPage < totalPages) { _auditPage++; renderAuditTable(searchTerm); }
    });
    container.querySelectorAll('[data-admin-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        _auditPage = Number(btn.dataset.adminPage);
        renderAuditTable(searchTerm);
      });
    });
  }

  return { init, toggleRole, verifyUser };
})();
