# Enrollment Verification — Student Journey UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the student "Enrollment Verification" journey redesign (spec `docs/superpowers/specs/2026-09-10-enrollment-verification-ux-design.md`) — a persistent 4-step journey tracker, state-aware actions, final-list + encode student emails, and a head UI limited to add/remove/verify — all strictly within the existing flat charcoal/coral design system.

**Architecture:** Client-first. A new pure `EnrollmentJourney` model module maps server submission states to journey steps and action affordances; `enrollment.js` renders them into a restructured `#view-enrollment`; `main.css` adds only token-based styles. Server change is confined to the notification/email path (`server/routes/faculty.js`, `server/lib/email.js`) so students get email only at verify and encode. Head-side capability surface is trimmed in `client/faculty.html` + `client/js/faculty/faculty.js` (buttons removed; server endpoints retained).

**Tech Stack:** Vanilla HTML/CSS/JS, Node/Express + Supabase, Solar iconify icons, Brevo transactional email, token-driven `main.css`.

## Global Constraints

- **Design tokens are law** (`AGENTS.md` §2 + `client/styles/main.css`): no gradients/glows/mesh; flat charcoal `#121214`/`#1C1C20`/`#26262C`; coral `#FF5533` (`--primary`) accents; semantic `--success #22C55E`, `--warning #F59E0B`, `--error #EF4444`; cards `--radius-lg`; controls `--radius-md`; pill radius `9999px`; text `#FFFFFF`/`#9A9AA6`/`#6E6E7A`. No inline `style=""` in HTML added by this work; no hardcoded hex colors — CSS vars only.
- **Terminology is law** (spec §4.2): "Enrollment Verification" is the student-facing name; mobile short label "Enrollment"; one verb set *build → submit → verified → encoded*; "Semester" not "term"; never "evaluation/verification" drift.
- **Server endpoints, state machine, pilot gate, RLS, `client/js/api.js` are untouched.** Return/reject endpoints stay but become UI-unreachable (D8) and send **no student email**.
- **Student emails fire at exactly two moments** (D4): Program Head verify (final subject list) and SA encode (done). All other transitions = in-app notification only.
- **UI must not look machine-generated**: reuse existing Solar icon set, existing card/pill/badge idioms, existing `UI.toast`; no decorative gradients, no drop shadows beyond the shadow tokens, no auto-generated clipart, restrained motion only (`fadeIn`/`slideUp`), `prefers-reduced-motion` respected.
- Verification before any push: `node --check` on changed JS, run `node tests/enrollment-journey.test.js`, then `node check_txs.js`. Branch: `redesign` → push to `origin/redesign/ui-enhancement`.

---

### Task 1: EnrollmentJourney pure model + unit tests

**Files:**
- Create: `client/js/enrollment-journey.js`
- Create: `tests/enrollment-journey.test.js`
- Modify: `client/index.html` (add script tag in the app script block, before `js/enrollment.js`, with `?v=1` cache-bust; later tasks bump it once)

**Interfaces:**
- Produces (UMD singleton): `EnrollmentJourney.STEPS`, `EnrollmentJourney.stepOf(submission)`, `EnrollmentJourney.canEdit(submission)`, `EnrollmentJourney.actionFor(submission)`, `EnrollmentJourney.toneFor(submission)`.
- Consumed by: Task 3 (`client/js/enrollment.js`).

- [ ] **Step 1: Write the model file**

```js
// UMD so `node tests/enrollment-journey.test.js` can require() it and the
// browser gets window.EnrollmentJourney (loaded before enrollment.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EnrollmentJourney = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 4 student-visible steps. `key` is stable; `label` is student copy.
  var STEPS = [
    { key: 'build',     label: 'Build your load',            short: 'Build' },
    { key: 'with-head', label: 'With your Program Head',     short: 'Head review' },
    { key: 'verified',  label: 'Verified — your final load', short: 'Verified' },
    { key: 'encoded',   label: 'Encoded — done',             short: 'Encoded' }
  ];

  function activeItems(sub) {
    return ((sub && sub.enrollment_submission_items) || [])
      .filter(function (i) { return i.item_state !== 'removed_by_head'; });
  }

  // Server status -> { stepIndex, state, stepKey }
  // state: 'current' | 'done' | 'upcoming' | 'defensive'
  function stepOf(sub) {
    if (!sub) return { stepIndex: 0, state: 'upcoming', stepKey: 'build' };
    var status = sub.status;
    if (status === 'draft') return { stepIndex: 0, state: 'current', stepKey: 'build' };
    if (status === 'submitted' || status === 'under_review') return { stepIndex: 1, state: 'current', stepKey: 'with-head' };
    if (status === 'approved') {
      return sub.encoded_at
        ? { stepIndex: 3, state: 'current', stepKey: 'encoded' }
        : { stepIndex: 2, state: 'current', stepKey: 'verified' };
    }
    // returned / rejected are legacy-only (D8): never reachable from the UI.
    return { stepIndex: 0, state: 'defensive', stepKey: 'build', legacyStatus: status };
  }

  function canEdit(sub) {
    return !!sub && sub.status === 'draft';
  }

  // One primary action per state (spec §5.3).
  function actionFor(sub) {
    if (!sub) return { kind: 'none', label: '', hint: '' };
    if (sub.status === 'draft') {
      var count = activeItems(sub).length;
      return count > 0
        ? { kind: 'submit', label: 'Submit to Program Head', hint: '' }
        : { kind: 'none', label: '', hint: 'Add at least one subject to submit your load.' };
    }
    if (sub.status === 'submitted') return { kind: 'none', label: '', hint: 'Your load was sent. You will be notified when your Program Head responds.' };
    if (sub.status === 'under_review') return { kind: 'none', label: '', hint: 'Your Program Head is reviewing your load. You will be notified when they respond.' };
    if (sub.status === 'approved' && !sub.encoded_at) return { kind: 'none', label: '', hint: 'Your load is verified. Nothing needed from you right now — your final list was emailed to you.' };
    if (sub.status === 'approved' && sub.encoded_at) return { kind: 'none', label: '', hint: '' };
    return { kind: 'none', label: '', hint: 'This submission is no longer editable. Contact your Program Head or the COE office.' };
  }

  function toneFor(sub) {
    if (!sub) return 'neutral';
    if (sub.status === 'approved') return sub.encoded_at ? 'success' : 'success';
    if (sub.status === 'submitted' || sub.status === 'under_review') return 'warning';
    if (sub.status === 'returned' || sub.status === 'rejected') return 'danger';
    return 'neutral';
  }

  return { STEPS: STEPS, stepOf: stepOf, canEdit: canEdit, actionFor: actionFor, toneFor: toneFor, activeItems: activeItems };
});
```

