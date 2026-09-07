// =============================================
// officer/curriculum.js - Curriculum Manager (admin-only, Phase A).
// Grid per program/year/sem: inline lec/lab edits + row-based prereq editor.
// =============================================
const CurriculumManager = (() => {
  const PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
  const KIND_LABELS = {
    prerequisite: 'Prerequisite',
    corequisite: 'Co-requisite',
    year_standing: 'Year standing',
    special: 'Special',
  };

  let subjects = [];
  let prereqs = [];           // all structured rows for the loaded program
  let editorSubject = null;   // subject currently open in the prereq editor

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function init() {
    fillProgramSelect();
    ['curriculum-program', 'curriculum-year', 'curriculum-sem'].forEach(id =>
      document.getElementById(id).addEventListener('change', load));
    await load();
  }

  function fillProgramSelect() {
    const sel = document.getElementById('curriculum-program');
    sel.innerHTML = PROGRAMS.map(p => `<option value="${p}">${p}</option>`).join('');
  }

  function visible(list) {
    const yr = document.getElementById('curriculum-year').value;
    const sem = document.getElementById('curriculum-sem').value;
    return list.filter(s => (!yr || String(s.year_level) === yr) && (!sem || String(s.semester) === sem));
  }

  async function load() {
    const program = document.getElementById('curriculum-program').value;
    const payload = await Api.curriculum.subjects(program);
    subjects = payload.subjects || [];
    prereqs = payload.prerequisites || [];
    renderGrid();
  }

  function renderGrid() {
    const grid = document.getElementById('curriculum-grid');
    const rows = visible(subjects);
    if (!rows.length) {
      grid.innerHTML = `<p class="empty-state">No subjects match these filters.</p>`;
      return;
    }
    grid.innerHTML = `
      <table class="curriculum-table">
        <thead>
          <tr><th>Code</th><th>Title</th><th>Units</th><th>Lec</th><th>Lab</th><th></th><th>Prerequisites</th></tr>
        </thead>
        <tbody>
          ${rows.map(s => {
            const rowsFor = prereqs.filter(r => r.subject_id === s.id);
            return `
            <tr data-subject="${s.id}">
              <td class="mono">${esc(s.code)}</td>
              <td>${esc(s.title)}</td>
              <td>${s.units}</td>
              <td><input type="number" min="0" max="${s.units}" value="${Number(s.lec_units)}" class="cur-input" data-lec="${s.id}" aria-label="Lecture units for ${esc(s.code)}" /></td>
              <td><input type="number" min="0" max="${s.units}" value="${Number(s.lab_units)}" class="cur-input" data-lab="${s.id}" aria-label="Laboratory units for ${esc(s.code)}" /></td>
              <td><button type="button" class="btn btn-ghost btn-sm" data-save="${s.id}">Save</button></td>
              <td>
                <span class="cur-prereq-summary">${esc(prereqSummary(rowsFor))}</span>
                <button type="button" class="btn btn-ghost btn-sm" data-edit-prereqs="${s.id}">Edit</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    grid.querySelectorAll('[data-save]').forEach(btn =>
      btn.addEventListener('click', onSaveComponents));
    grid.querySelectorAll('[data-edit-prereqs]').forEach(btn =>
      btn.addEventListener('click', () => openPrereqEditor(btn.dataset.editPrereqs)));
  }

  function prereqSummary(rowsFor) {
    if (!rowsFor.length) return '—';
    return rowsFor.map(r =>
      r.kind === 'year_standing' || r.kind === 'special'
        ? KIND_LABELS[r.kind]
        : `${KIND_LABELS[r.kind]}: ${r.depends_code || '?'}`
    ).join(', ');
  }

  async function onSaveComponents(e) {
    const id = e.currentTarget.dataset.save;
    const lec = Number(document.querySelector(`[data-lec="${id}"]`).value);
    const lab = Number(document.querySelector(`[data-lab="${id}"]`).value);
    try {
      await Api.curriculum.updateComponents(id, lec, lab);
      const s = subjects.find(x => x.id === id);
      if (s) { s.lec_units = lec; s.lab_units = lab; }
      flash('Components saved.');
    } catch (err) {
      flash(err.message || 'Save failed.', true);
    }
  }

  async function openPrereqEditor(subjectId) {
    editorSubject = subjects.find(s => s.id === subjectId);
    const panel = document.getElementById('curriculum-prereq-editor');
    panel.hidden = false;
    const { prerequisites } = await Api.curriculum.prerequisites(subjectId);
    panel.innerHTML = `
      <div class="cur-editor">
        <h3>Prerequisites — ${esc(editorSubject.code)}</h3>
        <ul class="cur-prereq-list">
          ${prerequisites.map(r => `
            <li>
              <span>${KIND_LABELS[r.kind]}${r.depends_code ? `: ${esc(r.depends_code)}` : (r.detail ? `: ${esc(r.detail)}` : '')}</span>
              <button type="button" class="btn btn-ghost btn-sm" data-del-prereq="${r.id}">Remove</button>
            </li>`).join('') || '<li>No prerequisite rows yet.</li>'}
        </ul>
        <form id="cur-prereq-add">
          <select id="cur-new-kind" required>
            <option value="prerequisite">Prerequisite</option>
            <option value="corequisite">Co-requisite</option>
            <option value="year_standing">Year standing</option>
            <option value="special">Special</option>
          </select>
          <select id="cur-new-subject">
            <option value="">— subject —</option>
            ${subjects.filter(s => s.id !== subjectId).map(s =>
              `<option value="${s.id}">${esc(s.code)} — ${esc(s.title)}</option>`).join('')}
          </select>
          <input type="text" id="cur-new-detail" placeholder="Detail (year standing / special)" />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <button type="button" class="btn btn-ghost btn-sm" id="cur-editor-close">Close</button>
      </div>`;

    panel.querySelector('#cur-editor-close').addEventListener('click', () => { panel.hidden = true; editorSubject = null; });
    panel.querySelectorAll('[data-del-prereq]').forEach(btn =>
      btn.addEventListener('click', async () => {
        await Api.curriculum.deletePrereq(btn.dataset.delPrereq);
        await openPrereqEditor(subjectId);
        await load();
      }));
    panel.querySelector('#cur-prereq-add').addEventListener('submit', onAddPrereq);
  }

  async function onAddPrereq(e) {
    e.preventDefault();
    const kind = document.getElementById('cur-new-kind').value;
    const depends = document.getElementById('cur-new-subject').value;
    const detail = document.getElementById('cur-new-detail').value;
    try {
      await Api.curriculum.addPrereq({
        subject_id: editorSubject.id,
        kind,
        depends_on_subject_id: depends || undefined,
        detail: detail || undefined,
      });
      await openPrereqEditor(editorSubject.id);
      await load();
    } catch (err) {
      flash(err.message || 'Add failed.', true);
    }
  }

  function flash(message, isError) {
    // Reuse the console's existing toast/flash helper if present;
    // otherwise this falls back to a transient status line in the section.
    if (typeof window.showConsoleToast === 'function') {
      window.showConsoleToast(message, isError);
      return;
    }
    const grid = document.getElementById('curriculum-grid');
    const note = document.createElement('p');
    note.className = isError ? 'cur-flash cur-flash--error' : 'cur-flash';
    note.textContent = message;
    grid.prepend(note);
    setTimeout(() => note.remove(), 4000);
  }

  return { init };
})();
