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
  let records = [];         // the student's subject records (newest first)
  let prereqRows = [];      // structured subject_prerequisites rows
  let yearLevel = 0;        // 0 = no year window
  let maxUnits = null;      // curriculum_requirements.max_units_per_term, null = no cap
  let passedCodes = new Set();
  let enrolledCodes = new Set();
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

    const [checklists, mine, myUnits] = await Promise.all([
      Api.units.checklists(program),
      Api.enrollment.my().catch(() => ({ submissions: [] })),
      Api.units.my().catch(() => []),
    ]);
    // The eligibility window (one year below, retakes from any year) is
    // applied per render by EJ.eligibleSubjects, so keep the whole checklist.
    subjects = checklists.subjects || [];
    records = Array.isArray(myUnits) ? myUnits : [];
    yearLevel = year;
    prereqRows = checklists.prerequisites || [];
    const req = (checklists.requirements || []).find(r => r.program === program);
    maxUnits = req && req.max_units_per_term != null ? Number(req.max_units_per_term) : null;

    const passes = (window.GrizzRecommend && window.GrizzRecommend.classifyPasses)
      ? window.GrizzRecommend.classifyPasses(records)
      : null;
    passedCodes = passes ? passes.passedCodes : new Set();
    enrolledCodes = passes ? passes.enrolledCodes : new Set();

    const terms = mine.submissions || [];
    current = terms.find(s => s.school_year === sy) || terms[0] || null;
    if (!current) {
      try { current = (await Api.enrollment.createTerm(sy, 1)).submission; } catch { current = null; }
    }
    // A load belongs to one semester: start the picker on that semester.
    if (current && current.semester) activeSemFilter = String(current.semester);

    fillPicker();
    renderAll();
    subscribeRealtime();
  }

  let realtimeChannel = null;
  function subscribeRealtime() {
    if (!window.supabaseClient || typeof window.supabaseClient.channel !== 'function') return;
    if (realtimeChannel) return;

    realtimeChannel = window.supabaseClient
      .channel('enrollment-student-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollment_submissions' }, async (payload) => {
        if (current && payload.new && payload.new.id === current.id) {
          const oldStatus = current.status;
          await load();
          if (oldStatus !== payload.new.status && typeof UI !== 'undefined' && UI.toast) {
            UI.toast('Your enrollment status was updated in real time.', 'info');
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollment_submission_items' }, async (payload) => {
        if (current && ((payload.new && payload.new.submission_id === current.id) || (payload.old && payload.old.submission_id === current.id))) {
          await load();
        }
      })
      .subscribe();
  }

  function renderAll() {
    renderDraft();
    renderStatus();
  }

  // ---- Draft & Eligible Courses card ----
  let activeYearFilter = 'all';
  let activeSemFilter = 'all';

  // Curriculum subjects still open to the student: not passed, not enrolled,
  // inside the year window, plus failed subjects from any year (retakes).
  function availableSubjects() {
    return EJ.eligibleSubjects(subjects, records, yearLevel);
  }

  function renderFilterSelects() {
    renderSemFilterSelect();
    renderYearFilterSelect();
    initFilterSelectListeners();
    if (typeof Dropdowns !== 'undefined' && typeof Dropdowns.syncAll === 'function') {
      Dropdowns.syncAll();
    }
  }

  function renderSemFilterSelect() {
    const sel = document.getElementById('enrollment-sem-select');
    if (!sel) return;

    const pool = availableSubjects();
    if (!pool.length) {
      sel.innerHTML = '<option value="all">Both Semesters</option>';
      return;
    }

    const yearFiltered = pool.filter(s => {
      if (activeYearFilter === 'all') return true;
      return String(s.year_level) === activeYearFilter;
    });

    const semCounts = {
      'all': yearFiltered.length,
      '1': yearFiltered.filter(s => Number(s.semester) === 1).length,
      '2': yearFiltered.filter(s => Number(s.semester) === 2).length,
    };

    const options = [
      { key: 'all', label: 'Both Semesters' },
      { key: '1', label: '1st Semester' },
      { key: '2', label: '2nd Semester' },
    ];

    sel.innerHTML = options.map(o => {
      const count = semCounts[o.key] || 0;
      const selected = activeSemFilter === o.key ? 'selected' : '';
      return `<option value="${o.key}" ${selected}>${o.label} (${count})</option>`;
    }).join('');
  }

  function renderYearFilterSelect() {
    const sel = document.getElementById('enrollment-year-select');
    if (!sel) return;

    const pool = availableSubjects();
    if (!pool.length) {
      sel.innerHTML = '<option value="all">All Year Levels</option>';
      return;
    }

    const semFiltered = pool.filter(s => {
      if (activeSemFilter === 'all') return true;
      return String(s.semester) === activeSemFilter;
    });

    // Retakes count under every year so the counts match what the list shows.
    const inYear = y => semFiltered.filter(s => s.retake || Number(s.year_level) === y).length;
    const yearCounts = { 'all': semFiltered.length, '1': inYear(1), '2': inYear(2), '3': inYear(3), '4': inYear(4) };

    const options = [
      { key: 'all', label: 'All Year Levels' },
      { key: '1', label: '1st Year' },
      { key: '2', label: '2nd Year' },
      { key: '3', label: '3rd Year' },
      { key: '4', label: '4th Year' },
    ];

    sel.innerHTML = options.map(o => {
      const count = yearCounts[o.key] || 0;
      const selected = activeYearFilter === o.key ? 'selected' : '';
      return `<option value="${o.key}" ${selected}>${o.label} (${count})</option>`;
    }).join('');
  }

  function initFilterSelectListeners() {
    const semSel = document.getElementById('enrollment-sem-select');
    const yearSel = document.getElementById('enrollment-year-select');

    if (semSel && !semSel.dataset.bound) {
      semSel.dataset.bound = 'true';
      semSel.addEventListener('change', (e) => {
        activeSemFilter = e.target.value;
        renderFilterSelects();
        renderEligibleList();
      });
    }

    if (yearSel && !yearSel.dataset.bound) {
      yearSel.dataset.bound = 'true';
      yearSel.addEventListener('change', (e) => {
        activeYearFilter = e.target.value;
        renderFilterSelects();
        renderEligibleList();
      });
    }
  }

  function fillPicker() {
    renderFilterSelects();
    renderEligibleList();
  }

  function renderEligibleList() {
    const listEl = document.getElementById('enrollment-eligible-list');
    if (!listEl) return;

    const taken = new Set(EJ.activeItems(current).map(i => i.subject_id));
    const canEdit = EJ.canEdit(current);
    const pool = availableSubjects();

    // A retake is a state, not a year: it stays visible under every year filter.
    const filtered = pool.filter(s => {
      const matchYear = s.retake || activeYearFilter === 'all' || String(s.year_level) === activeYearFilter;
      const matchSem = activeSemFilter === 'all' || String(s.semester) === activeSemFilter;
      return matchYear && matchSem;
    });

    if (!filtered.length) {
      if (!pool.length) {
        listEl.innerHTML = '<p class="enrollment-empty ev-eligible-empty">You\'ve already passed or are currently taking every course in your program\'s curriculum.</p>';
        return;
      }
      let filterText = '';
      if (activeSemFilter !== 'all' && activeYearFilter !== 'all') {
        filterText = `Year ${activeYearFilter}, ${activeSemFilter === '1' ? '1st' : '2nd'} Sem`;
      } else if (activeSemFilter !== 'all') {
        filterText = `${activeSemFilter === '1' ? '1st' : '2nd'} Sem`;
      } else if (activeYearFilter !== 'all') {
        filterText = `Year ${activeYearFilter}`;
      } else {
        filterText = 'this semester';
      }
      listEl.innerHTML = `<p class="enrollment-empty ev-eligible-empty">No eligible courses found for ${filterText}.</p>`;
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const isAdded = taken.has(s.id);
      const unitsLabel = `${s.units || 3} Units`;
      const unmet = EJ.unmetPrerequisites(s, prereqRows, passedCodes);
      const blocked = unmet.length > 0;
      const cardClass = ['eligible-course-card', isAdded ? 'course-is-added' : '', blocked ? 'course-is-blocked' : ''].join(' ').trim();
      const note = blocked
        ? `<p class="eligible-course-note"><iconify-icon icon="solar:lock-linear" aria-hidden="true"></iconify-icon> Needs ${unmet.map(esc).join(', ')}</p>`
        : '';

      return `
        <div class="${cardClass}">
          <div class="eligible-course-head">
            <span class="eligible-course-code">${esc(s.code)}</span>
            <span class="eligible-course-badges">
              ${s.retake ? '<span class="eligible-retake-badge">Retake</span>' : ''}
              <span class="eligible-units-badge">${unitsLabel}</span>
            </span>
          </div>
          <div class="eligible-course-title" title="${esc(s.title)}">${esc(s.title)}</div>
          ${note}
          <div class="eligible-course-footer">
            <span class="eligible-course-term">
              <iconify-icon icon="solar:calendar-linear"></iconify-icon> Yr ${s.year_level} • Sem ${s.semester}
            </span>
            ${isAdded
              ? `<span class="course-added-tag"><iconify-icon icon="solar:check-circle-bold"></iconify-icon> Added</span>`
              : `<button type="button" class="btn-add-course" data-add-subject="${s.id}" ${canEdit && !blocked ? '' : 'disabled'} aria-label="Add ${esc(s.code)} to load"${blocked ? ` title="Pass ${unmet.map(esc).join(', ')} first"` : ''}>
                  <iconify-icon icon="solar:add-circle-linear"></iconify-icon> Add to Load
                </button>`
            }
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-add-subject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const subjectId = btn.dataset.addSubject;
        const subject = subjects.find(s => s.id === subjectId);
        // Refuse the other semester's subject before any request is sent.
        const mismatch = EJ.semesterMismatch(subject, current);
        if (mismatch) { show(mismatch); return; }
        btn.disabled = true;
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
      const load = EJ.loadUnits(current, maxUnits);
      const unitsText = load.cap != null ? `${load.total} of ${load.cap} units` : `${total} units`;
      termEl.textContent = current
        ? `${current.school_year} · Semester ${current.semester} · ${items.length} subject${items.length === 1 ? '' : 's'} · ${unitsText}`
        : '';
      termEl.classList.toggle('is-over-cap', load.over);
      if (load.over) termEl.textContent += ` (limit is ${load.cap})`;
    }

    itemsEl.innerHTML = items.map(i => `
      <div class="enrollment-item-row" data-item="${i.id}">
        <span class="enrollment-item-code">${esc(i.subjects?.code)}</span>
        <span class="enrollment-item-title">${esc(i.subjects?.title)}</span>
        ${i.origin === 'grizz' ? `<span class="unit-badge unit-badge--none" style="width:auto;max-width:none;" title="${esc(i.grizz_reason || 'Recommended by Grizz')}">Grizz</span>` : ''}
        ${i.item_state === 'added_by_head' ? '<span class="unit-badge unit-badge--enrolled" style="width:auto;max-width:none;">Added by Program Head</span>' : ''}
        ${canEdit
          ? `<button type="button" class="btn btn-ghost" data-remove-item="${i.id}" aria-label="Remove ${esc(i.subjects?.code)}"><iconify-icon icon="solar:close-circle-linear" aria-hidden="true"></iconify-icon></button>`
          : ''}
      </div>`).join('')
      || (canEdit
          ? '<p class="enrollment-empty">No subjects in your proposed load yet. Pick courses from the Eligible Courses list below, or ask Grizz for recommendations.</p>'
          : '<p class="enrollment-empty">No subjects in your proposed load.</p>');

    itemsEl.querySelectorAll('[data-remove-item]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const item = items.find(i => i.id === btn.dataset.removeItem);
        const code = item?.subjects?.code || 'this subject';
        const ok = await UI.confirmDialog({
          title: `Remove ${code} from your load?`,
          message: 'You can add it back from the eligible courses while the load is still a draft.',
          confirmLabel: 'Remove',
          danger: true,
        });
        if (ok) removeItem(btn.dataset.removeItem);
      }));

    // Locked hint under the draft list
    const lockedNote = document.getElementById('enrollment-locked-note');
    if (lockedNote) {
      if (current && ['submitted', 'under_review'].includes(current.status)) {
        lockedNote.classList.remove('hidden');
        lockedNote.innerHTML = '<iconify-icon icon="solar:lock-linear" style="font-size:0.9rem;"></iconify-icon> This load is locked while your Program Head reviews it.';
      } else if (current && current.status === 'approved') {
        lockedNote.classList.remove('hidden');
        lockedNote.innerHTML = '<iconify-icon icon="solar:lock-keyhole-linear" style="font-size:0.9rem;"></iconify-icon> Verified by your Program Head: your load is locked.';
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
      approved: current.encoded_at ? 'Encoded: Done' : 'Verified: Final Load',
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
        <li class="enrollment-item-row">
          <span class="enrollment-item-code">${esc(i.subjects?.code)}</span>
          <span class="enrollment-item-title">${esc(i.subjects?.title)}</span>
        </li>`).join('');
      const headChanges = headChangeLines(s);
      if (s.encoded_at) {
        return `
          <div class="ev-done-card">
            <h4><iconify-icon icon="solar:check-circle-bold"></iconify-icon> Your load is encoded</h4>
            <p>Your final load has been encoded by the <strong>Student Assistant</strong>. Enrollment inside this system is complete. The next step (assessment and claiming) happens at the <strong>University Registrar</strong>, outside this system.</p>
          </div>
          <ul class="ev-final-list">${listHtml}</ul>`;
      }
      return `
        <div class="ev-done-card">
          <h4><iconify-icon icon="solar:verified-check-bold"></iconify-icon> Verified: Final Load</h4>
          <p>Your Program Head verified your load. This is the <strong>final list of subjects</strong> you will enroll this semester. Waiting for the Student Assistant to encode it.</p>
        </div>
        ${headChanges}
        <ul class="ev-final-list">${listHtml}</ul>
        <p class="ev-final-list-note">A copy of this final list was emailed to you. Nothing needed from you right now.</p>`;
    }
    return '';
  }

  function headChangeLines(s) {
    const rows = (s.enrollment_submission_items || [])
      .filter(i => i.item_state !== 'submitted' && i.head_note)
      .map(i => `<li>${i.item_state === 'removed_by_head' ? 'Removed' : 'Added'} <strong>${esc(i.subjects?.code)}</strong>: ${esc(i.head_note)}</li>`);
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
      if (i < step.stepIndex) return 'solar:check-circle-bold';
      if (i === step.stepIndex) return currentStepIcon();
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

  // Full icon names (not bare suffixes) so scripts/generate-icon-bundle.mjs can
  // find and bundle them.
  function currentStepIcon() {
    if (!current) return 'solar:clock-circle-linear';
    if (current.status === 'draft') return 'solar:pen-new-square-linear';
    if (current.status === 'submitted' || current.status === 'under_review') return 'solar:clock-circle-linear';
    if (current.status === 'approved') return current.encoded_at ? 'solar:check-circle-bold' : 'solar:verified-check-bold';
    return 'solar:clock-circle-linear';
  }

  function renderAction() {
    const action = EJ.actionFor(current);
    // The waiting states already say "you will be notified" in the status
    // body above; repeating it here read as two identical sentences.
    const waiting = current && (current.status === 'submitted' || current.status === 'under_review');
    const hint = action.hint && !waiting ? `<p class="ev-action-hint">${esc(action.hint)}</p>` : '';
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
    if (!current) return { ok: false, error: 'Enrollment is not ready: open the Enrollment Verification screen first.' };
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

  const _removing = new Set(); // item ids with a remove request in flight

  async function removeItem(itemId) {
    if (!current || !EJ.canEdit(current) || _removing.has(itemId)) return;
    _removing.add(itemId);
    clearError();
    try {
      await Api.enrollment.removeItem(current.id, itemId);
      current.enrollment_submission_items = (current.enrollment_submission_items || []).filter(i => i.id !== itemId);
      fillPicker();
      renderAll();
    } catch (err) { show(err.message); }
    finally { _removing.delete(itemId); }
  }

  let _submitting = false;
  let _confirming = false; // the confirm dialog is open: a second click must not open another

  async function submit() {
    if (!current || !EJ.canEdit(current) || _submitting || _confirming) return;
    clearError();
    const items = EJ.activeItems(current);
    if (!items.length) { show('Add at least one subject before submitting.'); return; }
    const load = EJ.loadUnits(current, maxUnits);
    if (load.over) {
      show(`Your load is ${load.total} units; the limit for ${program} is ${load.cap}. Remove a subject before submitting.`);
      return;
    }
    _confirming = true;
    let ok = false;
    try {
      ok = await UI.confirmDialog({
        title: 'Submit your load for review?',
        message: `${items.length} subject${items.length === 1 ? '' : 's'} (${load.total} units) will go to your ${program} Program Head. You cannot edit the load while they review it.`,
        confirmLabel: 'Submit to Program Head',
      });
    } finally {
      _confirming = false;
    }
    if (!ok) return;
    // Lock before the await so a double click cannot send two submissions.
    _submitting = true;
    const btn = document.getElementById('enrollment-submit-btn');
    const btnHTML = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
    try {
      const { submission } = await Api.enrollment.submit(current.id);
      current = submission;
      fillPicker(); // course cards must re-render as locked
      renderAll();
      UI.toast('Load submitted for verification.', 'success');
    } catch (err) {
      show(err.message);
      if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btnHTML; }
    } finally {
      _submitting = false;
    }
  }

  // Errors stay visible until the next action, so they are not missed.
  function show(msg) {
    const el = document.getElementById('enrollment-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function clearError() {
    document.getElementById('enrollment-error')?.classList.add('hidden');
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
    activeTerm: () => (current ? { schoolYear: current.school_year, semester: current.semester } : null),
    canEdit: () => EJ.canEdit(current),
    lockedReason: () => {
      if (!current) return '';
      if (current.status === 'draft') return '';
      if (current.status === 'approved') {
        return current.encoded_at ? 'Encoded: your load is locked' : 'Verified: your final load is locked';
      }
      return 'Submitted: your load is with your Program Head';
    },
    draftSubjectIds: () => EJ.activeItems(current).reduce((set, i) => (set.add(i.subject_id), set), new Set()),
  };

  return { load };
})();
