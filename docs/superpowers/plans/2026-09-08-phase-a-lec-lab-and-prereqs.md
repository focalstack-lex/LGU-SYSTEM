# Phase A: Lec/Lab Split & Structured Prerequisites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split subject units into lecture/laboratory components and replace free-text prerequisites with a structured table, seeded and admin-editable.

**Architecture:** Additive migration 031 adds `lec_units`/`lab_units` (CHECK-constrained against `units`) and a `subject_prerequisites` table with SQL parse functions that convert legacy strings into rows. A new admin route group `/api/curriculum` exposes editing; the checklists API gains the structured data; the student checklist, Grizz, and the standing PDF consume it. A Curriculum Manager section in the Officer Console provides lasting admin editing.

**Tech Stack:** PostgreSQL (Supabase, hand-applied SQL migrations), Express, vanilla JS client, PDFKit, node smoke tests (no test framework — plain scripts under `scripts/`).

**Spec:** `docs/superpowers/specs/2026-09-08-lec-lab-and-prereq-structure-design.md`

## Global Constraints

- Work on branch `testfeature/enrollment-automation` (already checked out).
- Migration 031 is **additive only** — no `DROP TABLE`, no column rewrites (`docs/DATABASE.md` warning about migration 005).
- Lab units count **fully**: `units` remains the authoritative total; progress %, curriculum totals, and Grizz's 24-unit cap math must not change.
- The CHECK constraint ships `NOT VALID`; `VALIDATE CONSTRAINT` happens only after the seed script fills every row (Task 2).
- Application code **stops reading** `subjects.prerequisites` for logic (display-only legacy fallback allowed).
- RLS on new tables: SELECT for `authenticated`, writes via `public.is_admin()` only. Server routes use the service key, which bypasses RLS.
- Migrations are applied **manually via the Supabase SQL editor** (per `docs/DATABASE.md` runbook) using `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars for scripts.
- Smoke tests follow the existing `scripts/smoke-test-*.js` conventions and run with plain `node scripts/<name>.js`; exit code non-zero on failure.
- Commit after every task; conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`).

---

### Task 1: Migration 031 — schema, parse functions, RLS, preview report

**Files:**
- Create: `supabase/migrations/031_lec_lab_and_structured_prereqs.sql`
- Create: `scripts/preview-prereq-parse.js`

**Interfaces:**
- Consumes: existing `public.subjects(id, code, program, units, prerequisites)`.
- Produces: columns `subjects.lec_units`, `subjects.lab_units`; constraint `subjects_units_components_check`; table `public.subject_prerequisites`; SQL functions `public.split_prereq_tokens(raw)`, `public.parse_prereq_token(subject_row, token)`, `public.preview_prereq_parse()`, `public.apply_prereq_parse()`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/031_lec_lab_and_structured_prereqs.sql`:

```sql
-- =============================================================
-- 031: Phase A - lecture/lab unit split + structured prerequisites
-- Additive only: no drops, no data rewrites.
-- Rollout: apply -> preview parse report -> seed lec/lab (Task 2)
--          -> VALIDATE CONSTRAINT -> deploy -> fix flagged tokens
-- =============================================================

-- =============================================
-- 1. LEC/LAB COLUMNS
-- =============================================
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS lec_units SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_units SMALLINT NOT NULL DEFAULT 0;

-- units = lec + lab. NOT VALID: existing rows (defaults 0+0) are exempt
-- until the seed script fills them; new/updated rows are checked immediately.
ALTER TABLE public.subjects
  DROP CONSTRAINT IF EXISTS subjects_units_components_check;
ALTER TABLE public.subjects
  ADD CONSTRAINT subjects_units_components_check
  CHECK (units = lec_units + lab_units) NOT VALID;

