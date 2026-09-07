# Phase A: Lecture/Lab Unit Split & Structured Prerequisites — Design

- **Date:** 2026-09-08
- **Branch:** `testfeature/enrollment-automation`
- **Status:** Approved design, pending implementation plan

## Context & Roadmap

This spec is **Phase A** of a four-phase enrollment automation initiative. The
decomposition and build order were approved as follows:

| Phase | Scope | Depends on |
|-------|-------|------------|
| **A (this spec)** | Lecture/lab unit split + structured prerequisites | — |
| B | Program Head & Dean approval portals (academic load approval workflow) | A |
| C | Add-to-cart enrollment seeded by Grizz recommendations, submitting into B's approval chain | A, B |
| D | Retake intelligence: student-declared takes per subject feeding Grizz, co-enrollment of a subject with its concurrently-retaken prerequisite | A, C |

Phase A is deliberately scoped so that Phases B–D build on real columns and
referential integrity instead of free-text parsing.

## Problem

1. **Subjects carry a single `units` value.** There is no lecture/laboratory
   distinction (e.g., EChem 121 is really 3 units lecture + 1 unit laboratory),
   so the system cannot display or reason about course components.
2. **Prerequisites are a free-text string** on `subjects.prerequisites`
   (e.g., `'CpE 223; CpE 112'`, `'2nd Yr Standing'`, `'Co-req CpE 223'`,
   `'*240 hours / 4th Yr Standing'`). Grizz regex-parses this at runtime
   (`client/js/ai-assistant.js:801-830`), which is fragile and makes the
   Phase D co-enrollment rule (retaking Cal 1 while enrolling Cal 2)
   practically impossible to build reliably.

## Goals

- Split subject units into lecture and laboratory components with data entry
  and validation.
- Restructure prerequisites into a proper table with referential integrity,
  distinguishing prerequisite / corequisite / year-standing / special gates.
- Give admins a lasting editing surface (Curriculum Manager) rather than a
  one-off seed.
- Preserve all existing unit math (progress %, curriculum totals, Grizz's
  24-unit cap) — the split is richer data, not a behavior change.

## Non-Goals (deferred to later phases)

- Program Head / Dean roles and load approval (Phase B).
- Cart-style enrollment flow (Phase C).
- Retake/attempt counting and co-enrollment-with-retaken-prereq eligibility
  (Phase D).
- Curriculum versioning per school year (rejected as YAGNI; revisit only if
  the curriculum actually starts changing year to year).

## Decisions (from brainstorming)

1. **Build order A → B → C → D** confirmed.
2. **Phase A includes prerequisite restructuring**, not just lec/lab.
3. **Lab units count fully** toward progress, curriculum totals, and the
   24-unit cap. EChem 121 = 3 lec + 1 lab = 4 units, exactly as today.
4. **Data source for the split:** the prospectus (`PROSPECTUS.docx`) contains
   only `code | title | total units | prerequisites` — no lec/lab columns.
   Therefore: admin-editable fields, seeded with the values we know
   (e.g., EChem 121 = 3+1), all remaining subjects defaulting to
   `lec = units, lab = 0`, correctable over time in the UI.
5. **Approach:** real columns + a prerequisite child table + an admin
   Curriculum Manager in the Officer Console (Option 1 of 3; JSONB-only and
   full curriculum versioning were rejected).

## Data Model (migration 031)

### `subjects` — new columns

```sql
ALTER TABLE subjects
  ADD COLUMN lec_units SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN lab_units SMALLINT NOT NULL DEFAULT 0;

-- Consistency, added NOT VALID then VALIDATEd after backfill:
ALTER TABLE subjects
  ADD CONSTRAINT subjects_units_components_check
  CHECK (units = lec_units + lab_units) NOT VALID;
```

- `units` remains the authoritative total. Nothing downstream (progress,
  totals, Grizz cap) changes its math.
- The CHECK constraint makes it impossible for any write path (API, script,
  SQL) to persist an inconsistent split.
- Migration is additive only — no drops, no rewrites (per the migration 005
  destructive-rerun lesson in `docs/DATABASE.md`).

### New table `subject_prerequisites`

```sql
CREATE TABLE subject_prerequisites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  depends_on_subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN
    ('prerequisite','corequisite','year_standing','special')),
  detail TEXT,           -- required for year_standing ('2nd Yr Standing')
                         -- and special ('*240 hours'); null otherwise
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One dependency per row; prevents duplicates even when
-- depends_on_subject_id is null:
CREATE UNIQUE INDEX subject_prerequisites_unique
  ON subject_prerequisites (
    subject_id, kind,
    COALESCE(depends_on_subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(detail, '')
  );

CREATE INDEX subject_prerequisites_subject_idx
  ON subject_prerequisites (subject_id);
CREATE INDEX subject_prerequisites_depends_idx
  ON subject_prerequisites (depends_on_subject_id);
```

