# Database Guide

Everything the repo knows - and doesn't know - about the Supabase database, plus the runbook for migrations, backups, and CI secrets.

## Known drift between the repo and production

The database was partly shaped by hand in the Supabase dashboard. As of 2026-08-22:

| Item | Status |
|---|---|
| `audit_logs` table | **Exists in production with NO migration in this repo.** It was created by hand. Columns used by `server/lib/audit.js` / `server/routes/admin.js`: `user_id`, `action`, `details` (jsonb), `created_at`. A baseline migration is still owed. |
| `events_status_check` | Migration `011` fixes this: the original `001` constraint omits `'archived'`, so archiving an event fails in production until `011` is applied. |
| `profiles.course` | Migration `010` adds a CHECK constraint (`BSCoE`/`BSCE`/`BSECE`/NULL). Data was already cleaned on 2026-08-22 (invalid values like "BS Nusring" were set to NULL). |
| Columns from the reverted admin-academics work | `subjects.is_archived`, `student_units.last_edited_by`, `student_units.updated_at` exist in production (migration 008 was applied before the revert) but **no code references them**. Harmless; keep them so re-landing that work later needs no DDL. |
| Migration `005` | **Destructive on re-run** - drops and recreates `subjects` / `student_units` / `curriculum_requirements`. `scripts/apply-tracker-schema.js` now refuses to run it without `--force`. Never paste 005 into the SQL console of a live project. |

## Applying migrations

Migrations are applied by hand in the **Supabase SQL console** (the project has no `execute_sql` RPC):

1. Supabase Dashboard → SQL Editor → New query
2. Paste the full contents of the migration file
3. Run. All migrations are guarded and re-runnable - running twice is safe.

Pending as of 2026-08-22: `010_profiles_course_constraint.sql`, `011_events_archived_status.sql`.

## Migration 031 (Phase A: lec/lab + structured prerequisites)

Migration file: `supabase/migrations/031_lec_lab_and_structured_prereqs.sql`.

- Additive only. Applied via SQL editor, then `node scripts/preview-prereq-parse.js`
  for the parse report, then `node scripts/seed-lec-lab.js`, then
  `ALTER TABLE public.subjects VALIDATE CONSTRAINT subjects_units_components_check;`
- Tokens flagged `special` in the parse report are fixed up in the Officer
  Console → Curriculum Manager (they stay in the report output until corrected).
- `subjects.prerequisites` (free text) is legacy: kept for reference, not read
  by application logic.

## Migrations 033 & 034 (component outcomes + Phase B faculty portal)

- `supabase/migrations/033_component_outcomes.sql` — adds `lec_grade`/`lab_grade`
  and `lec_status`/`lab_status` to `student_units` so lec and lab can pass/fail
  independently; a passed component banks its units in progress views.
- `supabase/migrations/034_faculty_roles_and_submissions.sql` — adds the
  `faculty`, `program_head`, `dean` roles; tables `enrollment_submissions` /
  `enrollment_submission_items`; SQL helpers `is_faculty()`,
  `is_dean_or_admin()`, `is_program_head_for(uuid)`; widens
  `notifications.target_role` for the new roles.
- Both are additive and re-runnable (guarded constraints, DROP-first policies).
  Apply via the SQL editor in order (033, then 034), then deploy server +
  client together.
- Program heads bind to a program via `profiles.course`; the dean is
  viewer-only; approval of a submitted load auto-enrolls it into
  `student_units` (idempotent upsert).

## Backups

`.github/workflows/backup.yml` runs weekly (Monday 02:30 PHT) and produces three dump artifacts (roles, schema, data) retained 90 days.

Requirements:

1. **The repository must be private.** The workflow refuses to run otherwise - artifacts on public repos are downloadable and contain student personal data.
2. **Secret `SUPABASE_DB_URL`**: Supabase Dashboard → Project Settings → Database → Connection string (URI).

To restore: download the artifacts, then in the Supabase SQL console run `roles.sql`, `schema.sql`, `data.sql` in that order against the target project (or via psql with the connection string).

Limitations: the dump covers the `public` schema. Supabase-managed schemas (`auth.users`, `storage`) are not fully restorable from a SQL dump - user accounts would need re-creation or a Supabase support restore.

## CI / smoke tests

`.github/workflows/smoke.yml` runs after every push to `main` (and daily) against production:

- The site loads with **zero console/page errors** - this is the check that would have caught the 2026-08 empty-`<select>` crash that broke login for everyone.
- The login form is **wired** - a dummy submit must produce feedback.
- Optional authenticated walk-through (Dashboard, Events, Transactions, Reports, Academic Progress) runs when secrets `TEST_EMAIL` / `TEST_PASSWORD` are set. Create a dedicated throwaway account for this; never use a real admin account.

Run it locally any time:

```bash
node scripts/smoke-ui.mjs                       # unauthenticated gates
TEST_EMAIL=… TEST_PASSWORD=… node scripts/smoke-ui.mjs   # full walk-through
```

(First time: `npm install && npx playwright install chromium`.)

## Secrets inventory

| Secret | Where | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` | Render env + local `.env` | Server runtime |
| `TEST_EMAIL`, `TEST_PASSWORD` | GitHub repo secrets (to add) | Authenticated smoke checks |
| `SUPABASE_DB_URL` | GitHub repo secret (to add) | Weekly database backup |
