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
  async function load() {
    const profile = await Auth.getProfile().catch(() => null);
    const program = (profile?.course || '').trim().toUpperCase() || 'BSCoE';
    const year = Number(profile?.year_level || 0);
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

  // ---- Draft card ----
  function fillPicker() {
    const sel = document.getElementById('enrollment-subject-select');
    if (!sel) return;
    const taken = new Set((current?.enrollment_submission_items || [])
      .filter(i => i.item_state !== 'removed_by_head')
      .map(i => i.subject_id));
    sel.innerHTML = subjects
      .filter(s => !taken.has(s.id))
      .map(s => `<option value="${s.id}">${esc(s.code)} — ${esc(s.title)} (${s.units}u)</option>`)
      .join('');
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
      </div>`).join('') || '<p class="enrollment-empty">No subjects yet — add from the list below.</p>';

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
    if (!current || !subjectId) return;
    try {
      const { item } = await Api.enrollment.addItem(current.id, subjectId, grizzReason);
      current.enrollment_submission_items = current.enrollment_submission_items || [];
      current.enrollment_submission_items.push(item);
      fillPicker();
      renderDraft();
    } catch (err) { show(err.message); }
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
    document.getElementById('enrollment-add-btn')?.addEventListener('click', () => {
      const sel = document.getElementById('enrollment-subject-select');
      if (sel?.value) addItem(sel.value);
    });
    document.getElementById('enrollment-submit-btn')?.addEventListener('click', submit);
  });

  // Phase C hook: Grizz-recommended subjects land here with their reason.
  window.Enrollment = { addFromGrizz: (subject, reason) => addItem(subject.id, reason || 'Recommended by Grizz') };

  return { load };
})();
