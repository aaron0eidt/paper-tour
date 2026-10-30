-- The leading steps of a tour that is still being written, so the reader can start playing before it is finished.
-- One row per running generation: it is replaced as steps arrive, removed when the finished tour is saved (or when an
-- attempt starts again), and never read as a tour of its own (a tours row means finished).
create table public.tour_generation_partials (
  generation_id uuid primary key references public.tour_generations(id) on delete cascade,
  -- Set when the row is first written and kept while it is replaced: a new value means a new attempt.
  attempt uuid not null default gen_random_uuid(),
  tour jsonb not null,
  ready integer not null check (ready >= 1),
  planned integer not null check (planned >= ready),
  updated_at timestamptz not null default now()
);
alter table public.tour_generation_partials enable row level security;
-- Served only by the authenticated, owner-checked API, like the private generation journal.
revoke all on public.tour_generation_partials from public, anon, authenticated;
