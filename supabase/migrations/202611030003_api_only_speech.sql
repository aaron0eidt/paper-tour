-- Retire the GPU-dependent option without moving local/private readers to a paid API.
-- Existing explicit Browser, ElevenLabs and OpenAI selections are preserved.
update public.speech_settings
set preferences = (preferences - 'precompute' - 'connections') || jsonb_build_object(
  'provider', case when preferences->>'provider' = 'local' then 'browser'
                   else coalesce(preferences->>'provider', 'browser') end,
  'connections', coalesce(preferences->'connections', '{}'::jsonb) - 'local'
), version = gen_random_uuid(), updated_at = now();
