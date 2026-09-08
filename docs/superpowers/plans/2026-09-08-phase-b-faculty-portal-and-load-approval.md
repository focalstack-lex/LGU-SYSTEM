# Phase B: Faculty Portal & Academic Load Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace line-up enrollment with a digital flow: students submit proposed loads, program heads (CPE/ECE/CE) evaluate them in a faculty portal at `/faculty`, approval auto-enrolls the load, student assistants export accepted loads for institutional encoding, and the dean gets a read-only dashboard.

**Architecture:** Migration 034 adds the faculty/program_head/dean roles and two tables (`enrollment_submissions`, `enrollment_submission_items`) with RLS. Two new route groups split by actor: `/api/enrollment` (student draft/submit) and `/api/faculty` (evaluation, decisions, auto-enroll, export). A pure state-machine lib (`server/lib/enrollment.js`) is TDD'd first. New pages: `faculty.html` (mirrors the Officer Console shell); student submissions live in the existing portal. Notifications ride the existing in-app + Brevo infrastructure.

**Tech Stack:** PostgreSQL/Supabase (hand-applied migrations), Express, vanilla JS, exceljs (already a dependency), Brevo email, node smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-08-faculty-portal-and-load-approval-design.md`

## Global Constraints

- Branch `testfeature/enrollment-automation`; conventional commits; commit per task.
- **Migration is numbered 034, not 032** (032 was reserved in the spec, but 033 was consumed by the component-outcomes addendum). Additive only; fully re-runnable (DROP-policy / guarded-constraint patterns).
- Role list after 034: `student, admin, governor, cashier, officer, faculty, program_head, dean`.
- Program binding for program heads reuses `profiles.course` (BSCoE/BSCE/BSECE).
- Dean is **viewer-only** — no mutating faculty endpoint may accept dean except `mark-encoded`-adjacent read actions; enforce in `requireProgramHead`.
- Approval auto-enroll creates `student_units` rows (status `enrolled`) using the **same upsert shape and `onConflict: 'student_id,subject_id,school_year,semester'`** as `server/routes/units.js` so the two paths can never duplicate rows. Approval is idempotent: approving an `approved` submission is a no-op.
- supabase-js has no multi-statement transaction: the approve flow is ordered idempotent-upserts + final status update (safe on retry).
- Dean must never reach a mutating endpoint — `requireProgramHead` excludes dean; tests assert it.
- `audit_logs` exists only in production (no migration); write via existing `logAudit(userId, action, details)` fire-and-forget.
- API paths in `client/js/api.js` groups are written WITHOUT `/api` (`_fetchRaw` prepends it). Migrations apply manually via the Supabase SQL editor.
- All smoke tests: plain node scripts, exit non-zero on failure, run from repo root.

---

### Task 1: Migration 034 — roles, submissions tables, RLS

**Files:**
- Create: `supabase/migrations/034_faculty_roles_and_submissions.sql`
- Test: `scripts/smoke-test-migration-034.js`

**Interfaces:**
- Produces: roles `faculty`/`program_head`/`dean`; tables `public.enrollment_submissions`, `public.enrollment_submission_items`; SQL helpers `public.is_faculty()`, `public.is_dean_or_admin()`, `public.is_program_head_for(target_student uuid)`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/034_faculty_roles_and_submissions.sql`:

```sql
-- =============================================================
-- 034: Phase B - faculty roles + enrollment submissions
-- Additive only; re-runnable (guarded constraints, DROP-first policies).
-- =============================================================

-- =============================================
-- 1. ROLES (guarded widening, pattern from 021)
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
      AND pg_get_constraintdef(oid) LIKE '%faculty%'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('student', 'admin', 'governor', 'cashier', 'officer',
                      'faculty', 'program_head', 'dean'));
  END IF;
END $$;

-- =============================================
-- 2. SQL HELPERS (SECURITY DEFINER, 016/021 style)
-- =============================================
CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('faculty', 'program_head', 'dean', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_dean_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('dean', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- A program head can act only on students whose course matches their own.
CREATE OR REPLACE FUNCTION public.is_program_head_for(target_student UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles head
    JOIN public.profiles stu ON stu.id = target_student
    WHERE head.id = auth.uid()
      AND head.role = 'program_head'
      AND stu.course = head.course
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- =============================================
-- 3. ENROLLMENT SUBMISSIONS
-- =============================================
CREATE TABLE IF NOT EXISTS public.enrollment_submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  school_year   TEXT NOT NULL,
  semester      SMALLINT NOT NULL CHECK (semester BETWEEN 1 AND 3),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','under_review','approved','returned','rejected')),
  submitted_at  TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES public.profiles(id),
  review_notes  TEXT,
  encoded_at    TIMESTAMPTZ,
  encoded_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, school_year, semester)
);

CREATE INDEX IF NOT EXISTS enrollment_submissions_status_idx
  ON public.enrollment_submissions (status);
CREATE INDEX IF NOT EXISTS enrollment_submissions_student_idx
  ON public.enrollment_submissions (student_id);

-- =============================================
-- 4. SUBMISSION ITEMS
-- =============================================
CREATE TABLE IF NOT EXISTS public.enrollment_submission_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES public.enrollment_submissions(id) ON DELETE CASCADE,
  subject_id    UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  origin        TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('grizz','manual')),
  grizz_reason  TEXT,
  item_state    TEXT NOT NULL DEFAULT 'submitted'
                CHECK (item_state IN ('submitted','removed_by_head','added_by_head')),
  head_note     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, subject_id)
);

CREATE INDEX IF NOT EXISTS enrollment_submission_items_submission_idx
  ON public.enrollment_submission_items (submission_id);

-- =============================================
-- 5. RLS (030/031 style: enable, revoke anon, DROP-first policies)
-- =============================================
ALTER TABLE public.enrollment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_submissions REVOKE ALL ON TABLE enrollment_submissions FROM anon;
ALTER TABLE public.enrollment_submission_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_submission_items REVOKE ALL ON TABLE enrollment_submission_items FROM anon;

DROP POLICY IF EXISTS "Students read own submissions" ON public.enrollment_submissions;
CREATE POLICY "Students read own submissions"
  ON public.enrollment_submissions FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Students create own drafts" ON public.enrollment_submissions;
CREATE POLICY "Students create own drafts"
  ON public.enrollment_submissions FOR INSERT
  WITH CHECK (student_id = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS "Students edit own editable submissions" ON public.enrollment_submissions;
CREATE POLICY "Students edit own editable submissions"
  ON public.enrollment_submissions FOR UPDATE
  USING (student_id = auth.uid() AND status IN ('draft','returned'));

DROP POLICY IF EXISTS "Faculty read submissions" ON public.enrollment_submissions;
CREATE POLICY "Faculty read submissions"
  ON public.enrollment_submissions FOR SELECT
  USING (public.is_faculty());

DROP POLICY IF EXISTS "Program heads update their program submissions" ON public.enrollment_submissions;
CREATE POLICY "Program heads update their program submissions"
  ON public.enrollment_submissions FOR UPDATE
  USING (public.is_program_head_for(student_id));

DROP POLICY IF EXISTS "Deans and admins full submissions access" ON public.enrollment_submissions;
CREATE POLICY "Deans and admins full submissions access"
  ON public.enrollment_submissions FOR ALL
  USING (public.is_dean_or_admin());

-- Items: visibility/edit via the parent submission
DROP POLICY IF EXISTS "Submission items readable with parent" ON public.enrollment_submission_items;
CREATE POLICY "Submission items readable with parent"
  ON public.enrollment_submission_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.enrollment_submissions s
            WHERE s.id = submission_id
              AND (s.student_id = auth.uid() OR public.is_faculty()))
  );

DROP POLICY IF EXISTS "Students insert items on editable submissions" ON public.enrollment_submission_items;
CREATE POLICY "Students insert items on editable submissions"
  ON public.enrollment_submission_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.enrollment_submissions s
            WHERE s.id = submission_id
              AND s.student_id = auth.uid()
              AND s.status IN ('draft','returned'))
  );

DROP POLICY IF EXISTS "Students delete items on editable submissions" ON public.enrollment_submission_items;
CREATE POLICY "Students delete items on editable submissions"
  ON public.enrollment_submission_items FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.enrollment_submissions s
            WHERE s.id = submission_id
              AND s.student_id = auth.uid()
              AND s.status IN ('draft','returned'))
  );

-- =============================================
-- 6. NOTIFICATIONS: widen target_role for faculty roles
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_target_role_check'
      AND pg_get_constraintdef(oid) LIKE '%faculty%'
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_target_role_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_target_role_check
      CHECK (target_role IN ('all', 'student', 'officer', 'admin', 'faculty', 'program_head', 'dean'));
  END IF;
END $$;
```

- [ ] **Step 2: Write the migration smoke test**

Create `scripts/smoke-test-migration-034.js`:

```js
// Static checks for migration 034 contents. Run: node scripts/smoke-test-migration-034.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '034_faculty_roles_and_submissions.sql'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('widens roles with faculty/program_head/dean', /'faculty', 'program_head', 'dean'/.test(src));
check('guarded role constraint (no blind drop)', /pg_constraint.*conname = 'profiles_role_check'/.test(src));
check('defines is_faculty()', /CREATE OR REPLACE FUNCTION public\.is_faculty\(\)/.test(src));
check('defines is_program_head_for(target_student UUID)', /is_program_head_for\(target_student UUID\)/.test(src));
check('submissions unique per student+term', /UNIQUE \(student_id, school_year, semester\)/.test(src));
check('items unique per submission+subject', /UNIQUE \(submission_id, subject_id\)/.test(src));
check('submission status enum complete', /'draft','submitted','under_review','approved','returned','rejected'/.test(src));
check('item_state enum complete', /'submitted','removed_by_head','added_by_head'/.test(src));
check('RLS enabled on both tables', (src.match(/ENABLE ROW LEVEL SECURITY/g) || []).length >= 2);
check('anon revoked on both tables', (src.match(/REVOKE ALL ON TABLE/g) || []).length >= 2);
check('students insert only own drafts', /student_id = auth\.uid\(\) AND status = 'draft'/.test(src));
check('encoded_at/encoded_by columns present', /encoded_at TIMESTAMPTZ/.test(src) && /encoded_by UUID/.test(src));
check('notifications target_role widened', /notifications_target_role_check/.test(src));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll migration 034 checks passed');
```