-- =============================================
-- 2. STRUCTURED PREREQUISITES
-- =============================================
CREATE TABLE IF NOT EXISTS public.subject_prerequisites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  depends_on_subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prerequisite','corequisite','year_standing','special')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One dependency per row, even when depends_on_subject_id is null.
CREATE UNIQUE INDEX IF NOT EXISTS subject_prerequisites_unique
  ON public.subject_prerequisites (
    subject_id, kind,
    COALESCE(depends_on_subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(detail, '')
  );
CREATE INDEX IF NOT EXISTS subject_prerequisites_subject_idx
  ON public.subject_prerequisites (subject_id);
CREATE INDEX IF NOT EXISTS subject_prerequisites_depends_idx
  ON public.subject_prerequisites (depends_on_subject_id);

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE public.subject_prerequisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prereqs viewable by authenticated"
  ON public.subject_prerequisites FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Only admins can insert prereqs"
  ON public.subject_prerequisites FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Only admins can update prereqs"
  ON public.subject_prerequisites FOR UPDATE USING (public.is_admin());

CREATE POLICY "Only admins can delete prereqs"
  ON public.subject_prerequisites FOR DELETE USING (public.is_admin());

-- =============================================
-- 4. LEGACY STRING PARSER
-- =============================================

-- Split a legacy prerequisites string into candidate tokens.
-- '/' is treated as a separator too (e.g. '*240 hours / 4th Yr Standing').
CREATE OR REPLACE FUNCTION public.split_prereq_tokens(raw TEXT)
RETURNS SETOF TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(t)
  FROM unnest(
    string_to_array(
      regexp_replace(COALESCE(raw, ''), '\s*/\s*', ';', 'g'),
      ';'
    )
  ) AS t
  WHERE btrim(t) <> ''
    AND upper(btrim(t)) NOT IN ('NONE', '-')
$$;

-- Classify + resolve one token into a structured row shape.
-- Code resolution: same program first, then any program (spec ambiguity rule).
-- First matching UNION branch wins (LIMIT 1 on the outer query).
CREATE OR REPLACE FUNCTION public.parse_prereq_token(
  p_subject public.subjects,
  p_token TEXT
)
RETURNS TABLE (kind TEXT, depends_on_subject_id UUID, detail TEXT)
LANGUAGE sql STABLE AS $$
  SELECT kind, depends_on_subject_id, detail FROM (

    -- co-requisite: "Co-req CpE 223", "Co-requisite: EMath 121"
    SELECT 'corequisite'::TEXT, dep.id, NULL::TEXT
    FROM (SELECT regexp_replace(p_token, '^.*co-?req(uisite)?\s*:?\s*', '', 'i') AS code) c
    LEFT JOIN LATERAL (
      SELECT s2.id FROM public.subjects s2
      WHERE upper(btrim(s2.code)) = upper(btrim(c.code))
      ORDER BY (s2.program = p_subject.program) DESC, s2.id
      LIMIT 1
    ) dep ON true
    WHERE p_token ~* 'co-?req'

    UNION ALL

    -- year standing: "2nd Yr Standing"
    SELECT 'year_standing'::TEXT, NULL::UUID, btrim(p_token)
    WHERE p_token !~* 'co-?req'
      AND p_token ~* '\d+\s*Yr\s*Standing'

    UNION ALL

    -- resolvable subject code
    SELECT 'prerequisite'::TEXT, dep.id, NULL::TEXT
    FROM LATERAL (
      SELECT s2.id FROM public.subjects s2
      WHERE upper(btrim(s2.code)) = upper(btrim(p_token))
        AND p_token !~* 'co-?req'
        AND p_token !~* 'standing'
        AND p_token !~* '\d+\s*(hours|hrs)'
      ORDER BY (s2.program = p_subject.program) DESC, s2.id
      LIMIT 1
    ) dep
    WHERE dep.id IS NOT NULL

    UNION ALL

    -- anything unresolvable lands as special (flagged in the report)
    SELECT 'special'::TEXT, NULL::UUID, btrim(p_token)
    WHERE p_token !~* 'co-?req'
      AND p_token !~* 'standing'

  ) parsed
  LIMIT 1
$$;

-- Dry run: every legacy token and how it maps. Nothing is written.
CREATE OR REPLACE FUNCTION public.preview_prereq_parse()
RETURNS TABLE (
  subject_code TEXT, program TEXT, raw_token TEXT,
  kind TEXT, depends_on_code TEXT, detail TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT s.code, s.program, t.token, p.kind, d.code, p.detail
  FROM public.subjects s
  CROSS JOIN LATERAL public.split_prereq_tokens(s.prerequisites) t
  CROSS JOIN LATERAL public.parse_prereq_token(s, t.token) p
  LEFT JOIN public.subjects d ON d.id = p.depends_on_subject_id
  WHERE s.prerequisites IS NOT NULL AND btrim(s.prerequisites) <> ''
$$;

-- Apply: insert parsed rows. Idempotent (unique index absorbs re-runs).
CREATE OR REPLACE FUNCTION public.apply_prereq_parse()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE inserted integer;
BEGIN
  INSERT INTO public.subject_prerequisites (subject_id, depends_on_subject_id, kind, detail)
  SELECT s.id, p.depends_on_subject_id, p.kind, p.detail
  FROM public.subjects s
  CROSS JOIN LATERAL public.split_prereq_tokens(s.prerequisites) t
  CROSS JOIN LATERAL public.parse_prereq_token(s, t.token) p
  WHERE s.prerequisites IS NOT NULL AND btrim(s.prerequisites) <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;
```

- [ ] **Step 2: Write the preview report script**

Create `scripts/preview-prereq-parse.js` (same credential pattern as `scripts/apply-tracker-schema.js`):

```js
// Dry-run report for migration 031's legacy prereq parser.
// Prints every token mapping and highlights 'special' rows that need
// manual fix-up in the Curriculum Manager. Read-only.
// Run: node scripts/preview-prereq-parse.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('❌ Supabase credentials missing (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  process.exit(1);
}
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.rpc('preview_prereq_parse');
  if (error) {
    console.error('❌ preview_prereq_parse failed (is migration 031 applied?):', error.message);
    process.exit(1);
  }

  const kinds = { prerequisite: 0, corequisite: 0, year_standing: 0, special: 0 };
  for (const row of data) kinds[row.kind] = (kinds[row.kind] || 0) + 1;

  console.log(`\n=== PREREQ PARSE REPORT: ${data.length} tokens across all subjects ===`);
  console.log(`prerequisite: ${kinds.prerequisite} | corequisite: ${kinds.corequisite} | year_standing: ${kinds.year_standing} | special (flagged): ${kinds.special}\n`);

  const flagged = data.filter(r => r.kind === 'special');
  if (flagged.length) {
    console.log('⚠️  Tokens needing manual fix-up (landed as "special"):');
    for (const r of flagged) console.log(`   [${r.program}] ${r.subject_code}: "${r.raw_token}"`);
    console.log('');
  }

  console.log('Full mapping:');
  for (const r of data) {
    const resolved = r.depends_on_code ? ` -> ${r.depends_on_code}` : (r.detail ? ` -> "${r.detail}"` : '');
    console.log(`   [${r.program}] ${r.subject_code}: "${r.raw_token}" (${r.kind})${resolved}`);
  }
}

run();
```

- [ ] **Step 3: Apply the migration**

Apply `supabase/migrations/031_lec_lab_and_structured_prereqs.sql` in the Supabase SQL editor (hand-applied per `docs/DATABASE.md`). Verify: `SELECT count(*) FROM public.subject_prerequisites;` returns `0`, and `\d subjects` shows the two new columns.

- [ ] **Step 4: Generate and review the parse report**

Run: `node scripts/preview-prereq-parse.js`
Expected: a report listing every legacy token. `prerequisite` rows resolve to codes; `co-req` tokens become `corequisite`; `Nth Yr Standing` tokens become `year_standing`; everything else is flagged `special` with its raw text. **Save this output** — the flagged tokens are the Curriculum Manager fix-up list.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/031_lec_lab_and_structured_prereqs.sql scripts/preview-prereq-parse.js
git commit -m "feat(db): migration 031 - lec/lab columns, structured prerequisites, legacy parser with dry-run report"
```

---

### Task 2: Lec/lab seed script + VALIDATE CONSTRAINT

**Files:**
- Create: `scripts/lec-lab-seed.json`
- Create: `scripts/seed-lec-lab.js`

**Interfaces:**
- Consumes: `subjects.lec_units` / `lab_units` / `units` (Task 1), env `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`.
- Produces: filled `lec_units`/`lab_units` for **every** subject row (unmapped → `lec = units, lab = 0`), so `VALIDATE CONSTRAINT subjects_units_components_check` passes. Known splits live in `scripts/lec-lab-seed.json` — the user supplies values (e.g., EChem 121 = `[3, 1]`).

- [ ] **Step 1: Create the seed map JSON**

Create `scripts/lec-lab-seed.json` — `global` applies to every program; `programs` overrides per program code (values are `[lec, lab]`):

```json
{
  "global": {
    "EChem 111": [3, 1],
    "EChem 121": [3, 1]
  },
  "programs": {}
}
```

(Add more entries as the user supplies them; anything absent defaults to all-lecture.)

