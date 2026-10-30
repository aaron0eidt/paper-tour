-- Authored visual sources and inputs remain inspectable after tours and conversations evolve.
create table public.visual_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  conversation_id uuid,
  tour_id uuid references public.tours(id) on delete cascade,
  parent_id uuid,
  parent_revision integer,
  created_at timestamptz not null default now(),
  check ((parent_id is null) = (parent_revision is null)),
  check (conversation_id is null or tour_id is null)
);
create table public.visual_artifact_revisions (
  artifact_id uuid not null references public.visual_artifacts(id) on delete cascade,
  revision integer not null check (revision >= 1),
  item jsonb not null,
  created_at timestamptz not null default now(),
  primary key (artifact_id, revision)
);
create index visual_artifacts_document on public.visual_artifacts(document_id,created_at);
alter table public.visual_artifacts enable row level security;
alter table public.visual_artifact_revisions enable row level security;
revoke all on public.visual_artifacts,public.visual_artifact_revisions from public,anon,authenticated;
create function public.prevent_visual_revision_update() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Visual revisions are immutable; append a new revision'; end;
$$;
revoke all on function public.prevent_visual_revision_update() from public,anon,authenticated;
create trigger visual_revision_immutable before update on public.visual_artifact_revisions
for each row execute function public.prevent_visual_revision_update();
