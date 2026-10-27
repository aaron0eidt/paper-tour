create table public.generation_events (
  id bigint generated always as identity primary key,
  generation_id uuid not null references public.tour_generations(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index generation_events_run_cursor on public.generation_events(generation_id,id);
alter table public.generation_events enable row level security;
-- Private prompt/output records are served only by the authenticated, owner-checked API.
revoke all on public.generation_events from public, anon, authenticated;