- [ ] **Step 2: Write the seed script**

Create `scripts/seed-lec-lab.js`:

```js
// Seeds subjects.lec_units / lab_units from lec-lab-seed.json.
// Every subject gets values: mapped codes use the map, all others default
// to lec = units, lab = 0. Idempotent - safe to re-run.
// Run: node scripts/seed-lec-lab.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('❌ Supabase credentials missing (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  process.exit(1);
}
const supabase = createClient(url, key);

const seedMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'lec-lab-seed.json'), 'utf8'));

function lookup(code, program) {
  const perProgram = seedMap.programs?.[program]?.[code];
  if (perProgram) return perProgram;
  return seedMap.global?.[code] || null;
}

async function run() {
  const { data: subjects, error } = await supabase.from('subjects').select('id, code, program, units');
  if (error) { console.error('❌ Failed to load subjects:', error.message); process.exit(1); }

  let mapped = 0, defaulted = 0, failed = 0;
  for (const s of subjects) {
    const split = lookup(s.code, s.program);
    const lec = split ? Number(split[0]) : Number(s.units);
    const lab = split ? Number(split[1]) : 0;
    if (lec + lab !== Number(s.units)) {
      console.error(`❌ [${s.program}] ${s.code}: seed ${lec}+${lab} != units ${s.units} - SKIPPED`);
      failed++;
      continue;
    }
    const { error: upErr } = await supabase
      .from('subjects')
      .update({ lec_units: lec, lab_units: lab })
      .eq('id', s.id);
    if (upErr) { console.error(`❌ [${s.program}] ${s.code}: ${upErr.message}`); failed++; continue; }
    split ? mapped++ : defaulted++;
  }

  console.log(`\n=== LEC/LAB SEED SUMMARY ===`);
  console.log(`subjects: ${subjects.length} | from map: ${mapped} | defaulted (lec=units, lab=0): ${defaulted} | failed/skipped: ${failed}`);

  // Only safe to validate once failed === 0.
  if (failed === 0) {
    console.log(`\nNEXT STEP - run in the Supabase SQL editor:`);
    console.log(`  ALTER TABLE public.subjects VALIDATE CONSTRAINT subjects_units_components_check;`);
  } else {
    console.log('\n⚠️  Fix the failed rows above and re-run before validating the constraint.');
    process.exit(1);
  }
}

run();
```

- [ ] **Step 3: Run the seed script**

Run: `node scripts/seed-lec-lab.js`
Expected: summary shows `failed: 0`, with the two mapped EChem subjects and the rest defaulted.

- [ ] **Step 4: Validate the constraint**

Run in the Supabase SQL editor:

```sql
ALTER TABLE public.subjects VALIDATE CONSTRAINT subjects_units_components_check;
```

Expected: succeeds (proves every row satisfies `units = lec + lab`).

- [ ] **Step 5: Commit**

```bash
git add scripts/lec-lab-seed.json scripts/seed-lec-lab.js
git commit -m "feat(scripts): lec/lab seed with per-program map, defaults, and constraint validation gate"
```

---

### Task 3: Curriculum validation helpers (TDD)

**Files:**
- Create: `server/lib/curriculum.js`
- Test: `scripts/smoke-test-curriculum-lib.js`

**Interfaces:**
- Produces (used by Task 4's routes and Task 9's UI validation):
  - `validateComponentSplit(units, lec, lab)` → `{ ok: true }` or `{ ok: false, error: string }`
  - `validatePrereqRow({ kind, depends_on_subject_id, detail })` → `{ ok: true }` or `{ ok: false, error: string }`
  - `PREREQ_KINDS` → `['prerequisite','corequisite','year_standing','special']`

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-curriculum-lib.js` (this lib is dependency-free, so the test `require`s it directly — no vm extraction needed):

```js
// Smoke test for server/lib/curriculum.js pure validators.
// Run: node scripts/smoke-test-curriculum-lib.js
const { validateComponentSplit, validatePrereqRow, PREREQ_KINDS } = require('../server/lib/curriculum');

let failed = 0;
function check(label, got, ok) {
  if (got === ok) console.log(`PASS ${label}`);
  else { failed++; console.log(`FAIL ${label}`); }
}

// validateComponentSplit
check('split 3+1=4 passes', validateComponentSplit(4, 3, 1).ok, true);
check('split 4+0=4 passes', validateComponentSplit(4, 4, 0).ok, true);
check('split 2+1!=4 rejected', validateComponentSplit(4, 2, 1).ok, false);
check('split negative rejected', validateComponentSplit(4, -1, 5).ok, false);
check('split non-integer rejected', validateComponentSplit(4, 1.5, 2.5).ok, false);
check('split string numbers coerced', validateComponentSplit('4', '3', '1').ok, true);
check('split error message mentions total', /total units/.test(validateComponentSplit(4, 2, 1).error), true);

// validatePrereqRow
check('prereq with subject passes', validatePrereqRow({ kind: 'prerequisite', depends_on_subject_id: 'x' }).ok, true);
check('prereq without subject rejected', validatePrereqRow({ kind: 'prerequisite' }).ok, false);
check('coreq with subject passes', validatePrereqRow({ kind: 'corequisite', depends_on_subject_id: 'x' }).ok, true);
check('coreq without subject rejected', validatePrereqRow({ kind: 'corequisite', detail: 'y' }).ok, false);
check('prereq with detail rejected', validatePrereqRow({ kind: 'prerequisite', depends_on_subject_id: 'x', detail: 'y' }).ok, false);
check('year_standing with detail passes', validatePrereqRow({ kind: 'year_standing', detail: '2nd Yr Standing' }).ok, true);
check('year_standing without detail rejected', validatePrereqRow({ kind: 'year_standing' }).ok, false);
check('special with detail passes', validatePrereqRow({ kind: 'special', detail: '*240 hours' }).ok, true);
check('special with subject rejected', validatePrereqRow({ kind: 'special', depends_on_subject_id: 'x', detail: 'y' }).ok, false);
check('unknown kind rejected', validatePrereqRow({ kind: 'banana', detail: 'y' }).ok, false);
check('kinds list intact', JSON.stringify(PREREQ_KINDS), JSON.stringify(['prerequisite', 'corequisite', 'year_standing', 'special']));

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll curriculum lib tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-curriculum-lib.js`
Expected: FAIL — `Cannot find module '../server/lib/curriculum'`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/curriculum.js`:

