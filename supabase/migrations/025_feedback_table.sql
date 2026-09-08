-- 025_feedback_table.sql
-- Feedback portal (student sign-in required; replaces the Google Form).
-- Rows are written ONLY by the backend with the service role key
-- (server/routes/feedback.js), so RLS stays on with no anon policies.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  ease        smallint check (ease is null or ease between 1 and 5),
  accuracy    smallint check (accuracy is null or accuracy between 1 and 5),
  ledger      smallint check (ledger is null or ledger between 1 and 5),
  grizz       smallint check (grizz is null or grizz between 1 and 5),
  performance smallint check (performance is null or performance between 1 and 5),
  improve     text,
  bug         text,
  program     text,
  year_level  smallint,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- Idempotent upgrades for databases where the earlier version of this
-- migration (without the identity columns) was already applied.
alter table public.feedback add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.feedback add column if not exists email   text;

alter table public.feedback enable row level security;

-- Intentionally NO policies: anon/authenticated roles can neither read nor
-- write directly. The service role bypasses RLS for the backend insert.

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

create index if not exists feedback_user_id_idx
  on public.feedback (user_id);
