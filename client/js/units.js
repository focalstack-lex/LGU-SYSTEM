// =============================================
// units.js - Credit Unit Tracker View Module
// =============================================

const Units = (() => {

  let requirements = []; // curriculum_requirements rows (all programs)
  let subjects     = []; // subjects for the current program
  let prereqRows   = []; // structured subject_prerequisites rows (all programs)
  let myUnits      = []; // the student's enrollment records
  let program      = null;
  let selectedYear = 'all'; // 'all' | '1' | '2' | '3' | '4'
  let enrollmentYear = null; // profile.enrollment_year - cohort that anchors prospectus SY prefill
  let batchMode = false; // multi-select mode toggle
  const selectedBatchSubjectIds = new Set();

  const VALID_PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
  const PROGRAM_NAMES = {
    BSCoE: 'Computer Engineering',
    BSCE:  'Civil Engineering',
    BSECE: 'Electronics Engineering',
  };
  const STATUS_LABELS = {
    enrolled:   'Enrolled',
    passed:     'Passed',
    failed:     'Failed',
    dropped:    'Dropped',
    incomplete: 'Incomplete',
  };
  const SEM_LABELS = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer Term' };
  const SEM_SHORT = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };

  // ---- Small helpers ----
  function currentSchoolYear() {
    const now = new Date();
    const y = now.getFullYear();
    return now.getMonth() + 1 >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  }

  function currentSemester() {
    const m = new Date().getMonth() + 1;
    return m >= 6 && m <= 10 ? 1 : 2;
  }

  // Prospectus school year for a subject's year level, anchored to the
  // student's enrollment year (e.g. enrolled 2025 → a Year 2 subject is
  // 2026-2027). Falls back to the current school year when the profile
  // has no enrollment year recorded yet.
  function prospectusSchoolYear(subject) {
    const base = enrollmentYear || Number(currentSchoolYear().split('-')[0]);
    const start = base + Number(subject.year_level) - 1;
    return `${start}-${start + 1}`;
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // The custom dropdown (.dd) is inserted as the select's previous sibling
  // by app.js bindDropdown, so it is not reachable via closest().
  function ddWrap(select) {
    return (select && select.parentNode) ? select.parentNode.querySelector('.dd') : null;
  }

  // Keep a hidden select and its custom .dd trigger in sync when we
  // pre-fill modal fields programmatically.
  function setDDValue(select, value) {
    select.value = value;
    const wrap = ddWrap(select);
    if (wrap) {
      const label = wrap.querySelector('.dd-label');
      const opt = select.options[select.selectedIndex];
      if (label) {
        label.textContent = opt ? opt.text : '';
        label.classList.toggle('dd-placeholder', !(opt && opt.value));
      }
    }
  }

  // ---- Load ----
  async function load() {
    const profile = await Auth.getProfile().catch(() => null);
    const isAdmin = profile?.role === 'admin';
    // Match case/whitespace-insensitively so legacy profiles storing
    // "BS Computer Engineering" or " bscoe " still resolve to the code.
    const normCourse    = (profile?.course || '').trim().toUpperCase();
    const enrolledProgram = VALID_PROGRAMS.find(p => p.toUpperCase() === normCourse) || null;
    const courseLock    = !!enrolledProgram;
    enrollmentYear      = Number(profile?.enrollment_year) || null;

    // Students are locked to their enrolled program; anyone without a course
    // (e.g. admins) can browse any program.
    if (courseLock && !isAdmin) {
      program = enrolledProgram;
    } else if (!program) {
      program = courseLock ? enrolledProgram : 'BSCoE';
    }

    const sel = document.getElementById('units-program');
    if (sel) {
      sel.disabled = courseLock && !isAdmin;
      const wrap = ddWrap(sel);
      if (wrap) wrap.classList.toggle('dd-disabled', sel.disabled);
      document.getElementById('units-program-lock')?.classList.toggle('hidden', !sel.disabled);
      if (!sel.dataset.userSet || sel.disabled) setDDValue(sel, program);
    }

    try {
      const [checklists, mine] = await Promise.all([
        Api.units.checklists(program),
        Api.units.my(),
      ]);
      requirements = checklists.requirements || [];
      subjects     = checklists.subjects || [];
      prereqRows   = checklists.prerequisites || [];
      myUnits      = mine || [];
      renderProgress(profile);
      renderChecklist();
    } catch (err) {
      document.getElementById('units-checklist').innerHTML = `
        <div class="empty-state">
          <iconify-icon icon="solar:danger-triangle-linear" class="empty-icon"></iconify-icon>
          <p>${esc(err.message)}</p>
        </div>`;
    }
  }

  // ---- Progress panel ----
  function renderProgress(profile) {
    const req = requirements.find(r => r.program === program);
    const total = req ? Number(req.total_units) : 0;

    // Count units once per subject - a retake that is later passed
    // never double-counts the same subject.
    const passedSubjectIds = new Set(
      myUnits.filter(u => u.status === 'passed' && u.subjects?.id).map(u => u.subjects.id)
    );
    const completed = subjects
      .filter(s => passedSubjectIds.has(s.id))
      .reduce((sum, s) => sum + Number(s.units || 0), 0);

    const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

    // In-progress: current-term enrolled units render as a lighter
    // segment behind the passed fill - pct stays passed-only.
    const inProgressUnits = currentTermRecords()
      .reduce((sum, u) => sum + Number(u.subjects.units || 0), 0);
    const inPct = total > 0
      ? Math.min(100 - pct, Math.round((inProgressUnits / total) * 100))
      : 0;

    document.getElementById('units-progress-pct').textContent = `${pct}%`;
    document.getElementById('units-progress-fill').style.width = `${pct}%`;
    document.getElementById('units-progress-progress').style.width = `${Math.min(100, pct + inPct)}%`;
    document.getElementById('units-progress-caption').textContent =
      `${completed} / ${total || '-'} units${inProgressUnits > 0 ? ` · ${inProgressUnits} in progress` : ''}`;
    document.getElementById('units-completed').textContent = completed;
    document.getElementById('units-total').textContent = total || '-';

    // Estimated graduation cohort: enrollment year + 4. Prefer the stored
    // enrollment_year (a student who enrolled in 2024 graduates 2028 even if
    // they created their account later); fall back to the account creation
    // year for profiles that predate the enrollment_year column.
    const enrollmentYear =
      profile?.enrollment_year
        ? Number(profile.enrollment_year)
        : (profile?.created_at ? new Date(profile.created_at).getFullYear() : new Date().getFullYear());
    const cohort = enrollmentYear + 4;
    document.getElementById('units-cohort-year').textContent = cohort;
  }

  // ---- Current semester card (read-only snapshot of this term) ----
  // Management (edit / drop / mark passed) stays in the year checklist.
  function currentTermRecords() {
    const sy = currentSchoolYear();
    const sem = currentSemester();
    return myUnits.filter(u =>
      u.status === 'enrolled' &&
      u.school_year === sy &&
      Number(u.semester) === sem &&
      u.subjects?.id
    );
  }

  function currentCardRow(u) {
    const s = u.subjects;
    const meta = [u.schedule, u.instructor].filter(Boolean).join(' · ');
    return `
      <div class="units-current-row">
        <span class="unit-code">${esc(s.code)}</span>
        <div class="unit-title">
          <div>${esc(s.title)}</div>
          ${meta ? `<div class="units-current-meta">${esc(meta)}</div>` : ''}
        </div>
        <span class="units-current-count">${s.units}</span>
      </div>`;
  }

  // Slim trigger above the checklist - the full list lives in the popup
  // modal so the card doesn't occupy permanent vertical space.
  function currentSemesterButton() {
    const rows = currentTermRecords();
    const totalUnits = rows.reduce((sum, u) => sum + Number(u.subjects.units || 0), 0);
    const term = `${SEM_SHORT[currentSemester()]}, AY ${currentSchoolYear()}`;
    return `
      <button type="button" class="units-current-trigger" data-act="view-current" id="units-current-trigger" title="View enrolled subjects this semester">
        <iconify-icon icon="solar:calendar-date-linear"></iconify-icon>
        <span class="units-current-trigger-label">Enrolled This Semester</span>
        <span class="units-current-trigger-term">${term}</span>
        <span class="units-current-trigger-units">${totalUnits} unit${totalUnits === 1 ? '' : 's'}</span>
        <iconify-icon icon="solar:alt-arrow-right-linear" class="units-current-trigger-chevron"></iconify-icon>
      </button>`;
  }

  function openCurrentModal() {
    const rows = [...currentTermRecords()].sort((a, b) =>
      a.subjects.code.localeCompare(b.subjects.code)
    );
    const totalUnits = rows.reduce((sum, u) => sum + Number(u.subjects.units || 0), 0);
    document.getElementById('units-current-modal-term').textContent =
      `${SEM_SHORT[currentSemester()]}, AY ${currentSchoolYear()}`;
    document.getElementById('units-current-modal-units').textContent =
      `${totalUnits} unit${totalUnits === 1 ? '' : 's'}`;
    document.getElementById('units-current-modal-body').innerHTML = rows.length
      ? rows.map(currentCardRow).join('')
      : `<div class="units-current-empty">No courses logged for this semester yet - log them in the checklist below.</div>`;
    openModalOverlay('units-current-modal');
  }

  function closeCurrentModal() {
    closeModalOverlay('units-current-modal');
  }

  // ---- Checklist ----
  function recordFor(subjectId) {
    // API returns newest first - the first match is the latest record
    return myUnits.find(u => u.subjects?.id === subjectId) || null;
  }

  function checklistControls() {
    const card = currentSemesterButton();
    const batchBtn = `
      <button type="button" class="units-batch-toggle ${batchMode ? 'active' : ''}" data-act="toggle-batch" id="units-batch-toggle" title="Select multiple subjects to log or enroll at once">
        <iconify-icon icon="${batchMode ? 'solar:close-circle-linear' : 'solar:checklist-minimalistic-linear'}"></iconify-icon>
        <span>${batchMode ? 'Done Selecting' : 'Select Multiple'}</span>
      </button>`;
    return `
      <div class="units-checklist-controls">
        ${card}
        ${batchBtn}
      </div>`;
  }

  function renderChecklist() {
    const container = document.getElementById('units-checklist');
    const headerControls = checklistControls();

    if (!subjects.length) {
      container.innerHTML = headerControls + `
        <div class="empty-state">
          <iconify-icon icon="solar:diploma-verified-linear" class="empty-icon"></iconify-icon>
          <p>No subjects are set up for ${esc(program)} - ${esc(PROGRAM_NAMES[program] || '')} yet.</p>
        </div>`;
      return;
    }

    const years = [1, 2, 3, 4].map(year => {
      const sems = [1, 2, 3].map(sem => ({
        sem,
        subjects: subjects.filter(s => s.year_level === year && s.semester === sem),
      })).filter(s => s.subjects.length);
      return { year, sems };
    }).filter(y => y.sems.length);

    const batchBar = `
      <div class="units-batch-bar ${batchMode && selectedBatchSubjectIds.size > 0 ? 'visible' : ''}" id="units-batch-bar">
        <div class="units-batch-bar-inner">
          <div class="units-batch-header">
            <div class="units-batch-info">
              <span class="units-batch-badge">${selectedBatchSubjectIds.size}</span>
              <span class="units-batch-text">selected</span>
            </div>
            <button type="button" class="units-batch-cancel-btn" data-batch-action="cancel" title="Cancel selection">
              <iconify-icon icon="solar:close-circle-linear"></iconify-icon> Cancel
            </button>
          </div>
          <div class="units-batch-actions">
            <button type="button" class="btn btn-primary units-batch-btn" data-batch-action="pass" ${selectedBatchSubjectIds.size === 0 ? 'disabled' : ''}>
              <iconify-icon icon="solar:check-circle-linear"></iconify-icon> Mark Passed (${selectedBatchSubjectIds.size})
            </button>
            <button type="button" class="btn btn-ghost units-batch-btn" data-batch-action="enroll" ${selectedBatchSubjectIds.size === 0 ? 'disabled' : ''}>
              <iconify-icon icon="solar:calendar-date-linear"></iconify-icon> Mark Enrolled (${selectedBatchSubjectIds.size})
            </button>
          </div>
        </div>
      </div>`;

    container.innerHTML = headerControls + years.map(({ year, sems }) => `
      <div class="unit-year" data-year="${year}">
        <div class="unit-year-banner">
          <span>Year ${year}</span>
          ${batchMode ? `<label class="unit-banner-select" title="Select all subjects in Year ${year}"><input type="checkbox" class="unit-year-check" data-batch-year="${year}" /> Select Year</label>` : ''}
        </div>
        ${sems.map(({ sem, subjects: list }) => `
          <div class="unit-sem">
            <div class="unit-sem-banner">
              <span>${SEM_LABELS[sem] || `Semester ${sem}`}</span>
              ${batchMode ? `<label class="unit-banner-select" title="Select all subjects in this semester"><input type="checkbox" class="unit-sem-check" data-batch-year="${year}" data-batch-sem="${sem}" /> Select Sem</label>` : ''}
            </div>
            ${list.map(subjectRow).join('')}
          </div>
        `).join('')}
      </div>
    `).join('') + batchBar;

    sliderInit = false; // a fresh bar positions itself instantly, then animates
    applyYearFilter();
    updateTabSlider();
  }

  // Show only the selected year's blocks (or all); keeps the active tab in sync.
  function applyYearFilter() {
    document.querySelectorAll('#units-checklist .unit-year').forEach(el => {
      el.style.display = (selectedYear === 'all' || el.dataset.year === selectedYear) ? '' : 'none';
    });
    document.querySelectorAll('#units-filter-tabs-wrapper .units-tab-btn').forEach(t => {
      t.classList.toggle('active', t.dataset.year === selectedYear);
    });
  }

  // Slide + morph the orange backplate onto the active tab.
  let sliderInit = false;

  function updateTabSlider() {
    const activeTab = document.querySelector('#units-filter-tabs-wrapper .units-tab-btn.active');
    const slider = document.getElementById('units-tab-slider');
    const wrapper = document.getElementById('units-filter-tabs-wrapper');
    if (!activeTab || !slider || !wrapper) return;

    // The slider's absolute `left: 4px` rests at the content start (padding
    // edge + padding), so translate relative to the content box - measuring
    // from the border-box would leave the pill offset by the border width.
    const cs = getComputedStyle(wrapper);
    const contentLeft = wrapper.getBoundingClientRect().left
      + (parseFloat(cs.borderLeftWidth) || 0)
      + (parseFloat(cs.paddingLeft) || 0);

    const tabRect = activeTab.getBoundingClientRect();

    if (!sliderInit) slider.style.transition = 'none';
    slider.style.width = `${tabRect.width}px`;
    slider.style.transform = `translateX(${tabRect.left - contentLeft}px)`;
    if (!sliderInit) {
      void slider.offsetWidth; // commit position before enabling the transition
      slider.style.transition = '';
      sliderInit = true;
    }
  }

  function updateBatchBar() {
    const bar = document.getElementById('units-batch-bar');
    if (!bar) return;
    const count = selectedBatchSubjectIds.size;
    bar.classList.toggle('visible', batchMode && count > 0);
    const badge = bar.querySelector('.units-batch-badge');
    if (badge) badge.textContent = count;
    const passBtn = bar.querySelector('[data-batch-action="pass"]');
    if (passBtn) {
      passBtn.disabled = count === 0;
      passBtn.innerHTML = `<iconify-icon icon="solar:check-circle-linear"></iconify-icon> Mark Passed (${count})`;
    }
    const enrollBtn = bar.querySelector('[data-batch-action="enroll"]');
    if (enrollBtn) {
      enrollBtn.disabled = count === 0;
      enrollBtn.innerHTML = `<iconify-icon icon="solar:calendar-date-linear"></iconify-icon> Mark Enrolled (${count})`;
    }
  }

  async function batchMarkPassed() {
    if (selectedBatchSubjectIds.size === 0) return;
    const count = selectedBatchSubjectIds.size;
    if (!confirm(`Mark all ${count} selected subject(s) as Passed in your official curriculum record?`)) return;

    try {
      const items = Array.from(selectedBatchSubjectIds).map(id => {
        const subj = subjects.find(s => s.id === id);
        return {
          subject_id: id,
          school_year: prospectusSchoolYear(subj),
          semester: Number(subj.semester),
          status: 'passed',
          grade: null,
        };
      });

      await Api.units.batchEnroll(items);
      UI.toast(`Successfully marked ${count} subject${count === 1 ? '' : 's'} as Passed!`, 'success');
      selectedBatchSubjectIds.clear();
      batchMode = false;
      await load();
    } catch (err) {
      UI.toast(err.message || 'Failed to update selected subjects.', 'error');
    }
  }

  async function batchMarkEnrolled() {
    if (selectedBatchSubjectIds.size === 0) return;
    const count = selectedBatchSubjectIds.size;
    const sy = currentSchoolYear();
    const sem = currentSemester();
    if (!confirm(`Mark ${count} selected subject(s) as Enrolled for ${SEM_SHORT[sem]}, AY ${sy}?`)) return;

    try {
      const items = Array.from(selectedBatchSubjectIds).map(id => ({
        subject_id: id,
        school_year: sy,
        semester: Number(sem),
        status: 'enrolled',
        grade: null,
      }));

      await Api.units.batchEnroll(items);
      UI.toast(`Successfully enrolled in ${count} subject${count === 1 ? '' : 's'} for this term!`, 'success');
      selectedBatchSubjectIds.clear();
      batchMode = false;
      await load();
    } catch (err) {
      UI.toast(err.message || 'Failed to enroll selected subjects.', 'error');
    }
  }

  // Structured prereq display: "Prerequisites: A, B · Co-requisites: C · 2nd Yr Standing · Notes: *240 hours"
  function formatPrereqRows(rows) {
    const codes   = rows.filter(r => r.kind === 'prerequisite').map(r => r.depends_code).filter(Boolean);
    const coreqs  = rows.filter(r => r.kind === 'corequisite').map(r => r.depends_code).filter(Boolean);
    const gates   = rows.filter(r => r.kind === 'year_standing').map(r => r.detail).filter(Boolean);
    const special = rows.filter(r => r.kind === 'special').map(r => r.detail).filter(Boolean);
    const parts = [];
    if (codes.length)   parts.push(`Prerequisites: ${codes.join(', ')}`);
    if (coreqs.length)  parts.push(`Co-requisites: ${coreqs.join(', ')}`);
    if (gates.length)   parts.push(gates.join(', '));
    if (special.length) parts.push(`Notes: ${special.join(', ')}`);
    return parts.join(' · ');
  }

  function subjectRow(s) {
    const rec = recordFor(s.id);
    const badge = rec
      ? `<span class="unit-badge unit-badge--${rec.status}">${STATUS_LABELS[rec.status]}${rec.grade != null ? ' · ' + rec.grade : ''}</span>`
      : `<span class="unit-badge unit-badge--none">Not taken</span>`;

    const actions = rec
      ? `
        <div class="unit-action-group" role="group" aria-label="Subject actions">
          ${rec.status !== 'passed'
            ? `<button type="button" class="unit-action-btn unit-action-btn--pass" data-act="passed" data-id="${rec.id}" title="Mark as passed" aria-label="Mark as passed"><iconify-icon icon="solar:check-circle-linear"></iconify-icon></button>`
            : ''}
          <button type="button" class="unit-action-btn unit-action-btn--edit" data-act="edit" data-id="${rec.id}" data-subject="${s.id}" title="Edit grade or status" aria-label="Edit record"><iconify-icon icon="solar:pen-linear"></iconify-icon></button>
          <button type="button" class="unit-action-btn unit-action-btn--del" data-act="drop" data-id="${rec.id}" title="Remove record" aria-label="Remove record"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button>
        </div>`
      : `<button type="button" class="unit-log-btn" data-act="log" data-subject="${s.id}" title="Log subject grade or enrollment"><iconify-icon icon="solar:add-circle-linear"></iconify-icon><span>Log</span></button>`;

    const unitsBadge = Number(s.lab_units) > 0
      ? `<span class="unit-units">${Number(s.lec_units)} lec / ${Number(s.lab_units)} lab</span>`
      : `<span class="unit-units">${s.units} unit${s.units === 1 ? '' : 's'}</span>`;

    const structuredPrereq = formatPrereqRows((prereqRows || []).filter(r => r.subject_id === s.id));
    const prereq = structuredPrereq
      ? `<div class="unit-prereq">${esc(structuredPrereq)}</div>`
      : (s.prerequisites
          ? `<div class="unit-prereq">Prerequisite: ${esc(s.prerequisites)}</div>`
          : '');

    const checkCol = batchMode
      ? `<label class="unit-row-check-label"><input type="checkbox" class="unit-row-check" data-subject-id="${s.id}" data-year="${s.year_level}" data-sem="${s.semester}" ${selectedBatchSubjectIds.has(s.id) ? 'checked' : ''} /></label>`
      : '';

    const isSelected = batchMode && selectedBatchSubjectIds.has(s.id);

    return `
      <div class="unit-row ${batchMode ? 'has-batch-check' : ''} ${isSelected ? 'unit-row--selected' : ''}" data-row-subject="${s.id}">
        ${checkCol}
        <span class="unit-code">${esc(s.code)}</span>
        <div class="unit-title">
          <div>${esc(s.title)} ${unitsBadge}</div>
          ${prereq}
        </div>
        ${badge}
        <div class="unit-actions">${actions}</div>
      </div>`;
  }

  // ---- Modal ----
  let modalMode = 'create'; // 'create' | 'edit'
  let modalSubject = null;
  let modalRecordId = null;

  function openModal(subject, record) {
    modalSubject = subject;
    modalRecordId = record?.id || null;
    modalMode = record ? 'edit' : 'create';

    document.getElementById('units-modal-title').textContent = record ? 'Edit Subject Record' : 'Log Subject';
    document.getElementById('units-modal-subject').textContent =
      `${subject.code} · ${subject.title} · ${subject.units} unit${subject.units === 1 ? '' : 's'}`;

    setDDValue(document.getElementById('units-sem'), String(record?.semester ?? currentSemester()));
    // New records default to the subject's prospectus school year (derived
    // from the student's enrollment year); edits keep their stored year.
    document.getElementById('units-sy').value = record?.school_year || prospectusSchoolYear(subject);
    setDDValue(document.getElementById('units-status'), record?.status || 'enrolled');
    document.getElementById('units-grade').value = record?.grade != null ? record.grade : '';
    document.getElementById('units-schedule').value = record?.schedule || '';
    document.getElementById('units-instructor').value = record?.instructor || '';

    const errEl = document.getElementById('units-modal-error');
    errEl.classList.add('hidden');
    openModalOverlay('units-modal');
  }

  // Modal show/hide with a close animation: hide only after the
  // fadeOut finishes. Reopening mid-close cancels cleanly.
  function openModalOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('modal-closing');
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModalOverlay(id) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden') || el.classList.contains('modal-closing')) return;
    el.classList.add('modal-closing');
    el.addEventListener('animationend', function done(e) {
      if (e.target !== el) return; // the card's animation bubbles up
      el.removeEventListener('animationend', done);
      if (!el.classList.contains('modal-closing')) return; // reopened mid-close
      el.classList.remove('modal-closing');
      el.classList.add('hidden');
      if (!document.querySelector('.modal-overlay:not(.hidden), .profile-modal-overlay:not(.hidden)')) {
        document.body.classList.remove('modal-open');
      }
    });
  }

  function closeModal() {
    closeModalOverlay('units-modal');
  }

  async function saveModal() {
    const errEl = document.getElementById('units-modal-error');
    errEl.classList.add('hidden');

    const school_year = document.getElementById('units-sy').value.trim();
    const semester = document.getElementById('units-sem').value;
    const status = document.getElementById('units-status').value;
    const gradeRaw = document.getElementById('units-grade').value;
    const schedule   = document.getElementById('units-schedule').value.trim().slice(0, 120);
    const instructor = document.getElementById('units-instructor').value.trim().slice(0, 120);

    if (!/^\d{4}-\d{4}$/.test(school_year)) {
      errEl.textContent = 'School year must look like "2026-2027".';
      errEl.classList.remove('hidden');
      return;
    }
    if (gradeRaw !== '' && (Number(gradeRaw) < 1 || Number(gradeRaw) > 5)) {
      errEl.textContent = 'Grade must be between 1.0 and 5.0.';
      errEl.classList.remove('hidden');
      return;
    }

    const body = {
      school_year,
      semester: Number(semester),
      status,
      grade: gradeRaw === '' ? null : Number(gradeRaw),
      schedule: schedule || null,
      instructor: instructor || null,
    };

    try {
      if (modalMode === 'edit') {
        await Api.units.update(modalRecordId, body);
        UI.toast('Subject record updated.', 'success');
      } else {
        await Api.units.enroll({ ...body, subject_id: modalSubject.id });
        UI.toast('Subject logged successfully.', 'success');
      }
      closeModal();
      await load();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  }

  async function markPassed(id) {
    if (!confirm('Mark this subject as passed?')) return;
    try {
      await Api.units.update(id, { status: 'passed' });
      UI.toast('Marked as passed.', 'success');
      await load();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function dropRecord(id) {
    if (!confirm('Remove this subject record? This cannot be undone.')) return;
    try {
      await Api.units.drop(id);
      UI.toast('Subject record removed.', 'success');
      await load();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  // ---- Download standing (PDF transcript of Yr 1–4) ----
  async function downloadStanding() {
    const btn = document.getElementById('units-download-pdf');
    const token = window._authToken;
    if (!token) { UI.toast('Please log in again.', 'error'); return; }

    const originalHTML = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Generating…'; }

    try {
      const res = await fetch(`${window.API_BASE}/api/units/standing`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const cd   = res.headers.get('Content-Disposition') || '';
      const name = cd.match(/filename="?([^";]+)"?/);
      a.href     = url;
      a.download = name ? name[1] : 'Academic-Standing.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      if (btn && originalHTML) { btn.disabled = false; btn.innerHTML = originalHTML; }
    }
  }

  // ---- Event wiring (runs once at script load) ----
  document.getElementById('units-filter-tabs-wrapper').addEventListener('click', e => {
    const tab = e.target.closest('[data-year]');
    if (!tab) return;
    selectedYear = tab.dataset.year;
    applyYearFilter();
    updateTabSlider();
  });

  document.getElementById('units-checklist').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'toggle-batch') {
      batchMode = !batchMode;
      if (!batchMode) selectedBatchSubjectIds.clear();
      renderChecklist();
      return;
    }
    if (act === 'view-current') { openCurrentModal(); return; }
    const subject = subjects.find(s => s.id === btn.dataset.subject);
    const record = btn.dataset.id ? myUnits.find(u => u.id === btn.dataset.id) : null;

    if (act === 'log' && subject) openModal(subject, null);
    if (act === 'edit' && subject) openModal(subject, record || recordFor(subject.id));
    if (act === 'passed') markPassed(btn.dataset.id);
    if (act === 'drop') dropRecord(btn.dataset.id);
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-batch-action]');
    if (!btn) return;
    const act = btn.dataset.batchAction;
    if (act === 'pass') batchMarkPassed();
    if (act === 'enroll') batchMarkEnrolled();
    if (act === 'cancel') {
      selectedBatchSubjectIds.clear();
      batchMode = false;
      renderChecklist();
    }
  });

  document.getElementById('units-checklist').addEventListener('change', e => {
    const rowCheck = e.target.closest('.unit-row-check');
    if (rowCheck) {
      const id = rowCheck.dataset.subjectId;
      if (rowCheck.checked) selectedBatchSubjectIds.add(id);
      else selectedBatchSubjectIds.delete(id);
      const row = rowCheck.closest('.unit-row');
      if (row) row.classList.toggle('unit-row--selected', rowCheck.checked);
      updateBatchBar();
      return;
    }

    const semCheck = e.target.closest('.unit-sem-check');
    if (semCheck) {
      const year = Number(semCheck.dataset.batchYear);
      const sem = Number(semCheck.dataset.batchSem);
      const semSubjects = subjects.filter(s => s.year_level === year && s.semester === sem);
      const isChecked = semCheck.checked;
      semSubjects.forEach(s => {
        if (isChecked) selectedBatchSubjectIds.add(s.id);
        else selectedBatchSubjectIds.delete(s.id);
      });
      const semEl = semCheck.closest('.unit-sem');
      if (semEl) {
        semEl.querySelectorAll('.unit-row-check').forEach(cb => {
          cb.checked = isChecked;
          const r = cb.closest('.unit-row');
          if (r) r.classList.toggle('unit-row--selected', isChecked);
        });
      }
      updateBatchBar();
      return;
    }

    const yearCheck = e.target.closest('.unit-year-check');
    if (yearCheck) {
      const year = Number(yearCheck.dataset.batchYear);
      const yearSubjects = subjects.filter(s => s.year_level === year);
      const isChecked = yearCheck.checked;
      yearSubjects.forEach(s => {
        if (isChecked) selectedBatchSubjectIds.add(s.id);
        else selectedBatchSubjectIds.delete(s.id);
      });
      const yearEl = yearCheck.closest('.unit-year');
      if (yearEl) {
        yearEl.querySelectorAll('.unit-sem-check, .unit-row-check').forEach(cb => {
          cb.checked = isChecked;
          const r = cb.closest('.unit-row');
          if (r) r.classList.toggle('unit-row--selected', isChecked);
        });
      }
      updateBatchBar();
      return;
    }
  });

  document.getElementById('units-modal-save').addEventListener('click', saveModal);
  document.getElementById('units-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('units-modal').addEventListener('click', e => {
    if (e.target.id === 'units-modal') closeModal();
  });

  document.getElementById('units-current-modal-close').addEventListener('click', closeCurrentModal);
  document.getElementById('units-current-modal').addEventListener('click', e => {
    if (e.target.id === 'units-current-modal') closeCurrentModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const uModal = document.getElementById('units-modal');
      if (uModal && !uModal.classList.contains('hidden')) closeModal();
      const cModal = document.getElementById('units-current-modal');
      if (cModal && !cModal.classList.contains('hidden')) closeCurrentModal();
    }
  });

  document.getElementById('units-program').addEventListener('change', e => {
    if (e.target.disabled) return; // locked to the student's enrolled program
    program = e.target.value;
    e.target.dataset.userSet = '1';
    load();
  });

  document.getElementById('units-download-pdf').addEventListener('click', downloadStanding);

  // Keep the slider pinned to the active tab when the layout resizes.
  window.addEventListener('resize', updateTabSlider);

  return { load };
})();
