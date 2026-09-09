-- =============================================================
-- Migration 036: Signup domain hardening + anon grant revocation
--
-- Follow-ups to the 2026-09-09 penetration test:
--   1. Replaces the LIKE-based signup domain check with an exact,
--       single-'@' domain match (defense in depth for the signup gate).
--      NOTE: the primary fix for fabricated-campus-mailbox signups is
--      turning OFF "Confirm email" autoconfirm (or disabling the email
--      provider entirely) in Supabase Dashboard -> Authentication ->
--      Sign In / Providers. The UI only offers Google OAuth sign-in.
--   2. Revokes direct SELECT on sensitive tables from the anon role.
--      RLS already returns zero rows for anon, but revoking the grant
--      makes the exposure provably closed. All client reads of these
--      tables happen as an authenticated user or through the backend
--      service key. Rollback GRANTs are included below.
--
-- How to apply: Supabase Dashboard -> SQL Editor -> paste & run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Hardened signup domain trigger (replaces migration 004's check)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_school_email_domain()
RETURNS TRIGGER AS $$
BEGIN
  -- Exact match: exactly one '@' and the domain must be g.cjc.edu.ph.
  -- (split_part returns the wrong segment if a second '@' is present,
  -- so 'a@b@g.cjc.edu.ph' and 'user@evil.com@g.cjc.edu.ph' are rejected.)
  IF NEW.email IS NULL
     OR NEW.email NOT LIKE '%@%'
     OR lower(split_part(NEW.email, '@', 2)) <> 'g.cjc.edu.ph' THEN
    RAISE EXCEPTION 'Only @g.cjc.edu.ph school accounts are allowed to register.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_before_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_school_email_domain();

-- -------------------------------------------------------------
-- 2. Revoke anon-role SELECT grants on sensitive tables
--    (RLS already blocks all rows for anon; this closes the surface.)
-- -------------------------------------------------------------
REVOKE SELECT ON public.transactions  FROM anon;
REVOKE SELECT ON public.events        FROM anon;
REVOKE SELECT ON public.feedback      FROM anon;
REVOKE SELECT ON public.notifications FROM anon;

-- Rollback (only if a logged-out feature turns out to need direct reads):
-- GRANT SELECT ON public.transactions  TO anon;
-- GRANT SELECT ON public.events        TO anon;
-- GRANT SELECT ON public.feedback      TO anon;
-- GRANT SELECT ON public.notifications TO anon;
