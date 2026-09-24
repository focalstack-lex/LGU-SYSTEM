-- =============================================================
-- Migration 039: Revoke anon Grants across all tables
-- Fixes P1-4 (Anon grants on sensitive/operational tables)
--
-- Defense-in-depth: Ensures unauthenticated PostgREST requests receive 401
-- at the grant layer rather than relying exclusively on RLS row filters.
-- All client reads and writes occur under the 'authenticated' role or
-- via Express backend server using the service_role key.
-- =============================================================

-- Revoke all table-level privileges from the anon role
REVOKE ALL ON public.enrolled_students FROM anon;
REVOKE ALL ON public.announcements      FROM anon;
REVOKE ALL ON public.receipts          FROM anon;
REVOKE ALL ON public.profiles          FROM anon;
REVOKE ALL ON public.events            FROM anon;
REVOKE ALL ON public.transactions      FROM anon;
REVOKE ALL ON public.feedback          FROM anon;
REVOKE ALL ON public.notifications     FROM anon;
REVOKE ALL ON public.subjects          FROM anon;
REVOKE ALL ON public.student_cvs       FROM anon;
REVOKE ALL ON public.subject_prerequisites FROM anon;
REVOKE ALL ON public.enrollment_submissions FROM anon;
REVOKE ALL ON public.audit_logs        FROM anon;

-- Blanket revoke on all current and future tables in schema public for anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

