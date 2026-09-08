-- =============================================================
-- 034: Phase B - faculty roles + enrollment submissions
-- Additive only; re-runnable (guarded constraints, DROP-first policies).
-- =============================================================

-- =============================================
-- 1. ROLES (guarded widening, pattern from 021)
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
      AND pg_get_constraintdef(oid) LIKE '%faculty%'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('student', 'admin', 'governor', 'cashier', 'officer',
                      'faculty', 'program_head', 'dean'));
  END IF;
END $$;

-- =============================================
-- 2. SQL HELPERS (SECURITY DEFINER, 016/021 style)
-- =============================================
CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('faculty', 'program_head', 'dean', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_dean_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('dean', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- A program head can act only on students whose course matches their own.
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
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- =============================================
-- 3. ENROLLMENT SUBMISSIONS
-- =============================================
CREATE TABLE IF NOT EXISTS public.enrollment_submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  school_year   TEXT NOT NULL,
  semester      SMALLINT NOT NULL CHECK (semester BETWEEN 1 AND 3),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','under_review','approved','returned','rejected')),
  submitted_at  TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES public.profiles(id),
  review_notes  TEXT,
  encoded_at    TIMESTAMPTZ,
  encoded_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, school_year, semester)
);

CREATE INDEX IF NOT EXISTS enrollment_submissions_status_idx
  ON public.enrollment_submissions (status);
CREATE INDEX IF NOT EXISTS enrollment_submissions_student_idx
  ON public.enrollment_submissions (student_id);

-- =============================================
-- 4. SUBMISSION ITEMS
-- =============================================
CREATE TABLE IF NOT EXISTS public.enrollment_submission_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES public.enrollment_submissions(id) ON DELETE CASCADE,
  subject_id    UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  origin        TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('grizz','manual')),
  grizz_reason  TEXT,
  item_state    TEXT NOT NULL DEFAULT 'submitted'
                CHECK (item_state IN ('submitted','removed_by_head','added_by_head')),
  head_note     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, subject_id)
);

CREATE INDEX IF NOT EXISTS enrollment_submission_items_submission_idx
  ON public.enrollment_submission_items (submission_id);

-- =============================================
-- 5. RLS (030/031 style: enable, revoke anon, DROP-first policies)
-- =============================================
ALTER TABLE public.enrollment_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enrollment_submissions FROM anon;
ALTER TABLE public.enrollment_submission_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enrollment_submission_items FROM anon;

DROP POLICY IF EXISTS "Students read own submissions" ON public.enrollment_submissions;
CREATE POLICY "Students read own submissions"
  ON public.enrollment_submissions FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Students create own drafts" ON public.enrollment_submissions;
CREATE POLICY "Students create own drafts"
  ON public.enrollment_submissions FOR INSERT
  WITH CHECK (student_id = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS "Students edit own editable submissions" ON public.enrollment_submissions;
CREATE POLICY "Students edit own editable submissions"
  ON public.enrollment_submissions FOR UPDATE
  USING (student_id = auth.uid() AND status IN ('draft','returned'));

DROP POLICY IF EXISTS "Faculty read submissions" ON public.enrollment_submissions;
CREATE POLICY "Faculty read submissions"
  ON public.enrollment_submissions FOR SELECT
  USING (public.is_faculty());

DROP POLICY IF EXISTS "Program heads update their program submissions" ON public.enrollment_submissions;
CREATE POLICY "Program heads update their program submissions"
  ON public.enrollment_submissions FOR UPDATE
  USING (public.is_program_head_for(student_id));

DROP POLICY IF EXISTS "Deans and admins full submissions access" ON public.enrollment_submissions;
CREATE POLICY "Deans and admins full submissions access"
  ON public.enrollment_submissions FOR ALL
  USING (public.is_dean_or_admin());

-- Items: visibility/edit via the parent submission
DROP POLICY IF EXISTS "Submission items readable with parent" ON public.enrollment_submission_items;
CREATE POLICY "Submission items readable with parent"
  ON public.enrollment_submission_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.enrollment_submissions s
            WHERE s.id = submission_id
              AND (s.student_id = auth.uid() OR public.is_faculty()))
  );

DROP POLICY IF EXISTS "Students insert items on editable submissions" ON public.enrollment_submission_items;
CREATE POLICY "Students insert items on editable submissions"
  ON public.enrollment_submission_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.enrollment_submissions s
            WHERE s.id = submission_id
              AND s.student_id = auth.uid()
              AND s.status IN ('draft','returned'))
  );

DROP POLICY IF EXISTS "Students delete items on editable submissions" ON public.enrollment_submission_items;
CREATE POLICY "Students delete items on editable submissions"
  ON public.enrollment_submission_items FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.enrollment_submissions s
            WHERE s.id = submission_id
              AND s.student_id = auth.uid()
              AND s.status IN ('draft','returned'))
  );

-- =============================================
-- 6. NOTIFICATIONS: widen target_role for faculty roles
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_target_role_check'
      AND pg_get_constraintdef(oid) LIKE '%faculty%'
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_target_role_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_target_role_check
      CHECK (target_role IN ('all', 'student', 'officer', 'admin', 'faculty', 'program_head', 'dean'));
  END IF;
END $$;
