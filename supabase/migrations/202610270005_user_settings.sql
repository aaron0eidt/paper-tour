create extension if not exists supabase_vault with schema vault;

create table public.user_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  default_model text not null default 'muse-spark-1.3',
  credential_source text not null default 'app' check (credential_source in ('app','personal')),
  secret_id uuid references vault.secrets(id) on delete set null,
  key_last4 text check (key_last4 is null or length(key_last4)=4),
  key_updated_at timestamptz,
  key_checked_at timestamptz,
  key_status text check (key_status in ('valid','unavailable')),
  credential_version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy own_settings_read on public.user_settings for select to authenticated using (owner_id=auth.uid());
revoke all on public.user_settings from anon,authenticated;
grant select on public.user_settings to authenticated;

-- Secrets are available to the server database connection, never through client roles or RPC.
revoke all on schema vault from public,anon,authenticated;
revoke all on all tables in schema vault from public,anon,authenticated;

create function public.delete_user_setting_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id=old.secret_id; end if;
  return old;
end;
$$;
revoke all on function public.delete_user_setting_secret() from public,anon,authenticated;
create trigger delete_user_setting_secret after delete on public.user_settings
for each row execute function public.delete_user_setting_secret();
