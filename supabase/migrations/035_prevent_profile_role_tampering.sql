-- =============================================================
-- Migration 035: Prevent Profile Privilege Escalation & Role Tampering
-- Fixes critical vulnerability where authenticated users can bypass Express
-- and directly update their `role` or `is_verified` columns via Supabase PostgREST API.
-- =============================================================

-- 1. Drop existing permissive RLS update & insert policies on public.profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile non-sensitive fields" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own student profile" ON public.profiles;

-- 2. Create Hardened UPDATE Policy:
-- Users can update full_name, course, year_level, enrollment_year, avatar_url
-- BUT CANNOT modify `role` or `is_verified`.
CREATE POLICY "Users can update own profile non-sensitive fields"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role IS NOT DISTINCT FROM (SELECT role FROM public.profiles WHERE id = auth.uid())
    AND is_verified IS NOT DISTINCT FROM (SELECT is_verified FROM public.profiles WHERE id = auth.uid())
  );

-- 3. Create Hardened INSERT Policy:
-- Authenticated users inserting their own profile must have role = 'student' and is_verified = FALSE.
CREATE POLICY "Users can insert own student profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND role = 'student'
    AND is_verified = FALSE
  );

-- 4. Database Trigger Failsafe:
-- Defense-in-depth: Blocks role or verification status tampering directly at the PostgreSQL row level.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- If invoked via client authenticated role (not service_role backend)
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Security Violation: Authenticated users cannot modify account roles.';
      END IF;
      IF NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
        RAISE EXCEPTION 'Security Violation: Authenticated users cannot modify account verification status.';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW.role <> 'student' THEN
        RAISE EXCEPTION 'Security Violation: New user profiles must default to student role.';
      END IF;
      IF NEW.is_verified = TRUE THEN
        RAISE EXCEPTION 'Security Violation: New user profiles cannot self-verify.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.prevent_profile_privilege_escalation();
