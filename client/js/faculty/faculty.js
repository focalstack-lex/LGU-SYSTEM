// =============================================
// faculty.js - Faculty portal (Phase B).
// Roles: program_head (queue + evaluation), faculty/SA (approved loads,
// mark encoded), dean (read-only overview). Admin sees everything.
// =============================================
const FacultyPortal = (() => {

  const FACULTY_ROLES = ['faculty', 'program_head', 'dean', 'admin'];
  const STATUS_LABELS = {
    draft: 'Draft',
    submitted: 'Submitted',
    under_review: 'Under evaluation',
    approved: 'Approved',
    returned: 'Returned',
    rejected: 'Rejected',
  };

  let profile = null;
  let currentSubmission = null;
  let detail = null; // { submission, history, prerequisites }

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ui.js's UI.toast targets the student portal's #toast element, which does
  // not exist on this standalone page, so the portal carries its own holder
  // (same idiom as officer-app.js's #of-toast-holder).
  function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `faculty-toast ${type}`;
    el.textContent = message;
    $('faculty-toast-holder').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function guard(label, fn) {
    try { return await fn(); }
    catch (err) { console.error(`[faculty] ${label}:`, err); toast(err.message || 'Something went wrong.', 'error'); }
  }

  const isHead = () => profile?.role === 'program_head' || profile?.role === 'admin';
  const isDean = () => profile?.role === 'dean' || profile?.role === 'admin';

  // checklists API validates exact casing ('BSCoE' | 'BSCE' | 'BSECE')
  const PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
  function programKey(course) {
    const upper = String(course || '').trim().toUpperCase();
    return PROGRAMS.find(p => p.toUpperCase() === upper) || '';
  }

  function showGate(message) {
    $('faculty-app').hidden = true;
    $('faculty-gate').hidden = false;
    $('faculty-gate-message').textContent = message;
  }

  // ---------- Boot ----------

  async function boot() {
    profile = await Auth.getProfile().catch(() => null);
    if (!profile) {
      // First-hit profile fetch can race the session restore - retry once.
      await new Promise(r => setTimeout(r, 800));
      profile = await Auth.getProfile().catch(() => null);
    }
    if (!profile) return showGate('Please log in through the main system first.');
    if (!FACULTY_ROLES.includes(profile.role)) {
      return showGate('This portal is for program heads, faculty staff, and the dean only.');
    }
    if (!window.isEnrollmentPilot?.(profile.email)) {
      return showGate('🚧 The enrollment verification portal is still under development. It will open for your role soon.');
    }

    $('faculty-gate').hidden = true;
    $('faculty-app').hidden = false;
    const roleLine = profile.role === 'program_head'
      ? `Program Head${profile.course ? ` (${profile.course})` : ''}`
      : profile.role === 'faculty' ? 'Student Assistant'
      : profile.role === 'dean' ? 'Dean' : 'Administrator';
    $('faculty-user-line').textContent = `${profile.full_name || profile.email} · ${roleLine}`;

    if (isHead()) {
      $('faculty-queue').hidden = false;
      await guard('loadQueue', loadQueue);
    } else {
      $('faculty-queue').hidden = true; // plain faculty (SAs) never see the queue
    }
    $('faculty-approved').hidden = false;
    await guard('loadApproved', loadApproved);
    if (isDean()) {
      $('faculty-dean').hidden = false;
      await guard('loadDean', loadDean);
    }
  }

  // ---------- Evaluation queue (program head) ----------

  async function loadQueue() {
    const { submissions } = await Api.faculty.submissions('submitted');
    const { submissions: reviewing } = await Api.faculty.submissions('under_review');
    renderQueueList([...(submissions || []), ...(reviewing || [])]);
  }

  function renderQueueList(list) {
    const el = $('faculty-queue-list');
    el.innerHTML = list.length ? list.map(s => `
      <div class="faculty-row" data-open="${s.id}">
        <span><strong>${esc(s.student?.full_name || 'Student')}</strong> · ${esc(s.student?.course || '')} Yr ${esc(s.student?.year_level || '')}</span>
        <span>${(s.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head').length} subjects · ${STATUS_LABELS[s.status] || esc(s.status)}</span>
        <span class="faculty-row-actions"><button type="button" class="btn btn-primary btn-sm">Evaluate</button></span>
      </div>`).join('') : '<p class="muted">The queue is empty.</p>';
    el.querySelectorAll('[data-open]').forEach(row =>
      row.addEventListener('click', () => guard('openEvaluation', () => openEvaluation(row.dataset.open))));
  }

  async function openEvaluation(id) {
    detail = await Api.faculty.detail(id);
    currentSubmission = detail.submission;
    Api.faculty.open(id).catch(() => {}); // fire-and-forget under_review touch

    const s = detail.submission;
    document.getElementById('faculty-queue').hidden = true;
    document.getElementById('faculty-eval').hidden = false;
    document.getElementById('faculty-eval-title').textContent =
      `${s.student?.full_name || 'Student'} — ${s.school_year} Sem ${s.semester} (${STATUS_LABELS[s.status] || s.status})`;

    const itemsEl = document.getElementById('faculty-items-list');
    itemsEl.innerHTML = (s.enrollment_submission_items || []).map(i => `
      <div class="faculty-item-row ${i.item_state === 'removed_by_head' ? 'faculty-item-removed' : ''}" data-item="${i.id}">
        <span class="mono">${esc(i.subjects?.code)}</span>
        <span class="faculty-item-title">${esc(i.subjects?.title)} (${esc(i.subjects?.units)}u)</span>
        ${i.origin === 'grizz' ? `<span class="faculty-tag" title="${esc(i.grizz_reason || 'Recommended by Grizz')}">Grizz</span>` : ''}
        ${i.item_state === 'added_by_head' ? '<span class="faculty-tag">added by head</span>' : ''}
        ${i.item_state === 'removed_by_head' ? `<span class="faculty-tag faculty-tag-warn">removed: ${esc(i.head_note || '')}</span>` : ''}
        ${i.item_state !== 'removed_by_head' && s.status !== 'approved' ? `<button type="button" class="btn btn-ghost btn-sm" data-remove="${i.id}">Remove</button>` : ''}
      </div>`).join('') || '<p class="muted">No subjects in this load.</p>';
    itemsEl.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const note = prompt('Reason for removing this subject (required):');
        if (!note || !note.trim()) return;
        await guard('removeItem', async () => {
          await Api.faculty.removeItem(s.id, btn.dataset.remove, note.trim());
          await openEvaluation(s.id);
        });
      }));

    // Prospectus + history columns
    renderProspectus();
    renderHistory();

    // Add-subject picker: same program's checklist subjects not already in the load
    fillAddPicker(s);

    document.getElementById('faculty-approve-btn').onclick = async () => {
      if (!confirm('Approving enrolls these subjects for the student now. Continue?')) return;
      await guard('approve', async () => {
        const r = await Api.faculty.approve(s.id);
        if (r.alreadyApproved) { alert('Already approved.'); return; }
        backToQueue();
      });
    };
    document.getElementById('faculty-return-btn').onclick = async () => {
      const notes = prompt('Notes for the student (required):');
      if (!notes || !notes.trim()) return;
      await guard('return', async () => {
        await Api.faculty.return(s.id, notes.trim());
        backToQueue();
      });
    };
    document.getElementById('faculty-reject-btn').onclick = async () => {
      const notes = prompt('Reason for rejection (required):');
      if (!notes || !notes.trim()) return;
      await guard('reject', async () => {
        await Api.faculty.reject(s.id, notes.trim());
        backToQueue();
      });
    };
  }

  // Add-subject picker: the student's program checklist minus subjects already
  // in the load (any item state — the server rejects duplicate inserts).
  async function fillAddPicker(s) {
    const sel = document.getElementById('faculty-add-subject');
    sel.innerHTML = '<option value="">— subject —</option>';
    const program = programKey(s.student?.course);
    if (!program) return;
    await guard('fillAddPicker', async () => {
      const checklists = await Api.units.checklists(program);
      const inLoad = new Set((s.enrollment_submission_items || []).map(i => i.subject_id));
      const options = (checklists.subjects || [])
        .filter(sub => !inLoad.has(sub.id))
        .sort((a, b) => (a.year_level - b.year_level) || String(a.code).localeCompare(String(b.code)))
        .map(sub => `<option value="${sub.id}">${esc(sub.code)} — ${esc(sub.title)} (${esc(sub.units)}u)</option>`)
        .join('');
      if (options) sel.insertAdjacentHTML('beforeend', options);
      else sel.insertAdjacentHTML('beforeend', '<option value="">Every program subject is in the load</option>');
    });
  }

  // Prospectus Progress: the student's year-level checklist with pass/fail
  // markers. Newest history record per subject wins (history arrives newest-
  // first); passed = status 'passed', or both lec_status + lab_status 'passed'.
  function renderProspectus() {
    const body = document.getElementById('faculty-prospectus-body');
    const newestBySubject = new Map();
    for (const h of detail.history || []) {
      const sid = h.subject_id || h.subjects?.id;
      if (sid && !newestBySubject.has(sid)) newestBySubject.set(sid, h);
    }
    const passedIds = new Set([...newestBySubject.entries()]
      .filter(([, h]) => h.status === 'passed' ||
        (h.lec_status === 'passed' && h.lab_status === 'passed'))
      .map(([sid]) => sid));

    const program = programKey(detail.submission.student?.course);
    body.innerHTML = '<p class="muted">Loading program checklist…</p>';
    guard('prospectus', async () => {
      const checklists = await Api.units.checklists(program);
      const subjects = checklists.subjects || [];
      if (!subjects.length) {
        body.innerHTML = '<p class="muted">No curriculum data for this program.</p>';
        return;
      }
      const byYear = new Map();
      for (const sub of subjects) {
        const y = sub.year_level || '?';
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(sub);
      }
      body.innerHTML = `<div class="faculty-prospectus">${[...byYear.keys()].sort((a, b) => a - b).map(y => `
        <div class="faculty-prospectus-year">
          <h4>Year ${esc(y)}</h4>
          ${byYear.get(y)
            .slice()
            .sort((a, b) => String(a.code).localeCompare(String(b.code)))
            .map(sub => {
              const passed = passedIds.has(sub.id);
              return `<div class="faculty-prospectus-row ${passed ? 'is-passed' : 'is-failed'}">
                <span class="mono">${esc(sub.code)}</span>
                <span class="faculty-item-title">${esc(sub.title)} (${esc(sub.units)}u)</span>
                <span class="faculty-prospectus-mark" title="${passed ? 'Passed' : 'Not passed yet'}">${passed ? '✓' : '✗'}</span>
              </div>`;
            }).join('')}
        </div>`).join('')}</div>`;
    });
  }

  function renderHistory() {
    const body = document.getElementById('faculty-history-body');
    body.innerHTML = (detail.history || []).length
      ? `<div class="faculty-history">${detail.history.slice(0, 40).map(h => `
          <div class="faculty-history-row">
            <span class="mono">${esc(h.subjects?.code)}</span>
            <span class="faculty-history-term">${esc(h.school_year || '')} Sem ${esc(h.semester || '')}</span>
            <span>${esc(h.status || '')}${h.grade != null && h.grade !== '' ? ' · ' + esc(h.grade) : ''}</span>
          </div>`).join('')}</div>`
      : '<p class="muted">No academic history yet.</p>';
  }

  function backToQueue() {
    document.getElementById('faculty-eval').hidden = true;
    if (isHead()) document.getElementById('faculty-queue').hidden = false;
    guard('loadQueue', loadQueue);
    guard('loadApproved', loadApproved);
  }

  // ---------- Approved loads (all faculty roles; SAs encode here) ----------

  async function loadApproved() {
    const { submissions } = await Api.faculty.submissions('approved');
    const el = document.getElementById('faculty-approved-list');
    el.innerHTML = (submissions || []).map(s => `
      <div class="faculty-row">
        <span><strong>${esc(s.student?.full_name || 'Student')}</strong> · ${esc(s.school_year)} Sem ${esc(s.semester)}</span>
        <span>${(s.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head').length} subjects${s.encoded_at ? ' · ✓ encoded' : ''}</span>
        <span class="faculty-row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-export="${s.id}">Export Excel</button>
          ${!s.encoded_at ? `<button type="button" class="btn btn-primary btn-sm" data-encoded="${s.id}">Mark Encoded</button>` : ''}
        </span>
      </div>`).join('') || '<p class="muted">No approved loads yet.</p>';
    el.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
      await guard('export', async () => {
        const blob = await Api.faculty.exportBlob(b.dataset.export);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `approved-load-${b.dataset.export}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }));
    el.querySelectorAll('[data-encoded]').forEach(b => b.addEventListener('click', async () => {
      await guard('markEncoded', async () => {
        await Api.faculty.markEncoded(b.dataset.encoded);
        toast('Marked as encoded.');
        loadApproved();
      });
    }));
  }

  // ---------- Dean overview (read-only) ----------

  async function loadDean() {
    const { submissions } = await Api.faculty.submissions();
    const by = { submitted: 0, under_review: 0, approved: 0, returned: 0, rejected: 0 };
    const byProgram = {};
    for (const s of submissions || []) {
      by[s.status] = (by[s.status] || 0) + 1;
      const p = s.student?.course || '—';
      byProgram[p] = byProgram[p] || {};
      byProgram[p][s.status] = (byProgram[p][s.status] || 0) + 1;
    }
    document.getElementById('faculty-dean-body').innerHTML = `
      <p>Submitted: ${by.submitted || 0} · Under evaluation: ${by.under_review || 0} · Approved: ${by.approved || 0} · Returned: ${by.returned || 0} · Rejected: ${by.rejected || 0}</p>
      ${Object.entries(byProgram).map(([p, counts]) =>
        `<p><strong>${esc(p)}</strong>: ${Object.entries(counts).map(([k, v]) => `${STATUS_LABELS[k] || k} ${v}`).join(', ')}</p>`).join('')}`;
  }

  // ---------- Static wiring ----------

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('faculty-eval-back')?.addEventListener('click', backToQueue);
    document.getElementById('faculty-add-btn')?.addEventListener('click', async () => {
      const subjectId = document.getElementById('faculty-add-subject').value;
      const note = document.getElementById('faculty-add-note').value.trim();
      if (!subjectId) return alert('Choose a subject.');
      if (!note) return alert('A reason is required when adding a subject.');
      await guard('addItem', async () => {
        await Api.faculty.addItem(currentSubmission.id, subjectId, note);
        document.getElementById('faculty-add-note').value = '';
        openEvaluation(currentSubmission.id);
      });
    });
  });

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => FacultyPortal.boot());