```js
// =============================================
// server/lib/curriculum.js - Pure validation helpers for the
// Curriculum API. No dependencies so smoke tests can require it directly.
// =============================================
const PREREQ_KINDS = ['prerequisite', 'corequisite', 'year_standing', 'special'];

function validateComponentSplit(units, lec, lab) {
  const u = Number(units);
  const l = Number(lec);
  const b = Number(lab);
  if (!Number.isInteger(l) || !Number.isInteger(b) || l < 0 || b < 0) {
    return { ok: false, error: 'Lecture and laboratory units must be non-negative integers.' };
  }
  if (l + b !== u) {
    return { ok: false, error: `Lecture + laboratory units (${l} + ${b}) must equal the subject's total units (${u}).` };
  }
  return { ok: true };
}

function validatePrereqRow({ kind, depends_on_subject_id, detail }) {
  if (!PREREQ_KINDS.includes(kind)) {
    return { ok: false, error: `Kind must be one of: ${PREREQ_KINDS.join(', ')}.` };
  }
  const hasSubject = Boolean(depends_on_subject_id);
  const hasDetail = typeof detail === 'string' && detail.trim().length > 0;
  if (kind === 'prerequisite' || kind === 'corequisite') {
    if (!hasSubject) {
      return { ok: false, error: 'A prerequisite or corequisite row must reference a subject.' };
    }
    if (hasDetail) {
      return { ok: false, error: 'Only year-standing and special rows carry detail text.' };
    }
  } else {
    if (hasSubject) {
      return { ok: false, error: 'Year-standing and special rows must not reference a subject.' };
    }
    if (!hasDetail) {
      return { ok: false, error: 'A year-standing or special row requires detail text.' };
    }
  }
  return { ok: true };
}

module.exports = { PREREQ_KINDS, validateComponentSplit, validatePrereqRow };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-test-curriculum-lib.js`
Expected: `All curriculum lib tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/curriculum.js scripts/smoke-test-curriculum-lib.js
git commit -m "feat(server): curriculum validation helpers with smoke tests"
```

---

### Task 4: `/api/curriculum` admin routes

**Files:**
- Create: `server/routes/curriculum.js`
- Modify: `server/index.js` (route mounting block, around line 174-179)
- Test: `scripts/smoke-test-curriculum-routes.js`

**Interfaces:**
- Consumes: `validateComponentSplit` / `validatePrereqRow` (Task 3, exact signatures), `requireAdmin` from `server/middleware/roles.js`, `logAudit(userId, action, details)` from `server/lib/audit.js`, `isValidUUID` from `server/lib/validate.js`.
- Produces (consumed by Task 9's UI):
  - `PATCH /api/curriculum/subjects/:id` body `{ lec_units, lab_units }` → `{ ok: true }` | 400/404
  - `GET /api/curriculum/subjects/:id/prerequisites` → `{ prerequisites: [{ id, subject_id, depends_on_subject_id, kind, detail, depends_code }] }`
  - `POST /api/curriculum/prerequisites` body `{ subject_id, kind, depends_on_subject_id?, detail? }` → `{ id }` | 400/409
  - `DELETE /api/curriculum/prerequisites/:id` → `{ ok: true }` | 404

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-curriculum-routes.js` — static wiring checks in the style of `smoke-test-units-fields.js`:

```js
// Static wiring smoke test for the curriculum routes.
// Verifies the route file exists, every endpoint is defined with the right
// verb+path+guard, and mounting is present in server/index.js.
// Run: node scripts/smoke-test-curriculum-routes.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'curriculum.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

let failed = 0;
function check(label, ok) {
  if (ok) console.log(`PASS ${label}`);
  else { failed++; console.log(`FAIL ${label}`); }
}

check('router is admin-guarded (router.use(requireAdmin))', /router\.use\(requireAdmin\)/.test(routeSrc));
check('PATCH /subjects/:id defined', /router\.patch\('\/subjects\/:id'/.test(routeSrc));
check('GET /subjects/:id/prerequisites defined', /router\.get\('\/subjects\/:id\/prerequisites'/.test(routeSrc));
check('POST /prerequisites defined', /router\.post\('\/prerequisites'/.test(routeSrc));
check('DELETE /prerequisites/:id defined', /router\.delete\('\/prerequisites\/:id'/.test(routeSrc));
check('uses validateComponentSplit', /validateComponentSplit\(/.test(routeSrc));
check('uses validatePrereqRow', /validatePrereqRow\(/.test(routeSrc));
check('audit-logs component updates', /CURRICULUM_UPDATE_COMPONENTS/.test(routeSrc));
check('audit-logs prereq creation', /CURRICULUM_ADD_PREREQ/.test(routeSrc));
check('audit-logs prereq deletion', /CURRICULUM_DELETE_PREREQ/.test(routeSrc));
check('handles unique-violation as 409', /23505/.test(routeSrc));
check('mounted in server/index.js', /app\.use\("\/api\/curriculum"/.test(indexSrc));
check('mounted with authMiddleware', /app\.use\("\/api\/curriculum",\s*authMiddleware/.test(indexSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll curriculum route wiring checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-curriculum-routes.js`
Expected: FAIL — `ENOENT ... server/routes/curriculum.js`.

- [ ] **Step 3: Write the route file**

Create `server/routes/curriculum.js`:

