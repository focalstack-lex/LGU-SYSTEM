-- =============================================
-- Migration 028: Auto Recalculate Enrollment Year
-- Recalculates profiles.enrollment_year & enrollment_verification_requests.enrollment_year
-- based on student year_level for SY 2026-2027 (baseline 2026).
-- =============================================

-- 1. Update profiles table
UPDATE public.profiles
SET enrollment_year = 2026 - (
  COALESCE(
    NULLIF(REGEXP_REPLACE(year_level, '[^0-9]', '', 'g'), '')::INTEGER,
    1
  ) - 1
)
WHERE year_level IS NOT NULL
  AND NULLIF(REGEXP_REPLACE(year_level, '[^0-9]', '', 'g'), '') IS NOT NULL;

-- 2. Update enrollment_verification_requests table if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'enrollment_verification_requests'
  ) THEN
    UPDATE public.enrollment_verification_requests
    SET enrollment_year = 2026 - (
      COALESCE(
        NULLIF(REGEXP_REPLACE(year_level, '[^0-9]', '', 'g'), '')::INTEGER,
        1
      ) - 1
    )
    WHERE year_level IS NOT NULL
      AND NULLIF(REGEXP_REPLACE(year_level, '[^0-9]', '', 'g'), '') IS NOT NULL;
  END IF;
END $$;

-- 3. Update handle_new_user function to calculate enrollment_year on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_year_num INTEGER;
  v_enroll_yr INTEGER;
BEGIN
  v_year_num := COALESCE(
    NULLIF(REGEXP_REPLACE(NEW.raw_user_meta_data->>'year_level', '[^0-9]', '', 'g'), '')::INTEGER,
    1
  );
  v_enroll_yr := 2026 - (v_year_num - 1);

  INSERT INTO public.profiles (id, email, full_name, role, course, year_level, enrollment_year, is_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'COE Member'),
    'student',
    NEW.raw_user_meta_data->>'course',
    NEW.raw_user_meta_data->>'year_level',
    v_enroll_yr,
    FALSE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
