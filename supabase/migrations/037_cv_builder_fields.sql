-- =============================================
-- Migration 037: CV Builder v2 fields
--
-- The rebuilt CV builder stores the student's name and an education block
-- (program, degree, expected graduation year, relevant coursework) on the CV
-- itself. Experience / leadership / certification / award entries live in the
-- existing custom_sections JSONB column, so no other schema change is needed.
--
-- Idempotent and additive: safe to run more than once, no data is modified.
-- RLS policies from 029/030 are column-agnostic and continue to apply.
-- =============================================

ALTER TABLE public.student_cvs
  ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS education JSONB NOT NULL DEFAULT '{}'::jsonb;
