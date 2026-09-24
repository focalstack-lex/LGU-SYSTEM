-- =============================================================
-- Migration 038: Pin search_path on all SECURITY DEFINER functions
-- Fixes P0-1 (Privilege Escalation via Unpinned search_path)
-- Re-runnable: CREATE OR REPLACE FUNCTION with explicit SET search_path
-- and fully schema-qualified object references.
-- =============================================================

-- 1. Helper function: update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp;

-- 2. Auth trigger: enforce_school_email_domain
CREATE OR REPLACE FUNCTION public.enforce_school_email_domain()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NULL
     OR NEW.email NOT LIKE '%@%'
     OR pg_catalog.lower(pg_catalog.split_part(NEW.email, '@', 2)) <> 'g.cjc.edu.ph' THEN
    RAISE EXCEPTION 'Only @g.cjc.edu.ph school accounts are allowed to register.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp;

-- 3. Auth trigger: handle_new_user (recalibrating enrollment year and default student status)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT;
  v_course TEXT;
  v_year TEXT;
  v_year_num INTEGER;
  v_enroll_yr INTEGER;
BEGIN
  v_full_name := pg_catalog.coalesce(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    'COE Student'
  );
  v_course := NEW.raw_user_meta_data->>'course';
  v_year := NEW.raw_user_meta_data->>'year_level';

  v_year_num := pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.regexp_replace(v_year, '[^0-9]', '', 'g'), '')::INTEGER,
    1
  );
  v_enroll_yr := 2026 - (v_year_num - 1);

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    course,
    year_level,
    enrollment_year,
    is_verified
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    'student',
    v_course,
    v_year,
    v_enroll_yr,
    FALSE
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = CASE
      WHEN public.profiles.full_name = 'COE Member' OR public.profiles.full_name = 'COE Student'
      THEN EXCLUDED.full_name
      ELSE public.profiles.full_name
    END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- 4. Role helper: is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp;

-- 5. Role helper: is_officer
CREATE OR REPLACE FUNCTION public.is_officer()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'governor', 'cashier', 'officer')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp;

-- 6. Role helper: is_faculty
CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('faculty', 'program_head', 'dean', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp;

-- 7. Role helper: is_dean_or_admin
CREATE OR REPLACE FUNCTION public.is_dean_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('dean', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp;

-- 8. Role helper: is_program_head_for
CREATE OR REPLACE FUNCTION public.is_program_head_for(target_student UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles head
    JOIN public.profiles stu ON stu.id = target_student
    WHERE head.id = auth.uid()
      AND head.role = 'program_head'
      AND stu.course = head.course
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp;

-- 9. Trigger helper: recompute_event_balance
CREATE OR REPLACE FUNCTION public.recompute_event_balance(target_event_id UUID)
RETURNS VOID AS $$
BEGIN
  IF target_event_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.events e
  SET remaining_budget =
      e.allocated_budget
      + pg_catalog.coalesce((
          SELECT pg_catalog.sum(t.amount) FROM public.transactions t
          WHERE t.event_id = e.id
            AND ((t.type = 'transfer' AND t.direction = 'in') OR t.type = 'allocation')
        ), 0)
      - pg_catalog.coalesce((
          SELECT pg_catalog.sum(t.amount) FROM public.transactions t
          WHERE t.event_id = e.id
            AND (t.type = 'transfer' AND t.direction = 'out')
        ), 0)
      - pg_catalog.coalesce((
          SELECT pg_catalog.sum(t.amount) FROM public.transactions t
          WHERE t.event_id = e.id
            AND t.type = 'expense'
            AND t.use_allocation = true
        ), 0),
      updated_at = pg_catalog.now()
  WHERE e.id = target_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- 10. Trigger function: sync_event_balance
CREATE OR REPLACE FUNCTION public.sync_event_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.event_id IS NOT NULL THEN
      PERFORM public.recompute_event_balance(NEW.event_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.event_id IS NOT NULL AND OLD.event_id IS DISTINCT FROM NEW.event_id THEN
      PERFORM public.recompute_event_balance(OLD.event_id);
    END IF;
    IF NEW.event_id IS NOT NULL THEN
      PERFORM public.recompute_event_balance(NEW.event_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.event_id IS NOT NULL THEN
      PERFORM public.recompute_event_balance(OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- 11. Profile defense-in-depth trigger: prevent_profile_privilege_escalation
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth, pg_temp;