- [ ] **Step 2: Write the failing test**

```js
// tests/enrollment-journey.test.js — run with: node tests/enrollment-journey.test.js
const assert = require('assert');
const EJ = require('../client/js/enrollment-journey.js');

const base = () => ({
  id: 's1', status: 'draft', semester: 1, school_year: '2026-2027', encoded_at: null,
  enrollment_submission_items: [
    { id: 'i1', subject_id: 'x', item_state: 'submitted', subjects: { code: 'CS201' } },
    { id: 'i2', subject_id: 'y', item_state: 'removed_by_head', subjects: { code: 'MATH5' } }
  ]
});

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('draft maps to build step, current', () => {
  const s = EJ.stepOf(base());
  assert.strictEqual(s.stepKey, 'build'); assert.strictEqual(s.stepIndex, 0); assert.strictEqual(s.state, 'current');
});
t('submitted maps to with-head', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'submitted' }));
  assert.strictEqual(s.stepKey, 'with-head'); assert.strictEqual(s.stepIndex, 1);
});
t('under_review maps to with-head', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'under_review' }));
  assert.strictEqual(s.stepKey, 'with-head');
});
t('approved without encoded_at maps to verified', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'approved' }));
  assert.strictEqual(s.stepKey, 'verified'); assert.strictEqual(s.stepIndex, 2);
});
t('approved with encoded_at maps to encoded', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'approved', encoded_at: '2026-09-12T01:00:00Z' }));
  assert.strictEqual(s.stepKey, 'encoded'); assert.strictEqual(s.stepIndex, 3);
});
t('legacy returned is defensive', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'returned' }));
  assert.strictEqual(s.state, 'defensive'); assert.strictEqual(s.legacyStatus, 'returned');
});
t('legacy rejected is defensive', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'rejected' }));
  assert.strictEqual(s.state, 'defensive');
});
t('canEdit true only for draft', () => {
  assert.ok(EJ.canEdit(base()));
  assert.ok(!EJ.canEdit(Object.assign(base(), { status: 'submitted' })));
  assert.ok(!EJ.canEdit(null));
});
t('activeItems excludes removed_by_head', () => {
  assert.strictEqual(EJ.activeItems(base()).length, 1);
});
t('draft with items yields submit action', () => {
  assert.strictEqual(EJ.actionFor(base()).kind, 'submit');
});
t('empty draft yields hint, no action', () => {
  const s = base(); s.enrollment_submission_items = [];
  assert.strictEqual(EJ.actionFor(s).kind, 'none');
  assert.ok(/at least one subject/.test(EJ.actionFor(s).hint));
});
t('approved+encoded yields success tone', () => {
  const s = Object.assign(base(), { status: 'approved', encoded_at: '2026-09-12T01:00:00Z' });
  assert.strictEqual(EJ.toneFor(s), 'success');
});

console.log(`\n${passed} enrollment-journey assertions passed.`);
```

- [ ] **Step 3: Run test to verify it fails** (model file missing)
  Run: `node tests/enrollment-journey.test.js` → Expected: `MODULE_NOT_FOUND`.

- [ ] **Step 4: Add the model script tag to `client/index.html`** in the app scripts block immediately before the tag that loads `js/enrollment.js`, using a `?v=` version.

- [ ] **Step 5: Run test to verify it passes**
  Run: `node tests/enrollment-journey.test.js` → Expected: `N enrollment-journey assertions passed.`

- [ ] **Step 6: Commit**
  `git add client/js/enrollment-journey.js tests/enrollment-journey.test.js client/index.html`
  `git commit -m "feat(enrollment): pure journey-state model with unit tests"`

---

### Task 2: Journey + workspace styles (token-only CSS)

