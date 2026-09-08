# Grizz Load-Add + Enrollment Pilot Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let pilot users push Grizz's "Next Sem Recommendations" into their Load Verification draft, and gate the whole enrollment feature set (student Load Verification + `/faculty` + their APIs) to an email allowlist so it can ship to `main` for live testing while everyone else sees "still under development".

**Architecture:** One allowlist mirrored client (`config.js`) and server (`pilotGate` middleware on the two routers). Grizz's recommendation renderer gains add buttons that call the existing Phase C hook (`Enrollment.addFromGrizz`); the enrollment module widens its export with state accessors. No schema changes, no new endpoints.

**Tech Stack:** Vanilla JS client (no framework), Express server, Supabase. Tests follow the repo's established pattern: static wiring smoke scripts (`scripts/smoke-test-*.js`) + manual GUI QA against `http://localhost:3000`.

**Spec:** `docs/superpowers/specs/2026-09-08-grizz-load-add-and-pilot-gate-design.md`

## Global Constraints

- Vanilla JS only in `client/js/` — no imports, no frameworks; classic scripts sharing global scope.
- Every modified client asset gets a `?v=` bump in every HTML page that includes it (repo cache-busting convention).
- All dynamic strings inserted into HTML go through the module's `esc()` helper.
- Program casing is exact (`'BSCoE' | 'BSCE' | 'BSECE'`) wherever the checklists API is called — never `.toUpperCase()` the value passed to an API.
- QA constraint: emails fire only to fake test addresses; never touch the real admin account's password.
- Test password for all seeded accounts: `Coetest2026!`.
- Pilot list (verbatim, client and server default): `lexmatondo@g.cjc.edu.ph`, `test.newuser@g.cjc.edu.ph`, `bsce.test@g.cjc.edu.ph`, `head.test@g.cjc.edu.ph`, `dean.test@g.cjc.edu.ph`, `sa.test@g.cjc.edu.ph`, `klydemodina@g.cjc.edu.ph`.
- Subject IDs are UUIDs; `subjects.id` is shared by Grizz and the enrollment module (both read `Api.units.checklists`).

---

### Task 1: Server pilot gate middleware

**Files:**
- Modify: `server/middleware/roles.js`
- Modify: `server/routes/enrollment.js` (after `router.use(requireStudent);` line)
- Modify: `server/routes/faculty.js` (after `router.use(requireFaculty);` line)
- Create: `scripts/smoke-test-pilot-gate.js`

**Interfaces:**
- Consumes: `req.user.email` — attached by `server/middleware/auth.js` (`req.user = user`), which runs before both routers (`server/index.js:182-183`).
- Produces: `pilotGate(req, res, next)` exported from `server/middleware/roles.js`; returns 403 `{ error: 'This feature is still under development.' }` for non-pilot emails.

- [ ] **Step 1: Write the failing smoke script**

Create `scripts/smoke-test-pilot-gate.js` (same static-check style as `smoke-test-api-groups.js`):

```js
// Static wiring checks for the enrollment pilot gate (spec 2026-09-08).
const fs = require('fs');
const path = require('path');
let failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failed++;
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// --- server gate (Task 1) ---
const roles = read('server/middleware/roles.js');
check('pilotGate middleware defined', /function pilotGate\(/.test(roles));
check('pilotGate checks req.user.email', /req\.user\?\.email/.test(roles));
check('pilotGate default includes admin + test accounts',
  ['lexmatondo', 'test.newuser', 'bsce.test', 'head.test', 'dean.test', 'sa.test', 'klydemodina']
    .every(e => roles.includes(e + '@g.cjc.edu.ph')));
check('pilotGate reads ENROLLMENT_PILOT_EMAILS env', /ENROLLMENT_PILOT_EMAILS/.test(roles));
check('pilotGate exported', /pilotGate/.test((roles.match(/module\.exports[^;]+/) || [''])[0]));

const enr = read('server/routes/enrollment.js');
check('enrollment router applies pilotGate', /router\.use\(requireStudent\);\s*\n\s*router\.use\(pilotGate\)/.test(enr));

const fac = read('server/routes/faculty.js');
check('faculty router applies pilotGate', /router\.use\(requireFaculty\);\s*\n\s*router\.use\(pilotGate\)/.test(fac));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll pilot-gate checks passed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node scripts/smoke-test-pilot-gate.js`
Expected: FAIL on all checks (pilotGate undefined).

