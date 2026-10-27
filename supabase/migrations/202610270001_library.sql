-- Immutable PDFs, immutable published analyses, and tours bound to their exact analysis.
create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  original_filename text not null,
  upload_path text not null unique,
  upload_size bigint not null check (upload_size > 0 and upload_size <= 26214400),
  file_status text not null default 'uploading' check (file_status in ('uploading','uploaded','invalid')),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count between 1 and 100),
  current_analysis_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz,
  deleted_at timestamptz
);
create index if not exists documents_owner_updated on public.documents(owner_id, updated_at desc) where deleted_at is null;

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  parser_version text not null default 'pending',
  source_sha256 text,
  status text not null default 'queued' check (status in ('queued','processing','ready','limited','failed')),
  doc jsonb,
  warnings text[] not null default '{}',
  error text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(document_id,id),
  check ((status in ('ready','limited')) = (doc is not null))
);
create index if not exists analyses_document_created on public.analyses(document_id, created_at desc);
create unique index if not exists analyses_one_active on public.analyses(document_id) where status in ('queued','processing');
alter table public.documents add constraint documents_analysis_fk foreign key (id,current_analysis_id) references public.analyses(document_id,id) deferrable initially deferred;

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid,
  kind text not null check (kind in ('pdf','thumbnail','figure','audio','explanation')),
  logical_path text not null,
  storage_path text not null unique,
  content_type text not null,
  foreign key(document_id,analysis_id) references public.analyses(document_id,id) on delete cascade,
  unique(analysis_id,logical_path)
);
create unique index if not exists assets_original on public.assets(document_id) where kind='pdf';

create table if not exists public.elements (
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  element_id text not null,
  kind text not null check (kind in ('page','section','block','sentence','figure','table','panel','equation')),
  page integer not null check(page > 0),
  text text not null,
  bbox jsonb,
  data jsonb not null,
  search_vector tsvector generated always as (to_tsvector('simple',text)) stored,
  primary key(analysis_id,element_id)
);
create index if not exists elements_search on public.elements using gin(search_vector);
create index if not exists elements_page on public.elements(analysis_id,page);

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid not null,
  title text not null,
  script jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(document_id,analysis_id) references public.analyses(document_id,id)
);
create index if not exists tours_document on public.tours(document_id);

create table if not exists public.reader_states (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id,document_id)
);

-- API owns all writes; authenticated users can inspect only their own published content.
alter table public.documents enable row level security;
alter table public.analyses enable row level security;
alter table public.assets enable row level security;
alter table public.elements enable row level security;
alter table public.tours enable row level security;
alter table public.reader_states enable row level security;
revoke all on public.documents,public.analyses,public.assets,public.elements,public.tours,public.reader_states from anon,authenticated;
grant select on public.documents,public.analyses,public.assets,public.elements,public.tours,public.reader_states to authenticated;
create policy documents_owner on public.documents for select to authenticated using(owner_id=auth.uid() and deleted_at is null);
create policy analyses_owner on public.analyses for select to authenticated using(exists(select 1 from public.documents d where d.id=document_id and d.owner_id=auth.uid() and d.deleted_at is null));
create policy assets_owner on public.assets for select to authenticated using(exists(select 1 from public.documents d where d.id=document_id and d.owner_id=auth.uid() and d.deleted_at is null));
create policy elements_owner on public.elements for select to authenticated using(exists(select 1 from public.analyses a join public.documents d on d.id=a.document_id where a.id=analysis_id and d.owner_id=auth.uid() and d.deleted_at is null));
create policy tours_owner on public.tours for select to authenticated using(exists(select 1 from public.documents d where d.id=document_id and d.owner_id=auth.uid() and d.deleted_at is null));
create policy reader_states_owner on public.reader_states for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.documents d where d.id=document_id and d.owner_id=auth.uid() and d.deleted_at is null));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('paper-files','paper-files',false,26214400,array['application/pdf','image/png','audio/mpeg','audio/wav','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Browser can insert exactly the reserved original. Never overwrite an original or write generated assets.
create policy reserved_pdf_upload on storage.objects for insert to authenticated with check (
  bucket_id='paper-files' and exists(
    select 1 from public.documents d where d.upload_path=name and d.owner_id=auth.uid() and d.file_status='uploading' and d.deleted_at is null
  )
);
create policy private_document_download on storage.objects for select to authenticated using (
  bucket_id='paper-files' and exists(
    select 1 from public.documents d where d.owner_id=auth.uid() and d.deleted_at is null and
      (d.upload_path=name or exists(select 1 from public.assets a where a.document_id=d.id and a.storage_path=name))
  )
);