**Files:**
- Modify: `client/styles/main.css` — insert a new block right after the existing `/* ---- Option 2 Eligible Courses Grid ---- */` block (after line ~8220), before the closing media queries of the enrollment section.
- Modify: `client/index.html` style tag version bump (the `main.css?v=` query).

**Interfaces:**
- Produces class names consumed by Task 3 renderer and Task 3 markup:
  - `.ev-track`, `.ev-step`, `.ev-step--done`, `.ev-step--current`, `.ev-step--upcoming`, `.ev-step--defensive`, `.ev-step-dot`, `.ev-step-label`, `.ev-step-sub`, `.ev-track-line`
  - `.ev-chip`, `.ev-chip--neutral|--warning|--success|--danger`
  - `.ev-status-copy`, `.ev-status-copy--waiting`
  - `.ev-action-area`, `.ev-action-area .btn`
  - `.ev-done-card`, `.ev-done-card .icon`
  - `.ev-locked-summary`, `.ev-locked-hint`
  - `.ev-returned-callout`
  - `.ev-defensive-card`

- [ ] **Step 1: Add the CSS block**

```css
/* =========================================================
   Enrollment Verification — Journey UI (2026-09-10)
   Token-only. Flat surfaces; semantic status colors; no gradients.
   ========================================================= */

/* ---- Journey tracker ---- */
.ev-track {
  list-style: none;
  margin: 0.25rem 0 1rem 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.ev-step {
  position: relative;
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  padding: 0 0 1.1rem 0;
}
.ev-step:last-child { padding-bottom: 0.15rem; }
.ev-step-dot {
  width: 18px; height: 18px;
  border-radius: 9999px;
  flex: 0 0 18px;
  margin-top: 1px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid var(--border-hover, rgba(255,255,255,0.16));
  background: var(--surface-secondary, #26262C);
  color: var(--text-tertiary, #6E6E7A);
  font-size: 0.66rem;
  line-height: 1;
  transition: background var(--transition, 0.25s ease), border-color var(--transition, 0.25s ease);
}
.ev-step-dot .iconify-icon { font-size: 10px; }
/* connector */
.ev-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 22px;
  bottom: -1px;
  width: 2px;
  background: var(--border, rgba(255,255,255,0.08));
}
.ev-step--done .ev-step-dot {
  background: var(--primary, #FF5533);
  border-color: var(--primary, #FF5533);
  color: #FFFFFF;
}
.ev-step--current .ev-step-dot {
  background: var(--primary, #FF5533);
  border-color: var(--primary, #FF5533);
  color: #FFFFFF;
  box-shadow: 0 0 0 4px rgba(255,85,51,0.15);
}
.ev-step--defensive .ev-step-dot {
  background: var(--status-negative, #EF4444);
  border-color: var(--status-negative, #EF4444);
  color: #FFFFFF;
}
.ev-step-label {
  font-family: var(--font-ui, 'Inter', sans-serif);
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--text-secondary, #9A9AA6);
  line-height: 1.35;
}
.ev-step--current .ev-step-label,
.ev-step--done .ev-step-label { color: var(--text-primary, #FFFFFF); }
.ev-step--defensive .ev-step-label { color: var(--status-negative, #EF4444); }
.ev-step-sub {
  display: block;
  font-size: 0.74rem;
  font-weight: 500;
  color: var(--text-tertiary, #6E6E7A);
  margin-top: 1px;
}

/* ---- Status chip ---- */
.ev-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.8rem;
  border-radius: 9999px;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: var(--surface-raised, #26262C);
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  color: var(--text-secondary, #9A9AA6);
}
.ev-chip::before {
  content: '';
  width: 7px; height: 7px; border-radius: 9999px;
  background: currentColor;
  flex: 0 0 7px;
}
.ev-chip--warning { color: var(--warning, #F59E0B); border-color: rgba(245,158,11,0.35); }
.ev-chip--success { color: var(--success, #22C55E); border-color: rgba(34,197,94,0.35); }
.ev-chip--danger  { color: var(--status-negative, #EF4444); border-color: rgba(239,68,68,0.35); }
.ev-chip--neutral { color: var(--text-secondary, #9A9AA6); }

/* ---- Status body copy ---- */
.ev-status-copy {
  color: var(--text-secondary, #9A9AA6);
  font-family: var(--font-ui, 'Inter', sans-serif);
  font-size: 0.83rem;
  line-height: 1.6;
  margin: 0.1rem 0 0.5rem 0;
}
.ev-status-copy strong { color: var(--text-primary, #FFFFFF); font-weight: 600; }
.ev-status-meta {
  font-family: var(--font-data, 'Outfit', monospace);
  font-size: 0.72rem;
  color: var(--text-tertiary, #6E6E7A);
  margin: 0 0 0.9rem 0;
}

/* ---- Action area ---- */
.ev-action-area { margin-top: 1.1rem; }
.ev-action-area .btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.45rem; }
.ev-action-hint {
  color: var(--text-tertiary, #6E6E7A);
  font-size: 0.8rem;
  line-height: 1.55;
  margin: 0.4rem 0 0 0;
}

/* ---- Verified final-list summary ---- */
.ev-done-card {
  border: 1px solid rgba(34,197,94,0.3);
  background: rgba(34,197,94,0.08);
  border-radius: var(--radius-lg, 16px);
  padding: 1rem;
  margin-top: 0.4rem;
}
.ev-done-card h4 {
  margin: 0 0 0.35rem 0;
  color: var(--success, #22C55E);
  font-size: 0.9rem;
  font-weight: 700;
  display: flex; align-items: center; gap: 0.4rem;
}
.ev-done-card p {
  margin: 0;
  color: var(--text-secondary, #9A9AA6);
  font-size: 0.83rem;
  line-height: 1.6;
}
.ev-done-card p strong { color: var(--text-primary, #FFFFFF); }

.ev-locked-hint {
  display: inline-flex; align-items: center; gap: 0.35rem;
  color: var(--text-tertiary, #6E6E7A);
  font-size: 0.76rem;
  margin: 0.25rem 0 0 0;
}

.ev-final-list-note {
  border-top: 1px solid var(--border, rgba(255,255,255,0.08));
  margin-top: 0.9rem;
  padding-top: 0.8rem;
  font-size: 0.8rem;
  color: var(--text-secondary, #9A9AA6);
  line-height: 1.55;
}
.ev-final-list-note strong { color: var(--success, #22C55E); }

/* ---- Legacy defensive card ---- */
.ev-defensive-card {
  border: 1px solid rgba(239,68,68,0.35);
  background: rgba(239,68,68,0.07);
  border-radius: var(--radius-lg, 16px);
  padding: 0.9rem 1rem;
  margin-top: 0.35rem;
  font-size: 0.83rem;
  color: var(--text-secondary, #9A9AA6);
  line-height: 1.55;
}
.ev-defensive-card strong { color: var(--status-negative, #EF4444); }

/* Read-only (locked) draft summary */
.ev-locked-note {
  display: flex; align-items: center; gap: 0.4rem;
  color: var(--text-tertiary, #6E6E7A);
  font-size: 0.8rem;
  margin: 0.6rem 0 0 0;
}

/* Compact chip-row variant (very small screens) */
@media (max-width: 480px) {
  .ev-track.ev-track--compact {
    flex-direction: row;
    overflow-x: auto;
    gap: 0.4rem;
    padding-bottom: 0.25rem;
  }
  .ev-track.ev-track--compact .ev-step {
    flex: 1 0 auto;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.3rem;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-md, 12px);
    background: var(--surface-raised, #26262C);
  }
  .ev-track.ev-track--compact .ev-step:not(:last-child)::before { display: none; }
  .ev-track.ev-track--compact .ev-step-label { font-size: 0.7rem; }
  .ev-track.ev-track--compact .ev-step-sub { display: none; }
}
html[data-theme="light"] .ev-step-dot {
  border-color: #CBD5E1;
  background: #FFFFFF;
  color: #94A3B8;
}
html[data-theme="light"] .ev-step:not(:last-child)::before { background: #E2E8F0; }
html[data-theme="light"] .ev-chip { background: #FFFFFF; }
html[data-theme="light"] .ev-done-card { background: rgba(34,197,94,0.07); }
html[data-theme="light"] .ev-defensive-card { background: rgba(239,68,68,0.05); }
@media (prefers-reduced-motion: reduce) {
  .ev-step-dot { transition: none; }
}
```