- [ ] **Step 3: Implement the middleware**

In `server/middleware/roles.js`, before `module.exports`, add:

```js
// Enrollment pilot allowlist (Phase B/C rollout gate, spec 2026-09-08).
// Client mirror: client/js/config.js window.ENROLLMENT_PILOT_EMAILS.
// Override with ENROLLMENT_PILOT_EMAILS="a@x.com, b@x.com" on the server.
const PILOT_DEFAULT = [
  'lexmatondo@g.cjc.edu.ph',
  'test.newuser@g.cjc.edu.ph',
  'bsce.test@g.cjc.edu.ph',
  'head.test@g.cjc.edu.ph',
  'dean.test@g.cjc.edu.ph',
  'sa.test@g.cjc.edu.ph',
  'klydemodina@g.cjc.edu.ph',
];

function pilotGate(req, res, next) {
  const raw = process.env.ENROLLMENT_PILOT_EMAILS;
  const list = raw
    ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : PILOT_DEFAULT;
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (!list.includes(email)) {
    return res.status(403).json({ error: 'This feature is still under development.' });
  }
  next();
}
```

Extend the export line to:

```js
module.exports = { OFFICER_ROLES, GOVERNOR_ROLES, FACULTY_ROLES, requireAdmin, requireGovernorOrAdmin, requireOfficer, requireFaculty, requireProgramHead, pilotGate };
```

In `server/routes/enrollment.js`: add `pilotGate` to the `require('../middleware/roles')` destructure and, directly after the existing `router.use(requireStudent);` line, add:

```js
router.use(pilotGate);
```

In `server/routes/faculty.js`: same pattern — import `pilotGate`, and directly after `router.use(requireFaculty);` add:

```js
router.use(pilotGate);
```

- [ ] **Step 4: Run the smoke script, verify it passes**

Run: `node scripts/smoke-test-pilot-gate.js`
Expected: all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/roles.js server/routes/enrollment.js server/routes/faculty.js scripts/smoke-test-pilot-gate.js
git commit -m "feat(enrollment): server pilot gate on enrollment + faculty routers"
```

---

### Task 2: Client pilot flag + student Load Verification gate

**Files:**
- Modify: `client/js/config.js` (append at end of file)
- Modify: `client/js/enrollment.js` (top of `load()`, which starts at line ~24)
- Modify: `client/styles/main.css` (append in the `enrollment-*` block, before the `@media` fallback at line ~7145)

**Interfaces:**
- Produces: `window.isEnrollmentPilot(email) -> boolean` and `window.ENROLLMENT_PILOT_EMAILS` (array). Task 3 and Task 5 consume `isEnrollmentPilot`.
- Produces: `EnrollmentSection` renders a gated notice instead of loading for non-pilot users.

- [ ] **Step 1: Extend the smoke script (failing)**

Append to `scripts/smoke-test-pilot-gate.js` before the summary `console.log`:

```js
// --- client flag + student gate (Task 2) ---
const cfg = read('client/js/config.js');
check('config defines ENROLLMENT_PILOT_EMAILS', /ENROLLMENT_PILOT_EMAILS\s*=/.test(cfg));
check('config defines isEnrollmentPilot', /window\.isEnrollmentPilot\s*=/.test(cfg));
check('config pilot list has 7 emails', (cfg.match(/@g\.cjc\.edu\.ph/g) || []).length >= 7);