Kind semantics (consumed by Grizz in Phase A; by Phases C/D later):

| Kind | Meaning | Satisfaction rule (Phase A, unchanged semantics) |
|------|---------|--------------------------------------------------|
| `prerequisite` | Must be passed (or in progress today) before taking the subject | Passed or currently enrolled |
| `corequisite` | Taken in the same term (e.g., `Co-req CpE 223`) | Passed or enrolled concurrently |
| `year_standing` | Gate on year level (`'2nd Yr Standing'`); number kept in `detail` | `detail` year ≤ profile year level |
| `special` | Anything unresolvable (`'*240 hours'`); carries raw text in `detail` | Never auto-satisfied; surfaced as a note |

### RLS

- `SELECT`: any authenticated user (students need prereqs for Grizz and
  checklists).
- `INSERT` / `UPDATE` / `DELETE`: admins only, via the existing `is_admin()`
  SQL helper (pattern from migration 016).

### Legacy column

`subjects.prerequisites` (free text) is **kept, untouched, but no longer read
by application code**. It remains as historical reference; the Curriculum
Manager displays it read-only under a "legacy" note until confidence in the
structured data is established.

### Code-to-row resolution (ambiguity rule)

Subject codes are unique per program only (`UNIQUE(program, code)`), and the
same code exists as separate rows across programs (e.g., `EMath 111` in both
BSCoE and BSCE). When a legacy prereq token is a code, the parser resolves it
to a subject row by:

1. Matching the code within the **same program** as the subject declaring the
   prereq; then
2. Falling back to **any program** offering that code (same course,
   different program row).

The resolved `subjects.id` is stored in `depends_on_subject_id`.

## Migration & Backfill

1. **Migration 031** runs the DDL above and then best-effort auto-parses every
   non-empty `subjects.prerequisites` string into structured rows:
   - Split on `;`, `,`, `/`.
   - Tokens containing `co-req` / `co-requisite` → `corequisite` row
     (code extracted from the remaining text).
   - Tokens matching `N(st|nd|rd|th) Yr Standing` → `year_standing` row with
     the full text in `detail` and the ordinal number extracted for cheap
     comparison.
   - Tokens that resolve to a subject via the rule above → `prerequisite`
     row.
   - Everything else → `special` row with the raw token in `detail`.
   - Idempotent: re-running inserts nothing new (unique index absorbs
     duplicates).
   - **Nothing fails the migration.** Unresolvable tokens land as `special`
     rows and appear in a parse report.
2. **Parse report:** the migration (or its companion script) prints a report
   listing each legacy string, how it mapped, and every token flagged
   `special`. Nothing is silent.
3. **Lec/lab seed** (`scripts/seed-lec-lab.js`): reads a JSON map of
   code → `[lec, lab]` (per program where the split differs across programs)
   containing the known values (EChem 121 = `[3, 1]`, etc.). Subjects not in
   the map default to `lec = units, lab = 0`. Prints a summary count.
   Validates the CHECK constraint as it goes.
4. **Rollout order:** apply migration 031 (constraint added `NOT VALID`) →
   run parse report → run seed script → `VALIDATE CONSTRAINT
   subjects_units_components_check` on `subjects` → deploy server + client →
   fix flagged tokens in the Curriculum Manager.

## Server API

New route file `server/routes/curriculum.js` mounted under `/api/curriculum`,
guarded by the existing `requireAdmin` middleware for writes:

| Method & path | Purpose | Validation |
|---|---|---|
| `PATCH /api/curriculum/subjects/:id` | Update `lec_units` / `lab_units` | `lec + lab = units`, else 400 with field-level message; non-negative integers |
| `GET /api/curriculum/subjects/:id/prerequisites` | Structured rows for the editor | — |
| `POST /api/curriculum/prerequisites` | Add a dependency row | `kind` whitelist; `depends_on_subject_id` XOR `detail` required as applicable |
| `DELETE /api/curriculum/prerequisites/:id` | Remove a dependency row | — |

- All writes go through the existing audit log (`server/lib/audit.js`).
- Read path for students: the existing `GET /api/units/checklists` response
  gains `lec_units`, `lab_units`, and the structured prerequisite rows per
  subject (no new endpoint needed).

## Curriculum Manager (Officer Console UI)

New **"Curriculum"** section in `officer.html` / `client/js/officer/`,
visible to admins only (the console already role-gates sections).

- Filters: program (BSCoE/BSCE/BSECE) → year level → semester, rendering the
  subject grid for that slice.
- Per subject row: code, title, total units, **editable lec and lab inputs**,
  prerequisite list with row-level editor.
- Prerequisite row editor: kind dropdown → then either a subject dropdown
  (filtered to the same program) or a free-text detail input for
  year-standing/special kinds; rows removable.