- [ ] **Step 3: Run the test**

Run: `node scripts/smoke-test-migration-034.js`
Expected: `All migration 034 checks passed`.

- [ ] **Step 4: Apply the migration** in the Supabase SQL editor (manual). Verify: `SELECT count(*) FROM public.enrollment_submissions;` returns 0 and `SELECT unnest(enum_range(NULL))` is not needed — instead confirm `\d enrollment_submissions` lists the columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/034_faculty_roles_and_submissions.sql scripts/smoke-test-migration-034.js
git commit -m "feat(db): migration 034 - faculty/program_head/dean roles, enrollment submissions tables, RLS"
```

---

### Task 2: Role middleware + enrollment state machine (TDD)

**Files:**
- Modify: `server/middleware/roles.js`
- Create: `server/lib/enrollment.js`
- Test: `scripts/smoke-test-enrollment-lib.js`

**Interfaces:**
- Produces (used by Tasks 3-5):
  - `requireFaculty(req,res,next)` — 403 unless role ∈ {faculty, program_head, dean, admin}
  - `requireProgramHead(req,res,next)` — 403 unless role ∈ {program_head, admin} (dean excluded by design)
  - `SUBMISSION_STATUSES`, `canTransition(from, to)`, `canStudentEdit(status)`, `canHeadAct(status)`, `TERMINAL_STATUSES` from `server/lib/enrollment.js`

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-enrollment-lib.js`:

```js
// TDD smoke test for server/lib/enrollment.js. Run: node scripts/smoke-test-enrollment-lib.js
let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

const lib = require('../server/lib/enrollment');

// transitions
check('draft -> submitted legal', lib.canTransition('draft', 'submitted'), true);
check('submitted -> under_review legal', lib.canTransition('submitted', 'under_review'), true);
check('submitted -> approved legal', lib.canTransition('submitted', 'approved'), true);
check('submitted -> returned legal', lib.canTransition('submitted', 'returned'), true);
check('submitted -> rejected legal', lib.canTransition('submitted', 'rejected'), true);
check('under_review -> approved legal', lib.canTransition('under_review', 'approved'), true);
check('under_review -> returned legal', lib.canTransition('under_review', 'returned'), true);
check('under_review -> rejected legal', lib.canTransition('under_review', 'rejected'), true);
check('returned -> submitted legal', lib.canTransition('returned', 'submitted'), true);
check('approved -> approved legal (idempotent no-op)', lib.canTransition('approved', 'approved'), true);
check('approved -> submitted illegal', lib.canTransition('approved', 'submitted'), false);
check('rejected -> approved illegal', lib.canTransition('rejected', 'approved'), false);
check('draft -> approved illegal', lib.canTransition('draft', 'approved'), false);

// editability
check('student edits draft', lib.canStudentEdit('draft'), true);
check('student edits returned', lib.canStudentEdit('returned'), true);
check('student cannot edit submitted', lib.canStudentEdit('submitted'), false);
check('student cannot edit approved', lib.canStudentEdit('approved'), false);

// head actionability
check('head acts on submitted', lib.canHeadAct('submitted'), true);
check('head acts on under_review', lib.canHeadAct('under_review'), true);
check('head cannot act on draft', lib.canHeadAct('draft'), false);
check('head cannot act on approved', lib.canHeadAct('approved'), false);

check('terminal statuses are approved/rejected',
  JSON.stringify(lib.TERMINAL_STATUSES), JSON.stringify(['approved', 'rejected']));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll enrollment lib tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-enrollment-lib.js`
Expected: FAIL — `Cannot find module '../server/lib/enrollment'`.

- [ ] **Step 3: Implement**

Modify `server/middleware/roles.js` — add after the existing constants and before `module.exports`:

```js
const FACULTY_ROLES   = ['faculty', 'program_head', 'dean', 'admin'];
const HEAD_ROLES      = ['program_head', 'admin'];

function requireFaculty(req, res, next) {
  if (!FACULTY_ROLES.includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Faculty access required.' });
  }
  next();
}

function requireProgramHead(req, res, next) {
  if (!HEAD_ROLES.includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Program head privileges required.' });
  }
  next();
}
```

and change the export line to:

```js
module.exports = { OFFICER_ROLES, GOVERNOR_ROLES, FACULTY_ROLES, requireAdmin, requireGovernorOrAdmin, requireOfficer, requireFaculty, requireProgramHead };
```

Create `server/lib/enrollment.js`:

```js
// =============================================
// server/lib/enrollment.js - Pure submission state machine.
// No dependencies so smoke tests can require it directly.
// =============================================
const SUBMISSION_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'returned', 'rejected'];
const TERMINAL_STATUSES = ['approved', 'rejected'];

// Legal status transitions. approved->approved exists so re-approval is a
// recognizable no-op, never an error.
const TRANSITIONS = {
  draft:        ['submitted'],
  submitted:    ['under_review', 'approved', 'returned', 'rejected'],
  under_review: ['approved', 'returned', 'rejected'],
  returned:     ['submitted'],
  approved:     ['approved'],
  rejected:     [],
};

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

function canStudentEdit(status) {
  return status === 'draft' || status === 'returned';
}

function canHeadAct(status) {
  return status === 'submitted' || status === 'under_review';
}

module.exports = { SUBMISSION_STATUSES, TERMINAL_STATUSES, TRANSITIONS, canTransition, canStudentEdit, canHeadAct };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-test-enrollment-lib.js`
Expected: `All enrollment lib tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/roles.js server/lib/enrollment.js scripts/smoke-test-enrollment-lib.js
git commit -m "feat(server): faculty role middleware and submission state machine"
```

---

### Task 3: Student enrollment routes (`/api/enrollment`)

**Files:**
- Create: `server/routes/enrollment.js`
- Modify: `server/index.js` (require near line 13, mount after the `/api/curriculum` line ~178)
- Test: `scripts/smoke-test-enrollment-routes.js`

**Interfaces:**
- Consumes: `canStudentEdit`/`canTransition` (Task 2), `isValidEnum`/`isValidUUID` from `server/lib/validate.js`, `logError`, `logAudit`, supabase client.
- Produces (consumed by Task 6 UI and Task 4):
  - `GET /api/enrollment/submissions/my` → `{ submissions: [{ ...submission, items: [...] }] }`
  - `POST /api/enrollment/submissions` `{ school_year, semester }` → `{ submission }` | 409 if an approved one exists for the term
  - `POST /api/enrollment/submissions/:id/items` `{ subject_id, origin?, grizz_reason? }` → `{ item }`
  - `DELETE /api/enrollment/submissions/:id/items/:itemId` → `{ ok: true }`
  - `POST /api/enrollment/submissions/:id/submit` → `{ submission }` | 400 when empty
  - All routes reject non-students with 403.

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-enrollment-routes.js`:

```js
// Static wiring checks for the student enrollment routes.
// Run: node scripts/smoke-test-enrollment-routes.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'enrollment.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('student-only guard present', /requireStudent/.test(routeSrc));
check('GET /submissions/my defined', /router\.get\('\/submissions\/my'/.test(routeSrc));
check('POST /submissions defined', /router\.post\('\/submissions'/.test(routeSrc));
check('POST /submissions/:id/items defined', /router\.post\('\/submissions\/:id\/items'/.test(routeSrc));
check('DELETE /submissions/:id/items/:itemId defined', /router\.delete\('\/submissions\/:id\/items\/:itemId'/.test(routeSrc));
check('POST /submissions/:id/submit defined', /router\.post\('\/submissions\/:id\/submit'/.test(routeSrc));
check('uses canStudentEdit', /canStudentEdit\(/.test(routeSrc));
check('uses canTransition on submit', /canTransition\(/.test(routeSrc));
check('rejects empty submissions on submit', /at least one subject|no subjects/i.test(routeSrc));
check('audits submission submit', /ENROLLMENT_SUBMIT/.test(routeSrc));
check('mounted in server/index.js', /app\.use\("\/api\/enrollment"/.test(indexSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll enrollment route wiring checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-enrollment-routes.js`
Expected: FAIL — ENOENT on the route file.

- [ ] **Step 3: Implement the route file**

Create `server/routes/enrollment.js`:

```js
// =============================================
// server/routes/enrollment.js - Student load submission (Phase B).
// Students draft proposed loads and submit them for program-head evaluation.
// =============================================
const express  = require('express');
const supabase = require('../lib/supabase');
const { isValidUUID, assertRequired } = require('../lib/validate');
const { logError } = require('../lib/logger');
const { logAudit } = require('../lib/audit');
const { createNotification } = require('./notifications');
const { canStudentEdit, canTransition } = require('../lib/enrollment');

const router = express.Router();

const SCHOOL_YEAR_RE = /^\d{4}-\d{4}$/;
const ORIGINS = ['grizz', 'manual'];

// Students only — staff use /api/faculty.
function requireStudent(req, res, next) {
  if (req.profile?.role !== 'student') {
    return res.status(403).json({ error: 'Student account required.' });
  }
  next();
}
router.use(requireStudent);

// GET /submissions/my - own submissions with items, newest term first
router.get('/submissions/my', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('enrollment_submissions')
      .select('*, enrollment_submission_items(*, subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester))')
      .eq('student_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) {
      logError('enrollment/my', error);
      return res.status(500).json({ error: 'Failed to load your submissions.' });
    }
    res.json({ submissions: data || [] });
  } catch (err) {
    logError('enrollment/my', err);
    res.status(500).json({ error: 'Failed to load your submissions.' });
  }
});

// POST /submissions - create (or reuse) the draft for a term
router.post('/submissions', async (req, res) => {
  try {
    const { school_year, semester } = req.body || {};
    if (!SCHOOL_YEAR_RE.test(String(school_year || ''))) {
      return res.status(400).json({ error: 'School year must look like 2026-2027.' });
    }
    const sem = Number(semester);
    if (!Number.isInteger(sem) || sem < 1 || sem > 3) {
      return res.status(400).json({ error: 'Semester must be 1, 2, or 3.' });
    }

    const { data: existing } = await supabase
      .from('enrollment_submissions')
      .select('*')
      .eq('student_id', req.user.id)
      .eq('school_year', school_year)
      .eq('semester', sem)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'approved' || existing.status === 'rejected') {
        return res.status(409).json({ error: `A submission for this term is already ${existing.status}.` });
      }
      return res.json({ submission: existing }); // reuse draft/submitted/returned
    }

    const { data, error } = await supabase
      .from('enrollment_submissions')
      .insert({ student_id: req.user.id, school_year, semester: sem })
      .select('*')
      .single();
    if (error) {
      logError('enrollment/create', error);
      return res.status(500).json({ error: 'Failed to create the submission.' });
    }
    res.status(201).json({ submission: data });
  } catch (err) {
    logError('enrollment/create', err);
    res.status(500).json({ error: 'Failed to create the submission.' });
  }
});

// Shared: load own submission in an editable state
async function loadEditableSubmission(req, res) {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ error: 'Invalid submission id.' }); return null; }
  const { data: submission } = await supabase
    .from('enrollment_submissions')
    .select('*')
    .eq('id', id)
    .eq('student_id', req.user.id)
    .maybeSingle();
  if (!submission) { res.status(404).json({ error: 'Submission not found.' }); return null; }
  if (!canStudentEdit(submission.status)) {
    res.status(400).json({ error: `This submission is ${submission.status} and can no longer be edited.` });
    return null;
  }
  return submission;
}

// POST /submissions/:id/items - add a subject while draft/returned
router.post('/submissions/:id/items', async (req, res) => {
  try {
    const submission = await loadEditableSubmission(req, res);
    if (!submission) return;

    const { subject_id, origin, grizz_reason } = req.body || {};
    if (!isValidUUID(subject_id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }

    const { data: subject } = await supabase
      .from('subjects')
      .select('id, code, program')
      .eq('id', subject_id)
      .maybeSingle();
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });
    if (subject.program !== req.profile.course) {
      return res.status(400).json({ error: `${subject.code} does not belong to your program.` });
    }

    const itemOrigin = ORIGINS.includes(origin) ? origin : 'manual';
    const { data: item, error } = await supabase
      .from('enrollment_submission_items')
      .insert({
        submission_id: submission.id,
        subject_id,
        origin: itemOrigin,
        grizz_reason: itemOrigin === 'grizz' ? String(grizz_reason || '').slice(0, 200) : null,
      })
      .select('*, subjects(id, code, title, units, lec_units, lab_units)')
      .single();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: `${subject.code} is already in this submission.` });
      }
      logError('enrollment/add-item', error);
      return res.status(500).json({ error: 'Failed to add the subject.' });
    }

    logAudit(req.user.id, 'ENROLLMENT_ADD_ITEM', { submission_id: submission.id, subject_id });
    res.status(201).json({ item });
  } catch (err) {
    logError('enrollment/add-item', err);
    res.status(500).json({ error: 'Failed to add the subject.' });
  }
});

