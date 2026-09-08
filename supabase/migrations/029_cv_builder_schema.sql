-- =============================================
-- Migration 029: Student Career Passport & CV Builder
-- Adds student_cvs table with RLS and public verification token lookup
-- =============================================

CREATE TABLE IF NOT EXISTS public.student_cvs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  headline TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  location TEXT DEFAULT '',
  linkedin_url TEXT DEFAULT '',
  github_url TEXT DEFAULT '',
  portfolio_url TEXT DEFAULT '',
  technical_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  soft_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  capstone_project JSONB NOT NULL DEFAULT '{}'::jsonb,
  work_experience JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_locker_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  template_style TEXT NOT NULL DEFAULT 'harvard',
  share_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_student_cvs_user_id ON public.student_cvs(user_id);
CREATE INDEX IF NOT EXISTS idx_student_cvs_share_token ON public.student_cvs(share_token);

-- Enable RLS
ALTER TABLE public.student_cvs ENABLE ROW LEVEL SECURITY;

-- Policy 1: Students can view their own CV
CREATE POLICY "Users can view own CV" ON public.student_cvs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 2: Students can insert/update their own CV
CREATE POLICY "Users can insert own CV" ON public.student_cvs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own CV" ON public.student_cvs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 3: Public verification lookup by share_token
CREATE POLICY "Public can view public CVs by token" ON public.student_cvs
  FOR SELECT
  USING (is_public = TRUE);

-- Policy 4: Admins/Officers can view all CVs (for placement/career matching)
CREATE POLICY "Admins and officers can view all CVs" ON public.student_cvs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'officer', 'treasurer', 'auditor')
    )
  );

-- Trigger for auto updated_at timestamp
CREATE OR REPLACE FUNCTION public.set_cv_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_cvs_updated_at ON public.student_cvs;
CREATE TRIGGER trg_student_cvs_updated_at
  BEFORE UPDATE ON public.student_cvs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_cv_updated_at();
