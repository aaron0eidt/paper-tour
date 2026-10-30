-- Profiles are reusable instructions; generations retain snapshots rather than mutable foreign-key lookups.
create table public.tour_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  current_revision integer not null default 1 check (current_revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tour_profiles_owner_updated on public.tour_profiles(owner_id, updated_at desc, id);
create table public.tour_profile_revisions (
  profile_id uuid not null references public.tour_profiles(id) on delete cascade,
  revision integer not null check (revision >= 1),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now(),
  primary key (profile_id, revision)
);
alter table public.tour_profiles enable row level security;
alter table public.tour_profile_revisions enable row level security;
create policy own_tour_profiles_read on public.tour_profiles for select to authenticated using (owner_id = auth.uid());
create policy own_tour_profile_revisions_read on public.tour_profile_revisions for select to authenticated
  using (exists (select 1 from public.tour_profiles p where p.id = profile_id and p.owner_id = auth.uid()));
revoke all on public.tour_profiles, public.tour_profile_revisions from anon, authenticated;
grant select on public.tour_profiles, public.tour_profile_revisions to authenticated;
alter table public.tour_generations add column profile jsonb check (profile is null or jsonb_typeof(profile) = 'object');