// DELETE /submissions/:id/items/:itemId - remove while draft/returned
router.delete('/submissions/:id/items/:itemId', async (req, res) => {
  try {
    const submission = await loadEditableSubmission(req, res);
    if (!submission) return;
    const { itemId } = req.params;
    if (!isValidUUID(itemId)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    const { error } = await supabase
      .from('enrollment_submission_items')
      .delete()
      .eq('id', itemId)
      .eq('submission_id', submission.id);
    if (error) {
      logError('enrollment/remove-item', error);
      return res.status(500).json({ error: 'Failed to remove the subject.' });
    }
    logAudit(req.user.id, 'ENROLLMENT_REMOVE_ITEM', { submission_id: submission.id, item_id: itemId });
    res.json({ ok: true });
  } catch (err) {
    logError('enrollment/remove-item', err);
    res.status(500).json({ error: 'Failed to remove the subject.' });
  }
});

// POST /submissions/:id/submit - draft/returned -> submitted; notify program heads
router.post('/submissions/:id/submit', async (req, res) => {
  try {
    const submission = await loadEditableSubmission(req, res);
    if (!submission) return;
    if (!canTransition(submission.status, 'submitted')) {
      return res.status(400).json({ error: `Cannot submit from ${submission.status}.` });
    }

    const { count } = await supabase
      .from('enrollment_submission_items')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submission.id);
    if (!count) {
      return res.status(400).json({ error: 'Add at least one subject before submitting.' });
    }

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', submission.id)
      .select('*')
      .single();
    if (error) {
      logError('enrollment/submit', error);
      return res.status(500).json({ error: 'Failed to submit for verification.' });
    }

    // Notify the program heads of the student's program (in-app + email are
    // wired in Task 5; the in-app notification is placed here).
    const { data: heads } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'program_head')
      .eq('course', req.profile.course);
    for (const head of heads || []) {
      createNotification({
        userId: head.id,
        type: 'units',
        category: 'units',
        title: 'New load for evaluation',
        message: `${req.profile.full_name || 'A student'} submitted a load for ${submission.school_year}.`,
        link: '/faculty',
      });
    }

    logAudit(req.user.id, 'ENROLLMENT_SUBMIT', { submission_id: submission.id, items: count });
    res.json({ submission: updated });
  } catch (err) {
    logError('enrollment/submit', err);
    res.status(500).json({ error: 'Failed to submit for verification.' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router**

In `server/index.js`, add the require near the others (line ~13):

```js
const enrollmentRouter  = require("./routes/enrollment");
```

and the mount after the `/api/curriculum` line:

```js
app.use("/api/enrollment",    authMiddleware, onlyWrites(writeLimiter), enrollmentRouter);
```

- [ ] **Step 5: Run tests**

Run: `node scripts/smoke-test-enrollment-routes.js` (expect pass) and `node -e "require('dotenv').config(); require('./server/routes/enrollment.js'); console.log('loads ok')"`.
Expected: all pass; module loads.

- [ ] **Step 6: Commit**

```bash
git add server/routes/enrollment.js server/index.js scripts/smoke-test-enrollment-routes.js
git commit -m "feat(server): student load submission routes - draft, items, submit with program-head notification"
```

---

### Task 4: Faculty routes — evaluation queue, detail, item edits

**Files:**
- Create: `server/routes/faculty.js`
- Modify: `server/index.js` (require + mount after `/api/enrollment`)
- Test: `scripts/smoke-test-faculty-routes.js`

**Interfaces:**
- Consumes: `requireFaculty`/`requireProgramHead` (Task 2), `canHeadAct` (Task 2).
- Produces (consumed by Task 5 and the UIs):
  - `GET /api/faculty/submissions?status=` → `{ submissions }` — program_head scoped to `profiles.course = req.profile.course`; dean/admin see all; plain faculty see approved-only list (SA queue).
  - `GET /api/faculty/submissions/:id` → `{ submission, items, student, history }` (scoping enforced; `history` = the student's `student_units`)
  - `POST /api/faculty/submissions/:id/open` → sets `under_review` once (fire-and-forget friendly)
  - `POST /api/faculty/submissions/:id/items` `{ subject_id, head_note }` → adds item with `item_state: 'added_by_head'` (head_note required)
  - `PATCH /api/faculty/submissions/:id/items/:itemId` `{ head_note }` → marks `removed_by_head` (head_note required)

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-faculty-routes.js`:

```js
// Static wiring checks for the faculty routes (read + item edit half).
// Run: node scripts/smoke-test-faculty-routes.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'faculty.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('router is faculty-guarded', /router\.use\(requireFaculty\)/.test(routeSrc));
check('program-head-only guard exists', /requireProgramHead/.test(routeSrc));
check('GET /submissions defined', /router\.get\('\/submissions'/.test(routeSrc));
check('GET /submissions/:id defined', /router\.get\('\/submissions\/:id'/.test(routeSrc));
check('POST /submissions/:id/open defined', /router\.post\('\/submissions\/:id\/open'/.test(routeSrc));
check('POST /submissions/:id/items defined', /router\.post\('\/submissions\/:id\/items'/.test(routeSrc));
check('PATCH /submissions/:id/items/:itemId defined', /router\.patch\('\/submissions\/:id\/items\/:itemId'/.test(routeSrc));
check('head_note required for adds', /head_note/.test(routeSrc));
check('added_by_head state used', /added_by_head/.test(routeSrc));
check('removed_by_head state used', /removed_by_head/.test(routeSrc));
check('scoping by program course', /\.eq\('course',/.test(routeSrc) || /course/.test(routeSrc));
check('mounted in server/index.js', /app\.use\("\/api\/faculty"/.test(indexSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll faculty route wiring checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-faculty-routes.js`
Expected: FAIL — ENOENT.

- [ ] **Step 3: Implement**

Create `server/routes/faculty.js`:

```js
// =============================================
// server/routes/faculty.js - Load evaluation + SA encoding queue (Phase B).
// program_head: evaluate/decide on their program. faculty: SA read-only queue
// + mark-encoded. dean: read-only across programs (enforced by requireProgramHead
// exclusion on every mutating route).
// =============================================
const express  = require('express');
const supabase = require('../lib/supabase');
const { isValidUUID } = require('../lib/validate');
const { logError } = require('../lib/logger');
const { logAudit } = require('../lib/audit');
const { requireFaculty, requireProgramHead } = require('../middleware/roles');
const { canHeadAct } = require('../lib/enrollment');

const router = express.Router();
router.use(requireFaculty);

const SUBMISSION_SELECT = `
  *, student:profiles!enrollment_submissions_student_id_fkey(id, full_name, email, course, year_level, enrollment_year),
     enrollment_submission_items(*, subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester))
`;

// Shared: load a submission and enforce faculty access scope.
// deans/admins: any. program_head: own program only. faculty (SA): read-only.
async function loadSubmissionFor(req, res, { forHead = false } = {}) {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ error: 'Invalid submission id.' }); return null; }
  const { data: submission } = await supabase
    .from('enrollment_submissions')
    .select(SUBMISSION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!submission) { res.status(404).json({ error: 'Submission not found.' }); return null; }

  const role = req.profile.role;
  const isOwnProgram = role === 'program_head' && submission.student?.course === req.profile.course;
  if (forHead && !(role === 'admin' || isOwnProgram)) {
    res.status(403).json({ error: 'This load belongs to another program.' });
    return null;
  }
  return submission;
}

// GET /submissions?status= - queue list
router.get('/submissions', async (req, res) => {
  try {
    let query = supabase.from('enrollment_submissions').select(SUBMISSION_SELECT);
    if (req.profile.role === 'program_head') {
      // scope to own program via the student join
      query = query.eq('student.course', req.profile.course);
    }
    if (req.query.status) query = query.eq('status', String(req.query.status));
    const { data, error } = await query.order('submitted_at', { ascending: true, nullsFirst: false });
    if (error) {
      logError('faculty/list', error);
      return res.status(500).json({ error: 'Failed to load submissions.' });
    }
    res.json({ submissions: data || [] });
  } catch (err) {
    logError('faculty/list', err);
    res.status(500).json({ error: 'Failed to load submissions.' });
  }
});

// GET /submissions/:id - full evaluation payload
router.get('/submissions/:id', async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res);
    if (!submission) return;

    const [historyRes, prereqRes] = await Promise.all([
      supabase.from('student_units')
        .select('*, subjects(code, title, units, lec_units, lab_units, program)')
        .eq('student_id', submission.student_id)
        .order('created_at', { ascending: false }),
      supabase.from('subject_prerequisites')
        .select('id, subject_id, kind, detail, depends_code:subjects(code)')
        .order('id', { ascending: true }),
    ]);
    if (historyRes.error) logError('faculty/detail-history', historyRes.error);
    res.json({
      submission,
      history: historyRes.data || [],
      prerequisites: prereqRes.data || [],
    });
  } catch (err) {
    logError('faculty/detail', err);
    res.status(500).json({ error: 'Failed to load the submission.' });
  }
});

// POST /submissions/:id/open - touch under_review (program head only)
router.post('/submissions/:id/open', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) return res.json({ ok: true });
    await supabase
      .from('enrollment_submissions')
      .update({ status: 'under_review', updated_at: new Date().toISOString() })
      .eq('id', submission.id);
    res.json({ ok: true });
  } catch (err) {
    logError('faculty/open', err);
    res.status(500).json({ error: 'Failed to open the submission.' });
  }
});

// POST /submissions/:id/items - program head adds a subject
router.post('/submissions/:id/items', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot edit a ${submission.status} load.` });
    }
    const { subject_id, head_note } = req.body || {};
    if (!isValidUUID(subject_id)) return res.status(400).json({ error: 'Invalid subject id.' });
    if (!head_note || !String(head_note).trim()) {
      return res.status(400).json({ error: 'A reason (head_note) is required when adding a subject.' });
    }
    const { data: item, error } = await supabase
      .from('enrollment_submission_items')
      .insert({
        submission_id: submission.id,
        subject_id,
        origin: 'manual',
        item_state: 'added_by_head',
        head_note: String(head_note).trim().slice(0, 300),
      })
      .select('*, subjects(id, code, title, units, lec_units, lab_units)')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That subject is already in this load.' });
      logError('faculty/add-item', error);
      return res.status(500).json({ error: 'Failed to add the subject.' });
    }
    logAudit(req.user.id, 'FACULTY_ADD_ITEM', { submission_id: submission.id, subject_id, head_note });
    res.status(201).json({ item });
  } catch (err) {
    logError('faculty/add-item', err);
    res.status(500).json({ error: 'Failed to add the subject.' });
  }
});

// PATCH /submissions/:id/items/:itemId - program head removes a subject
router.patch('/submissions/:id/items/:itemId', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot edit a ${submission.status} load.` });
    }
    const { itemId } = req.params;
    if (!isValidUUID(itemId)) return res.status(400).json({ error: 'Invalid item id.' });
    const { head_note } = req.body || {};
    if (!head_note || !String(head_note).trim()) {
      return res.status(400).json({ error: 'A reason (head_note) is required when removing a subject.' });
    }
    const { data: item, error } = await supabase
      .from('enrollment_submission_items')
      .update({ item_state: 'removed_by_head', head_note: String(head_note).trim().slice(0, 300) })
      .eq('id', itemId)
      .eq('submission_id', submission.id)
      .select('*, subjects(id, code, title, units)')
      .single();
    if (error || !item) return res.status(404).json({ error: 'Item not found.' });
    logAudit(req.user.id, 'FACULTY_REMOVE_ITEM', { submission_id: submission.id, item_id: itemId, head_note });
    res.json({ item });
  } catch (err) {
    logError('faculty/remove-item', err);
    res.status(500).json({ error: 'Failed to remove the subject.' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount**

In `server/index.js`: require after `enrollmentRouter`:

```js
const facultyRouter     = require("./routes/faculty");
```

mount after the `/api/enrollment` line:

```js
app.use("/api/faculty",       authMiddleware, onlyWrites(writeLimiter), facultyRouter);
```

- [ ] **Step 5: Run tests**

Run: `node scripts/smoke-test-faculty-routes.js` (expect pass) and the module-load one-liner (`node -e "require('dotenv').config(); require('./server/routes/faculty.js'); console.log('loads ok')"`).

- [ ] **Step 6: Commit**

```bash
git add server/routes/faculty.js server/index.js scripts/smoke-test-faculty-routes.js
git commit -m "feat(server): faculty evaluation queue, detail with history, program-head item edits"
```

---

### Task 5: Faculty decisions — approve (auto-enroll), return, reject, mark-encoded, export, notifications

**Files:**
- Modify: `server/routes/faculty.js` (append decision routes before `module.exports`)
- Modify: `server/lib/email.js` (add `sendLoadStatusEmail`, export it)
- Test: `scripts/smoke-test-faculty-decisions.js`

**Interfaces:**
- Consumes: `loadSubmissionFor`, `canHeadAct` (Task 4); `logAudit`; `createNotification` from `./notifications`.
- Produces:
  - `POST /api/faculty/submissions/:id/approve` — idempotent; auto-enrolls
  - `POST /api/faculty/submissions/:id/return` / `.../reject` `{ notes }`
  - `POST /api/faculty/submissions/:id/mark-encoded` (any faculty role)
  - `GET /api/faculty/submissions/:id/export` (xlsx of the final load)
  - `sendLoadStatusEmail({ to, name, status, studentName, term, lines, changes })` in `server/lib/email.js`

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-faculty-decisions.js`:

```js
// Static wiring checks for the decision endpoints. Run: node scripts/smoke-test-faculty-decisions.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'faculty.js'), 'utf8');
const emailSrc = fs.readFileSync(path.join(root, 'server', 'lib', 'email.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('POST /submissions/:id/approve defined', /router\.post\('\/submissions\/:id\/approve'/.test(routeSrc));
check('POST /submissions/:id/return defined', /router\.post\('\/submissions\/:id\/return'/.test(routeSrc));
check('POST /submissions/:id/reject defined', /router\.post\('\/submissions\/:id\/reject'/.test(routeSrc));
check('POST /submissions/:id/mark-encoded defined', /router\.post\('\/submissions\/:id\/mark-encoded'/.test(routeSrc));
check('GET /submissions/:id/export defined', /router\.get\('\/submissions\/:id\/export'/.test(routeSrc));
check('approve is idempotent (approved no-op)', /already approved|alreadyApproved|status === 'approved'/i.test(routeSrc));
check('approve upserts student_units with the standard conflict target',
  /onConflict[^]*?student_id,subject_id,school_year,semester/.test(routeSrc));
check('approve excludes removed items', /removed_by_head/.test(routeSrc));
check('approve notifies the student', /createNotification/.test(routeSrc));
check('approve emails the student', /sendLoadStatusEmail/.test(routeSrc));
check('audit logs decisions', /FACULTY_APPROVE/.test(routeSrc) && /FACULTY_RETURN/.test(routeSrc) && /FACULTY_REJECT/.test(routeSrc));
check('mark-encoded allowed for all faculty roles', /mark-encoded/.test(routeSrc));
check('exceljs used for export', /exceljs|ExcelJS/i.test(routeSrc));
check('email.js exports sendLoadStatusEmail', /sendLoadStatusEmail/.test(emailSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll faculty decision wiring checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-faculty-decisions.js`
Expected: FAIL (missing decision routes).

- [ ] **Step 3: Add `sendLoadStatusEmail` to `server/lib/email.js`**

Insert before the `module.exports` line, and extend the export list to include it:

```js
// Load approval status email (Phase B). status: 'approved'|'returned'|'rejected'|'encoded'
async function sendLoadStatusEmail({ to, name = 'COE Student', status, studentName, term, lines = [], changes = null }) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0, reason: 'Brevo API key missing' };
    if (!to) return { sent: 0, reason: 'No recipient email provided' };

    const headlines = {
      approved: 'Load Approved',
      returned: 'Load Returned for Changes',
      rejected: 'Load Rejected',
      encoded:  'Load Encoded',
    };
    const changeHtml = changes
      ? `<p style="margin:8px 0;"><strong>Changes by your Program Head:</strong></p>
         <ul style="margin:8px 0;padding-left:20px;">${changes.map(c => `<li>${c}</li>`).join('')}</ul>`
      : '';
    const listHtml = lines.length
      ? `<ul style="margin:8px 0;padding-left:20px;">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`
      : '';

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `${headlines[status] || 'Load Update'}: COE LGU Portal`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: headlines[status] || 'Load Update',
      preheader: `${studentName} - load for ${term}`,
      content: `
        <p style="margin:0 0 12px;">Hi ${studentName},</p>
        <p style="margin:0 0 12px;">Your submitted load for <strong>${term}</strong> was <strong>${headlines[status] || status}</strong>.</p>
        ${changeHtml}
        ${listHtml}
        <p style="margin:12px 0 0;"><a href="${APP_URL}" style="color:#e8590c;">Open the portal</a> to view the full details.</p>`,
    });
    sendSmtpEmail.sender = {
      name: 'COE Financial Transparency System',
      email: process.env.BREVO_SENDER_EMAIL || 'coebudget@gmail.com',
    };
    sendSmtpEmail.to = [{ email: to, name }];
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return { sent: 1, messageId: data.messageId };
  } catch (err) {
    logError('Email Load Status Error', err);
    return { sent: 0, error: err.message };
  }
}
```

Export line becomes:

```js
module.exports = { sendAnnouncementEmail, sendNewEventEmail, sendAccountApprovalEmail, sendLoadStatusEmail };
```

- [ ] **Step 4: Append the decision routes to `server/routes/faculty.js`**

Add requires at the top (merge with Task 4's):

```js
const { createNotification } = require('./notifications');
const { sendLoadStatusEmail } = require('../lib/email');
const ExcelJS = require('exceljs');
```

Append before `module.exports = router;`:

```js
// ---- shared notification + email helpers ----
function termLabel(s) { return `${s.school_year} Sem ${s.semester}`; }

async function notifyStudent(submission, status, extraChanges = []) {
  const lines = (submission.enrollment_submission_items || [])
    .filter(i => i.item_state !== 'removed_by_head')
    .map(i => `${i.subjects.code} - ${i.subjects.title}${i.item_state === 'added_by_head' ? ' (added by Program Head)' : ''}`);
  const changes = (submission.enrollment_submission_items || [])
    .filter(i => i.item_state !== 'submitted' && i.head_note)
    .map(i => `${i.item_state === 'removed_by_head' ? 'Removed' : 'Added'} ${i.subjects.code}: ${i.head_note}`)
    .concat(extraChanges);
  createNotification({
    userId: submission.student_id,
    type: 'units',
    category: 'units',
    title: `Load ${status.charAt(0).toUpperCase()}${status.slice(1)}`,
    message: `Your load for ${termLabel(submission)} was ${status}.`,
    link: '/',
  });
  sendLoadStatusEmail({
    to: submission.student?.email,
    name: submission.student?.full_name || 'COE Student',
    status, studentName: submission.student?.full_name || 'COE Student',
    term: termLabel(submission), lines, changes: changes.length ? changes : null,
  });
}

// POST /submissions/:id/approve - idempotent auto-enroll
router.post('/submissions/:id/approve', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (submission.status === 'approved') {
      return res.json({ ok: true, alreadyApproved: true }); // idempotent no-op
    }
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot approve a ${submission.status} load.` });
    }

    const active = (submission.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');
    if (!active.length) {
      return res.status(400).json({ error: 'The load has no active subjects to approve.' });
    }

    // Idempotent auto-enroll: same shape + conflict target as /api/units/enroll.
    const subjectIds = active.map(i => i.subject_id);
    const { data: subjects } = await supabase
      .from('subjects')
      .select('id, units')
      .in('id', subjectIds);
    const unitsById = new Map((subjects || []).map(s => [s.id, s.units]));
    for (const item of active) {
      const { error } = await supabase
        .from('student_units')
        .upsert({
          student_id: submission.student_id,
          subject_id: item.subject_id,
          school_year: submission.school_year,
          semester: submission.semester,
          status: 'enrolled',
          grade: null,
        }, { onConflict: 'student_id,subject_id,school_year,semester' });
      if (error) {
        logError('faculty/approve-enroll', error);
        return res.status(500).json({ error: `Failed to enroll ${item.subjects.code}: ${error.message}` });
      }
    }

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({
        status: 'approved',
        reviewed_by: req.user.id,
        review_notes: req.body?.notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', submission.id)
      .eq('status', submission.status) // guard against concurrent decision
      .select(SUBMISSION_SELECT)
      .single();
    if (error) {
      logError('faculty/approve-status', error);
      return res.status(500).json({ error: 'Failed to record the approval.' });
    }

    logAudit(req.user.id, 'FACULTY_APPROVE', {
      submission_id: submission.id, student_id: submission.student_id,
      enrolled: active.length, term: termLabel(submission),
    });
    notifyStudent(updated, 'approved');
    res.json({ ok: true, submission: updated });
  } catch (err) {
    logError('faculty/approve', err);
    res.status(500).json({ error: 'Failed to approve the load.' });
  }
});

// POST /submissions/:id/return - send back to the student for changes
router.post('/submissions/:id/return', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot return a ${submission.status} load.` });
    }
    const notes = String(req.body?.notes || '').trim();
    if (!notes) return res.status(400).json({ error: 'Notes are required when returning a load.' });

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({ status: 'returned', reviewed_by: req.user.id, review_notes: notes.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', submission.id)
      .select(SUBMISSION_SELECT)
      .single();
    if (error) { logError('faculty/return', error); return res.status(500).json({ error: 'Failed to return the load.' }); }

    logAudit(req.user.id, 'FACULTY_RETURN', { submission_id: submission.id, notes });
    notifyStudent(updated, 'returned');
    res.json({ ok: true, submission: updated });
  } catch (err) {
    logError('faculty/return', err);
    res.status(500).json({ error: 'Failed to return the load.' });
  }
});

// POST /submissions/:id/reject
router.post('/submissions/:id/reject', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot reject a ${submission.status} load.` });
    }
    const notes = String(req.body?.notes || '').trim();
    if (!notes) return res.status(400).json({ error: 'Notes are required when rejecting a load.' });

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({ status: 'rejected', reviewed_by: req.user.id, review_notes: notes.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', submission.id)
      .select(SUBMISSION_SELECT)
      .single();
    if (error) { logError('faculty/reject', error); return res.status(500).json({ error: 'Failed to reject the load.' }); }

    logAudit(req.user.id, 'FACULTY_REJECT', { submission_id: submission.id, notes });
    notifyStudent(updated, 'rejected');
    res.json({ ok: true, submission: updated });
  } catch (err) {
    logError('faculty/reject', err);
    res.status(500).json({ error: 'Failed to reject the load.' });
  }
});

// POST /submissions/:id/mark-encoded - any faculty role (SAs)
router.post('/submissions/:id/mark-encoded', async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res);
    if (!submission) return;
    if (submission.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved loads can be marked encoded.' });
    }
    if (submission.encoded_at) return res.json({ ok: true, alreadyEncoded: true });
    const { error } = await supabase
      .from('enrollment_submissions')
      .update({ encoded_at: new Date().toISOString(), encoded_by: req.user.id, updated_at: new Date().toISOString() })
      .eq('id', submission.id);
    if (error) { logError('faculty/encoded', error); return res.status(500).json({ error: 'Failed to mark as encoded.' }); }
    logAudit(req.user.id, 'FACULTY_MARK_ENCODED', { submission_id: submission.id });
    notifyStudent(submission, 'encoded');
    res.json({ ok: true });
  } catch (err) {
    logError('faculty/encoded', err);
    res.status(500).json({ error: 'Failed to mark as encoded.' });
  }
});

// GET /submissions/:id/export - Excel of the final load (SAs encode from this)
router.get('/submissions/:id/export', async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res);
    if (!submission) return;
    if (submission.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved loads can be exported.' });
    }
    const active = (submission.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'COE LGU System';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Approved Load');
    sheet.columns = [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Title', key: 'title', width: 46 },
      { header: 'Lec', key: 'lec', width: 8 },
      { header: 'Lab', key: 'lab', width: 8 },
      { header: 'Units', key: 'units', width: 8 },
      { header: 'Year', key: 'year', width: 8 },
      { header: 'Sem', key: 'sem', width: 8 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const i of active) {
      sheet.addRow({
        code: i.subjects.code, title: i.subjects.title,
        lec: i.subjects.lec_units, lab: i.subjects.lab_units, units: i.subjects.units,
        year: i.subjects.year_level, sem: i.subjects.semester,
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="approved-load-${submission.id}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logError('faculty/export', err);
    res.status(500).json({ error: 'Failed to export the load.' });
  }
});
```

- [ ] **Step 5: Run tests**

Run: `node scripts/smoke-test-faculty-decisions.js` (expect pass), plus the earlier suites: `node scripts/smoke-test-faculty-routes.js`, `node scripts/smoke-test-enrollment-routes.js`, `node scripts/smoke-test-enrollment-lib.js` (all expect pass).

- [ ] **Step 6: Commit**

```bash
git add server/routes/faculty.js server/lib/email.js scripts/smoke-test-faculty-decisions.js
git commit -m "feat(server): load decisions with idempotent auto-enroll, notifications, and Excel export"
```

---

### Task 6: Api client groups

**Files:**
- Modify: `client/js/api.js` (new groups + export keys)
- Test: `scripts/smoke-test-api-groups.js`

**Interfaces:**
- Produces (consumed by Tasks 7-8):
  - `Api.enrollment.my()`, `.createTerm(school_year, semester)`, `.addItem(id, subject_id, grizzReason?)`, `.removeItem(id, itemId)`, `.submit(id)`
  - `Api.faculty.submissions(status?)`, `.detail(id)`, `.open(id)`, `.addItem(id, subject_id, head_note)`, `.removeItem(id, itemId, head_note)`, `.approve(id, notes?)`, `.return(id, notes)`, `.reject(id, notes)`, `.markEncoded(id)`, `.exportBlob(id)`

- [ ] **Step 1: Add the groups**

In `client/js/api.js`, add near the `units` group (paths WITHOUT `/api`, per `_fetchRaw`):

```js
  const enrollment = {
    my:        () => _request('GET', '/enrollment/submissions/my', null, false, 15000),
    createTerm: (school_year, semester) => _request('POST', '/enrollment/submissions', { school_year, semester }),
    addItem:   (id, subject_id, grizz_reason) => _request('POST', `/enrollment/submissions/${id}/items`,
                  grizz_reason ? { subject_id, origin: 'grizz', grizz_reason } : { subject_id }),
    removeItem:(id, itemId) => _request('DELETE', `/enrollment/submissions/${id}/items/${itemId}`),
    submit:    (id) => _request('POST', `/enrollment/submissions/${id}/submit`),
  };

  const faculty = {
    submissions: (status) => _request('GET', `/faculty/submissions${status ? '?status=' + encodeURIComponent(status) : ''}`, null, false, 15000),
    detail:      (id) => _request('GET', `/faculty/submissions/${id}`, null, false, 0),
    open:        (id) => _request('POST', `/faculty/submissions/${id}/open`),
    addItem:     (id, subject_id, head_note) => _request('POST', `/faculty/submissions/${id}/items`, { subject_id, head_note }),
    removeItem:  (id, itemId, head_note) => _request('PATCH', `/faculty/submissions/${id}/items/${itemId}`, { head_note }),
    approve:     (id, notes) => _request('POST', `/faculty/submissions/${id}/approve`, notes ? { notes } : {}),
    return:      (id, notes) => _request('POST', `/faculty/submissions/${id}/return`, { notes }),
    reject:      (id, notes) => _request('POST', `/faculty/submissions/${id}/reject`, { notes }),
    markEncoded: (id) => _request('POST', `/faculty/submissions/${id}/mark-encoded`),
    exportBlob: async (id) => {
      const token = await _getToken();
      const res = await fetch(`${window.API_BASE}/api/faculty/submissions/${id}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed.');
      return res.blob();
    },
  };
```

(`_getToken` already exists in the file — confirm the exact name while editing; if it differs, use the same token lookup `_fetchRaw` uses.)

Add both keys to the returned object next to the existing keys: `enrollment, faculty`.

- [ ] **Step 2: Write the smoke test**

Create `scripts/smoke-test-api-groups.js`:

```js
// Static wiring checks for the enrollment/faculty Api groups.
// Run: node scripts/smoke-test-api-groups.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'client', 'js', 'api.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('enrollment group exists', /const enrollment = \{/.test(src));
check('faculty group exists', /const faculty = \{/.test(src));
check('enrollment.my hits /enrollment/submissions/my', /submissions\/my/.test(src));
check('faculty.approve hits approve endpoint', /submissions\/\$\{id\}\/approve/.test(src));
check('faculty.exportBlob fetches with auth header', /submissions\/\$\{id\}\/export/.test(src) && /Authorization/.test(src));
check('groups exported in return object', /enrollment,\s*faculty|faculty,\s*enrollment/.test(src));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll Api group checks passed');
```

- [ ] **Step 3: Run + commit**

Run: `node scripts/smoke-test-api-groups.js` and `node --check client/js/api.js`.

```bash
git add client/js/api.js scripts/smoke-test-api-groups.js
git commit -m "feat(client): enrollment and faculty Api client groups"
```

---

### Task 7: Student portal — Load Verification section

**Files:**
- Modify: `client/index.html` (nav item after Academic Progress at ~line 283; new `<section class="view" id="view-enrollment">`; script tag `js/enrollment.js?v=1.0` before `js/app.js`)
- Modify: `client/js/app.js` (`navigateTo` dispatch near line 565: `if (view === 'enrollment') EnrollmentSection.load();` + add `'enrollment'` to the `moreViews` array)
- Create: `client/js/enrollment.js`
- Test: `scripts/smoke-test-enrollment-ui.js`

**Interfaces:**
- Consumes: `Api.enrollment.*` (Task 6), `Api.units.checklists()` for the subject picker, Grizz hook contract below.
- Produces: `window.EnrollmentSection = { load }` and `window.Enrollment.addFromGrizz(subject, reason)` — the Phase C cart will call `addFromGrizz`.

- [ ] **Step 1: Add the nav item + section shell to `client/index.html`**

Copy the exact `nav-item` markup style of the Academic Progress link (`index.html:283-285`), with `data-view="enrollment" id="nav-enrollment"`, icon `solar:clipboard-check-linear`, label `Load Verification`. Add the section after `view-units` (the units section starts at `index.html:583`):

```html
<section class="view" id="view-enrollment">
  <div class="section-header">
    <h2>Load Verification</h2>
    <p class="section-sub">Build your proposed load and send it to your Program Head for evaluation.</p>
  </div>
  <div class="enrollment-grid">
    <div class="card" id="enrollment-draft-card">
      <h3 id="enrollment-draft-title">Proposed Load</h3>
      <p class="muted" id="enrollment-term-line"></p>
      <div id="enrollment-items"></div>
      <div class="enrollment-picker">
        <select id="enrollment-subject-select" aria-label="Choose a subject"></select>
        <button type="button" class="btn btn-primary" id="enrollment-add-btn">Add Subject</button>
      </div>
      <div class="auth-error hidden" id="enrollment-error"></div>
      <button type="button" class="btn btn-primary" id="enrollment-submit-btn">Submit for Verification</button>
    </div>
    <div class="card" id="enrollment-status-card">
      <h3>Submission Status</h3>
      <div id="enrollment-status-body"><p class="muted">No submission for this term yet.</p></div>
    </div>
  </div>
</section>
```

Add minimal CSS to `client/styles/main.css` matching the existing card/nav conventions (`.enrollment-grid` two-column on desktop, one column under 768px; `.enrollment-item-row` with code/title/reason/remove button). Keep it small.

- [ ] **Step 2: Create `client/js/enrollment.js`**

```js
// =============================================
// enrollment.js - Student load verification (Phase B).
// Draft builder + status card. Grizz calls Enrollment.addFromGrizz(subject, reason).
// =============================================
const EnrollmentSection = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS_LABELS = { draft: 'Draft', submitted: 'Submitted for evaluation', under_review: 'Under evaluation', approved: 'Approved', returned: 'Returned for changes', rejected: 'Rejected' };

  let subjects = [];
  let current = null; // active submission (with items)

  async function load() {
    const profile = await window.Auth?.getProfile?.().catch(() => null) || null;
    const program = profile?.course || 'BSCoE';
    const year = Number(profile?.year_level || 0);
    const now = new Date();
    const sy = now.getMonth() >= 5 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;

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

  function fillPicker() {
    const sel = document.getElementById('enrollment-subject-select');
    const taken = new Set((current?.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head').map(i => i.subject_id));
    sel.innerHTML = subjects
      .filter(s => !taken.has(s.id))
      .map(s => `<option value="${s.id}">${esc(s.code)} — ${esc(s.title)} (${s.units}u)</option>`).join('');
  }

  function renderDraft() {
    const itemsEl = document.getElementById('enrollment-items');
    const items = (current?.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');
    const total = items.reduce((sum, i) => sum + Number(i.subjects?.units || 0), 0);
    document.getElementById('enrollment-term-line').textContent =
      current ? `${current.school_year} · Semester ${current.semester} · ${items.length} subject(s) · ${total} units` : '';
    itemsEl.innerHTML = items.map(i => `
      <div class="enrollment-item-row" data-item="${i.id}">
        <span class="mono">${esc(i.subjects?.code)}</span>
        <span>${esc(i.subjects?.title)}</span>
        ${i.origin === 'grizz' ? `<span class="unit-badge unit-badge--none" title="${esc(i.grizz_reason || 'Recommended by Grizz')}">Grizz</span>` : ''}
        ${i.item_state === 'added_by_head' ? `<span class="unit-badge unit-badge--none">Added by Program Head</span>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-remove-item="${i.id}" aria-label="Remove ${esc(i.subjects?.code)}">✕</button>
      </div>`).join('') || '<p class="muted">No subjects yet — add from the list below.</p>';

    itemsEl.querySelectorAll('[data-remove-item]').forEach(btn =>
      btn.addEventListener('click', () => removeItem(btn.dataset.removeItem)));
  }

  function renderStatus() {
    const body = document.getElementById('enrollment-status-body');
    if (!current) { body.innerHTML = '<p class="muted">No submission for this term yet.</p>'; return; }
    const items = current.enrollment_submission_items || [];
    const changes = items.filter(i => i.item_state !== 'submitted' && i.head_note)
      .map(i => `<li>${i.item_state === 'removed_by_head' ? 'Removed' : 'Added'} <strong>${esc(i.subjects?.code)}</strong>: ${esc(i.head_note)}</li>`).join('');
    body.innerHTML = `
      <p><strong>${STATUS_LABELS[current.status] || current.status}</strong></p>
      ${current.review_notes ? `<p class="muted">Program Head: ${esc(current.review_notes)}</p>` : ''}
      ${changes ? `<ul>${changes}</ul>` : ''}
      ${current.encoded_at ? '<p class="muted">✓ Encoded by the registrar staff.</p>' : ''}
      ${current.status === 'approved' ? '<p class="muted">Your subjects are now enrolled in your Academic Progress tab.</p>' : ''}`;
  }

  async function addItem(subjectId, grizzReason) {
    if (!current) return;
    try {
      const { item } = await Api.enrollment.addItem(current.id, subjectId, grizzReason);
      current.enrollment_submission_items = current.enrollment_submission_items || [];
      current.enrollment_submission_items.push(item);
      fillPicker(); renderDraft();
    } catch (err) { show(err.message); }
  }

  async function removeItem(itemId) {
    try {
      await Api.enrollment.removeItem(current.id, itemId);
      current.enrollment_submission_items = current.enrollment_submission_items.filter(i => i.id !== itemId);
      fillPicker(); renderDraft();
    } catch (err) { show(err.message); }
  }

  async function submit() {
    try {
      const { submission } = await Api.enrollment.submit(current.id);
      current = submission;
      renderStatus();
      UI.toast('Load submitted for verification.', 'success');
    } catch (err) { show(err.message); }
  }

  function show(msg) {
    const el = document.getElementById('enrollment-error');
    el.textContent = msg; el.classList.remove('hidden');
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
```

- [ ] **Step 3: Wire the dispatch in `client/js/app.js`**

In `navigateTo` (line ~565), add `'enrollment'` to the `moreViews` array and add:

```js
  if (view === 'enrollment') EnrollmentSection.load();
```

- [ ] **Step 4: Add the script tag to `client/index.html`**

Before `js/app.js` in the script block (~line 1508+): `<script src="js/enrollment.js?v=1.0"></script>`

- [ ] **Step 5: Write + run the smoke test**

Create `scripts/smoke-test-enrollment-ui.js` (static style):

```js
// Static wiring checks for the student load-verification section.
// Run: node scripts/smoke-test-enrollment-ui.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'client', 'js', 'app.js'), 'utf8');
const mod = fs.readFileSync(path.join(root, 'client', 'js', 'enrollment.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('index.html has enrollment section', html.includes('id="view-enrollment"'));
check('index.html has enrollment nav item', html.includes('data-view="enrollment"'));
check('index.html loads enrollment.js', html.includes('js/enrollment.js'));
check('module exposes load()', /return\s*\{\s*load\s*\}/.test(mod));
check('Grizz hook exposed', /addFromGrizz/.test(mod));
check('sends grizz origin with reason', /origin: 'grizz'|grizz_reason/.test(mod));
check('app.js dispatches enrollment view', /view === 'enrollment'/.test(app));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll enrollment UI wiring checks passed');
```

Run it plus `node --check client/js/enrollment.js client/js/app.js` (node --check accepts multiple files sequentially).

- [ ] **Step 6: Commit**

```bash
git add client/index.html client/js/app.js client/js/enrollment.js client/styles/main.css scripts/smoke-test-enrollment-ui.js
git commit -m "feat(student-portal): load verification section - draft builder, submit, status with head-change diff"
```

---

### Task 8: Faculty portal page (`/faculty`)

**Files:**
- Create: `client/faculty.html` (copy the `officer.html` shell: same head, config/auth/api/ui includes, vendor script order, bottom nav; keep only the sections below; page title "Faculty Portal - College of Engineering")
- Create: `client/js/faculty/faculty.js`
- Modify: `vercel.json` — add `{ "src": "/faculty", "dest": "client/faculty.html" }` between the feedback entries and the catch-all
- Test: `scripts/smoke-test-faculty-ui.js`

**Interfaces:**
- Consumes: `Api.faculty.*` (Task 6), `requireFaculty`/`requireProgramHead` server scoping (Tasks 4-5) — the client gates visibility by `profile.role`.
- Produces: `window.FacultyPortal = { boot }` — the page's only entry point.

- [ ] **Step 1: Create `client/faculty.html`**

Copy `client/officer.html` and reduce it to this shell (keep the existing head/meta/CSS links, `js/config.js`, `js/auth.js`, `js/api.js`, `js/ui.js` includes with their `?v=` params, the Supabase CDN script, and the toast styles):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Faculty Portal - College of Engineering</title>
  <link rel="stylesheet" href="styles/main.css?v=6.9" />
  <link rel="icon" href="assets/icons/icon-192.png" />
</head>
<body>
  <div id="faculty-gate" class="faculty-gate">
    <h2>Restricted Access</h2>
    <p>Please log in through the main system first.</p>
    <a href="/">Back to Main Portal</a>
  </div>

  <div id="faculty-app" hidden>
    <header class="faculty-topbar">
      <img src="assets/coe-logo.png" alt="COE Logo" class="faculty-logo" />
      <div>
        <h1>Faculty Portal</h1>
        <p id="faculty-user-line"></p>
      </div>
    </header>
    <main class="faculty-main">
      <!-- Program head: evaluation queue -->
      <section id="faculty-queue" class="faculty-section">
        <h2>Evaluation Queue</h2>
        <p class="muted">Loads submitted by your program's students.</p>
        <div id="faculty-queue-list"></div>
      </section>

      <!-- Program head: evaluation view -->
      <section id="faculty-eval" class="faculty-section" hidden>
        <button type="button" class="btn btn-ghost" id="faculty-eval-back">← Back to queue</button>
        <h2 id="faculty-eval-title"></h2>
        <div class="faculty-eval-grid">
          <div class="card" id="faculty-eval-items">
            <h3>Submitted Load</h3>
            <div id="faculty-items-list"></div>
            <div class="faculty-add-row">
              <select id="faculty-add-subject" aria-label="Add a subject"></select>
              <input type="text" id="faculty-add-note" placeholder="Reason for adding (required)" />
              <button type="button" class="btn btn-primary" id="faculty-add-btn">Add</button>
            </div>
            <div class="faculty-decisions">
              <button type="button" class="btn btn-primary" id="faculty-approve-btn">Approve & Enroll</button>
              <button type="button" class="btn btn-ghost" id="faculty-return-btn">Return for Changes</button>
              <button type="button" class="btn btn-ghost" id="faculty-reject-btn">Reject</button>
            </div>
          </div>
          <div class="card" id="faculty-eval-prospectus">
            <h3>Prospectus Progress</h3>
            <div id="faculty-prospectus-body"></div>
          </div>
          <div class="card" id="faculty-eval-history">
            <h3>Academic History</h3>
            <div id="faculty-history-body"></div>
          </div>
        </div>
      </section>

      <!-- All faculty: approved loads (SA encoding queue) -->
      <section id="faculty-approved" class="faculty-section">
        <h2>Approved Loads</h2>
        <p class="muted">Final loads ready for institutional encoding. Mark each one when done.</p>
        <div id="faculty-approved-list"></div>
      </section>

      <!-- Dean: read-only dashboard -->
      <section id="faculty-dean" class="faculty-section">
        <h2>Dean Overview</h2>
        <div id="faculty-dean-body"></div>
      </section>
    </main>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script src="js/config.js?v=5.3"></script>
  <script src="js/auth.js?v=5.4"></script>
  <script src="js/api.js?v=5.3"></script>
  <script src="js/ui.js?v=5.7"></script>
  <script src="js/faculty/faculty.js?v=1.0"></script>
</body>
</html>
```

Add `.faculty-*` CSS to `client/styles/main.css` following the existing conventions (gate centered, topbar flex, `.faculty-eval-grid` 3 columns on desktop → 1 under 900px, card reuse). Keep it compact.

- [ ] **Step 2: Create `client/js/faculty/faculty.js`**

```js
// =============================================
// faculty.js - Faculty portal (Phase B).
// Roles: program_head (queue + evaluation), faculty/SA (approved loads,
// mark encoded), dean (read-only overview). Admin sees everything.
// =============================================
const FacultyPortal = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS_LABELS = { draft: 'Draft', submitted: 'Submitted', under_review: 'Under evaluation', approved: 'Approved', returned: 'Returned', rejected: 'Rejected' };

  let profile = null;
  let currentSubmission = null;
  let detail = null; // { submission, history, prerequisites }

  const isHead = () => profile?.role === 'program_head' || profile?.role === 'admin';
  const isDean = () => profile?.role === 'dean' || profile?.role === 'admin';

  async function boot() {
    profile = await window.Auth?.getProfile?.().catch(() => null);
    if (!profile || !['faculty', 'program_head', 'dean', 'admin'].includes(profile.role)) return; // gate stays visible
    document.getElementById('faculty-gate').hidden = true;
    document.getElementById('faculty-app').hidden = false;
    document.getElementById('faculty-user-line').textContent =
      `${profile.full_name || profile.email} · ${profile.role === 'program_head' ? `Program Head (${profile.course})` : profile.role}`;

    if (isHead()) { await loadQueue(); document.getElementById('faculty-queue').hidden = false; }
    else { document.getElementById('faculty-queue').hidden = true; }
    await loadApproved();
    if (isDean()) { document.getElementById('faculty-dean').hidden = false; await loadDean(); }
  }

  async function loadQueue() {
    const { submissions } = await Api.faculty.submissions('submitted');
    const { submissions: reviewing } = await Api.faculty.submissions('under_review');
    renderQueueList([...(submissions || []), ...(reviewing || [])]);
  }

  function renderQueueList(list) {
    const el = document.getElementById('faculty-queue-list');
    el.innerHTML = list.length ? list.map(s => `
      <div class="faculty-row" data-open="${s.id}">
        <span><strong>${esc(s.student?.full_name || 'Student')}</strong> · ${esc(s.student?.course || '')} Yr ${esc(s.student?.year_level || '')}</span>
        <span>${(s.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head').length} subjects · ${STATUS_LABELS[s.status]}</span>
        <button type="button" class="btn btn-primary btn-sm">Evaluate</button>
      </div>`).join('') : '<p class="muted">The queue is empty.</p>';
    el.querySelectorAll('[data-open]').forEach(row =>
      row.addEventListener('click', () => openEvaluation(row.dataset.open)));
  }

  async function openEvaluation(id) {
    detail = await Api.faculty.detail(id);
    currentSubmission = detail.submission;
    Api.faculty.open(id).catch(() => {}); // fire-and-forget under_review touch

    const s = detail.submission;
    const active = (s.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');
    document.getElementById('faculty-queue').hidden = true;
    document.getElementById('faculty-eval').hidden = false;
    document.getElementById('faculty-eval-title').textContent =
      `${s.student?.full_name || 'Student'} — ${s.school_year} Sem ${s.semester} (${STATUS_LABELS[s.status]})`;

    const itemsEl = document.getElementById('faculty-items-list');
    itemsEl.innerHTML = (s.enrollment_submission_items || []).map(i => `
      <div class="faculty-item-row ${i.item_state === 'removed_by_head' ? 'faculty-item-removed' : ''}" data-item="${i.id}">
        <span class="mono">${esc(i.subjects?.code)}</span>
        <span>${esc(i.subjects?.title)} (${i.subjects?.units}u)</span>
        ${i.origin === 'grizz' ? `<span class="muted" title="${esc(i.grizz_reason || '')}">Grizz</span>` : ''}
        ${i.item_state === 'added_by_head' ? '<span class="muted">added by head</span>' : ''}
        ${i.item_state === 'removed_by_head' ? `<span class="muted">removed: ${esc(i.head_note || '')}</span>` : ''}
        ${i.item_state !== 'removed_by_head' && s.status !== 'approved' ? `<button type="button" class="btn btn-ghost btn-sm" data-remove="${i.id}">Remove</button>` : ''}
      </div>`).join('');
    itemsEl.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const note = prompt('Reason for removing this subject (required):');
        if (!note) return;
        await Api.faculty.removeItem(s.id, btn.dataset.remove, note);
        await openEvaluation(s.id);
      }));

    // Prospectus + history columns
    const passedBySubject = new Map();
    for (const h of detail.history || []) if (!passedBySubject.has(h.subject_id)) passedBySubject.set(h.subject_id, h);
    const passedIds = new Set([...passedBySubject.values()].filter(h => h.status === 'passed' || (h.lec_status === 'passed' && h.lab_status === 'passed')).map(h => h.subject_id));
    document.getElementById('faculty-prospectus-body').innerHTML = (detail.prerequisites || []).length
      ? 'Curriculum data available below the load for cross-checking.'
      : 'No curriculum data.';
    document.getElementById('faculty-history-body').innerHTML = (detail.history || []).length
      ? detail.history.slice(0, 40).map(h => `<div class="faculty-history-row"><span class="mono">${esc(h.subjects?.code)}</span><span>${esc(h.status)}${h.grade != null ? ' · ' + h.grade : ''}</span></div>`).join('')
      : '<p class="muted">No academic history yet.</p>';

    // Add-subject picker: same program subjects not already in the load
    const inLoad = new Set((s.enrollment_submission_items || []).map(i => i.subject_id));
    document.getElementById('faculty-add-subject').innerHTML = '<option value="">— subject —</option>';

    document.getElementById('faculty-approve-btn').onclick = async () => {
      if (!confirm('Approving enrolls these subjects for the student now. Continue?')) return;
      const r = await Api.faculty.approve(s.id);
      if (r.alreadyApproved) { alert('Already approved.'); return; }
      backToQueue();
    };
    document.getElementById('faculty-return-btn').onclick = async () => {
      const notes = prompt('Notes for the student (required):');
      if (!notes) return;
      await Api.faculty.return(s.id, notes);
      backToQueue();
    };
    document.getElementById('faculty-reject-btn').onclick = async () => {
      const notes = prompt('Reason for rejection (required):');
      if (!notes) return;
      await Api.faculty.reject(s.id, notes);
      backToQueue();
    };
  }

  function backToQueue() {
    document.getElementById('faculty-eval').hidden = true;
    document.getElementById('faculty-queue').hidden = false;
    loadQueue(); loadApproved();
  }

  async function loadApproved() {
    const { submissions } = await Api.faculty.submissions('approved');
    const el = document.getElementById('faculty-approved-list');
    el.innerHTML = (submissions || []).map(s => `
      <div class="faculty-row">
        <span><strong>${esc(s.student?.full_name || 'Student')}</strong> · ${esc(s.school_year)} Sem ${s.semester}</span>
        <span>${(s.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head').length} subjects${s.encoded_at ? ' · ✓ encoded' : ''}</span>
        <span class="faculty-row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-export="${s.id}">Export Excel</button>
          ${!s.encoded_at ? `<button type="button" class="btn btn-primary btn-sm" data-encoded="${s.id}">Mark Encoded</button>` : ''}
        </span>
      </div>`).join('') || '<p class="muted">No approved loads yet.</p>';
    el.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', async () => {
      const blob = await Api.faculty.exportBlob(b.dataset.export);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `approved-load-${b.dataset.export}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    }));
    el.querySelectorAll('[data-encoded]').forEach(b => b.addEventListener('click', async () => {
      await Api.faculty.markEncoded(b.dataset.encoded);
      loadApproved();
    }));
  }

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
      ${Object.entries(byProgram).map(([p, counts]) => `<p><strong>${esc(p)}</strong>: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}</p>`).join('')}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('faculty-eval-back')?.addEventListener('click', backToQueue);
    document.getElementById('faculty-add-btn')?.addEventListener('click', async () => {
      const subjectId = document.getElementById('faculty-add-subject').value;
      const note = document.getElementById('faculty-add-note').value.trim();
      if (!subjectId) return alert('Choose a subject.');
      if (!note) return alert('A reason is required when adding a subject.');
      await Api.faculty.addItem(currentSubmission.id, subjectId, note);
      openEvaluation(currentSubmission.id);
    });
  });

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => FacultyPortal.boot());
```

(The add-subject dropdown population is intentionally left to the editable program's checklist — in `openEvaluation`, populate `#faculty-add-subject` from `Api.units.checklists(submission.student?.course)` subjects not already in the load. This is a two-line addition inside `openEvaluation` — implement it there rather than in the picker stub shown above.)

- [ ] **Step 3: Add the vercel.json mapping**

Insert between the feedback entries and the catch-all in `vercel.json`:

```json
    { "src": "/faculty", "dest": "client/faculty.html" },
```

- [ ] **Step 4: Write + run the smoke test**

Create `scripts/smoke-test-faculty-ui.js`:

```js
// Static wiring checks for the faculty portal. Run: node scripts/smoke-test-faculty-ui.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client', 'faculty.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'client', 'js', 'faculty', 'faculty.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('page has gate + app shells', html.includes('faculty-gate') && html.includes('faculty-app'));
check('all three sections present', ['faculty-queue', 'faculty-approved', 'faculty-dean'].every(id => html.includes(id)));
check('evaluation view with three columns', html.includes('faculty-eval-prospectus') && html.includes('faculty-eval-history'));
check('loads faculty.js', html.includes('js/faculty/faculty.js'));
check('module boots on DOMContentLoaded', /FacultyPortal\.boot\(\)/.test(js));
check('role gating (head vs dean vs faculty)', /isHead/.test(js) && /isDean/.test(js));
check('grizz reason surfaced on items', /grizz_reason/.test(js));
check('approve confirm dialog present', /confirm\(/.test(js));
check('vercel routes /faculty', vercel.routes.some(r => r.src === '/faculty' && r.dest === 'client/faculty.html'));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll faculty UI wiring checks passed');
```

Run it plus `node --check client/js/faculty/faculty.js`.

- [ ] **Step 5: Commit**

```bash
git add client/faculty.html client/js/faculty/faculty.js client/styles/main.css vercel.json scripts/smoke-test-faculty-ui.js
git commit -m "feat(faculty-portal): /faculty page - evaluation queue, three-column evaluation, SA encoding queue, dean overview"
```

---

### Task 9: Docs + full smoke suite

**Files:**
- Modify: `docs/DATABASE.md` (migration 034 section, same pattern as the 031 section)
- Test: the full suite

- [ ] **Step 1: Add the DATABASE.md section**

After the existing migration 031 section, add:

```markdown
## Migration 034 (Phase B: faculty roles + enrollment submissions)

- File: `supabase/migrations/034_faculty_roles_and_submissions.sql`. Additive
  and re-runnable (guarded constraints, DROP-first policies).
- Adds roles `faculty`, `program_head`, `dean`; tables
  `enrollment_submissions` / `enrollment_submission_items`; SQL helpers
  `is_faculty()`, `is_dean_or_admin()`, `is_program_head_for(uuid)`.
- Widens `notifications.target_role` for the new roles.
- Program heads bind to a program via `profiles.course`; dean is viewer-only.
- Apply via the SQL editor, then deploy server + client together.
```

- [ ] **Step 2: Run the full suite**

```bash
node scripts/smoke-test-migration-034.js && \
node scripts/smoke-test-enrollment-lib.js && \
node scripts/smoke-test-enrollment-routes.js && \
node scripts/smoke-test-faculty-routes.js && \
node scripts/smoke-test-faculty-decisions.js && \
node scripts/smoke-test-api-groups.js && \
node scripts/smoke-test-enrollment-ui.js && \
node scripts/smoke-test-faculty-ui.js && \
node scripts/smoke-test-curriculum-lib.js && \
node scripts/smoke-test-curriculum-routes.js && \
node scripts/smoke-test-curriculum-ui.js && \
node scripts/smoke-test-component-outcomes.js && \
node scripts/smoke-test-component-outcomes-client.js && \
node scripts/smoke-test-units-api-enrichment.js && \
node scripts/smoke-test-units-fields.js && \
node scripts/smoke-test-standing.js
```
Expected: all pass; no generated artifacts committed (`rm -f scripts/standing-smoke.pdf` if produced).

- [ ] **Step 3: Commit**

```bash
git add docs/DATABASE.md
git commit -m "docs: migration 034 runbook notes for faculty portal and submissions"
```

---

### Task 10: End-to-end browser verification (manual, after migration 034 applied)

**Files:** none (verification only)

- [ ] **Step 1: Verify the DB state** — `SELECT count(*) FROM enrollment_submissions;` → 0; roles widened.
- [ ] **Step 2: Student flow** — as the test student: build a draft in "Load Verification" (incl. a Grizz-hook item via console: `Enrollment.addFromGrizz(subject, 'test reason')`), submit, confirm the program head gets an in-app notification.
- [ ] **Step 3: Program head flow** — as a program head account (role `program_head`, course BSCoE): queue shows the load; the three-column evaluation renders; remove a subject with a reason; approve; confirm `student_units` rows were created for the term (and only once — re-approve is a no-op).
- [ ] **Step 4: SA flow** — as a faculty account: approved load visible; Excel export downloads with the final subject list; mark-encoded sticks.
- [ ] **Step 5: Dean flow** — as a dean account: overview stats render; no decision buttons exist; mutating API calls return 403.
- [ ] **Step 6: Scoping** — a BSCE program head cannot open a BSCoE submission (403).

---

## Spec Coverage Check (self-review)

| Spec requirement | Task |
|---|---|
| Roles faculty/program_head/dean + binding via `profiles.course` | 1, 2 |
| `enrollment_submissions` + items tables, status enums, encoded tracking | 1 |
| RLS (own submissions; program-scoped heads; dean read; admin) | 1 |
| Student draft/submit flow, `origin` + `grizz_reason` from day one | 3, 7 |
| Evaluation queue + three-column evaluation view (items w/ Grizz reasons, prospectus, history) | 4, 8 |
| Head add/remove with required `head_note`; prereq-informed override | 4, 8 |
| Approve → auto-enroll, transactional-safe + idempotent, change-diff notification | 5 |
| Return/reject with notes → student notified | 5 |
| Dean viewer-only dashboard, no action rights | 2, 4, 5, 8 |
| SA approved-loads queue, Excel export, mark-encoded | 5, 8 |
| In-app + Brevo notifications (incl. change diff) | 5 |
| `/faculty` route mapping in vercel.json | 8 |
| Audit logging on all decisions | 3, 4, 5 |
| Scope constraint: no cashier/registrar/payment integration | honored (out of scope) |
| Testing: role matrix, scoping, idempotency, notifications, export | 1-9 smoke suites + Task 10 manual matrix |
