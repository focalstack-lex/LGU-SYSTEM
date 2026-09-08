-- =============================================
-- Migration 030: Security Hardening & Strict RLS Enforcement
-- Ensures all public tables have Row Level Security explicitly enabled
-- and prevents unauthenticated PostgREST table enumeration
-- =============================================

-- 1. Enable RLS on all public schema tables
ALTER TABLE IF EXISTS public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_cvs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.enrolled_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.enrollment_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.roster ENABLE ROW LEVEL SECURITY;

-- 2. Revoke raw table execution from anon role on sensitive tables
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.student_cvs FROM anon;
REVOKE ALL ON TABLE public.enrollment_verification_requests FROM anon;
