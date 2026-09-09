// =============================================
// enrollment.js - Student Enrollment Verification (Phase B).
// Draft builder + journey/status card. Grizz calls Enrollment.addFromGrizz(subject, reason).
// =============================================
const EnrollmentSection = (() => {

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const EJ = window.EnrollmentJourney;

  let subjects = [];
  let current = null; // active submission (with items)
  let program = 'COE';

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
      <h3>Enrollment Verification is being rolled out</h3>
      <p>This feature is still in a controlled pilot. It will open for your account soon, and you'll be notified once it's live.</p>`;
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
    program = PROGRAMS.find(p => p.toUpperCase() === upper) || 'COE';
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
    renderAll();
  }

  function renderAll() {
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

    const taken = new Set(EJ.activeItems(current).map(i => i.subject_id));
    const canEdit = EJ.canEdit(current);

    const filtered = subjects.filter(s => {
      if (activeYearFilter === 'all') return true;
      return String(s.year_level) === activeYearFilter;
    });

    if (!filtered.length) {
      const yearText = activeYearFilter === 'all' ? 'this semester' : `Year ${activeYearFilter}`;
      listEl.innerHTML = `<p class="enrollment-empty ev-eligible-empty">No eligible courses found for ${yearText}.</p>`;
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
    const items = EJ.activeItems(current);
    const total = items.reduce((sum, i) => sum + Number(i.subjects?.units || 0), 0);
    const canEdit = EJ.canEdit(current);

    const termEl = document.getElementById('enrollment-term-line');
    if (termEl) {
      termEl.textContent = current
        ? `${current.school_year} · Semester ${current.semester} · ${items.length} subject${items.length === 1 ? '' : 's'} · ${total} units`
        : '';
    }

    itemsEl.innerHTML = items.map(i => `
      <div class="enrollment-item-row" data-item="${i.id}">
        <span class="enrollment-item-code">${esc(i.subjects?.code)}</span>
        <span class="enrollment-item-title">${esc(i.subjects?.title)}</span>
        ${i.origin === 'grizz' ? `<span class="unit-badge unit-badge--none" style="width:auto;max-width:none;" title="${esc(i.grizz_reason || 'Recommended by Grizz')}">Grizz</span>` : ''}
        ${i.item_state === 'added_by_head' ? '<span class="unit-badge unit-badge--enrolled" style="width:auto;max-width:none;">Added by Program Head</span>' : ''}
        ${canEdit
          ? `<button type="button" class="btn btn-ghost" data-remove-item="${i.id}" aria-label="Remove ${esc(i.subjects?.code)}">✕</button>`
          : ''}
      </div>`).join('')
      || (canEdit
          ? '<p class="enrollment-empty">No subjects in your proposed load yet. Pick courses from the Eligible Courses list below, or ask Grizz for recommendations.</p>'
          : '<p class="enrollment-empty">No subjects in your proposed load.</p>');

    itemsEl.querySelectorAll('[data-remove-item]').forEach(btn =>
      btn.addEventListener('click', () => removeItem(btn.dataset.removeItem)));

    // Locked hint under the draft list
    const lockedNote = document.getElementById('enrollment-locked-note');
    if (lockedNote) {
      if (current && ['submitted', 'under_review'].includes(current.status)) {
        lockedNote.classList.remove('hidden');
        lockedNote.innerHTML = '<iconify-icon icon="solar:lock-linear" style="font-size:0.9rem;"></iconify-icon> This load is locked while your Program Head reviews it.';
      } else if (current && current.status === 'approved') {
        lockedNote.classList.remove('hidden');
        lockedNote.innerHTML = '<iconify-icon icon="solar:lock-keyhole-linear" style="font-size:0.9rem;"></iconify-icon> Verified by your Program Head — your load is locked.';
      } else {
        lockedNote.classList.add('hidden');
      }
    }
  }

  // ---- Journey + status card ----
  function statusMeta() {
    if (!current) {
      return {
        chipTone: 'neutral', chipLabel: 'No open submission',
        statusHtml: '<p class="ev-status-copy">We couldn\'t find an open enrollment term for you yet. If you expected one, contact the COE office.</p>',
        metaHtml: '',
      };
    }
    const step = EJ.stepOf(current);
    const tone = EJ.toneFor(current);
    const chipLabel = {
      draft: 'Build your load',
      submitted: 'With your Program Head',
      under_review: 'Program Head is reviewing',
      approved: current.encoded_at ? 'Encoded — done' : 'Verified — final load',
    }[current.status] || (step.state === 'defensive' ? 'Not editable' : current.status);
    const chipTone = {
      draft: 'neutral', submitted: 'warning', under_review: 'warning', approved: 'success',
    }[current.status] || 'danger';

    const items = EJ.activeItems(current);
    return {
      chipTone, chipLabel,
      statusHtml: buildStatusHtml(current, items),
      metaHtml: statusMetaLine(current),
    };
  }

  function statusMetaLine(s) {
    if ((s.status === 'submitted' || s.status === 'under_review') && s.submitted_at) {
      return `With your Program Head since ${UI.dateStr(s.submitted_at)}.`;
    }
    if (s.status === 'approved' && !s.encoded_at && s.reviewed_at) {
      return `Verified on ${UI.dateStr(s.reviewed_at)}.`;
    }
    if (s.status === 'approved' && s.encoded_at) {
      return `Encoded on ${UI.dateStr(s.encoded_at)}.`;
    }
    return '';
  }

  function buildStatusHtml(s, items) {
    const step = EJ.stepOf(s);
    if (step.state === 'defensive') {
      return `<div class="ev-defensive-card"><strong>This submission is no longer editable.</strong><br/>Contact your Program Head or the COE office for help.</div>`;
    }
    if (s.status === 'draft') {
      const total = items.reduce((sum, i) => sum + Number(i.subjects?.units || 0), 0);
      return `<p class="ev-status-copy">${items.length} subject${items.length === 1 ? '' : 's'} (${total} units) in your proposed load. When it's ready, submit it to your <strong>${esc(program)}</strong> Program Head for review.</p>`;
    }
    if (s.status === 'submitted' || s.status === 'under_review') {
      return `<p class="ev-status-copy">Your proposed load for <strong>Semester ${esc(s.semester)}</strong> was sent to your <strong>${esc(program)}</strong> Program Head. You'll be notified when they respond.</p>`;
    }
    if (s.status === 'approved') {
      const listHtml = items.map(i => `
        <li class="enrollment-item-row" style="border-bottom:none;padding:0.35rem 0;">
          <span class="enrollment-item-code">${esc(i.subjects?.code)}</span>
          <span class="enrollment-item-title">${esc(i.subjects?.title)}</span>
        </li>`).join('');
      const headChanges = headChangeLines(s);
      if (s.encoded_at) {
        return `
          <div class="ev-done-card">
            <h4><iconify-icon icon="solar:check-circle-bold"></iconify-icon> Your load is encoded</h4>
            <p>Your final load has been encoded by the <strong>Student Assistant</strong>. Enrollment inside this system is complete. The next step — assessment and claiming — happens at the <strong>University Registrar</strong>, outside this system.</p>
          </div>
          <ul style="list-style:none;margin:0.8rem 0 0 0;padding:0;">${listHtml}</ul>`;
      }
      return `
        <div class="ev-done-card">
          <h4><iconify-icon icon="solar:verified-check-bold"></iconify-icon> Verified — your final load</h4>
          <p>Your Program Head verified your load. This is the <strong>final list of subjects</strong> you will enroll this semester. Waiting for the Student Assistant to encode it.</p>
        </div>
        ${headChanges}
        <ul style="list-style:none;margin:0.8rem 0 0 0;padding:0;">${listHtml}</ul>
        <p class="ev-final-list-note">A copy of this final list was emailed to you. Nothing needed from you right now.</p>`;
    }
    return '';
  }

  function headChangeLines(s) {
    const rows = (s.enrollment_submission_items || [])
      .filter(i => i.item_state !== 'submitted' && i.head_note)
      .map(i => `<li>${i.item_state === 'removed_by_head' ? 'Removed' : 'Added'} <strong>${esc(i.subjects?.code)}</strong> — ${esc(i.head_note)}</li>`);
    return rows.length ? `<ul class="enrollment-changes">${rows.join('')}</ul>` : '';
  }

  function renderStatus() {
    const body = document.getElementById('enrollment-status-body');
    if (!body) return;
    const trackEl = document.getElementById('enrollment-journey-track');
    const actionEl = document.getElementById('enrollment-action-area');

    const meta = statusMeta();
    if (trackEl) trackEl.innerHTML = renderTrack();
    body.innerHTML = `
      <span class="ev-chip ev-chip--${meta.chipTone}">${esc(meta.chipLabel)}</span>
      ${meta.statusHtml}
      ${meta.metaHtml ? `<p class="ev-status-meta">${esc(meta.metaHtml)}</p>` : ''}`;

    if (actionEl) actionEl.innerHTML = renderAction();
  }

  function renderTrack() {
    const step = EJ.stepOf(current);
    const compact = window.matchMedia('(max-width: 480px)').matches;
    const trackClass = compact ? 'ev-track ev-track--compact' : 'ev-track';
    if (!current || step.state === 'defensive') {
      return `<ol class="${trackClass}" aria-label="Enrollment steps"></ol>`;
    }
    const iconFor = i => {
      if (i < step.stepIndex) return 'solar:check-bold';
      if (i === step.stepIndex) return 'solar:' + currentStepIcon();
      return '';
    };
    return `<ol class="${trackClass}" aria-label="Enrollment steps">` + EJ.STEPS.map((s, i) => {
      const state = i < step.stepIndex ? 'done' : (i === step.stepIndex ? 'current' : 'upcoming');
      const icon = iconFor(i);
      return `
        <li class="ev-step ev-step--${state}">
          <span class="ev-step-dot" aria-hidden="true">${icon ? `<iconify-icon icon="${icon}"></iconify-icon>` : ''}</span>
          <span class="ev-step-label">${s.label}</span>
        </li>`;
    }).join('') + '</ol>';
  }

  function currentStepIcon() {
    if (!current) return 'clock-circle-linear';
    if (current.status === 'draft') return 'pen-new-square-linear';
    if (current.status === 'submitted' || current.status === 'under_review') return 'clock-circle-linear';
    if (current.status === 'approved') return current.encoded_at ? 'check-circle-bold' : 'verified-check-bold';
    return 'clock-circle-linear';
  }

  function renderAction() {
    const action = EJ.actionFor(current);
    const hint = action.hint ? `<p class="ev-action-hint">${esc(action.hint)}</p>` : '';
    if (action.kind === 'submit') {
      return `<button type="button" class="btn btn-primary" id="enrollment-submit-btn">
                <iconify-icon icon="solar:plain-3-linear" style="font-size:1.1rem;"></iconify-icon>
                <span>${esc(action.label)}</span>
              </button>`;
    }
    return hint;
  }

  // ---- Actions ----
  async function addItem(subjectId, grizzReason) {
    if (!current) return { ok: false, error: 'Enrollment is not ready — open the Enrollment Verification screen first.' };
    if (!subjectId) return { ok: false, error: 'No subject selected.' };
    try {
      const { item } = await Api.enrollment.addItem(current.id, subjectId, grizzReason);
      current.enrollment_submission_items = current.enrollment_submission_items || [];
      current.enrollment_submission_items.push(item);
      fillPicker();
      renderAll();
      return { ok: true, item };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function removeItem(itemId) {
    if (!current || !EJ.canEdit(current)) return;
    try {
      await Api.enrollment.removeItem(current.id, itemId);
      current.enrollment_submission_items = (current.enrollment_submission_items || []).filter(i => i.id !== itemId);
      fillPicker();
      renderAll();
    } catch (err) { show(err.message); }
  }

  async function submit() {
    if (!current || !EJ.canEdit(current)) return;
    const items = EJ.activeItems(current);
    if (!items.length) { show('Add at least one subject before submitting.'); return; }
    const total = items.reduce((sum, i) => sum + Number(i.subjects?.units || 0), 0);
    const ok = window.confirm(`Submit ${items.length} subject${items.length === 1 ? '' : 's'} (${total} units) to the ${program} Program Head?`);
    if (!ok) return;
    try {
      const { submission } = await Api.enrollment.submit(current.id);
      current = submission;
      renderAll();
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

  // Action delegation (the action button is rendered dynamically).
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('enrollment-action-area')?.addEventListener('click', e => {
      if (e.target.closest('#enrollment-submit-btn')) submit();
    });
  });

  // Phase C hook surface (spec 2026-09-08): Grizz reads state and pushes subjects.
  window.Enrollment = {
    addFromGrizz: (subject, reason) => addItem(subject?.id, reason || 'Recommended by Grizz'),
    ensureReady: load, // loads profile + checklists + submissions; creates the term draft if none
    canEdit: () => EJ.canEdit(current),
    lockedReason: () => {
      if (!current) return '';
      if (current.status === 'draft') return '';
      if (current.status === 'approved') {
        return current.encoded_at ? 'Encoded — your load is locked' : 'Verified — your final load is locked';
      }
      return 'Submitted — your load is with your Program Head';
    },
    draftSubjectIds: () => EJ.activeItems(current).reduce((set, i) => (set.add(i.subject_id), set), new Set()),
  };

  return { load };
})();