- [ ] **Step 2: Bump the `main.css?v=` query on the `<link>` in `client/index.html`.**
- [ ] **Step 3: Sanity check** — `node --check` isn't for CSS; instead confirm no syntax break by counting braces balance in the inserted block and verifying the file still ends intact. (Manual: `grep -c "{" main.css` before/after is not reliable; rely on careful paste.)
- [ ] **Step 4: Commit** — `git add client/styles/main.css client/index.html && git commit -m "style(enrollment): journey tracker and status UI tokens"`

---

### Task 3: Student journey markup + renderer (index.html + enrollment.js)

**Files:**
- Modify: `client/index.html` — restructure `#view-enrollment` (rename, journey column, state-aware action area); add "Enrollment" row to the mobile More sheet.
- Modify: `client/js/app.js` — add `'enrollment'` to the persisted `NAV_VIEWS` list (line ~21 in `ui.js` actually; see below) and make sure bottom-nav persistence is fine.
- Modify: `client/js/enrollment.js` — replace status/draft renderers with journey-aware renderers consuming `EnrollmentJourney`.

**Detail — persistence:** in `client/js/ui.js` `showView`, the `NAV_VIEWS` array (line 21) does **not** include `'enrollment'`; add it so refresh returns to the view (spec §2.5). Modify `client/js/ui.js`.

**Interfaces:**
- Consumes: `EnrollmentJourney.*` (Task 1), existing `UI.toast`, `UI.dateStr`, `UI.renderStatusBadge` not needed (uses `ev-*` chips).
- Produces: `window.Enrollment` (existing public surface, unchanged shape), new rendered DOM in `#view-enrollment`.

- [ ] **Step 1: Rewrite the `#view-enrollment` markup in `client/index.html`**