const enrollmentJs = read('client/js/enrollment.js');
check('enrollment load() checks isEnrollmentPilot', /isEnrollmentPilot/.test(enrollmentJs));
check('enrollment renders gated notice', /renderGatedNotice/.test(enrollmentJs));
```

Run: `node scripts/smoke-test-pilot-gate.js` — expect the new checks to FAIL.

- [ ] **Step 2: Implement config.js flag**

Append to `client/js/config.js`:

```js
// =============================================
// Enrollment pilot allowlist (Phase B/C rollout, spec 2026-09-08).
// Server mirror: server/middleware/roles.js PILOT_DEFAULT.
// =============================================
window.ENROLLMENT_PILOT_EMAILS = [
  'lexmatondo@g.cjc.edu.ph',   // admin / developer
  'test.newuser@g.cjc.edu.ph', // student: Alex Rivera (BSCoE, Yr 2)
  'bsce.test@g.cjc.edu.ph',    // student: Maria Santos (BSCE, seeded submitted load)
  'head.test@g.cjc.edu.ph',    // program head (BSCoE)
  'dean.test@g.cjc.edu.ph',    // dean
  'sa.test@g.cjc.edu.ph',      // student assistant (faculty role)
  'klydemodina@g.cjc.edu.ph',  // real student account for live testing
];
window.isEnrollmentPilot = function (email) {
  const v = String(email || '').trim().toLowerCase();
  return (window.ENROLLMENT_PILOT_EMAILS || []).some(e => String(e).trim().toLowerCase() === v);
};
```

- [ ] **Step 3: Gate the enrollment module**

In `client/js/enrollment.js`, add this helper above `load()`:

```js
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
```

Then make `load()` start with the gate, before any API call:

```js
  async function load() {
    const profile = await Auth.getProfile().catch(() => null);
    if (!window.isEnrollmentPilot?.(profile?.email)) {
      renderGatedNotice();
      return;
    }
    // checklists API validates exact casing ('BSCoE' | 'BSCE' | 'BSECE')
    ...existing body continues unchanged...
```

- [ ] **Step 4: Add the notice CSS**

Append inside `client/styles/main.css` at the end of the enrollment block (before the `@media` fallback around line 7145):

```css
.enrollment-gated {
  max-width: 560px;
  margin: 3rem auto;
  padding: 2rem;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}
.enrollment-gated h3 { margin: 0 0 0.6rem; }
.enrollment-gated p { margin: 0; color: var(--text-secondary); }
```

- [ ] **Step 5: Run the smoke script, verify all pass**

Run: `node scripts/smoke-test-pilot-gate.js`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add client/js/config.js client/js/enrollment.js client/styles/main.css scripts/smoke-test-pilot-gate.js
git commit -m "feat(enrollment): client pilot flag + gated Load Verification notice"
```

---

### Task 3: Faculty portal gate

**Files:**
- Modify: `client/js/faculty/faculty.js` (in `boot()`, after the `FACULTY_ROLES.includes(profile.role)` check, before `$('faculty-gate').hidden = true;` at line ~64)

**Interfaces:**
- Consumes: `window.isEnrollmentPilot` (Task 2), `showGate(message)` (existing, line ~49).
- Behavior: non-pilot faculty-role users are still redirected to `/faculty` by `app.js`, but see the gate screen with the under-development message instead of the portal.

- [ ] **Step 1: Extend the smoke script (failing)**

Append before the summary log:

```js
// --- faculty portal gate (Task 3) ---
const facultyJs = read('client/js/faculty/faculty.js');
check('faculty boot() checks isEnrollmentPilot', /isEnrollmentPilot/.test(facultyJs));
```

Run: `node scripts/smoke-test-pilot-gate.js` — new check FAILs.

- [ ] **Step 2: Implement**

In `client/js/faculty/faculty.js` `boot()`, directly after the role check block (`if (!FACULTY_ROLES.includes(profile.role)) { ... }`), insert:

```js
    if (!window.isEnrollmentPilot?.(profile.email)) {
      return showGate('🚧 The enrollment verification portal is still under development. It will open for your role soon.');
    }
```

- [ ] **Step 3: Run smoke, verify pass**

Run: `node scripts/smoke-test-pilot-gate.js`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add client/js/faculty/faculty.js scripts/smoke-test-pilot-gate.js
git commit -m "feat(faculty): pilot-gate the faculty portal behind the allowlist"
```

---

### Task 4: Enrollment module export widening + addItem result contract

**Files:**
- Modify: `client/js/enrollment.js` (`addItem` ~line 110, `DOMContentLoaded` handler ~line 149, `window.Enrollment` export ~line 158)

**Interfaces:**
- Produces (consumed by Task 5):
  - `Enrollment.addFromGrizz(subject, reason) -> Promise<{ok: true, item} | {ok: false, error}>`
  - `Enrollment.ensureReady() -> Promise<void>` (alias of `load()`; idempotent, creates the term draft if none)
  - `Enrollment.canEdit() -> boolean` (true only for draft/returned)
  - `Enrollment.lockedReason() -> string` (human-readable, `''` when editable)
  - `Enrollment.draftSubjectIds() -> Set<UUID>` (active items only, `removed_by_head` excluded)
- Breaking change handled here: `addItem` no longer calls `show()` internally — it returns the error; the view's own button surfaces it.

- [ ] **Step 1: Extend the smoke script (failing)**

Append before the summary log:

```js
// --- enrollment export widening (Task 4) ---
check('Enrollment exports ensureReady', /ensureReady:\s*load/.test(enrollmentJs));
check('Enrollment exports canEdit', /canEdit:\s*\(\)/.test(enrollmentJs));
check('Enrollment exports lockedReason', /lockedReason:\s*\(\)/.test(enrollmentJs));
check('Enrollment exports draftSubjectIds', /draftSubjectIds:\s*\(\)/.test(enrollmentJs));
check('addItem returns ok/error contract', /return\s*\{\s*ok:\s*false,\s*error/.test(enrollmentJs));
```

Run: `node scripts/smoke-test-pilot-gate.js` — new checks FAIL.

- [ ] **Step 2: Implement**

Replace `addItem` in `client/js/enrollment.js` with:

```js
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
```

Update the DOMContentLoaded click handler so the view still surfaces errors:

```js
    document.getElementById('enrollment-add-btn')?.addEventListener('click', async () => {
      const sel = document.getElementById('enrollment-subject-select');
      if (!sel?.value) return;
      const res = await addItem(sel.value);
      if (!res.ok) show(res.error);
    });
```

Replace the `window.Enrollment` export line with:

```js
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
```

- [ ] **Step 3: Run smoke, verify pass**

Run: `node scripts/smoke-test-pilot-gate.js`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add client/js/enrollment.js scripts/smoke-test-pilot-gate.js
git commit -m "feat(enrollment): expose state accessors + result contract for Grizz"
```

---

### Task 5: Grizz recommendation add buttons

**Files:**
- Modify: `client/js/ai-assistant.js` (`appendBotMessage` ~line 507; `handleNextSemRecommendations` ~line 835-973)
- Modify: `client/styles/ai.css` (append after the `.ursa-subject-tag.req` block, ~line 583)

**Interfaces:**
- Consumes: all five `window.Enrollment` members from Task 4; `window.isEnrollmentPilot` from Task 2.
- Produces: recommendation cards with `data-grizz-add="<subjectId>"` buttons, a `data-grizz-add-all` button, `data-grizz-result` and `data-grizz-lock` note elements; `appendBotMessage` returns the message element.
- Note: the card styles live in `ai.css` (Grizz chat styles), NOT `main.css`.

- [ ] **Step 1: Extend the smoke script (failing)**

Append before the summary log:

```js
// --- Grizz add buttons (Task 5) ---
const aiJs = read('client/js/ai-assistant.js');
check('appendBotMessage returns message element', /scrollToBottom\(\);\s*\n\s*return msg;/.test(aiJs));
check('recommendations await ensureReady', /await window\.Enrollment\?\.ensureReady\(\)/.test(aiJs));
check('per-card add buttons rendered', /data-grizz-add=/.test(aiJs));
check('add-all button rendered', /data-grizz-add-all/.test(aiJs));
check('jump link to enrollment view', /ursa-nav-link"\s+data-view="enrollment"/.test(aiJs));
```

Run: `node scripts/smoke-test-pilot-gate.js` — new checks FAIL.

- [ ] **Step 2: Make appendBotMessage return the element**

In `client/js/ai-assistant.js` `appendBotMessage`, after `scrollToBottom();` add `return msg;`:

```js
    stream.appendChild(msg);
    scrollToBottom();
    return msg;
  }
```

- [ ] **Step 3: Rewrite handleNextSemRecommendations with the add UI**

Replace the whole function (from `function handleNextSemRecommendations() {` through its closing brace) with:

```js
  async function handleNextSemRecommendations() {
    const prog = profile?.course || 'BSCoE';
    const progTitle = PROGRAM_NAMES[prog] || prog;

    // Partial-pass records do not satisfy prerequisites (handled inside
    // classifyPasses); the Component Backlog note for them is rendered by
    // the Academic Progress summary.
    const { passedCodes, enrolledCodes } = classifyPasses(myUnits);

    const currentYear = Number(profile?.year_level) || 1;

    // Build once per recommendation run, from the checklists payload captured in loadData():
    const prereqsBySubject = new Map();
    for (const r of (prereqRows || [])) {
      if (!prereqsBySubject.has(r.subject_id)) prereqsBySubject.set(r.subject_id, []);
      prereqsBySubject.get(r.subject_id).push(r);
    }

    // Find uncompleted subjects (exclude both PASSED and CURRENTLY ENROLLED subjects)
    const uncompleted = subjects.filter(s => {
      const c = s.code.trim().toUpperCase();
      return !passedCodes.has(c) && !enrolledCodes.has(c);
    });

    const eligible = [];
    const blockedByPrereq = [];

    uncompleted.forEach(s => {
      const prereqStr = (s.prerequisites || '').trim();

      const verdict = evaluatePrereqs(s, prereqsBySubject, passedCodes, enrolledCodes, currentYear);
      if (verdict) {
        if (verdict.satisfied) {
          eligible.push({ ...s, missingPrereq: null, prereqNotes: verdict.notes });
        } else {
          blockedByPrereq.push({ ...s, reason: `Missing prerequisite: ${verdict.missing.join(', ')}` });
        }
        return;
      }

      // ---- legacy fallback (subjects with no structured rows yet) ----
      if (!prereqStr || prereqStr === 'None' || prereqStr === '-') {
        eligible.push({ ...s, missingPrereq: null });
        return;
      }

      const standingMatch = prereqStr.match(/(\d+)(?:st|nd|rd|th)?\s*Yr\s*Standing/i);
      if (standingMatch) {
        const requiredYr = Number(standingMatch[1]);
        if (currentYear < requiredYr) {
          blockedByPrereq.push({ ...s, reason: `Requires Year ${requiredYr} standing` });
          return;
        }
      }

      const rawTokens = prereqStr.split(/[;,/]/).map(t => t.replace(/co-req/i, '').trim()).filter(Boolean);
      let satisfies = true;
      let missing = [];

      rawTokens.forEach(token => {
        const normToken = token.trim().toUpperCase();
        // Prerequisite is satisfied if passed or currently enrolled in active semester
        if (normToken && !normToken.includes('STANDING') && !passedCodes.has(normToken) && !enrolledCodes.has(normToken)) {
          if (/^[A-Z0-9\s-]+$/.test(normToken)) {
            satisfies = false;
            missing.push(token.trim());
          }
        }
      });

      if (satisfies) {
        eligible.push({ ...s, missingPrereq: null });
      } else {
        blockedByPrereq.push({ ...s, reason: `Missing prerequisite: ${missing.join(', ')}` });
      }
    });

    eligible.sort((a, b) => a.year_level - b.year_level || a.semester - b.semester);

    let totalUnits = 0;
    const recommended = [];
    for (const s of eligible) {
      if (totalUnits + s.units <= 24 || recommended.length < 5) {
        recommended.push(s);
        totalUnits += s.units;
      }
    }

    if (recommended.length === 0) {
      appendBotMessage(
        'Curriculum Recommendations',
        `<p>You have completed or are currently enrolled in all available prerequisite-cleared courses for <strong>${esc(progTitle)}</strong>.</p>`,
        [
          { action: 'academic-progress', label: 'View Academic Progress', icon: 'solar:diploma-verified-linear' },
        ]
      );
      return;
    }

    // Phase C: pilot accounts can push recommendations into their Load
    // Verification draft. Non-pilots get today's cards with no add UI.
    const pilot = window.isEnrollmentPilot?.(profile?.email);
    let canEdit = false;
    let lockNote = '';
    let inLoad = new Set();
    if (pilot && window.Enrollment?.ensureReady) {
      try { await window.Enrollment.ensureReady(); } catch { /* state stays null → rendered as locked */ }
      canEdit = !!window.Enrollment.canEdit?.();
      lockNote = window.Enrollment.lockedReason?.() || '';
      inLoad = window.Enrollment.draftSubjectIds?.() || new Set();
    }

    const addButtonFor = (s) => inLoad.has(s.id)
      ? '<span class="ursa-subject-tag active">In your load ✓</span>'
      : `<button type="button" class="ursa-add-btn" data-grizz-add="${esc(s.id)}">+ Add</button>`;

    const cardsHtml = recommended.map(s => `
      <div class="ursa-subject-item">
        <div class="ursa-subject-meta">
          <span class="ursa-subject-code">${esc(s.code)} <span class="ursa-units-badge">${unitsLabel(s)}</span></span>
          <span class="ursa-subject-title" title="${esc(s.title)}">${esc(s.title)}</span>
        </div>
        <span class="ursa-subject-tag">
          Yr ${s.year_level} · Sem ${s.semester}
        </span>
        ${(s.prereqNotes || []).length ? `<span class="ursa-subject-tag req">Note: ${esc(s.prereqNotes.join(', '))}</span>` : ''}
        ${pilot ? addButtonFor(s) : ''}
      </div>
    `).join('');

    const addAllHtml = pilot ? `
      <div class="ursa-response-actions" style="margin-top:0.6rem;">
        <button type="button" class="ursa-chip-action" data-grizz-add-all
          ${(!canEdit || !recommended.some(s => !inLoad.has(s.id))) ? 'disabled' : ''}>
          <iconify-icon icon="solar:cart-plus-linear"></iconify-icon> Add all recommended
        </button>
      </div>
      <p class="ursa-note-text" data-grizz-lock ${canEdit ? 'hidden' : ''}>🔒 Your load is ${esc(lockNote || 'not editable right now')} — subjects can be added once it's back in draft.</p>` : '';

    const jumpHtml = pilot ? `
      <p style="margin:0.6rem 0 0;"><a href="#" class="ursa-nav-link" data-view="enrollment" style="color:var(--primary);font-weight:600;">Open Load Verification →</a></p>` : '';

    const html = `
      <div class="ursa-summary-bar">
        <div class="ursa-summary-item">
          <span class="ursa-summary-val">${recommended.length} Subjects</span>
          <span class="ursa-summary-label">Recommended</span>
        </div>
        <div class="ursa-summary-divider"></div>
        <div class="ursa-summary-item">
          <span class="ursa-summary-val">${totalUnits} Units</span>
          <span class="ursa-summary-label">Total Load</span>
        </div>
      </div>

      <div class="ursa-card-list">
        ${cardsHtml}
      </div>

      ${addAllHtml}
      ${jumpHtml}
      <p class="ursa-note-text" data-grizz-result hidden></p>
      <p class="ursa-note-text">
        Grades can be updated directly in the Academic Progress tab.
      </p>
    `;

    const msg = appendBotMessage('Recommended Subject Load', html, [
      { action: 'academic-progress', label: 'Academic Progress Tally', icon: 'solar:diploma-verified-linear' },
      { action: 'check-prereq', label: 'Check Prerequisites', icon: 'solar:branching-paths-down-linear' },
    ]);
    if (!pilot || !msg) return;

    const resultEl = msg.querySelector('[data-grizz-result]');
    const showResult = (text) => { if (resultEl) { resultEl.hidden = false; resultEl.textContent = text; } };
    const loadIds = () => window.Enrollment.draftSubjectIds?.() || new Set();

    const syncButtons = () => {
      const ids = loadIds();
      const editable = !!window.Enrollment.canEdit?.();
      msg.querySelectorAll('[data-grizz-add]').forEach(b => {
        const done = ids.has(b.dataset.grizzAdd);
        b.disabled = done || !editable;
        b.classList.toggle('added', done);
        b.textContent = done ? '✓ Added' : '+ Add';
      });
      const allBtn = msg.querySelector('[data-grizz-add-all]');
      if (allBtn) allBtn.disabled = !editable || recommended.every(s => ids.has(s.id));
    };

    const addOne = async (btn, subject) => {
      btn.disabled = true;
      const res = await window.Enrollment.addFromGrizz(subject, 'Recommended by Grizz')
        .catch(err => ({ ok: false, error: err.message }));
      showResult(res?.ok ? `✓ Added ${subject.code} to your proposed load.` : (res?.error || 'Could not add the subject.'));
      syncButtons();
    };

    msg.querySelectorAll('[data-grizz-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const subject = recommended.find(s => String(s.id) === btn.dataset.grizzAdd);
        if (subject) addOne(btn, subject);
      });
    });

    msg.querySelector('[data-grizz-add-all]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const ids = loadIds();
      const pending = recommended.filter(s => !ids.has(s.id));
      let added = 0;
      let lastErr = '';
      for (const s of pending) {
        const res = await window.Enrollment.addFromGrizz(s, 'Recommended by Grizz')
          .catch(err => ({ ok: false, error: err.message }));
        if (res?.ok) added++; else lastErr = res?.error || 'request failed';
      }
      showResult(added
        ? `✓ Added ${added} subject${added === 1 ? '' : 's'} to your proposed load.` + (lastErr ? ` (${pending.length - added} failed: ${lastErr})` : '')
        : (lastErr || 'Nothing to add.'));
      syncButtons();
    });
  }
