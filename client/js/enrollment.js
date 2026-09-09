// =============================================
// enrollment.js - Student load verification (Phase B).
// Draft builder + status card. Grizz calls Enrollment.addFromGrizz(subject, reason).
// =============================================
const EnrollmentSection = (() => {

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const STATUS_LABELS = {
    draft: 'Draft',
    submitted: 'Submitted for evaluation',
    under_review: 'Under evaluation',
    approved: 'Approved',
    returned: 'Returned for changes',
    rejected: 'Rejected',
  };

  let subjects = [];
  let current = null; // active submission (with items)

  // ---- Load ----
  // Pilot gate: non-allowlisted accounts see a notice instead of the feature.
  function renderGatedNotice() {
    const section = document.getElementById('view-enrollment');
    if (!section) return;
    section.querySelector('.enrollment-grid')?.remove();
    let note = section.querySelector('.enrollment-gated');
    if (!note) {
      note = document.createElement('div');
      note.className = 'enrollment-gated';
      section.appendChild(note);
    }
    note.innerHTML = `
      <h3>🚧 Load Verification is still under development</h3>
      <p>This feature is being polished and will open for your account soon.
         You'll be notified once it's live.</p>`;
  }

  async function load() {
    const profile = await Auth.getProfile().catch(() => null);
    if (!window.isEnrollmentPilot?.(profile?.email)) {
      renderGatedNotice();
      return;
    }
    // checklists API validates exact casing ('BSCoE' | 'BSCE' | 'BSECE')
    const PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
    const upper = (profile?.course || '').trim().toUpperCase();
    const program = PROGRAMS.find(p => p.toUpperCase() === upper) || 'BSCoE';
    const year = Number(profile?.year_level || 0);
    if (year >= 1 && year <= 4) {
      activeYearFilter = String(year);
    } else {
      activeYearFilter = 'all';
    }

    const now = new Date();
    const sy = now.getMonth() >= 5
      ? `${now.getFullYear()}-${now.getFullYear() + 1}`
      : `${now.getFullYear() - 1}-${now.getFullYear()}`;

    const [checklists, mine] = await Promise.all([
      Api.units.checklists(program),
      Api.enrollment.my().catch(() => ({ submissions: [] })),
    ]);
    subjects = (checklists.subjects || []).filter(s => !year || s.year_level >= year - 1);

    const terms = mine.submissions || [];
    current = terms.find(s => s.school_year === sy) || terms[0] || null;
    if (!current) {
      try { current = (await Api.enrollment.createTerm(sy, 1)).submission; } catch { current = null; }
    }

    fillPicker();
    renderDraft();
    renderStatus();
  }

  // ---- Draft & Eligible Courses card ----
  let activeYearFilter = 'all';

  function renderYearFilterPills() {
    const filterEl = document.getElementById('enrollment-year-filter');
    if (!filterEl) return;

    if (!subjects.length) {
      filterEl.innerHTML = '';
      return;
    }

    const yearCounts = {
      'all': subjects.length,
      '1': subjects.filter(s => Number(s.year_level) === 1).length,
      '2': subjects.filter(s => Number(s.year_level) === 2).length,
      '3': subjects.filter(s => Number(s.year_level) === 3).length,
      '4': subjects.filter(s => Number(s.year_level) === 4).length,
    };

    const pills = [
      { key: 'all', label: 'All' },
      { key: '1', label: '1st Yr' },
      { key: '2', label: '2nd Yr' },
      { key: '3', label: '3rd Yr' },
      { key: '4', label: '4th Yr' },
    ];

    filterEl.innerHTML = pills.map(p => {
      const count = yearCounts[p.key] || 0;
      const isActive = activeYearFilter === p.key;
      return `
        <button type="button" class="year-pill ${isActive ? 'active' : ''}" data-year-filter="${p.key}">
          <span>${p.label}</span>
          <span class="year-pill-count">${count}</span>
        </button>
      `;
    }).join('');

    filterEl.querySelectorAll('[data-year-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeYearFilter = btn.dataset.yearFilter;
        renderYearFilterPills();
        renderEligibleList();
      });
    });
  }

  function fillPicker() {
    renderYearFilterPills();
    renderEligibleList();
  }

  function renderEligibleList() {
    const listEl = document.getElementById('enrollment-eligible-list');
    if (!listEl) return;

    const taken = new Set((current?.enrollment_submission_items || [])
      .filter(i => i.item_state !== 'removed_by_head')
      .map(i => i.subject_id));

    const canEdit = !current || ['draft', 'returned'].includes(current.status);

    const filtered = subjects.filter(s => {
      if (activeYearFilter === 'all') return true;
      return String(s.year_level) === activeYearFilter;
    });

    if (!filtered.length) {
      const yearText = activeYearFilter === 'all' ? 'this term' : `Year ${activeYearFilter}`;
      listEl.innerHTML = `<p class="enrollment-empty" style="grid-column: 1/-1; text-align: center; padding: 2rem 1rem; color: var(--text-tertiary);">No eligible courses found for ${yearText}.</p>`;
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const isAdded = taken.has(s.id);
      const unitsLabel = `${s.units || 3} Units`;

      return `
        <div class="eligible-course-card ${isAdded ? 'course-is-added' : ''}">
          <div class="eligible-course-head">
            <span class="eligible-course-code">${esc(s.code)}</span>
            <span class="eligible-units-badge">${unitsLabel}</span>
          </div>
          <div class="eligible-course-title" title="${esc(s.title)}">${esc(s.title)}</div>
          <div class="eligible-course-footer">
            <span class="eligible-course-term">
              <iconify-icon icon="solar:calendar-linear"></iconify-icon> Yr ${s.year_level} • Sem ${s.semester}
            </span>
            ${isAdded
              ? `<span class="course-added-tag"><iconify-icon icon="solar:check-circle-bold"></iconify-icon> Added</span>`
              : `<button type="button" class="btn-add-course" data-add-subject="${s.id}" ${canEdit ? '' : 'disabled'}>
                  <iconify-icon icon="solar:add-circle-linear"></iconify-icon> Add to Load
                </button>`
            }
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-add-subject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const subjectId = btn.dataset.addSubject;
        const res = await addItem(subjectId);
        if (!res.ok) {
          btn.disabled = false;
          show(res.error);
        }
      });
    });
  }

  function renderDraft() {
    const itemsEl = document.getElementById('enrollment-items');
    if (!itemsEl) return;
    const items = (current?.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');
    const total = items.reduce((sum, i) => sum + Number(i.subjects?.units || 0), 0);

    document.getElementById('enrollment-term-line').textContent =
      current ? `${current.school_year} · Semester ${current.semester} · ${items.length} subject(s) · ${total} units` : '';

    itemsEl.innerHTML = items.map(i => `
      <div class="enrollment-item-row" data-item="${i.id}">
        <span class="enrollment-item-code">${esc(i.subjects?.code)}</span>
        <span class="enrollment-item-title">${esc(i.subjects?.title)}</span>
        ${i.origin === 'grizz' ? `<span class="unit-badge unit-badge--none" style="width:auto;max-width:none;" title="${esc(i.grizz_reason || 'Recommended by Grizz')}">Grizz</span>` : ''}
        ${i.item_state === 'added_by_head' ? '<span class="unit-badge unit-badge--enrolled" style="width:auto;max-width:none;">Added by Program Head</span>' : ''}
        <button type="button" class="btn btn-ghost" data-remove-item="${i.id}" aria-label="Remove ${esc(i.subjects?.code)}">✕</button>
      </div>`).join('') || '<p class="enrollment-empty">No subjects in proposed load yet. Pick courses from the Eligible Courses grid.</p>';

    itemsEl.querySelectorAll('[data-remove-item]').forEach(btn =>
      btn.addEventListener('click', () => removeItem(btn.dataset.removeItem)));
  }

  // ---- Status card ----
  function renderStatus() {
    const body = document.getElementById('enrollment-status-body');
    if (!body) return;
    if (!current) {
      body.innerHTML = '<p class="enrollment-empty">No submission for this term yet.</p>';
      return;
    }
    const items = current.enrollment_submission_items || [];
    const changes = items
      .filter(i => i.item_state !== 'submitted' && i.head_note)
      .map(i => `<li>${i.item_state === 'removed_by_head' ? 'Removed' : 'Added'} <strong>${esc(i.subjects?.code)}</strong>: ${esc(i.head_note)}</li>`)
      .join('');
    body.innerHTML = `
      <p><strong>${STATUS_LABELS[current.status] || esc(current.status)}</strong></p>
      ${current.review_notes ? `<p class="enrollment-note">Program Head: ${esc(current.review_notes)}</p>` : ''}
      ${changes ? `<ul class="enrollment-changes">${changes}</ul>` : ''}
      ${current.encoded_at ? '<p class="enrollment-note">✓ Encoded by the registrar staff.</p>' : ''}
      ${current.status === 'approved' ? '<p class="enrollment-note">Your subjects are now enrolled in your Academic Progress tab.</p>' : ''}`;
  }

  // ---- Actions ----
  async function addItem(subjectId, grizzReason) {
    if (!current) return { ok: false, error: 'Load not ready — open Load Verification first.' };
    if (!subjectId) return { ok: false, error: 'No subject selected.' };
    try {
      const { item } = await Api.enrollment.addItem(current.id, subjectId, grizzReason);
      current.enrollment_submission_items = current.enrollment_submission_items || [];
      current.enrollment_submission_items.push(item);
      fillPicker();
      renderDraft();
      return { ok: true, item };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function removeItem(itemId) {
    if (!current) return;
    try {
      await Api.enrollment.removeItem(current.id, itemId);
      current.enrollment_submission_items = (current.enrollment_submission_items || []).filter(i => i.id !== itemId);
      fillPicker();
      renderDraft();
    } catch (err) { show(err.message); }
  }

  async function submit() {
    if (!current) return;
    try {
      const { submission } = await Api.enrollment.submit(current.id);
      current = submission;
      renderStatus();
      UI.toast('Load submitted for verification.', 'success');
    } catch (err) { show(err.message); }
  }

  function show(msg) {
    const el = document.getElementById('enrollment-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('enrollment-submit-btn')?.addEventListener('click', submit);
  });

  // Phase C hook surface (spec 2026-09-08): Grizz reads state and pushes subjects.
  window.Enrollment = {
    addFromGrizz: (subject, reason) => addItem(subject?.id, reason || 'Recommended by Grizz'),
    ensureReady: load, // loads profile + checklists + submissions; creates the term draft if none
    canEdit: () => !!current && ['draft', 'returned'].includes(current.status),
    lockedReason: () => ({
      submitted: 'Submitted — with your Program Head',
      under_review: 'Under evaluation',
      approved: 'Approved — locked',
      rejected: 'Rejected',
    }[current?.status] || ''),
    draftSubjectIds: () => new Set((current?.enrollment_submission_items || [])
      .filter(i => i.item_state !== 'removed_by_head').map(i => i.subject_id)),
  };

  return { load };
})();