```html
<!-- Enrollment Verification (Phase B) -->
<section class="view" id="view-enrollment">
  <div class="view-header">
    <div>
      <h2>Enrollment Verification</h2>
      <p class="view-sub">Build your proposed load, send it to your Program Head for review, and get it encoded by the SA.</p>
    </div>
  </div>

  <div class="enrollment-grid">
    <!-- Left: Journey & status (persistent anchor) -->
    <div class="enrollment-column-left">
      <div class="enrollment-card" id="enrollment-journey-card">
        <h3><iconify-icon icon="solar:route-linear" style="color:var(--primary);margin-right:0.4rem;vertical-align:middle;"></iconify-icon>Enrollment Status</h3>
        <ol class="ev-track" id="enrollment-journey-track" aria-label="Enrollment steps"></ol>
        <div id="enrollment-status-body"></div>
        <div class="ev-action-area" id="enrollment-action-area"></div>
      </div>
    </div>

    <!-- Right: Workspace (editable states) / read-only summary (locked states) -->
    <div class="enrollment-column-right">
      <div class="enrollment-card" id="enrollment-draft-card">
        <h3><iconify-icon icon="solar:document-text-linear" style="color:var(--primary);margin-right:0.4rem;vertical-align:middle;"></iconify-icon>Proposed Load</h3>
        <p class="enrollment-note" id="enrollment-term-line"></p>
        <div id="enrollment-items"></div>
        <div class="ev-locked-note hidden" id="enrollment-locked-note"></div>
        <div class="auth-error hidden" id="enrollment-error"></div>
      </div>

      <div class="enrollment-card" id="enrollment-eligible-card" style="margin-top:1.25rem;">
        <div class="enrollment-eligible-header">
          <h3><iconify-icon icon="solar:book-bookmark-linear" style="color:var(--primary);margin-right:0.4rem;vertical-align:middle;"></iconify-icon>Eligible Courses for this Semester</h3>
          <p class="enrollment-note" style="margin:0.25rem 0 0.85rem;">Pick the subjects you need — Grizz's recommendations are a great starting point.</p>
        </div>
        <div id="enrollment-year-filter" class="year-filter-pills"></div>
        <div id="enrollment-eligible-list" class="enrollment-eligible-grid">
          <div class="loading-state">Loading eligible courses…</div>
        </div>
      </div>
    </div>
  </div>
</section>
```

**Note:** the static `#enrollment-submit-btn` is removed — the single action now renders dynamically in `#enrollment-action-area`. The old static markup in the spec-referenced lines (index.html:676-703) is replaced wholesale by the above.

- [ ] **Step 2: Add the mobile More-sheet "Enrollment" row** in `client/index.html` (More sheet body), as the first section — an `Academic` section — placed before the `Finance` section:

```html
<!-- Section: ACADEMIC -->
<div class="mobile-sheet-section">
  <span class="mobile-sheet-section-label">Academic</span>
  <div class="mobile-sheet-group">
    <button type="button" class="mobile-sheet-row" id="bottom-nav-enrollment" data-view="enrollment" data-sheet-action="nav">
      <div class="mobile-sheet-row-icon" style="color:var(--primary); background:rgba(255,85,51,0.12);">
        <iconify-icon icon="solar:clipboard-check-linear"></iconify-icon>
      </div>
      <div class="mobile-sheet-row-content">
        <span class="mobile-sheet-row-title">Enrollment</span>
        <span class="mobile-sheet-row-desc">Build &amp; track your proposed load</span>
      </div>
      <iconify-icon icon="solar:alt-arrow-right-linear" class="mobile-sheet-row-chevron"></iconify-icon>
    </button>
  </div>
</div>
```

- [ ] **Step 3: Persist the view** — in `client/js/ui.js` line 21, change `NAV_VIEWS` to include `'enrollment'`:
```js
const NAV_VIEWS = ['dashboard', 'events', 'transactions', 'income', 'reports', 'units', 'enrollment', 'admin'];
```

- [ ] **Step 4: Rewrite `client/js/enrollment.js` rendering** — replace the `STATUS_LABELS` map, `renderDraft`, `renderStatus`, and the `DOMContentLoaded` submit binding with journey-aware versions, and remove the old static submit button handler. Full replacement content:

```js
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
  let program = null;

  // ---- Load ----
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
    const PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
    const upper = (profile?.course || '').trim().toUpperCase();
    program = PROGRAMS.find(p => p.toUpperCase() === upper) || 'BSCoE';
    const year = Number(profile?.year_level || 0);
    if (year >= 1 && year <= 4) { activeYearFilter = String(year); }
    else { activeYearFilter = 'all'; }

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

  // ---- Year filter pills (unchanged behavior) ----
  let activeYearFilter = 'all';
  function renderYearFilterPills() { /* identical to current implementation; no copy change needed */ }
  function fillPicker() { renderYearFilterPills(); renderEligibleList(); }

  // ---- Eligible courses grid (behavior unchanged) ----
  function renderEligibleList() { /* keep current implementation as-is */ }

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
      if (!current) { lockedNote.classList.add('hidden'); }
      else if (!canEdit && current.status !== 'approved') {
        lockedNote.classList.remove('hidden');
        lockedNote.innerHTML = '<iconify-icon icon="solar:lock-linear" style="font-size:0.9rem;"></iconify-icon> This load is locked while your Program Head reviews it.';
      } else if (current.status === 'approved') {
        lockedNote.classList.remove('hidden');
        lockedNote.innerHTML = '<iconify-icon icon="solar:lock-keyhole-linear" style="font-size:0.9rem;"></iconify-icon> Verified by your Program Head — your load is locked.';
      } else { lockedNote.classList.add('hidden'); }
    }
  }

  // ---- Journey + status card ----
  function statusMeta() {
    if (!current) {
      return { chipTone: 'neutral', chipLabel: 'No open submission', statusHtml: '', metaHtml: '', bodyClass: '' };
    }
    const step = EJ.stepOf(current);
    const tone = EJ.toneFor(current);
    const action = EJ.actionFor(current);
    const chipLabel = {
      draft: 'Build your load',
      submitted: 'With your Program Head',
      under_review: 'Program Head is reviewing',
      approved: current.encoded_at ? 'Encoded — done' : 'Verified — final load',
    }[current.status] || (step.state === 'defensive' ? 'Not editable' : current.status);
    const chipTone = {
      neutral: 'neutral', submitted: 'warning', under_review: 'warning',
      approved: 'success',
    }[current.status] || 'danger';

    const items = EJ.activeItems(current);
    const statusHtml = buildStatusHtml(current, step, items);
    const metaHtml = statusMetaLine(current);
    return { chipTone, chipLabel, statusHtml, metaHtml };
  }

  function statusMetaLine(s) {
    if (s.status === 'submitted' || s.status === 'under_review') {
      if (s.submitted_at) return `With your Program Head since ${UI.dateStr(s.submitted_at)}.`;
    }
    if (s.status === 'approved' && !s.encoded_at && s.reviewed_at) return `Verified on ${UI.dateStr(s.reviewed_at)}.`;
    if (s.status === 'approved' && s.encoded_at) return `Encoded on ${UI.dateStr(s.encoded_at)}.`;
    return '';
  }

  function buildStatusHtml(s, step, items) {
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
      const listHtml = items.map(i =>
        `<li class="enrollment-item-row" style="border-bottom:none;padding:0.35rem 0;">
           <span class="enrollment-item-code">${esc(i.subjects?.code)}</span>
           <span class="enrollment-item-title">${esc(i.subjects?.title)}</span>
         </li>`).join('');
      if (s.encoded_at) {
        return `
          <div class="ev-done-card">
            <h4><iconify-icon icon="solar:check-circle-bold" style="color:var(--success);"></iconify-icon> Your load is encoded</h4>
            <p>Your final load has been encoded by the <strong>Student Assistant</strong>.
               Enrollment inside this system is complete. The next step — assessment and claiming — happens at the
               <strong>University Registrar</strong>, outside this system.</p>
          </div>
          <ul style="list-style:none;margin:0.8rem 0 0 0;padding:0;">${listHtml}</ul>`;
      }
      const headChanges = headChangeLines(s);
      return `
        <div class="ev-done-card">
          <h4><iconify-icon icon="solar:verified-check-bold" style="color:var(--success);"></iconify-icon> Verified — your final load</h4>
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
    if (trackEl) trackEl.innerHTML = renderTrack(current);
    body.innerHTML = `
      <span class="ev-chip ev-chip--${meta.chipTone}">${esc(meta.chipLabel)}</span>
      ${meta.statusHtml}
      ${meta.metaHtml ? `<p class="ev-status-meta">${esc(meta.metaHtml)}</p>` : ''}`;

    if (actionEl) actionEl.innerHTML = renderAction();
  }

  function renderTrack(sub) {
    const step = EJ.stepOf(sub);
    const trackClasses = window.matchMedia('(max-width: 480px)').matches ? 'ev-track ev-track--compact' : 'ev-track';
    if (!sub || step.state === 'defensive') {
      return `<ol class="${trackClasses}" aria-label="Enrollment steps"></ol>`;
    }
    return `<ol class="${trackClasses}" aria-label="Enrollment steps">` + EJ.STEPS.map((s, i) => {
      const state = i < step.stepIndex ? 'done' : (i === step.stepIndex ? 'current' : 'upcoming');
      const stepStateClass = state === 'done' ? 'ev-step--done' : state === 'current' ? 'ev-step--current' : 'ev-step--upcoming';
      const marker = state === 'done'
        ? '<iconify-icon icon="solar:check-bold"></iconify-icon>'
        : (state === 'current' ? `<iconify-icon icon="solar:${currentStepIcon(sub)}"></iconify-icon>` : '');
      return `
        <li class="ev-step ${stepStateClass}">
          <span class="ev-step-dot" aria-hidden="true">${marker}</span>
          <span class="ev-step-label">${s.label}${state === 'current' && sub.status === 'submitted' ? '' : ''}</span>
        </li>`;
    }).join('') + '</ol>';
  }

  function currentStepIcon(sub) {
    if (sub.status === 'draft') return 'pen-new-square-linear';
    if (sub.status === 'submitted' || sub.status === 'under_review') return 'clock-circle-linear';
    if (sub.status === 'approved') return sub.encoded_at ? 'check-circle-bold' : 'verified-check-bold';
    return 'clock-circle-linear';
  }

  function renderAction() {
    const action = EJ.actionFor(current);
    const hint = action.hint ? `<p class="ev-action-hint">${esc(action.hint)}</p>` : '';
    if (action.kind === 'submit') {
      return `<button type="button" class="btn btn-primary" id="enrollment-submit-btn">
                <iconify-icon icon="solar:plain-3-linear"></iconify-icon>
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

  // Action delegation (button is dynamic after Task 2/3 markup)
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('enrollment-action-area')?.addEventListener('click', e => {
      if (e.target.closest('#enrollment-submit-btn')) submit();
    });
  });

  // Public hook surface (Phase C): Grizz reads state and pushes subjects.
  window.Enrollment = {
    addFromGrizz: (subject, reason) => addItem(subject?.id, reason || 'Recommended by Grizz'),
    ensureReady: load,
    canEdit: () => EJ.canEdit(current),
    lockedReason: () => {
      if (!current) return '';
      if (current.status === 'draft') return '';
      if (current.status === 'approved') return current.encoded_at ? 'Encoded — locked' : 'Verified — your final load is locked';
      return 'Submitted — your load is with your Program Head';
    },
    draftSubjectIds: () => EJ.activeItems(current).reduce((set, i) => (set.add(i.subject_id), set), new Set()),
  };

  return { load };
})();
```

**Preserve unchanged:** `renderYearFilterPills`, `renderEligibleList`, `fillPicker`, `renderGatedNotice` (apart from the copy string), the public `window.Enrollment` surface keys (Grizz + dashboard depend on them).

- [ ] **Step 5: Behavior checks (static)**
  - `node --check client/js/enrollment.js` and `node --check client/js/ui.js` pass.
  - `node tests/enrollment-journey.test.js` still passes (public surface unchanged).
  - Grep confirms: no remaining `enrollment-submit-btn` static HTML, no `enrollment-status-card`, no `Submitted for evaluation`, no `Load Verification` in `index.html`/`enrollment.js` (remaining allowed instance: `faculty.js` gates/copy handled in Task 5).
- [ ] **Step 6: Commit** — `git commit -m "feat(enrollment): journey tracker, state-aware actions, final-list/encoded states"`

---

### Task 4: Copy sweep (Grizz + notifications references)

**Files:**
- Modify: `client/js/ai-assistant.js` — jump link label + grizz locked-note language uses `Enrollment.lockedReason()` already; update static text.
- Modify: `client/js/enrollment.js` leftover strings (handled in Task 3) — verify none remain.
- Modify: `client/faculty.html` title copy stays; gated copy in `faculty.js` (Task 5).

- [ ] **Step 1:** In `client/js/ai-assistant.js` line ~1005 change `Open Load Verification` → `Open Enrollment Verification`. In the locked-note render (~line 998-1000), leave text driven by `lockedReason()` but ensure it reads naturally; confirm no `Load Verification` strings remain anywhere in `client/js` except the gated copy.
- [ ] **Step 2:** `grep -rn "Load Verification" client/js client/*.html` → expect only the enrollment gated notice and faculty gated notice (both reworded to "Enrollment Verification").
- [ ] **Step 3:** Commit — `git commit -m "refactor(enrollment): normalize terminology to Enrollment Verification"`

---

### Task 5: Head UI — add / remove / verify only

**Files:**
- Modify: `client/faculty.html` — remove `#faculty-return-btn` and `#faculty-reject-btn`; relabel `#faculty-approve-btn` to `Verify & Finalize`; update section sub-copy.
- Modify: `client/js/faculty/faculty.js` — remove return/reject handlers; relabel approve; update STATUS_LABELS (`under_review: 'Under review'`), dean counts copy, queue copy; make remove/add only actionable while `canHeadAct` (i.e., not when status is approved); remove the reject/return prompt helpers.

- [ ] **Step 1:** In `client/faculty.html`, the decisions row becomes:
```html
<div class="faculty-decisions">
  <button type="button" class="btn btn-primary" id="faculty-approve-btn">Verify &amp; Finalize</button>
</div>
```
Update the header of `#faculty-approved` section: `<h2>Verified Loads</h2>` and sub `<p class="muted">Final loads waiting for encoding by the Student Assistant. Mark each one when done.</p>`.
- [ ] **Step 2:** In `client/js/faculty/faculty.js`:
  - `under_review: 'Under review'`; remove nothing else from STATUS_LABELS (server may still surface legacy rows).
  - Approve confirm copy: `Verify & finalize this load? This enrolls the subjects for the student. Continue?`
  - Delete the `faculty-return-btn` and `faculty-reject-btn` handlers; delete the Return/Reject prompts.
  - Dean overview counts text uses `Under review` label already via STATUS_LABELS (auto), fine.
  - Add a defensive guard: evaluation Remove buttons only render when `s.status !== 'approved'` (already conditional on `!== 'removed_by_head' && s.status !== 'approved'`); keep.
- [ ] **Step 3:** `node --check client/js/faculty/faculty.js` passes; grep confirms no `reject`/`return` handlers bound and no Reject/Return buttons.
- [ ] **Step 4:** Commit — `git commit -m "feat(faculty): program head adds/removes/verifies only — no reject or return"`

---

### Task 6: Server — verify + encode emails only, final-list copy

**Files:**
- Modify: `server/routes/faculty.js` — `notifyStudent()` email gating + wording; notification titles.
- Modify: `server/lib/email.js` — `sendLoadStatusEmail` copy for verified/encoded; keep signature.

- [ ] **Step 1: `server/lib/email.js`** — replace the `statusConfig` labels + body paragraph logic:

```js
const statusConfig = {
  verified: { label: 'Enrollment Verification — Final List',  bg: 'rgba(34, 197, 94, 0.1)',  color: '#16A34A', border: '#DCFCE7' },
  approved: { label: 'Enrollment Verification — Final List',  bg: 'rgba(34, 197, 94, 0.1)',  color: '#16A34A', border: '#DCFCE7' },
  encoded:  { label: 'Enrollment Verification — Encoded',     bg: 'rgba(56, 189, 248, 0.1)', color: '#0284C7', border: '#E0F2FE' },
  returned: { label: 'Load Returned for Changes',             bg: 'rgba(245, 158, 11, 0.1)', color: '#D97706', border: '#FEF3C7' },
  rejected: { label: 'Load Rejected',                         bg: 'rgba(239, 68, 68, 0.1)',  color: '#DC2626', border: '#FEE2E2' },
};
```
Add a `milestone` parameter (`sendLoadStatusEmail({ ... , milestone })`) where milestone ∈ `'verified' | 'encoded'`, defaulting to `status === 'approved' ? 'verified' : status`. Then:
- Preheader/paragraph:
```js
const heading = milestone === 'encoded'
  ? `Your load for <strong>${term}</strong> has been encoded by the <strong>Student Assistant</strong>.`
  : `Your Program Head has <strong>verified</strong> your load for <strong>${term}</strong>.`;
const subline = milestone === 'encoded'
  ? 'Your enrollment inside this system is complete. The next step — assessment and claiming — happens at the University Registrar, outside this system.'
  : 'These are the final subjects you will enroll this semester.';
const listHeader = milestone === 'encoded' ? 'Encoded Subjects' : 'Final Subjects';
```
Wire `heading`, `subline`, and `listHeader` into the template in place of the old "has been {cfg.label}" sentence and "Submitted Course Load" header. Keep the CTA button text `Open the Portal`.
- [ ] **Step 2: `server/routes/faculty.js`** — in `notifyStudent`:
  - Build notification title from a journey label map:
```js
const TITLE = {
  approved: 'Load Verified — Final List',
  encoded: 'Load Encoded',
  returned: 'Load Returned',
  rejected: 'Load Rejected',
};
```
  - Create the in-app notification for **every** status (unchanged), with `title: TITLE[status]`, message `Your load for ${termLabel(submission)} was ${...}.` (humanized: approved → `Your Program Head verified your load for ${termLabel(submission)}. These are the final subjects you will enroll.`; encoded → `Your load for ${termLabel(submission)} has been encoded. Proceed to the University Registrar for assessment.`).
  - **Email only when** `status === 'approved' || status === 'encoded'`:
```js
if (status === 'approved' || status === 'encoded') {
  sendLoadStatusEmail({
    to: submission.student?.email,
    name: submission.student?.full_name || 'COE Student',
    status,
    milestone: status === 'approved' ? 'verified' : 'encoded',
    studentName: submission.student?.full_name || 'COE Student',
    term: termLabel(submission), lines, changes: changes.length ? changes : null,
  });
}
```
  - Return/reject endpoints therefore produce an in-app notification only (no email) — matching D8 even if an old client ever calls them.
- [ ] **Step 3: Static checks** — `node --check server/lib/email.js`, `node --check server/routes/faculty.js` pass.
- [ ] **Step 4:** Commit — `git commit -m "feat(email): verify final-list and encode emails only; no email on return/reject"`

---

### Task 7: Verify + push

- [ ] **Step 1:** Run the unit tests: `node tests/enrollment-journey.test.js` → all pass.
- [ ] **Step 2:** `node --check` on every modified JS file (`client/js/enrollment.js`, `client/js/ui.js`, `client/js/ai-assistant.js`, `client/js/faculty/faculty.js`, `server/lib/email.js`, `server/routes/faculty.js`, `client/js/enrollment-journey.js`).
- [ ] **Step 3:** `node check_txs.js` → passes (no ledger drift). This is required by `AGENTS.md` before pushing.
- [ ] **Step 4:** Grep QA:
  - No `Load Verification` remains in `client/index.html`, `client/js/enrollment.js`, `client/js/ai-assistant.js`.
  - No `faculty-return-btn` / `faculty-reject-btn` / `.onclick` for reject or return remain in `client/faculty.html` or `client/js/faculty/faculty.js`.
  - `sendLoadStatusEmail(` calls exist only for `approved`/`encoded` in `server/routes/faculty.js`.
- [ ] **Step 5:** Optional live smoke (if `.env` + seeded pilot accounts are reachable): boot `npm start`, drive the flow via Playwright MCP against `gated.test`/`bsce.test`, capture screenshots to `gui-test-screenshots/`. If the backend is unavailable, note it as a manual follow-up.
- [ ] **Step 6:** Commit any remaining changes, then push per `AGENTS.md`:
```bash
git push origin redesign:refs/heads/redesign/ui-enhancement
```
