-- =============================================
-- Migration 026: Admin Account Verification
-- Adds `is_verified` boolean to profiles table and defaults to false for new users.
-- Existing users/admins are set to TRUE.
-- =============================================

-- Add is_verified column if it doesn't already exist
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing users in database default to TRUE so active accounts are uninterrupted
UPDATE public.profiles
SET is_verified = TRUE
WHERE is_verified IS FALSE;

-- Update handle_new_user function to set is_verified = FALSE for new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, course, year_level, is_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'COE Member'),
    'student', -- Hard-coded: role must never come from client-supplied metadata
    NEW.raw_user_meta_data->>'course',
    NEW.raw_user_meta_data->>'year_level',
    FALSE -- Account requires admin verification
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Index for quick verification filtering
CREATE INDEX IF NOT EXISTS idx_profiles_is_verified ON public.profiles(is_verified);
