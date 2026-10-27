-- Explicit regeneration preserves completed generations and their saved tours.
alter table public.tour_generations drop constraint tour_generations_analysis_id_key;
create unique index tour_generations_one_active on public.tour_generations(analysis_id)
  where status in ('queued','generating');
create index tour_generations_latest on public.tour_generations(analysis_id,created_at desc,id desc);