```

The call site in the action switch (`handleAction`, ~line 729) stays `handleNextSemRecommendations();` — an async call without await is fine there.

- [ ] **Step 4: Add the button CSS**

Append to `client/styles/ai.css` after the `.ursa-subject-tag.req` rule:

```css
/* Phase C: per-card add button on recommendation cards */
.ursa-add-btn {
  font-family: var(--font-ui);
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.22rem 0.55rem;
  color: var(--primary);
  background: transparent;
  border: 1px solid var(--primary);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  flex: 0 0 auto;
}
.ursa-add-btn:hover:not(:disabled) { background: var(--primary); color: #fff; }
.ursa-add-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ursa-add-btn.added { color: #4ADE80; border-color: rgba(34, 197, 94, 0.45); }
[data-theme="light"] .ursa-add-btn.added { color: #16A34A; }
```

- [ ] **Step 5: Run smoke, verify pass**

Run: `node scripts/smoke-test-pilot-gate.js`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add client/js/ai-assistant.js client/styles/ai.css scripts/smoke-test-pilot-gate.js
git commit -m "feat(grizz): add recommended subjects to Load Verification from chat"
```

---

### Task 6: Cache-bust every touched asset

**Files:**
- Modify: `client/index.html` (script/link tags at lines ~21, 1539, 1554, 1557)
- Modify: `client/faculty.html` (lines ~21, ~106, faculty.js tag)
- Modify: `client/officer.html` (line ~1142)

**Interfaces:** none — pure cache-busting; later tasks rely on browsers picking up the new files.

- [ ] **Step 1: Bump versions**

Exact edits:

`client/index.html`:
- `styles/main.css?v=7.1` → `styles/main.css?v=7.2`
- `js/config.js?v=5.4` → `js/config.js?v=5.5`
- `js/ai-assistant.js?v=5.3` → `js/ai-assistant.js?v=5.4`
- `js/enrollment.js?v=1.0` → `js/enrollment.js?v=1.1`

`client/faculty.html`:
- `styles/main.css?v=7.1` → `styles/main.css?v=7.2`
- `js/config.js?v=5.4` → `js/config.js?v=5.5`
- `js/faculty/faculty.js?v=1.2` → `js/faculty/faculty.js?v=1.3`

`client/officer.html`:
- `js/config.js?v=5.4` → `js/config.js?v=5.5`

`client/index.html` also needs (Task 5's stylesheet): `styles/ai.css?v=6.4` → `styles/ai.css?v=6.5`

- [ ] **Step 2: Run every smoke suite**

Run: `node scripts/smoke-test-api-groups.js && node scripts/smoke-test-pilot-gate.js && node scripts/smoke-test-component-outcomes.js && node scripts/smoke-test-component-outcomes-client.js && node scripts/smoke-test-cache.js && node scripts/smoke-test-curriculum-lib.js`
Expected: all suites pass (exit 0 each).

- [ ] **Step 3: Commit**

```bash
git add client/index.html client/faculty.html client/officer.html
git commit -m "chore: cache-bust client assets for pilot gate + Grizz add buttons"
```

---

### Task 7: Seed the non-pilot QA account

**Files:**
- Modify: `scripts/seed-phase-b-demo.js` (constants at top ~lines 11-13; new section 3 before the final log block ~line 129)

**Interfaces:**
- Produces: auth user + profile `gated.test@g.cjc.edu.ph` (student, BSCoE, Yr 1, enrollment_year 2025) — deliberately NOT in the pilot allowlist, used to verify the under-development paths.

- [ ] **Step 1: Add constants**

After `const BSCE_NAME = 'Maria Santos (Test)';` add:

```js
const GATED_EMAIL = 'gated.test@g.cjc.edu.ph';
const GATED_NAME = 'Gate Checker (Test)';
```

- [ ] **Step 2: Add the seed section**

Insert before the final `console.log('\n=== SEED COMPLETE ===');` block:

```js
  // =============================================
  // 3. Non-pilot QA account (NOT in ENROLLMENT_PILOT_EMAILS - verifies the
  //    "under development" gate on client + server)
  // =============================================
  {
    let gatedUser = null;
    let page = 1;
    for (let p = 1; p <= 5 && !gatedUser; p++) {
      const { data } = await admin.auth.admin.listUsers({ perPage: 200, page: p });
      gatedUser = (data?.users || []).find(u => (u.email || '').toLowerCase() === GATED_EMAIL);
      if (!data?.users || data.users.length < 200) break;
    }
    if (!gatedUser) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: GATED_EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: GATED_NAME },
      });
      if (error) { console.log('gated user FAIL: ' + error.message); return; }
      gatedUser = created.user;
      console.log('gated user created: ' + GATED_EMAIL);
    } else {
      await admin.auth.admin.updateUserById(gatedUser.id, { password: PASSWORD });
      console.log('gated user exists (password reset): ' + GATED_EMAIL);
    }
    const { data: prof } = await admin.from('profiles').select('id').eq('id', gatedUser.id).maybeSingle();
    if (!prof) {
      const { error } = await admin.from('profiles').insert({
        id: gatedUser.id, email: GATED_EMAIL, full_name: GATED_NAME, role: 'student', course: 'BSCoE', year_level: '1', enrollment_year: 2025,
      });
      if (error) console.log('  gated profile FAIL: ' + error.message);
    } else {
      await admin.from('profiles').update({ role: 'student', course: 'BSCoE', year_level: '1' }).eq('id', gatedUser.id);
    }
  }
```

- [ ] **Step 3: Update the logins line**

Replace the final logins console.log with:

```js
  console.log('Logins: test.newuser / head.test / bsce.test / gated.test @g.cjc.edu.ph - password: ' + PASSWORD);
```

- [ ] **Step 4: Run the seed**

Run: `node scripts/seed-phase-b-demo.js`
Expected: "gated user created" (or "exists (password reset)"), no FAIL lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-phase-b-demo.js
git commit -m "test: seed non-pilot gated.test account for gate QA"
```

---

### Task 8: Local GUI QA (manual, black-box)

**Files:** none (screenshots land in `gui-test-screenshots/`, which is gitignored).

Start the server: `node server/index.js` (background). All accounts use password `Coetest2026!`.

- [ ] **Step 1: Non-pilot student sees the gate** — log in as `gated.test@g.cjc.edu.ph`, click Load Verification: expect the 🚧 under-development panel, no draft UI, no Grizz add buttons on recommendations.
- [ ] **Step 2: Pilot student full flow** — log in as `test.newuser@g.cjc.edu.ph`: Grizz → "Next Sem Recommendations" shows Add buttons + "Add all recommended" + jump link; add one subject (button flips to "✓ Added", result line appears), add-all for the rest; open Load Verification via the jump link: all subjects present with Grizz badges; server 403/duplicate errors (if any) show inline in chat.
- [ ] **Step 3: Locked state** — log in as `bsce.test@g.cjc.edu.ph` (seeded submitted load): add buttons render disabled + "🔒 Your load is Submitted — with your Program Head…" note.
- [ ] **Step 4: Pilot head** — log in as `head.test@g.cjc.edu.ph`: redirected to `/faculty`, portal fully usable (queue shows both loads).
- [ ] **Step 5: Server gate** — from the browser devtools or curl (with gated.test's token), `POST /api/enrollment/submissions` returns 403 `{"error":"This feature is still under development."}`.
- [ ] **Step 6: Report** — write the pass/fail summary with screenshot paths; stop the background server. Fix-and-restart any failing test point (same pattern as Phase B QA).

---

### Task 9: Merge to main (production deploy)

**Files:** none — git only. Render (API) and Vercel (client) auto-deploy from `main`.

- [ ] **Step 1: Merge**

```bash
git checkout main
git pull origin main
git merge --no-ff testfeature/enrollment-automation -m "feat: Phase B/C — faculty portal, load approval, Grizz load-add, enrollment pilot gate"
git push origin main
git checkout testfeature/enrollment-automation
```

- [ ] **Step 2: Verify deploy**

Wait for Render + Vercel deploys to finish, then on production log in as `test.newuser@g.cjc.edu.ph` and confirm the Load Verification view loads (pilot), and as any real account that the nav shows the under-development panel. Optional: set `ENROLLMENT_PILOT_EMAILS` on Render (default already covers admin + test accounts).
