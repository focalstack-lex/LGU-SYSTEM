// ==========================================================================
// cv-builder.js - College of Engineering CV Builder
//
// One state object (`cv`, shaped like the server document) drives both the
// editor form and the read-only paper preview. Changes autosave to
// PUT /api/cv/me; a per-user copy in localStorage keeps unsynced edits safe
// across reloads, offline periods and failed saves.
// ==========================================================================

const CvBuilder = (() => {
  'use strict';

  // ---------------- Constants ----------------
  const INSTITUTION = 'College of Engineering, Cor Jesu College';
  const PAPER_W = 816;              // US Letter width  @ 96dpi
  const PAPER_PRINTABLE_H = 960;    // 11in page - 2 x 0.5in margins @ 96dpi
  const PAPER_CHROME_H = 96;        // top + bottom paper padding on screen

  const SAVE_DEBOUNCE_MS = 3000;    // wait for the student to pause typing
  const MIN_SAVE_GAP_MS  = 8000;    // stay well under the server's 40 saves / 5 min
  const MAX_ENTRIES = 25;           // mirrors server/routes/cv.js
  const MAX_BULLETS = 4;
  const MAX_BULLET_LEN = 200;

  const LOCAL_KEY = (uid) => `coe_cv_draft_v2:${uid}`;
  const LEGACY_LOCAL_KEY = 'coe_cv_draft';   // v1 key was shared by every account on the browser

  const PROGRAMS = {
    BSCoE: {
      label: 'BS Computer Engineering',
      coursework: ['Data Structures & Algorithms', 'Object-Oriented Programming', 'Computer Architecture', 'Operating Systems', 'Computer Networks', 'Embedded Systems', 'Digital Logic Design', 'Database Management Systems'],
      skills: ['C / C++', 'Python', 'Java', 'Linux', 'Git / GitHub', 'Arduino / ESP32', 'PostgreSQL', 'Verilog / VHDL']
    },
    BSCE: {
      label: 'BS Civil Engineering',
      coursework: ['Theory of Structures', 'Fluid Mechanics', 'Geotechnical Engineering', 'Reinforced Concrete Design', 'Surveying', 'Construction Estimation', 'Highway Engineering', 'Hydrology'],
      skills: ['AutoCAD', 'Civil 3D', 'ETABS', 'SAP2000', 'STAAD.Pro', 'Revit', 'Quantity Takeoff', 'MS Project']
    },
    BSECE: {
      label: 'BS Electronics Engineering',
      coursework: ['Signals & Systems', 'Electronic Circuits', 'Digital Signal Processing', 'Communications Systems', 'Electromagnetics', 'Microprocessors', 'Control Systems', 'Digital Logic Design'],
      skills: ['MATLAB', 'Multisim', 'Proteus', 'KiCad', 'C / C++', 'Python', 'Oscilloscope & Logic Analyzer', 'PLC Programming']
    }
  };
  const COMMON_SKILLS = ['MS Excel', 'MS Office', 'Technical Drafting'];

  const SECTIONS = [
    { type: 'experience',    title: 'Experience',               note: 'Internships, OJT, part-time and project work.',        add: 'Add experience',    titleHint: 'e.g. Site Engineering Intern', orgHint: 'e.g. Company / Agency' },
    { type: 'leadership',    title: 'Leadership & Organizations', note: 'Officer roles, committees and student organizations.', add: 'Add leadership role', titleHint: 'e.g. Project Head', orgHint: 'e.g. COE Student Council' },
    { type: 'certification', title: 'Certifications & Training', note: 'Seminars, workshops and licenses.',                     add: 'Add certification', titleHint: 'e.g. DOLE BOSH Safety Training', orgHint: 'e.g. Issuing body' },
    { type: 'award',         title: 'Honors & Awards',           note: "Dean's list, scholarships and competitions.",           add: 'Add award',         titleHint: "e.g. Dean's Lister", orgHint: 'e.g. Awarding body' }
  ];
  const TYPE_LABEL = { leadership: 'Leadership', certification: 'Certification' };

  const STATUS_TEXT = {
    loading: 'Loading…',
    saved:   'All changes saved',
    saving:  'Saving…',
    unsaved: 'Unsaved changes',
    offline: 'Offline — kept in this browser',
    error:   'Not saved — tap to retry'
  };

  // ---------------- State ----------------
  let cv = emptyCv();
  let verified = [];          // read-only college records for this student
  let userId = null;
  let dirty = false;          // local edits not yet confirmed by the server
  let saving = false;
  let loadFailed = false;     // never autosave over a server copy we could not read
  let saveTimer = null;
  let retryDelay = 0;
  let lastSaveAt = 0;
  let previewQueued = false;
  let initialised = false;

  // ---------------- Small helpers ----------------
  const $ = (id) => document.getElementById(id);
  const trim = (v) => String(v ?? '').trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = value;
  }
  function uniqueCI(list) {
    const seen = new Set();
    return list.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const splitList = (s) => uniqueCI(String(s).split(',').map((x) => x.trim()).filter(Boolean));
  const newId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // Only http(s) links become clickable; anything else renders as plain text.
  function safeHref(url) {
    const v = trim(url);
    if (!v) return '';
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withScheme);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch { return ''; }
  }
  const displayUrl = (url) => trim(url).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

  // ---------------- Data shape ----------------
  function emptyCv() {
    return {
      full_name: '', contact_email: '', contact_phone: '', location: '',
      linkedin_url: '', github_url: '', portfolio_url: '',
      education: { program: '', degree: '', grad_year: '', coursework: [] },
      summary: '',
      technical_skills: [], soft_skills: [],
      capstone_project: { title: '', abstract: '', tech_stack: '' },
      custom_sections: [],
      selected_locker_items: []
    };
  }

  function normalizeEntries(list) {
    if (!Array.isArray(list)) return [];
    const types = SECTIONS.map((s) => s.type);
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
      id: (typeof e.id === 'string' && e.id) ? e.id : newId(),
      type: types.includes(e.type) ? e.type : 'experience',
      title: typeof e.title === 'string' ? e.title : '',
      organization: typeof e.organization === 'string' ? e.organization : '',
      date: typeof e.date === 'string' ? e.date : '',
      bullets: Array.isArray(e.bullets) ? e.bullets.filter((b) => typeof b === 'string') : []
    })).slice(0, MAX_ENTRIES);
  }

  function normalizeCv(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const str = (v) => (typeof v === 'string' ? v : '');
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
    const ed = (r.education && typeof r.education === 'object') ? r.education : {};
    const cp = (r.capstone_project && typeof r.capstone_project === 'object') ? r.capstone_project : {};
    return {
      full_name: str(r.full_name), contact_email: str(r.contact_email), contact_phone: str(r.contact_phone), location: str(r.location),
      linkedin_url: str(r.linkedin_url), github_url: str(r.github_url), portfolio_url: str(r.portfolio_url),
      education: { program: str(ed.program), degree: str(ed.degree), grad_year: String(ed.grad_year ?? ''), coursework: list(ed.coursework) },
      summary: str(r.summary),
      technical_skills: list(r.technical_skills), soft_skills: list(r.soft_skills),
      capstone_project: { title: str(cp.title), abstract: str(cp.abstract), tech_stack: str(cp.tech_stack) },
      custom_sections: normalizeEntries(r.custom_sections),
      selected_locker_items: list(r.selected_locker_items)
    };
  }

  function normalizeVerified(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((i) => i && typeof i.id === 'string').map((i) => ({
      id: i.id,
      type: i.type === 'seminar' ? 'certification' : 'leadership',
      title: trim(i.title),
      organization: trim(i.organization),
      date: trim(i.date_range),
      bullets: trim(i.description) ? [trim(i.description)] : []
    })).filter((i) => i.title);
  }

  // The exact document sent to the server (and used for change detection).
  function payload() {
    const c = cv;
    return {
      full_name: trim(c.full_name),
      contact_email: trim(c.contact_email),
      contact_phone: trim(c.contact_phone),
      location: trim(c.location),
      linkedin_url: trim(c.linkedin_url),
      github_url: trim(c.github_url),
      portfolio_url: trim(c.portfolio_url),
      education: {
        program: c.education.program,
        degree: trim(c.education.degree),
        grad_year: trim(c.education.grad_year),
        coursework: c.education.coursework
      },
      summary: trim(c.summary),
      technical_skills: c.technical_skills,
      soft_skills: c.soft_skills,
      capstone_project: {
        title: trim(c.capstone_project.title),
        abstract: trim(c.capstone_project.abstract),
        tech_stack: trim(c.capstone_project.tech_stack)
      },
      custom_sections: c.custom_sections
        .filter((e) => trim(e.title))
        .map((e) => ({
          id: e.id, type: e.type,
          title: trim(e.title), organization: trim(e.organization), date: trim(e.date),
          bullets: cleanBullets(e.bullets)
        })),
      selected_locker_items: c.selected_locker_items
    };
  }

  const cleanBullets = (list) => (list || []).map((b) => trim(b).slice(0, MAX_BULLET_LEN)).filter(Boolean).slice(0, MAX_BULLETS);

  // ---------------- Toast ----------------
  let toastTimer = null;
  function showToast(message, type = 'info') {
    const toast = $('cv-toast');
    if (!toast) return;
    $('cv-toast-message').textContent = message;
    $('cv-toast-icon').innerHTML = type === 'success'
      ? '<iconify-icon icon="solar:check-circle-bold" style="color:#22C55E;font-size:1.1rem;"></iconify-icon>'
      : (type === 'error'
        ? '<iconify-icon icon="solar:danger-circle-bold" style="color:#EF4444;font-size:1.1rem;"></iconify-icon>'
        : '<iconify-icon icon="solar:info-circle-bold" style="color:var(--primary);font-size:1.1rem;"></iconify-icon>');
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  // ---------------- Save status ----------------
  function setStatus(state, text) {
    const el = $('cv-status');
    if (!el) return;
    el.dataset.state = state;
    $('cv-status-text').textContent = text || STATUS_TEXT[state] || '';
  }

  // ---------------- Local draft cache ----------------
  function persistLocal() {
    if (!userId) return;
    try {
      localStorage.setItem(LOCAL_KEY(userId), JSON.stringify({ v: 2, dirty, savedAt: Date.now(), cv }));
    } catch { /* storage full / blocked - the server copy is still authoritative */ }
  }
  function readLocal() {
    if (!userId) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY(userId)) || 'null');
      return (parsed && parsed.v === 2 && parsed.cv) ? parsed : null;
    } catch { return null; }
  }

  // ---------------- Autosave ----------------
  function markDirty() {
    dirty = true;
    persistLocal();
    setStatus(navigator.onLine === false ? 'offline' : 'unsaved');
    scheduleSave();
  }

  function scheduleSave(minDelay = SAVE_DEBOUNCE_MS) {
    clearTimeout(saveTimer);
    const wait = Math.max(minDelay, lastSaveAt + MIN_SAVE_GAP_MS - Date.now());
    saveTimer = setTimeout(save, wait);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (!dirty || loadFailed) return;
    if (saving) return;                      // finishing save re-checks for newer edits
    if (navigator.onLine === false) { setStatus('offline'); return; }

    saving = true;
    setStatus('saving');
    const body = payload();
    const snapshot = JSON.stringify(body);
    try {
      await Api.request('PUT', '/cv/me', body);
      lastSaveAt = Date.now();
      retryDelay = 0;
      if (JSON.stringify(payload()) === snapshot) {
        dirty = false;
        persistLocal();
        setStatus('saved');
      } else {
        scheduleSave();                      // edited while the request was in flight
      }
    } catch (err) {
      handleSaveError(err);
    } finally {
      saving = false;
    }
  }

  function handleSaveError(err) {
    const msg = String(err?.message || '');
    persistLocal();
    if (/session|log in/i.test(msg)) {
      setStatus('error', 'Session expired — sign in again');
      showToast('Your session expired. Your edits are kept — sign in and reopen the CV builder.', 'error');
      setTimeout(toLogin, 3000);
      return;
    }
    if (navigator.onLine === false || err instanceof TypeError) {
      setStatus('offline');
      return;                                // the 'online' event triggers a retry
    }
    setStatus('error');
    retryDelay = Math.min((retryDelay || 15000) * 2, 120000);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, retryDelay);
  }

  function toLogin() { window.location.replace('/index.html'); }

  // ---------------- Form <-> state ----------------
  function fillForm() {
    document.querySelectorAll('#cv-form [data-path]').forEach((el) => {
      const val = getPath(cv, el.dataset.path);
      el.value = el.dataset.type === 'list' ? (val || []).join(', ') : (val ?? '');
    });
    updateCounters();
  }

  function updateCounters() {
    document.querySelectorAll('[data-counter-for]').forEach((c) => {
      const input = $(c.dataset.counterFor);
      if (!input) return;
      const max = Number(input.getAttribute('maxlength')) || 0;
      c.textContent = max ? `${input.value.length} / ${max}` : '';
    });
  }

  function onFormInput(e) {
    const t = e.target;

    if (t.dataset.verifiedId !== undefined) {
      toggleVerified(t.dataset.verifiedId, t.checked);
      return;
    }

    if (t.dataset.path) {
      const path = t.dataset.path;
      const prev = getPath(cv, path);
      setPath(cv, path, t.dataset.type === 'list' ? splitList(t.value) : t.value);

      if (path === 'education.program') onProgramChange(prev);
      if (path === 'education.coursework' || path === 'technical_skills' || path === 'education.program') renderChips();
      updateCounters();
      markDirty();
      queuePreview();
      return;
    }

    const card = t.closest('[data-entry-id]');
    if (card && t.dataset.entryKey) {
      const entry = cv.custom_sections.find((x) => x.id === card.dataset.entryId);
      if (!entry) return;
      if (t.dataset.entryKey === 'bullets') {
        entry.bullets = t.value.split('\n');
        updateBulletHint(card, t.value);
      } else {
        entry[t.dataset.entryKey] = t.value;
      }
      markDirty();
      queuePreview();
    }
  }

  // Picking a program only fills the degree name when the student has not
  // written their own; it never injects any other content.
  function onProgramChange(prevProgram) {
    const next = cv.education.program;
    const prevLabel = PROGRAMS[prevProgram]?.label;
    const degree = trim(cv.education.degree);
    if (PROGRAMS[next] && (!degree || degree === prevLabel)) {
      cv.education.degree = PROGRAMS[next].label;
      $('cv-degree').value = cv.education.degree;
    }
  }

  // ---------------- Suggestion chips ----------------
  function renderChips() {
    const program = PROGRAMS[cv.education.program];
    renderChipRow('coursework-chips', program ? program.coursework : [], cv.education.coursework, 'education.coursework');
    renderChipRow('skill-chips', uniqueCI([...(program ? program.skills : []), ...COMMON_SKILLS]), cv.technical_skills, 'technical_skills');
  }

  function renderChipRow(containerId, options, current, path) {
    const el = $(containerId);
    if (!el) return;
    const active = new Set(current.map((s) => s.toLowerCase()));
    el.innerHTML = options.map((opt) => {
      const on = active.has(opt.toLowerCase());
      return `<button type="button" class="cv-chip${on ? ' active' : ''}" data-chip="${esc(opt)}" data-chip-path="${esc(path)}" aria-pressed="${on}">${on ? '✓ ' : '+ '}${esc(opt)}</button>`;
    }).join('');
  }

  function toggleChip(path, value) {
    const list = getPath(cv, path) || [];
    const idx = list.findIndex((s) => s.toLowerCase() === value.toLowerCase());
    if (idx >= 0) list.splice(idx, 1); else list.push(value);
    setPath(cv, path, list);
    const input = document.querySelector(`#cv-form [data-path="${path}"]`);
    if (input) input.value = list.join(', ');
    renderChips();
    markDirty();
    queuePreview();
  }

  // ---------------- Verified college records ----------------
  function renderVerified() {
    const block = $('verified-block');
    const root = $('verified-root');
    if (!block || !root) return;
    block.hidden = verified.length === 0;
    const selected = new Set(cv.selected_locker_items);
    root.innerHTML = verified.map((v) => `
      <label class="cv-verified${selected.has(v.id) ? ' on' : ''}">
        <input type="checkbox" data-verified-id="${esc(v.id)}" ${selected.has(v.id) ? 'checked' : ''} />
        <span class="cv-verified-main">
          <span class="cv-verified-title">${esc(v.title)}</span>
          <span class="cv-verified-sub">${esc(v.organization)}${v.date ? ' · ' + esc(v.date) : ''}</span>
        </span>
        <span class="cv-verified-tag">${esc(TYPE_LABEL[v.type] || '')}</span>
      </label>`).join('');
  }

  function toggleVerified(id, on) {
    const set = new Set(cv.selected_locker_items);
    if (on) set.add(id); else set.delete(id);
    cv.selected_locker_items = Array.from(set);
    renderVerified();
    markDirty();
    queuePreview();
  }

  // ---------------- Entries (experience / leadership / certifications / awards) ----------------
  function renderEntries() {
    const root = $('entries-root');
    if (!root) return;
    root.innerHTML = SECTIONS.map((sec) => {
      const items = cv.custom_sections.filter((e) => e.type === sec.type);
      return `
        <section class="cv-block" data-section="${sec.type}">
          <h3 class="cv-block-title">${esc(sec.title)}</h3>
          <p class="cv-block-note">${esc(sec.note)}</p>
          <div class="cv-entry-list">
            ${items.map((e, i) => entryCardHtml(e, sec, i, items.length)).join('')}
          </div>
          <button type="button" class="cv-add-btn" data-action="add" data-type="${sec.type}">
            <iconify-icon icon="solar:add-circle-linear"></iconify-icon> ${esc(sec.add)}
          </button>
        </section>`;
    }).join('');
    root.querySelectorAll('[data-entry-id] textarea').forEach((ta) => updateBulletHint(ta.closest('[data-entry-id]'), ta.value));
  }

  function entryCardHtml(e, sec, index, total) {
    return `
      <div class="cv-entry" data-entry-id="${esc(e.id)}">
        <div class="cv-entry-head">
          <span class="cv-entry-num">${esc(sec.title.split(' ')[0])} ${index + 1}</span>
          <div class="cv-entry-actions">
            <button type="button" class="cv-icon-btn" data-action="up" data-id="${esc(e.id)}" aria-label="Move up" ${index === 0 ? 'disabled' : ''}><iconify-icon icon="solar:arrow-up-linear"></iconify-icon></button>
            <button type="button" class="cv-icon-btn" data-action="down" data-id="${esc(e.id)}" aria-label="Move down" ${index === total - 1 ? 'disabled' : ''}><iconify-icon icon="solar:arrow-down-linear"></iconify-icon></button>
            <button type="button" class="cv-icon-btn danger" data-action="remove" data-id="${esc(e.id)}" aria-label="Remove entry"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button>
          </div>
        </div>
        <div class="cv-form-group">
          <label>Title / role</label>
          <input type="text" class="cv-input" data-entry-key="title" maxlength="120" value="${esc(e.title)}" placeholder="${esc(sec.titleHint)}" />
        </div>
        <div class="cv-form-row">
          <div class="cv-form-group">
            <label>Organization</label>
            <input type="text" class="cv-input" data-entry-key="organization" maxlength="120" value="${esc(e.organization)}" placeholder="${esc(sec.orgHint)}" />
          </div>
          <div class="cv-form-group">
            <label>Date</label>
            <input type="text" class="cv-input" data-entry-key="date" maxlength="40" value="${esc(e.date)}" placeholder="e.g. Jun – Aug 2025" />
          </div>
        </div>
        <div class="cv-form-group">
          <label>Details <span class="cv-field-hint">one point per line</span></label>
          <textarea class="cv-input" data-entry-key="bullets" rows="3" placeholder="What you did and what came of it">${esc((e.bullets || []).join('\n'))}</textarea>
          <span class="cv-counter cv-bullet-hint"></span>
        </div>
      </div>`;
  }

  function updateBulletHint(card, value) {
    const hint = card && card.querySelector('.cv-bullet-hint');
    if (!hint) return;
    const lines = value.split('\n').map((l) => l.trim()).filter(Boolean);
    const tooLong = lines.some((l) => l.length > MAX_BULLET_LEN);
    const over = lines.length > MAX_BULLETS;
    hint.classList.toggle('warn', over || tooLong);
    hint.textContent = over
      ? `Only the first ${MAX_BULLETS} lines appear on your CV`
      : (tooLong ? `Lines are cut at ${MAX_BULLET_LEN} characters` : `${lines.length} / ${MAX_BULLETS} lines`);
  }

  function onEntriesClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'add') {
      if (cv.custom_sections.length >= MAX_ENTRIES) {
        showToast(`You can add up to ${MAX_ENTRIES} entries.`, 'error');
        return;
      }
      const entry = { id: newId(), type: btn.dataset.type, title: '', organization: '', date: '', bullets: [] };
      cv.custom_sections.push(entry);
      renderEntries();
      const input = document.querySelector(`[data-entry-id="${entry.id}"] [data-entry-key="title"]`);
      if (input) input.focus();
      return;
    }

    const id = btn.dataset.id;
    const idx = cv.custom_sections.findIndex((x) => x.id === id);
    if (idx === -1) return;

    if (action === 'remove') {
      cv.custom_sections.splice(idx, 1);
    } else {
      // Swap with the neighbouring entry of the SAME section.
      const type = cv.custom_sections[idx].type;
      const step = action === 'up' ? -1 : 1;
      let j = idx + step;
      while (j >= 0 && j < cv.custom_sections.length && cv.custom_sections[j].type !== type) j += step;
      if (j < 0 || j >= cv.custom_sections.length) return;
      [cv.custom_sections[idx], cv.custom_sections[j]] = [cv.custom_sections[j], cv.custom_sections[idx]];
    }
    renderEntries();
    markDirty();
    queuePreview();
  }

  // ---------------- Paper preview ----------------
  function entryHtml(e) {
    const bullets = cleanBullets(e.bullets);
    return `
      <div class="cv-item">
        <div class="cv-row">
          <span class="cv-item-title">${esc(e.title)}</span>
          ${trim(e.date) ? `<span class="cv-item-date">${esc(e.date)}</span>` : ''}
        </div>
        ${trim(e.organization) ? `<div class="cv-item-org">${esc(e.organization)}</div>` : ''}
        ${bullets.length ? `<ul class="cv-bullets">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  const sectionHtml = (title, body) =>
    `<section class="cv-sec"><h2 class="cv-sec-title">${esc(title)}</h2>${body}</section>`;

  function linkHtml(label, url) {
    const text = displayUrl(url);
    const href = safeHref(url);
    const body = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
    return `<span>${esc(label)}: ${body}</span>`;
  }

  function entriesFor(type) {
    const own = cv.custom_sections.filter((e) => e.type === type && trim(e.title));
    const selected = new Set(cv.selected_locker_items);
    const official = verified.filter((v) => v.type === type && selected.has(v.id));
    return [...own, ...official];
  }

  function paperHtml() {
    const c = cv;
    const parts = [];

    // Header
    const contact = [c.location, c.contact_phone, c.contact_email].map(trim).filter(Boolean);
    const links = [['LinkedIn', c.linkedin_url], ['GitHub', c.github_url], ['Portfolio', c.portfolio_url]].filter(([, u]) => trim(u));
    const name = trim(c.full_name);
    parts.push(`
      <header class="cv-head">
        ${name ? `<h1 class="cv-name">${esc(name)}</h1>` : '<h1 class="cv-name cv-screen-only cv-name-empty">Your Name</h1>'}
        ${contact.length ? `<div class="cv-contact">${contact.map((x) => `<span>${esc(x)}</span>`).join('<i class="cv-sep">•</i>')}</div>` : ''}
        ${links.length ? `<div class="cv-contact">${links.map(([l, u]) => linkHtml(l, u)).join('<i class="cv-sep">•</i>')}</div>` : ''}
      </header>`);

    // Education
    const ed = c.education;
    if (trim(ed.degree) || trim(ed.grad_year) || ed.coursework.length) {
      parts.push(sectionHtml('Education', `
        <div class="cv-item">
          <div class="cv-row">
            <span class="cv-item-title">${esc(trim(ed.degree) || 'Bachelor of Science in Engineering')}</span>
            ${trim(ed.grad_year) ? `<span class="cv-item-date">Expected ${esc(trim(ed.grad_year))}</span>` : ''}
          </div>
          <div class="cv-item-org">${esc(INSTITUTION)}</div>
          ${ed.coursework.length ? `<ul class="cv-bullets"><li><strong>Relevant Coursework:</strong> ${esc(ed.coursework.join(', '))}</li></ul>` : ''}
        </div>`));
    }

    if (trim(c.summary)) parts.push(sectionHtml('Summary', `<p class="cv-para">${esc(trim(c.summary))}</p>`));

    const exp = entriesFor('experience');
    if (exp.length) parts.push(sectionHtml('Experience', exp.map(entryHtml).join('')));

    const cp = c.capstone_project;
    if (trim(cp.title)) {
      parts.push(sectionHtml('Capstone Project', `
        <div class="cv-item">
          <div class="cv-row"><span class="cv-item-title">${esc(trim(cp.title))}</span></div>
          ${trim(cp.tech_stack) ? `<div class="cv-item-org">${esc(trim(cp.tech_stack))}</div>` : ''}
          ${trim(cp.abstract) ? `<ul class="cv-bullets"><li>${esc(trim(cp.abstract))}</li></ul>` : ''}
        </div>`));
    }

    const lead = entriesFor('leadership');
    if (lead.length) parts.push(sectionHtml('Leadership & Organizations', lead.map(entryHtml).join('')));

    const certs = entriesFor('certification');
    if (certs.length) parts.push(sectionHtml('Certifications & Training', certs.map(entryHtml).join('')));

    const awards = entriesFor('award');
    if (awards.length) parts.push(sectionHtml('Honors & Awards', awards.map(entryHtml).join('')));

    if (c.technical_skills.length || c.soft_skills.length) {
      parts.push(sectionHtml('Skills', `<ul class="cv-bullets">
        ${c.technical_skills.length ? `<li><strong>Technical Skills:</strong> ${esc(c.technical_skills.join(', '))}</li>` : ''}
        ${c.soft_skills.length ? `<li><strong>Other Skills &amp; Languages:</strong> ${esc(c.soft_skills.join(', '))}</li>` : ''}
      </ul>`));
    }

    if (parts.length === 1 && !name) {
      parts.push('<p class="cv-paper-empty cv-screen-only">Your CV appears here as you fill in the form.</p>');
    }
    return parts.join('');
  }

  function hasContent() {
    const p = payload();
    return !!(p.full_name || p.summary || p.education.degree || p.education.coursework.length ||
      p.technical_skills.length || p.soft_skills.length || p.capstone_project.title ||
      p.custom_sections.length || p.selected_locker_items.length);
  }

  function renderPaper() {
    const paper = $('cv-paper');
    if (!paper) return;
    paper.innerHTML = paperHtml();
    fitPaper();
    updateLength();
  }

  function queuePreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      renderPaper();
    });
  }

  // Scale the fixed-size sheet down to the space available (phones, narrow panes).
  function fitPaper() {
    const frame = $('cv-paper-frame');
    const paper = $('cv-paper');
    if (!frame || !paper) return;
    const avail = frame.clientWidth;
    if (!avail) return;                      // pane is hidden (mobile edit tab)
    const scale = Math.min(1, avail / PAPER_W);
    paper.style.transform = scale < 1 ? `scale(${scale})` : '';
    frame.style.height = `${Math.ceil(paper.offsetHeight * scale)}px`;
  }

  function updateLength() {
    const paper = $('cv-paper');
    const out = $('cv-length');
    if (!paper || !out) return;
    const pages = Math.max(1, Math.ceil((paper.offsetHeight - PAPER_CHROME_H) / PAPER_PRINTABLE_H));
    out.classList.toggle('warn', pages > 1);
    out.textContent = pages > 1
      ? `Runs to ${pages} pages — trim to fit one page`
      : 'Fits on one page';
  }

  // ---------------- Actions ----------------
  function exportPdf() {
    if (!hasContent()) {
      showToast('Add some details before downloading.', 'info');
      return;
    }
    const previousTitle = document.title;
    const name = trim(cv.full_name);
    document.title = name ? `${name} - CV` : 'CV';   // becomes the default PDF filename
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  function resetCv() {
    if (!confirm('Clear every field and start over? This also removes your saved CV.')) return;
    cv = emptyCv();
    fillForm();
    renderChips();
    renderVerified();
    renderEntries();
    renderPaper();
    markDirty();
    showToast('CV cleared.', 'info');
  }

  function setPane(pane) {
    document.body.dataset.pane = pane;
    document.querySelectorAll('.cv-mobile-tab').forEach((t) => {
      const on = t.dataset.pane === pane;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    if (pane === 'preview') requestAnimationFrame(() => { fitPaper(); updateLength(); });
  }

  // ---------------- Load ----------------
  function showLoadError() {
    loadFailed = true;
    document.body.dataset.loadError = '1';
    setStatus('error', 'Could not load your CV');
    if (!$('cv-load-error')) {
      const box = document.createElement('div');
      box.id = 'cv-load-error';
      box.className = 'cv-load-error';
      box.innerHTML = `
        <strong>We couldn't load your saved CV.</strong>
        <p>To protect what you've already saved, editing is paused until it loads.</p>
        <button type="button" class="btn btn-primary" id="cv-load-retry">Try again</button>`;
      $('cv-editor').prepend(box);
      $('cv-load-retry').addEventListener('click', () => window.location.reload());
    }
  }

  async function loadData() {
    setStatus('loading');
    let remote = null;
    let remoteErr = null;
    try {
      remote = await Api.request('GET', '/cv/me');
    } catch (err) {
      remoteErr = err;
    }

    if (remoteErr && /session|log in/i.test(String(remoteErr.message || ''))) {
      toLogin();
      return false;
    }

    const local = readLocal();

    if (remote) {
      verified = normalizeVerified(remote.locker_items);
      if (local && local.dirty) {
        cv = normalizeCv(local.cv);          // unsynced edits win over the older server copy
        dirty = true;
      } else {
        cv = normalizeCv(remote);
        dirty = false;
      }
    } else if (local) {
      cv = normalizeCv(local.cv);            // offline / server down: work from the browser copy
      dirty = !!local.dirty;
    } else {
      showLoadError();
      return false;
    }

    fillForm();
    renderChips();
    renderVerified();
    renderEntries();
    renderPaper();

    if (dirty) {
      setStatus(remote ? 'unsaved' : 'offline');
      if (remote) scheduleSave(1000);
    } else {
      setStatus('saved');
    }
    return true;
  }

  // ---------------- Wiring ----------------
  function bindEvents() {
    const form = $('cv-form');
    // 'input' fires for text fields, selects and checkboxes alike. Do not also
    // listen for 'change': it fires on blur and its handler re-renders the
    // suggestion chips, which swallows the click that caused the blur.
    form.addEventListener('input', onFormInput);
    form.addEventListener('click', (e) => {
      const chip = e.target.closest('.cv-chip');
      if (chip) { toggleChip(chip.dataset.chipPath, chip.dataset.chip); return; }
      if (e.target.closest('#entries-root')) onEntriesClick(e);
    });

    $('cv-print-btn').addEventListener('click', exportPdf);
    $('cv-reset-btn').addEventListener('click', resetCv);
    $('cv-status').addEventListener('click', () => {
      const state = $('cv-status').dataset.state;
      if (dirty && (state === 'error' || state === 'offline' || state === 'unsaved')) {
        retryDelay = 0;
        save();
      }
    });

    document.querySelectorAll('.cv-mobile-tab').forEach((t) => {
      t.addEventListener('click', () => setPane(t.dataset.pane));
    });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => fitPaper()).observe($('cv-preview'));
    }
    window.addEventListener('resize', fitPaper);
    window.addEventListener('online', () => { if (dirty) { retryDelay = 0; save(); } });
    window.addEventListener('offline', () => { if (dirty) setStatus('offline'); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && dirty) save();
    });
    window.addEventListener('beforeunload', (e) => {
      if (dirty && !loadFailed) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async function init() {
    if (initialised) return;
    initialised = true;

    bindEvents();
    renderPaper();

    const session = await Auth.getSession();
    if (!session) { toLogin(); return; }
    userId = session.user.id;
    try { localStorage.removeItem(LEGACY_LOCAL_KEY); } catch { /* storage unavailable */ }

    await loadData();
  }

  return { init };
})();