```js
// =============================================
// server/routes/curriculum.js - Admin curriculum management (Phase A).
// All routes require admin (service key bypasses RLS server-side).
// =============================================
const express  = require('express');
const supabase = require('../lib/supabase');
const { requireAdmin } = require('../middleware/roles');
const { isValidUUID } = require('../lib/validate');
const { logError } = require('../lib/logger');
const { logAudit } = require('../lib/audit');
const { validateComponentSplit, validatePrereqRow } = require('../lib/curriculum');

const router = express.Router();
router.use(requireAdmin);

// PATCH /api/curriculum/subjects/:id  { lec_units, lab_units }
router.patch('/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }

    const { data: subject, error: fetchErr } = await supabase
      .from('subjects')
      .select('id, code, program, units')
      .eq('id', id)
      .single();
    if (fetchErr || !subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }

    const verdict = validateComponentSplit(subject.units, req.body?.lec_units, req.body?.lab_units);
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.error });
    }

    const lec = Number(req.body.lec_units);
    const lab = Number(req.body.lab_units);
    const { error } = await supabase
      .from('subjects')
      .update({ lec_units: lec, lab_units: lab })
      .eq('id', id);
    if (error) {
      logError('curriculum/subjects/update', error);
      return res.status(500).json({ error: 'Failed to update the subject.' });
    }

    logAudit(req.user.id, 'CURRICULUM_UPDATE_COMPONENTS', {
      subject_id: id, code: subject.code, program: subject.program,
      lec_units: lec, lab_units: lab,
    });
    res.json({ ok: true });
  } catch (err) {
    logError('curriculum/subjects/update', err);
    res.status(500).json({ error: 'Failed to update the subject.' });
  }
});

// GET /api/curriculum/subjects/:id/prerequisites
router.get('/subjects/:id/prerequisites', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }

    const { data, error } = await supabase
      .from('subject_prerequisites')
      .select('id, subject_id, depends_on_subject_id, kind, detail, depends:depends_on_subject_id(code)')
      .eq('subject_id', id)
      .order('id', { ascending: true });
    if (error) {
      logError('curriculum/prereqs/list', error);
      return res.status(500).json({ error: 'Failed to load prerequisites.' });
    }

    const prerequisites = (data || []).map(r => ({
      id: r.id,
      subject_id: r.subject_id,
      depends_on_subject_id: r.depends_on_subject_id,
      kind: r.kind,
      detail: r.detail,
      depends_code: r.depends?.code || null,
    }));
    res.json({ prerequisites });
  } catch (err) {
    logError('curriculum/prereqs/list', err);
    res.status(500).json({ error: 'Failed to load prerequisites.' });
  }
});

// POST /api/curriculum/prerequisites
// { subject_id, kind, depends_on_subject_id?, detail? }
router.post('/prerequisites', async (req, res) => {
  try {
    const { subject_id, kind, depends_on_subject_id, detail } = req.body || {};
    if (!isValidUUID(subject_id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }
    if (depends_on_subject_id && !isValidUUID(depends_on_subject_id)) {
      return res.status(400).json({ error: 'Invalid dependency subject id.' });
    }

    const verdict = validatePrereqRow({ kind, depends_on_subject_id, detail });
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.error });
    }

    const { data, error } = await supabase
      .from('subject_prerequisites')
      .insert({
        subject_id,
        kind,
        depends_on_subject_id: depends_on_subject_id || null,
        detail: detail ? detail.trim() : null,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That prerequisite row already exists for this subject.' });
      }
      logError('curriculum/prereqs/create', error);
      return res.status(500).json({ error: 'Failed to add the prerequisite.' });
    }

    logAudit(req.user.id, 'CURRICULUM_ADD_PREREQ', {
      subject_id, prereq_id: data.id, kind,
      depends_on_subject_id: depends_on_subject_id || null,
      detail: detail || null,
    });
    res.status(201).json({ id: data.id });
  } catch (err) {
    logError('curriculum/prereqs/create', err);
    res.status(500).json({ error: 'Failed to add the prerequisite.' });
  }
});

// DELETE /api/curriculum/prerequisites/:id
router.delete('/prerequisites/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid prerequisite id.' });
    }

    const { data, error } = await supabase
      .from('subject_prerequisites')
      .delete()
      .eq('id', id)
      .select('id')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Prerequisite row not found.' });
    }

    logAudit(req.user.id, 'CURRICULUM_DELETE_PREREQ', { prereq_id: id });
    res.json({ ok: true });
  } catch (err) {
    logError('curriculum/prereqs/delete', err);
    res.status(500).json({ error: 'Failed to remove the prerequisite.' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router**

In `server/index.js`, add the require next to the other route requires (near line 13):

```js
const curriculumRouter = require("./routes/curriculum");
```

and in the mounting block (after the `/api/units` line, around line 176):

```js
app.use("/api/curriculum",    authMiddleware, onlyWrites(writeLimiter), curriculumRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node scripts/smoke-test-curriculum-routes.js`
Expected: `All curriculum route wiring checks passed`.

- [ ] **Step 6: Verify against a running server (manual)**

Start the server (`npm run dev` or per README), then with a valid admin Supabase session token:
- `PATCH /api/curriculum/subjects/<echem-121-id>` with `{ "lec_units": 2, "lab_units": 1 }` → 400 mentioning "must equal the subject's total units".
- Repeat with `{ "lec_units": 3, "lab_units": 1 }` → `{ "ok": true }`.
- Non-admin token on the same PATCH → 403 `Admin privileges required.`

- [ ] **Step 7: Commit**

```bash
git add server/routes/curriculum.js server/index.js scripts/smoke-test-curriculum-routes.js
git commit -m "feat(server): admin /api/curriculum routes for lec/lab editing and prerequisite rows"
```

---

### Task 5: Checklists + /my API enrichment

**Files:**
- Modify: `server/routes/units.js` — `GET /checklists` (lines ~59-91) and `GET /my` (lines ~93-115)
- Test: `scripts/smoke-test-units-api-enrichment.js`

**Interfaces:**
- Consumes: `subject_prerequisites` table (Task 1).
- Produces (consumed by Tasks 6, 7, 9):
  - `GET /api/units/checklists` response gains a third key: `{ requirements, subjects, prerequisites }` where `prerequisites` is `[{ id, subject_id, kind, detail, depends_code }]` (`depends_code` = the dependency subject's code, null for year_standing/special).
  - `GET /api/units/my` rows now include `subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester)`.
  - Graceful degradation: if `subject_prerequisites` is missing (migration not applied), `prerequisites` is `[]` and the error is logged — checklists must never 503 over the new table.

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-units-api-enrichment.js`:

```js
// Static wiring checks: checklists returns structured prereqs with graceful
// degradation, and /my joins the lec/lab columns.
// Run: node scripts/smoke-test-units-api-enrichment.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'server', 'routes', 'units.js'), 'utf8');

let failed = 0;
function check(label, ok) {
  if (ok) console.log(`PASS ${label}`);
  else { failed++; console.log(`FAIL ${label}`); }
}

const checklistBlock = src.slice(src.indexOf("router.get('/checklists'"), src.indexOf("router.get('/my'"));

check('checklists fetches subject_prerequisites', /from\('subject_prerequisites'\)/.test(checklistBlock));
check('checklists selects depends_on_subject_id code', /depends_on_subject_id\(code\)/.test(checklistBlock));
check('checklists response includes prerequisites key', /prerequisites:/.test(checklistBlock));
check('missing prereq table degrades to empty array', /\[\]/.test(checklistBlock.split('isMissingRelation')[1] || checklistBlock));
check('/my join includes lec_units', /lec_units/.test(src.slice(src.indexOf("router.get('/my'"), src.indexOf("router.get('/standing'"))));
check('/my join includes lab_units', /lab_units/.test(src.slice(src.indexOf("router.get('/my'"), src.indexOf("router.get('/standing'"))));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll units API enrichment checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test-units-api-enrichment.js`
Expected: FAIL on the first checks.

