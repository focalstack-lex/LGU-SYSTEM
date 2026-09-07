# Phase B: Faculty Portal & Academic Load Approval — Design

- **Date:** 2026-09-08
- **Branch:** `testfeature/enrollment-automation`
- **Status:** Approved design, pending implementation plan
- **Depends on:** Phase A (`2026-09-08-lec-lab-and-prereq-structure-design.md`) — structured prerequisites power the evaluation warnings; lec/lab units appear in evaluation views.

## Context

Today there is no officer approval of academic loads: students self-log
subjects into `student_units`, and the only officer flow is account/roster
verification. Enrollment at the institution is manual: after evaluation,
student assistants encode subjects by hand, students pay at the cashier, and
the registrar encodes subjects into the assessment.

**Scope constraint (explicit decision):** this system serves the **College of
Engineering only**. Cashier, registrar, assessment generation, and payment
are institutional processes outside this system and are *not* included. The
system's job after approval is to make the accepted load instantly visible
and exportable for the student assistants who do the institutional encoding.

## Problem

1. Students wait in line for load evaluation during enrollment.
2. Program heads have no tool to see a student's curriculum, history, and
   proposed load together.
3. Student assistants receive approved loads with no system support — they
   encode blind from paper.
4. No record exists of who evaluated what, or what was changed and why.

## Decisions (from brainstorming)

1. **Faculty umbrella role:** one new `faculty` role; program heads are
   flagged with a program binding; dean is a separate elevated role.
2. **Program heads per program:** CPE (BSCoE), ECE (BSECE), CE (BSCE) —
   matching the three programs in `curriculum_requirements`. Binding reuses
   the existing `profiles.course` column.
3. **Dean is viewer-only for now** — no approval rights; escalation rules can
   be added later without rework.
4. **Approval auto-enrolls:** approving a load creates the `student_units`
   rows for the target term. The approved load IS the enrollment.
5. **No cashier/payment integration.** Post-approval, student assistants view
   accepted subjects immediately for institutional encoding; Excel export
   (stack already includes `exceljs`) and printable sheets support them.
6. **Portal path:** `coelgu-system.engineer/faculty` → `faculty.html`, a clean
   route mapping in `vercel.json` (same pattern as `/cv-builder`).

## Roles (migration 032)

- `profiles.role` CHECK extended: `student, admin, governor, cashier,
  officer, faculty, program_head, dean`.
- **Program binding:** a program head's `profiles.course` is set to their
  program (BSCoE/BSCE/BSECE) — the same column already used for student
  program scoping. No new column.
- Server middleware (`server/middleware/roles.js`) gains:
  - `requireFaculty` — faculty, program_head, dean, admin.
  - `requireProgramHead` — program_head, admin.
- Student assistants get plain `faculty` accounts (read-only views).

## Data Model (migration 032)

### `enrollment_submissions` — one per student per term

```
id BIGINT IDENTITY PK
student_id → profiles(id) NOT NULL
school_year TEXT NOT NULL          -- e.g. '2026-2027'
semester SMALLINT NOT NULL         -- 1-3, matching subjects.semester
status TEXT CHECK IN ('draft','submitted','under_review',
                      'approved','returned','rejected')
submitted_at TIMESTAMPTZ
reviewed_by → profiles(id)         -- the program head who decided
review_notes TEXT
created_at / updated_at TIMESTAMPTZ
UNIQUE (student_id, school_year, semester)
```

Status flow: `draft → submitted → (under_review) → approved | returned |
rejected`. `under_review` is set automatically the first time a program head
opens the evaluation view (a fire-and-forget status touch; it never blocks
and is skipped if the head goes straight to a decision). `returned` goes
back to the student, who edits and re-submits (back to `submitted`).
Student assistants may mark approved loads as encoded (see `encoded_at`
below).

Add columns: `encoded_at TIMESTAMPTZ`, `encoded_by → profiles(id)` for the
student-assistant acknowledgment.

### `enrollment_submission_items` — one row per subject in the load

```
id BIGINT IDENTITY PK
submission_id → enrollment_submissions(id) ON DELETE CASCADE
subject_id → subjects(id) NOT NULL
origin TEXT CHECK IN ('grizz','manual')
grizz_reason TEXT                  -- why Grizz recommended it
item_state TEXT CHECK IN ('submitted','removed_by_head','added_by_head')
head_note TEXT                     -- required when a head adds/removes/overrides
UNIQUE (submission_id, subject_id)
```

The Grizz-recommended list and the head's edits are both preserved
structurally: `origin='grizz'` + `item_state='removed_by_head'` shows what
Grizz recommended that the head removed; `item_state='added_by_head'` shows
what the head added. This is the audit trail, not just log lines.

### RLS

- `enrollment_submissions`: students SELECT/INSERT/UPDATE their own rows
  (draft/edit/submit); program heads SELECT + UPDATE rows whose student's
  program matches `profiles.course`; dean SELECT all; admin full.
- `enrollment_submission_items`: same visibility via the parent submission;
  students edit items only while the submission is `draft`/`returned`;
  program heads add/remove with `head_note`.
- All state-changing API actions additionally enforce status legality server
  side (RLS alone cannot express the state machine).

## Workflow

