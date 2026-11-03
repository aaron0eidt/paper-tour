-- Speech credentials use the same server-only encrypted Vault as the Meta connection.
create table public.speech_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences)='object'),
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create table public.speech_credentials (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai','elevenlabs')),
  secret_id uuid references vault.secrets(id) on delete set null,
  key_last4 text check (key_last4 is null or length(key_last4)=4),
  primary key (owner_id,provider)
);
alter table public.speech_settings enable row level security;
alter table public.speech_credentials enable row level security;
-- Credential rows are server-only: even masked details are returned through the authenticated API.
revoke all on public.speech_settings,public.speech_credentials from public,anon,authenticated;
create trigger delete_speech_credential_secret after delete on public.speech_credentials
for each row execute function public.delete_user_setting_secret();