- [ ] **Step 3: Modify GET /checklists**

In `server/routes/units.js`, replace the checklists handler's fetch/response portion (the `Promise.all` and final `res.json`) with:

```js
    const [reqRes, subjRes, prereqRes] = await Promise.all([
      reqQuery,
      subjQuery,
      supabase
        .from('subject_prerequisites')
        .select('id, subject_id, depends_on_subject_id, kind, detail, depends_on_subject_id(code)')
        .order('id', { ascending: true }),
    ]);
    if (reqRes.error || subjRes.error) {
      if (isMissingRelation(reqRes.error || subjRes.error)) {
        return res.status(503).json({ error: 'The credit unit tracker is not set up yet. Please run the 005_credit_unit_tracker.sql migration in the Supabase SQL console.' });
      }
      logError('units/checklists', reqRes.error || subjRes.error);
      return res.status(500).json({ error: 'Failed to load the curriculum.' });
    }

    // Graceful degradation: migration 031 not applied yet -> empty prereq list.
    let prerequisites = [];
    if (prereqRes.error) {
      if (!isMissingRelation(prereqRes.error)) {
        logError('units/checklists/prereqs', prereqRes.error);
      }
    } else {
      prerequisites = (prereqRes.data || []).map(r => ({
        id: r.id,
        subject_id: r.subject_id,
        kind: r.kind,
        detail: r.detail,
        depends_code: r.depends_on_subject_id?.code || null,
      }));
    }

    res.json({ requirements: reqRes.data, subjects: subjRes.data, prerequisites });
```

- [ ] **Step 4: Modify GET /my**

Change the select in the `/my` handler to include the new columns:

```js
      .select('id, school_year, semester, grade, status, created_at, instructor, schedule, subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester)')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node scripts/smoke-test-units-api-enrichment.js`
Expected: `All units API enrichment checks passed`.
Also re-run the older test to confirm no regression: `node scripts/smoke-test-units-fields.js` — expected: still passes.

- [ ] **Step 6: Commit**

```bash
git add server/routes/units.js scripts/smoke-test-units-api-enrichment.js
git commit -m "feat(server): checklists returns structured prerequisites; /my joins lec/lab columns"
```

---

### Task 6: Student checklist UI — lec/lab badge + structured prereqs

**Files:**
- Modify: `client/js/units.js` — `load()` (line ~82), `subjectRow()` (line ~432)
- Modify: `client/css` (the stylesheet used by index.html — locate the `unit-units` rule and add `unit-prereq` additions nearby)

**Interfaces:**
- Consumes: `GET /api/units/checklists` third key `prerequisites` (Task 5), `subjects.lec_units`/`lab_units` (Task 1).
- Produces: internal helper `formatPrereqRows(rows)` → display string; checklist cards show `3 lec / 1 lab` when `lab_units > 0`, otherwise the plain unit count. Legacy `s.prerequisites` string remains the display fallback when no structured rows exist.

- [ ] **Step 1: Store the prereq list in load()**

In `client/js/units.js` `load()`, find where the checklists response is destructured/stored (the call that fills the module-level `subjects`/`requirements` arrays). Keep the prerequisites array alongside them:

```js
    // module scope, next to the existing subjects/requirements declarations:
    let prereqRows = [];
```

and in `load()`, wherever the checklists payload is consumed (destructure the new key):

```js
    const payload = await Api.units.checklists(/* existing args */);
    // ...existing assignments to subjects / requirements...
    prereqRows = payload.prerequisites || [];
```

(Keep the existing variable/assignment style of the file; the only change is capturing `payload.prerequisites`.)

- [ ] **Step 2: Add the format helper**

Add near `subjectRow()`:

```js
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
```

- [ ] **Step 3: Update subjectRow()**

In `subjectRow(s)`, replace the units span and the legacy prereq block:

```js
    const unitsBadge = Number(s.lab_units) > 0
      ? `<span class="unit-units">${Number(s.lec_units)} lec / ${Number(s.lab_units)} lab</span>`
      : `<span class="unit-units">${s.units} unit${s.units === 1 ? '' : 's'}</span>`;

    const structuredPrereq = formatPrereqRows((prereqRows || []).filter(r => r.subject_id === s.id));
    const prereq = structuredPrereq
      ? `<div class="unit-prereq">${esc(structuredPrereq)}</div>`
      : (s.prerequisites
          ? `<div class="unit-prereq">Prerequisite: ${esc(s.prerequisites)}</div>`
          : '');
```

and in the returned template, replace `<div>${esc(s.title)} <span class="unit-units">...</span></div>` with:

```html
          <div>${esc(s.title)} ${unitsBadge}</div>
```

- [ ] **Step 4: Visual verification (manual)**

Load the student portal checklist:
- EChem 121 (seeded 3+1 in Task 2) shows "3 lec / 1 lab".
- All-lecture subjects show their plain unit count exactly as before.
- A subject with legacy prereqs shows the structured form when rows exist; subjects whose tokens were flagged `special` show them under "Notes:".

- [ ] **Step 5: Commit**

```bash
git add client/js/units.js
git commit -m "feat(client): checklist shows lec/lab split and structured prerequisite display"
```

---

### Task 7: Grizz reads structured prerequisites

**Files:**
- Modify: `client/js/ai-assistant.js` — `handleNextSemRecommendations()` (lines ~769-892; the parsing block is ~801-830)

**Interfaces:**
- Consumes: `GET /api/units/checklists` `prerequisites` array (Task 5).
- Produces: internal helper `evaluatePrereqs(subject, prereqsBySubject, passedCodes, enrolledCodes, currentYear)` → `{ satisfied, missing, notes }`. Semantics unchanged (spec table): `prerequisite`/`corequisite` satisfied if passed or currently enrolled; `year_standing` compares the ordinal in `detail` against the profile year level; `special` never auto-satisfied → surfaced as a note. Recommendations display "3+1" for lab subjects.

- [ ] **Step 1: Capture the prereq array where Grizz loads the curriculum**

In `handleNextSemRecommendations()` (and anywhere else Grizz fetches the curriculum via the checklists endpoint), capture the new key into a map:

```js
    // build once per recommendation run, from the checklists payload:
    const prereqsBySubject = new Map();
    for (const r of (payload.prerequisites || [])) {
      if (!prereqsBySubject.has(r.subject_id)) prereqsBySubject.set(r.subject_id, []);
      prereqsBySubject.get(r.subject_id).push(r);
    }
```

