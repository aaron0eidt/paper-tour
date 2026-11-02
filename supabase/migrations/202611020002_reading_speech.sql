-- Validated paper readings, including their synchronized visual actions, survive API restarts.
create table public.reading_speech (
  cache_key text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid not null,
  target_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(document_id, analysis_id) references public.analyses(document_id,id) on delete cascade
);
create index reading_speech_document on public.reading_speech(document_id,analysis_id);
alter table public.reading_speech enable row level security;
revoke all on public.reading_speech from public,anon,authenticated;
