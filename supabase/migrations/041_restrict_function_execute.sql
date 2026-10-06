-- =============================================
-- Migration 041: Restrict EXECUTE on SECURITY DEFINER functions and pin
-- search_path on the remaining SECURITY INVOKER functions.
-- Clears Supabase database linter findings 0011, 0028 and 0029 (2026-10-06).
-- Re-runnable: REVOKE, GRANT and ALTER FUNCTION ... SET are idempotent.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and anon and
-- authenticated inherit through PUBLIC, so each REVOKE names PUBLIC too.
-- =============================================

-- 1. Trigger functions: only ever invoked by their triggers. Postgres checks
--    EXECUTE when a trigger is created, not when it fires, so revoking from
--    API roles does not affect the triggers.
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_school_email_domain()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_event_balance()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;

-- 2. recompute_event_balance writes events.remaining_budget. Its only caller
--    is sync_event_balance, which runs as the function owner.
REVOKE EXECUTE ON FUNCTION public.recompute_event_balance(UUID) FROM PUBLIC, anon, authenticated;

-- 3. Role helpers: RLS policies evaluate them as the querying user, so
--    authenticated must keep EXECUTE. Grant it explicitly before removing
--    PUBLIC so it does not disappear with the inherited grant.
GRANT  EXECUTE ON FUNCTION public.is_admin()                  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_officer()                TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_faculty()                TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_dean_or_admin()          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_program_head_for(UUID)   TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_admin()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_officer()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_faculty()                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_dean_or_admin()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_program_head_for(UUID)   FROM PUBLIC, anon;

-- 4. SECURITY INVOKER functions with a role-mutable search_path. The list
--    keeps public so unqualified references resolve exactly as before.
ALTER FUNCTION public.split_prereq_tokens(TEXT)                SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.parse_prereq_token(public.subjects, TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.preview_prereq_parse()                   SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.apply_prereq_parse()                     SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.set_cv_updated_at()                      SET search_path = pg_catalog, public, pg_temp;

-- 5. Future functions created by this role are not callable by PUBLIC or
--    anon by default. Grant EXECUTE explicitly when a function is meant to
--    be a public RPC. The PUBLIC grant is a global default, and per-schema
--    defaults can only add to it, so it must be revoked without IN SCHEMA.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
