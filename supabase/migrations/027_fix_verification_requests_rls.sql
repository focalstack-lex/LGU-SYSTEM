-- =============================================
-- Migration 027: Fix RLS Policy for Enrollment Verification Requests
-- Allows all officer roles ('admin', 'governor', 'cashier', 'officer') to review & approve requests.
-- =============================================

DROP POLICY IF EXISTS "Officers can manage all verification requests" ON public.enrollment_verification_requests;

CREATE POLICY "Officers can manage all verification requests" ON public.enrollment_verification_requests
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'governor', 'cashier', 'officer')
    )
  );
