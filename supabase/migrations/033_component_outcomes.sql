-- =============================================================
-- 033: Component-Level Outcomes - pass lab, fail lec (or vice versa)
-- Spec addendum 2026-09-08. Additive only: two CHECK-constrained
-- nullable status columns + two nullable grade columns on
-- student_units. Rows without component values behave exactly as
-- today (backward compatible). (032 is reserved for Phase B.)
-- =============================================================

ALTER TABLE public.student_units
  ADD COLUMN IF NOT EXISTS lec_grade NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS lab_grade NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS lec_status TEXT
    CHECK (lec_status IN ('enrolled','passed','failed','dropped','incomplete')),
  ADD COLUMN IF NOT EXISTS lab_status TEXT
    CHECK (lab_status IN ('enrolled','passed','failed','dropped','incomplete'));
