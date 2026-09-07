-- =============================================================
-- 031: Phase A - lecture/lab unit split + structured prerequisites
-- Additive only: no drops, no data rewrites.
-- Rollout: apply -> preview parse report -> seed lec/lab (Task 2)
--          -> VALIDATE CONSTRAINT -> deploy -> fix flagged tokens
-- =============================================================

-- =============================================
-- 1. LEC/LAB COLUMNS
-- =============================================
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS lec_units SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_units SMALLINT NOT NULL DEFAULT 0;

-- units = lec + lab. NOT VALID: existing rows (defaults 0+0) are exempt
-- until the seed script fills them; new/updated rows are checked immediately.
ALTER TABLE public.subjects
  DROP CONSTRAINT IF EXISTS subjects_units_components_check;
ALTER TABLE public.subjects
  ADD CONSTRAINT subjects_units_components_check
  CHECK (units = lec_units + lab_units) NOT VALID;

-- =============================================
-- 2. STRUCTURED PREREQUISITES
-- =============================================
CREATE TABLE IF NOT EXISTS public.subject_prerequisites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  depends_on_subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prerequisite','corequisite','year_standing','special')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One dependency per row, even when depends_on_subject_id is null.
CREATE UNIQUE INDEX IF NOT EXISTS subject_prerequisites_unique
  ON public.subject_prerequisites (
    subject_id, kind,
    COALESCE(depends_on_subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(detail, '')
  );
CREATE INDEX IF NOT EXISTS subject_prerequisites_subject_idx
  ON public.subject_prerequisites (subject_id);
CREATE INDEX IF NOT EXISTS subject_prerequisites_depends_idx
  ON public.subject_prerequisites (depends_on_subject_id);

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE public.subject_prerequisites ENABLE ROW LEVEL SECURITY;

-- DROP-first keeps the whole file re-runnable after a partial failure.
DROP POLICY IF EXISTS "Prereqs viewable by authenticated" ON public.subject_prerequisites;
CREATE POLICY "Prereqs viewable by authenticated"
  ON public.subject_prerequisites FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Only admins can insert prereqs" ON public.subject_prerequisites;
CREATE POLICY "Only admins can insert prereqs"
  ON public.subject_prerequisites FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Only admins can update prereqs" ON public.subject_prerequisites;
CREATE POLICY "Only admins can update prereqs"
  ON public.subject_prerequisites FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Only admins can delete prereqs" ON public.subject_prerequisites;
CREATE POLICY "Only admins can delete prereqs"
  ON public.subject_prerequisites FOR DELETE USING (public.is_admin());

-- =============================================
-- 4. LEGACY STRING PARSER
-- =============================================

-- Split a legacy prerequisites string into candidate tokens.
-- '/' is treated as a separator too (e.g. '*240 hours / 4th Yr Standing').
CREATE OR REPLACE FUNCTION public.split_prereq_tokens(raw TEXT)
RETURNS SETOF TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(t)
  FROM unnest(
    string_to_array(
      regexp_replace(COALESCE(raw, ''), '\s*/\s*', ';', 'g'),
      ';'
    )
  ) AS t
  WHERE btrim(t) <> ''
    AND upper(btrim(t)) NOT IN ('NONE', '-')
$$;

-- Classify + resolve one token into a structured row shape.
-- Code resolution: same program first, then any program (spec ambiguity rule).
-- First matching UNION branch wins (LIMIT 1 on the outer query).
CREATE OR REPLACE FUNCTION public.parse_prereq_token(
  p_subject public.subjects,
  p_token TEXT
)
RETURNS TABLE (kind TEXT, depends_on_subject_id UUID, detail TEXT)
LANGUAGE sql STABLE AS $$
  SELECT kind, depends_on_subject_id, detail FROM (

    -- co-requisite: "Co-req CpE 223", "Co-requisite: EMath 121"
    SELECT 'corequisite'::TEXT, dep.id, NULL::TEXT
    FROM (SELECT regexp_replace(p_token, '^.*co-?req(uisite)?\s*:?\s*', '', 'i') AS code) c
    LEFT JOIN LATERAL (
      SELECT s2.id FROM public.subjects s2
      WHERE upper(btrim(s2.code)) = upper(btrim(c.code))
      ORDER BY (s2.program = p_subject.program) DESC, s2.id
      LIMIT 1
    ) dep ON true
    WHERE p_token ~* 'co-?req'

    UNION ALL

    -- year standing: "2nd Yr Standing"
    SELECT 'year_standing'::TEXT, NULL::UUID, btrim(p_token)
    WHERE p_token !~* 'co-?req'
      AND p_token ~* '\d+\s*Yr\s*Standing'

    UNION ALL

    -- resolvable subject code
    SELECT 'prerequisite'::TEXT, dep.id, NULL::TEXT
    FROM LATERAL (
      SELECT s2.id FROM public.subjects s2
      WHERE upper(btrim(s2.code)) = upper(btrim(p_token))
        AND p_token !~* 'co-?req'
        AND p_token !~* 'standing'
        AND p_token !~* '\d+\s*(hours|hrs)'
      ORDER BY (s2.program = p_subject.program) DESC, s2.id
      LIMIT 1
    ) dep
    WHERE dep.id IS NOT NULL

    UNION ALL

    -- anything unresolvable lands as special (flagged in the report)
    SELECT 'special'::TEXT, NULL::UUID, btrim(p_token)
    WHERE p_token !~* 'co-?req'
      AND p_token !~* 'standing'

  ) parsed
  LIMIT 1
$$;

-- Dry run: every legacy token and how it maps. Nothing is written.
CREATE OR REPLACE FUNCTION public.preview_prereq_parse()
RETURNS TABLE (
  subject_code TEXT, program TEXT, raw_token TEXT,
  kind TEXT, depends_on_code TEXT, detail TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT s.code, s.program, t.token, p.kind, d.code, p.detail
  FROM public.subjects s
  CROSS JOIN LATERAL public.split_prereq_tokens(s.prerequisites) t
  CROSS JOIN LATERAL public.parse_prereq_token(s, t.token) p
  LEFT JOIN public.subjects d ON d.id = p.depends_on_subject_id
  WHERE s.prerequisites IS NOT NULL AND btrim(s.prerequisites) <> ''
$$;

-- Apply: insert parsed rows. Idempotent (unique index absorbs re-runs).
CREATE OR REPLACE FUNCTION public.apply_prereq_parse()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE inserted integer;
BEGIN
  INSERT INTO public.subject_prerequisites (subject_id, depends_on_subject_id, kind, detail)
  SELECT s.id, p.depends_on_subject_id, p.kind, p.detail
  FROM public.subjects s
  CROSS JOIN LATERAL public.split_prereq_tokens(s.prerequisites) t
  CROSS JOIN LATERAL public.parse_prereq_token(s, t.token) p
  WHERE s.prerequisites IS NOT NULL AND btrim(s.prerequisites) <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;
