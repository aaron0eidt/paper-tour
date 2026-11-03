-- Public activity metadata; the existing journal remains the single event history.
create table public.document_activity_runs (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  kind text not null check(kind in ('answer','reading')),
  status text not null default 'running' check(status in ('running','paused','completed','failed','cancelled')),
  title text not null,
  page integer,
  target_id text,
  progress jsonb,
  operations jsonb not null default '{}',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index document_activity_history on public.document_activity_runs(document_id,started_at desc,id);
alter table public.document_activity_runs enable row level security;
revoke all on public.document_activity_runs from public,anon,authenticated;
alter table public.agent_events alter column generation_id drop not null;
alter table public.agent_events add column activity_run_id uuid references public.document_activity_runs(id) on delete cascade;
alter table public.agent_events add constraint agent_events_has_run check(generation_id is not null or activity_run_id is not null);
create index agent_events_activity_cursor on public.agent_events(activity_run_id,id);
-- Preserve the tour-only meaning of the compatibility view.
create or replace view public.generation_events with (security_invoker=true) as
  select id,generation_id,type,data,created_at from public.agent_events where generation_id is not null;