(Use the exact local name the function already gives the checklists response; the only change is reading `prerequisites` off it.)

- [ ] **Step 2: Add the structured evaluator**

Add a module-level helper in `GrizzAI`:

```js
  // Structured prerequisite evaluation (migration 031 rows).
  // Legacy free-text fallback keeps the old regex path when the table is empty
  // for a subject, so Grizz never regresses before the migration lands.
  function evaluatePrereqs(subject, prereqsBySubject, passedCodes, enrolledCodes, currentYear) {
    const rows = prereqsBySubject.get(subject.id) || [];
    if (!rows.length) return null; // signal: caller falls back to legacy parsing

    let satisfied = true;
    const missing = [];
    const notes = [];
    for (const row of rows) {
      const depCode = row.depends_code;
      if ((row.kind === 'prerequisite' || row.kind === 'corequisite') && depCode) {
        if (!passedCodes.has(depCode) && !enrolledCodes.has(depCode)) {
          satisfied = false;
          missing.push(depCode);
        }
      } else if (row.kind === 'year_standing' && row.detail) {
        const requiredYr = Number((row.detail.match(/(\d+)/) || [])[1] || 0);
        if (currentYear < requiredYr) {
          satisfied = false;
          missing.push(row.detail);
        }
      } else if (row.kind === 'special' && row.detail) {
        notes.push(row.detail);
      }
    }
    return { satisfied, missing, notes };
  }
```

- [ ] **Step 3: Replace the parsing block in the eligibility loop**

Inside the curriculum filter loop, replace the free-text block (`standingMatch`/`rawTokens`/`satisfies`/`missing`, lines ~801-830) with:

```js
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
      /* ...keep the existing standingMatch / rawTokens code verbatim below... */
```

- [ ] **Step 4: Show the split and notes in the recommendation output**

Wherever the recommendation list renders each subject's units, prefer the split:

```js
  function unitsLabel(s) {
    return Number(s.lab_units) > 0 ? `${s.lec_units}+${s.lab_units} units` : `${s.units} units`;
  }
```

and append `prereqNotes` (if any) to a recommended subject's message text as a small "Note: *240 hours" line.

- [ ] **Step 5: Manual verification (browser)**

With Grizz's drawer open on a student account:
- Recommendations still appear for prereq-cleared subjects (structured path).
- A subject whose prereq was failed and is not enrolled is blocked with the same "Missing prerequisite" message shape.
- A lab subject shows "3+1 units".
- Temporarily returning an empty `prerequisites` from a stubbed response keeps recommendations working via the legacy path.

- [ ] **Step 6: Commit**

```bash
git add client/js/ai-assistant.js
git commit -m "feat(grizz): structured prerequisite evaluation with legacy fallback and lab-aware unit labels"
```

---

### Task 8: Standing PDF — lec/lab split column

**Files:**
- Modify: `server/routes/units.js` — standing report table geometry (~lines 277-286) and row rendering (~line 343)

**Interfaces:**
- Consumes: subject rows (the standing handler already loads subjects; confirm the select includes `lec_units, lab_units` — add them if not).
- Produces: PDF table gains a "LEC/LAB" column showing `3+1` when `lab > 0`, otherwise the plain unit count; total-units column and all summary math unchanged.

- [ ] **Step 1: Update the column geometry**

Replace:

```js
    const cols = { code: 72, title: 126, units: 298, sy: 332, sem: 392, status: 442, grade: 504 };
    const colW = { code: 52, title: 170, units: 32, sy: 58, sem: 48, status: 60, grade: 36 };
```

with:

```js
    const cols = { code: 72, title: 126, split: 298, units: 330, sy: 366, sem: 426, status: 476, grade: 538 };
    const colW = { code: 52, title: 170, split: 30, units: 32, sy: 58, sem: 48, status: 60, grade: 36 };
```

and add the header cell next to the existing `UNITS` header:

```js
      doc.text('LEC/LAB',      cols.split, y + 7, { width: colW.split, align: 'right' });
```

- [ ] **Step 2: Render the split per row**

In the row loop (near line 343), add:

```js
      const splitText = Number(s.lab_units) > 0 ? `${s.lec_units}+${s.lab_units}` : '—';
      doc.text(splitText, cols.split, rowY + 6, { width: colW.split, align: 'right' });
```

(The existing `UNITS` total column keeps printing `s.units` — total math is untouched.)

- [ ] **Step 3: Verify the PDF (manual)**

Run: `node scripts/smoke-test-standing.js`
Expected: still passes (it checks extraction/wiring, not pixels). Then open the standing PDF for a test student with EChem 121: the row shows `3+1` under LEC/LAB, and all columns still fit inside the right margin.

- [ ] **Step 4: Commit**

```bash
git add server/routes/units.js
git commit -m "feat(standing-pdf): lec/lab split column in the academic standing report"
```

---

### Task 9: Curriculum Manager (Officer Console, admin-only)