- Save flow: client-side check `lec + lab = units` before submit; server
  re-validates; 400s surface inline. Every save is audit-logged.
- The legacy free-text string is shown read-only with a "legacy" label so
  admins can cross-check while fixing flagged tokens.

## Downstream Consumers

- **Student checklist** (`client/js/units.js`): subjects with `lab_units > 0`
  display a "3 lec / 1 lab" badge; all-lecture subjects render exactly as
  today.
- **Grizz** (`client/js/ai-assistant.js`): the regex prereq parser
  (lines ~801–830) is replaced by a read of the structured rows from the
  checklists response. Satisfaction semantics are unchanged in Phase A (table
  above). Recommendations display "3+1" for lab subjects. The architecture is
  what matters here: Phase D's co-enrollment rule plugs into this structure.
- **Academic Standing PDF** (`server/routes/units.js`, PDFKit): the subject
  table gains a lec/lab split column (e.g., "3 / 1").
- **Progress %, curriculum totals, 24-unit cap:** deliberately untouched
  (lab counts fully).

## Error Handling

- Any write that would break `lec + lab = units` is rejected at the DB level
  (CHECK constraint) and at the API level (400) — no silent drift.
- `POST /prerequisites` rejects a `prerequisite`/`corequisite` row without a
  resolvable subject, and a `year_standing`/`special` row without `detail`.
- Unparseable legacy tokens never block the migration; they are surfaced.
- All new endpoints return the error shape used by the existing routes
  (`{ error: message }` with appropriate status codes).

## Testing

- **Parser dry-run report** generated before applying the migration for
  review of every legacy-string → rows mapping.
- **Smoke tests** (pattern: `scripts/smoke-test-units-fields.js`):
  - PATCH lec/lab happy path; rejection when sum ≠ units; rejection for
    non-admin callers.
  - Prerequisite add/delete happy paths; invalid-kind and missing-detail
    rejections.
  - Checklists response includes `lec_units` / `lab_units` / structured
    prereqs.
- **RLS check:** student role cannot write `subject_prerequisites` or the new
  subject columns via the API path.
- **Migration idempotency:** running 031 twice changes nothing the second
  time.

---

## Addendum (2026-09-08): Component-Level Outcomes — pass lab, fail lec (or vice versa)

Approved decision: students can pass one component and fail the other; the
passed component's units bank into progress immediately, and the failed
component is the only thing to retake.

### Data model (migration 033, additive only)

```sql
ALTER TABLE public.student_units
  ADD COLUMN IF NOT EXISTS lec_grade NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS lab_grade NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS lec_status TEXT
    CHECK (lec_status IN ('enrolled','passed','failed','dropped','incomplete')),
  ADD COLUMN IF NOT EXISTS lab_status TEXT
    CHECK (lab_status IN ('enrolled','passed','failed','dropped','incomplete'));
```

- One row per subject per term is retained. Component fields are NULL unless
  the subject has a lab component (`subjects.lab_units > 0`), in which case
  the log/edit UI records each component's status and optional grade.
- Rows without component values behave exactly as today (backward compatible).

### Semantics

- **Full pass** = overall `passed`, or both components `passed`.
- **Partial pass** = exactly one component `passed`. That component's units
  (e.g., the 1-unit lab) count as earned units toward progress immediately.
- **Prerequisite satisfaction (Grizz)**: only a full pass satisfies a
  prerequisite. A partial pass surfaces a "Component Backlog" note
  ("passed the lecture - retake the lab only") instead of the generic
  backlog notice.
- Retake-of-only-the-failed-component enrollment semantics are Phase D
  scope; this addendum covers recording and credit math.

### Touchpoints

1. **Log/Edit modal** (`client/js/units.js`): subjects with `lab_units > 0`
   show separate Lecture and Laboratory status/grade fields; one save writes
   one row. Overall `status` is derived on save: both passed -> `passed`,
   either failed -> `failed`, otherwise stays `enrolled`/`incomplete`.
2. **Checklist badge**: partial records display e.g. `Lec: Passed · Lab: Failed`.
3. **Progress math** (`renderProgress`): earned units per subject = full
   `units` on full pass; otherwise the sum of `lec_units`/`lab_units` for
   components passed; 0 otherwise. Curriculum totals unchanged.
4. **Server** (`server/routes/units.js`): enroll/batch-enroll/update accept
   and sanitize the four component fields; `/my` returns them; the standing
   PDF prints component grades when present (e.g., `1.75 / 5.00`).
5. **Grizz** (`client/js/ai-assistant.js`): `passedCodes` membership requires
   a full pass; partial passes feed the Component Backlog note.

### Testing

Smoke tests cover: component-field sanitization, derived overall status,
earned-units math (full/partial/none), Grizz full-pass gating, and
standing-PDF rendering with component grades.