1. **Student builds a load.** Phase B ships a basic flow on the existing
   enrollment screen: pick subjects (from curriculum, incl. retakes) →
   items are created in a `draft` submission for the target
   school_year/semester → "Submit for verification." Phase C replaces this
   with the Grizz-seeded add-to-cart UX; `origin` and `grizz_reason` fields
   exist from day one so the transition needs no migration.
2. **Program head notified** (in-app + Brevo email) on submit.
3. **Evaluation** (program head): the three-column view (below). Actions:
   remove an item (reason required), add an item (prereq warning, override
   with required reason), **Return for changes** (notes to student), or
   **Approve** (confirm dialog).
4. **Approval auto-enrolls** in a single transaction: upsert `student_units`
   rows (status `enrolled`, the submission's school_year/semester, one row
   per non-removed item) → submission `approved` → student notified with a
   **diff of what the head changed** (added/removed + reasons).
   Idempotent: approving an already-approved submission is a no-op.
5. **Student assistants encode:** approved loads appear instantly in the
   "Approved Loads" queue; Excel export + printable sheet; optional
   "mark as encoded" acknowledgment (`encoded_at`), which the student can see.
6. **Dean** sees all submissions read-only with per-program statistics.
7. Every state change, item edit, and decision writes to `audit_logs`
   (existing `server/lib/audit.js`) with actor, action, and payload summary.

### Prereq checking during evaluation

Phase A's `subject_prerequisites` rows drive it: when a program head adds a
subject, or approves a load containing a subject whose prerequisites are not
satisfied by the student's history (passed) or the load itself (co-req /
concurrent retake — full co-enrollment semantics arrive in Phase D), the
system shows the violation and requires an explicit override with a reason.
The system informs; the program head decides.

## Faculty Portal (`/faculty`)

`faculty.html` + `client/js/faculty/` (new page, Officer Console patterns:
auth gate, section visibility by role, same design language).

| Section | Roles | Content |
|---|---|---|
| Evaluation queue | program_head | Submitted/returned loads for their program; student name, year level, subject count, total units |
| Evaluation view | program_head | Three columns: submitted list (items with Grizz reasons), student's prospectus/checklist, academic history (passed/failed/enrolled) |
| Approved loads | faculty (SAs), program_head, dean | Approved final lists per program; Excel export; print view; "mark as encoded" (faculty) |
| Dean dashboard | dean | Read-only: submissions by status, approval volumes, per-program drill-down |

The student side (draft/submit UI, viewing returned notes and the approved
load with changes) lives in the existing student portal as a new section.

## API

New route files, existing middleware patterns:

**`server/routes/enrollment.js`** (student):
- `GET /api/enrollment/submissions/my` — own submissions + items.
- `POST /api/enrollment/submissions` — create draft for a term.
- `POST /api/enrollment/submissions/:id/items` / `DELETE .../items/:itemId` — edit while draft/returned.
- `POST /api/enrollment/submissions/:id/submit` — draft/returned → submitted; validates non-empty; notifies program head(s).

**`server/routes/faculty.js`** (staff):
- `GET /api/faculty/submissions?status=&program=` — program-scoped for heads; all for dean.
- `GET /api/faculty/submissions/:id` — full detail incl. student history, prospectus data.
- `POST .../items` / `PATCH .../items/:itemId` — head add/remove (`head_note` required).
- `POST .../approve` — transactional auto-enroll; idempotent.
- `POST .../return` / `POST .../reject` — with notes.
- `POST .../mark-encoded` — faculty SA acknowledgment.
- `GET .../export` — Excel (`exceljs`) of the final load.

## Notifications

Existing infrastructure: in-app notifications + Brevo email
(`server/lib/email.js`, COE Orange template).

| Event | To | Content |
|---|---|---|
| Submitted | program head(s) of the student's program | Student, term, subject count, units |
| Approved | student | Final load + diff of head changes + reasons |
| Returned / rejected | student | Notes, what to fix |
| Encoded (ack) | student | Their load is encoded — institutional step done |

## Error Handling

- Illegal status transitions rejected server-side (400) regardless of UI.
- Approval requires ≥1 non-removed item; `head_note` required for every head
  add/remove and every prereq override.
- Double-approve is a no-op (idempotency guard), never duplicate
  `student_units` rows.
- Program-scoping enforced in every faculty query — a BSCoE head cannot list
  or open BSCE submissions.
- Existing error shape `{ error: message }`.

## Testing

Role-matrix smoke tests (pattern: `scripts/smoke-test-*.js`):

- Student draft → item add/remove → submit happy path.
- Program-head scoping: head of BSCoE cannot see/act on BSCE submissions.
- Dean read-only: every mutating endpoint returns 403 for dean.
- Approval transaction: `student_units` rows created exactly once; second
  approve changes nothing.
- Item rules: remove without reason rejected; add with unsatisfied prereq
  requires override reason; edit rejected after approval.
- Notification dispatch on submit/approve/return/reject/encoded.
- Excel export contains exactly the non-removed items.
- RLS: student cannot read other students' submissions; faculty cannot
  mutate.

## Rollout

1. Migration 032 (roles + tables + RLS) — additive only.
2. Deploy server (new routes) → deploy client (`faculty.html`, student
   submission section, `vercel.json` `/faculty` mapping).
3. Create program head accounts (admin sets role + `course`), faculty/SA
   accounts, dean account.
4. Pilot with one program's enrollment cycle before announcing broadly.
