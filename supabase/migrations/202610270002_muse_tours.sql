-- One durable generation lifecycle per immutable analysis.
create table public.tour_generations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid not null unique,
  status text not null default 'queued' check (status in ('queued','generating','ready','failed','needs_configuration')),
  stage text not null default 'preparing' check (stage in ('preparing','images','writing','validating')),
  images_done integer not null default 0 check (images_done >= 0),
  images_total integer not null default 0 check (images_total >= 0 and images_done <= images_total),
  error_code text,
  error text,
  model text not null,
  metadata jsonb not null default '{}',
  result_tour_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(document_id,analysis_id) references public.analyses(document_id,id) on delete cascade
);
create index tour_generations_document on public.tour_generations(document_id,created_at desc);
alter table public.tours add column generation_id uuid unique references public.tour_generations(id) on delete set null;
alter table public.tour_generations add constraint tour_generations_result_fk foreign key(result_tour_id) references public.tours(id) deferrable initially deferred;
alter table public.tour_generations enable row level security;
revoke all on public.tour_generations from anon,authenticated;
grant select on public.tour_generations to authenticated;
create policy tour_generations_owner on public.tour_generations for select to authenticated using (
  exists(select 1 from public.documents d where d.id=document_id and d.owner_id=auth.uid() and d.deleted_at is null)
);
