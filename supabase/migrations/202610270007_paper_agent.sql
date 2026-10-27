alter table public.tour_generations add column engine text not null default 'legacy' check(engine in ('legacy','agent'));
alter table public.tour_generations drop constraint tour_generations_status_check;
alter table public.tour_generations add constraint tour_generations_status_check check(status in ('queued','generating','ready','failed','needs_configuration','paused','cancelled'));
drop index public.tour_generations_one_active;
create unique index tour_generations_one_active on public.tour_generations(analysis_id) where status in ('queued','generating','paused');
create table public.paper_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  context_key text not null unique, model text not null, credential_version text not null,
  context_version text not null, root_response_id text,
  visuals jsonb not null default '[]', created_at timestamptz not null default now()
);
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.paper_sessions(id) on delete cascade,
  wake_index integer not null default 0,
  generation_id uuid not null unique references public.tour_generations(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','pausing','paused','completed','failed','cancelled')),
  head_response_id text, turn_index integer not null default 0, turns integer not null default 0,
  output_tokens bigint not null default 0, runtime_ms bigint not null default 0,
  budget_base jsonb not null default '{"turns":0,"output":0,"runtime":0}',
  state jsonb not null default '{"plan":[],"chapters":{},"observations":{},"presented":{}}',
  reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tour_generations add column agent_run_id uuid references public.agent_runs(id) on delete set null;
create table public.agent_steps (
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step integer not null, phase text not null, status text not null default 'prepared',
  input jsonb not null, response_id text, response jsonb,
  primary key(run_id,step)
);
create table public.agent_tool_calls (
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  call_id text not null, name text not null, arguments jsonb not null,
  result jsonb not null, primary key(run_id,call_id)
);
-- Reuse the existing append-only journal; old tour-only entries remain readable.
alter table public.generation_events rename to agent_events;
alter table public.agent_events add column agent_run_id uuid references public.agent_runs(id) on delete cascade;
create index agent_events_run_cursor on public.agent_events(agent_run_id,id);
-- The compatibility view keeps existing workers, routes and historical traces working.
create view public.generation_events with (security_invoker=true) as select id,generation_id,type,data,created_at from public.agent_events;
revoke all on public.generation_events from public,anon,authenticated;
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check(kind in ('pdf','thumbnail','figure','audio','explanation','visual_context'));
create table public.visual_observation_cache (
  session_id uuid not null references public.paper_sessions(id) on delete cascade,
  source_id text not null, image_hash text not null, observation jsonb not null,
  primary key(session_id,source_id)
);
alter table public.paper_sessions enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.visual_observation_cache enable row level security;
revoke all on public.paper_sessions,public.agent_runs,public.agent_steps,public.agent_tool_calls,public.visual_observation_cache from public,anon,authenticated;
