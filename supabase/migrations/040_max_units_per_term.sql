-- =============================================================
-- Migration 040: Unit cap per term for enrollment loads
-- Adds curriculum_requirements.max_units_per_term. The enrollment submit
-- route refuses a load whose active items exceed it; the student screen
-- shows "X of Y units". Default 24; officers change it per program here.
-- Re-runnable.
-- =============================================================

ALTER TABLE public.curriculum_requirements
  ADD COLUMN IF NOT EXISTS max_units_per_term SMALLINT NOT NULL DEFAULT 24
  CHECK (max_units_per_term BETWEEN 1 AND 40);

COMMENT ON COLUMN public.curriculum_requirements.max_units_per_term IS
  'Maximum units a student may submit in one enrollment load for this program.';