**Files:**
- Modify: `client/officer.html` — new nav item + section shell (follow the roster section's markup pattern)
- Modify: `client/js/officer/officer-app.js` — section registration + admin-only visibility (follow how the roster section at ~line 226 is registered and gated)
- Modify: `client/js/api.js` — add a `curriculum` group using the file's existing request helper
- Create: `client/js/officer/curriculum.js` — the section module
- Test: `scripts/smoke-test-curriculum-ui.js` (static wiring checks)

**Interfaces:**
- Consumes: Task 4 endpoints (exact paths/payloads), Task 5 checklists `prerequisites`, `requireAdmin`-equivalent client gate (admin role check as done for other admin-only console sections).
- Produces: `CurriculumManager.init()` invoked by `officer-app.js` when the section opens. Program → year → semester grid; inline lec/lab editing; row-based prerequisite editor.

- [ ] **Step 1: Add the API client group**

In `client/js/api.js`, add alongside the existing route groups (reuse the file's existing request helper exactly as the other groups do):

```js
  curriculum: {
    subjects: (program) => request('GET', `/api/units/checklists?program=${encodeURIComponent(program)}`),
    updateComponents: (id, lec_units, lab_units) =>
      request('PATCH', `/api/curriculum/subjects/${id}`, { lec_units, lab_units }),
    prerequisites: (subjectId) =>
      request('GET', `/api/curriculum/subjects/${subjectId}/prerequisites`),
    addPrereq: (payload) => request('POST', '/api/curriculum/prerequisites', payload),
    deletePrereq: (id) => request('DELETE', `/api/curriculum/prerequisites/${id}`),
  },
```

(Adjust `request(...)` to the exact helper signature used by the neighboring groups in the file — the verb/path/payload contract above is the source of truth.)

- [ ] **Step 2: Add the section shell to officer.html**

Inside the console's section container (next to the roster section), add a nav entry labeled **Curriculum** (admin-only, same gating markup the other admin sections use) and:

```html
<section class="console-section" id="curriculum-section" hidden>
  <div class="section-head">
    <h2>Curriculum Manager</h2>
    <p class="section-sub">Edit lecture/laboratory components and prerequisites. Changes are audit-logged.</p>
  </div>
  <div class="curriculum-filters">
    <select id="curriculum-program" aria-label="Program"></select>
    <select id="curriculum-year" aria-label="Year level">
      <option value="">All years</option>
      <option value="1">Year 1</option>
      <option value="2">Year 2</option>
      <option value="3">Year 3</option>
      <option value="4">Year 4</option>
    </select>
    <select id="curriculum-sem" aria-label="Semester">
      <option value="">All semesters</option>
      <option value="1">1st</option>
      <option value="2">2nd</option>
      <option value="3">Summer</option>
    </select>
  </div>
  <div id="curriculum-grid"></div>
  <div id="curriculum-prereq-editor" hidden></div>
</section>
```

- [ ] **Step 3: Write the section module**

Create `client/js/officer/curriculum.js`:

```js
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
```

- [ ] **Step 4: Register the section in officer-app.js**

Following exactly how the roster section is registered and role-gated (roster reference: `client/js/officer/officer-app.js:226`):
- Add the nav-to-section wiring for `curriculum-section`.
- Gate it to `admin` role only (same mechanism other admin-only sections use).
- On first open, call `CurriculumManager.init()` once (guard against double-init).

Add the script tag to `officer.html` **before** `officer-app.js`:

```html
  <script src="js/officer/curriculum.js"></script>
```

- [ ] **Step 5: Add the wiring smoke test**

Create `scripts/smoke-test-curriculum-ui.js`:

```js
// Static wiring checks for the Curriculum Manager.
// Run: node scripts/smoke-test-curriculum-ui.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('client/officer.html');
const app = read('client/js/officer/officer-app.js');
const mod = read('client/js/officer/curriculum.js');
const api = read('client/js/api.js');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('officer.html has curriculum section', html.includes('id="curriculum-section"'));
check('officer.html loads curriculum.js', html.includes('js/officer/curriculum.js'));
check('module exposes init', /return\s*\{\s*init\s*\}/.test(mod));
check('grid renders lec input', /data-lec=/.test(mod));
check('grid renders lab input', /data-lab=/.test(mod));
check('editor handles all four kinds', ['prerequisite', 'corequisite', 'year_standing', 'special'].every(k => mod.includes(`value="${k}"`)));
check('api client has curriculum group', /curriculum:\s*\{/.test(api));
check('api client hits PATCH subjects', /PATCH`,\s*`?\/api\/curriculum\/subjects\/\$\{id\}|'PATCH',\s*`\/api\/curriculum\/subjects/.test(api));
check('officer-app references CurriculumManager', app.includes('CurriculumManager'));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll curriculum UI wiring checks passed');
```

- [ ] **Step 6: Run test, then verify manually**

Run: `node scripts/smoke-test-curriculum-ui.js`
Expected: `All curriculum UI wiring checks passed`.

Manual pass (admin account): open the console → Curriculum → select BSCoE → change EChem 121 lec to 2 → Save → error flash "must equal the subject's total units"; set 3+1 → saved. Edit prerequisites: add a row of each kind, remove one; the summary column updates. Non-admin officer account: section is not visible.

- [ ] **Step 7: Commit**

```bash
git add client/officer.html client/js/officer/officer-app.js client/js/officer/curriculum.js client/js/api.js scripts/smoke-test-curriculum-ui.js
git commit -m "feat(officer-console): Curriculum Manager - lec/lab editing and prerequisite row editor (admin-only)"
```

---

### Task 10: Docs update + full smoke suite

**Files:**
- Modify: `docs/DATABASE.md` — note migration 031 in the runbook section (non-destructive, hand-applied, VALIDATE step) and record the parse-report findings location
- Test: full run of every touched smoke script

- [ ] **Step 1: Update DATABASE.md**

Add a section:

```markdown
## Migration 031 (Phase A: lec/lab + structured prerequisites)

- Additive only. Applied via SQL editor, then `node scripts/preview-prereq-parse.js`
  for the parse report, then `node scripts/seed-lec-lab.js`, then
  `ALTER TABLE public.subjects VALIDATE CONSTRAINT subjects_units_components_check;`
- Tokens flagged `special` in the parse report are fixed up in the Officer
  Console → Curriculum Manager (they stay in the report output until corrected).
- `subjects.prerequisites` (free text) is legacy: kept for reference, not read
  by application logic.
```

- [ ] **Step 2: Run the full smoke suite**

```bash
node scripts/smoke-test-curriculum-lib.js && \
node scripts/smoke-test-curriculum-routes.js && \
node scripts/smoke-test-curriculum-ui.js && \
node scripts/smoke-test-units-api-enrichment.js && \
node scripts/smoke-test-units-fields.js && \
node scripts/smoke-test-standing.js
```
Expected: every script prints its pass line and exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/DATABASE.md
git commit -m "docs: migration 031 runbook notes and legacy prereq column status"
```

---

## Spec Coverage Check (self-review)

| Spec requirement | Task |
|---|---|
| `lec_units`/`lab_units` + CHECK `NOT VALID` | 1 |
| `subject_prerequisites` table + unique rule + RLS | 1 |
| Legacy parser + resolution rule (same program first) | 1 |
| Parse report (nothing silent) | 1 (preview script) |
| Seed script with per-program map + defaults | 2 |
| `VALIDATE CONSTRAINT` after backfill | 2 |
| Admin routes (PATCH subjects, prereq CRUD) + validation + audit | 3, 4 |
| Checklists API gains split + structured prereqs | 5 |
| Checklist UI "3 lec / 1 lab" badge | 6 |
| Grizz structured prereqs, legacy fallback, "3+1" display | 7 |
| Standing PDF split column | 8 |
| Curriculum Manager UI (admin-only, program→year→sem) | 9 |
| Error handling (400 field messages, 409 duplicate, admin-only) | 3, 4 |
| Testing/rollout | 1-2 (DB steps), 4-6, 9-10 (smoke + manual) |
