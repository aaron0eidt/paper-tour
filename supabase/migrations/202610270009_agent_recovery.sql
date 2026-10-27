-- A run waiting for credentials still owns the active slot and its checkpoint.
drop index public.tour_generations_one_active;
create unique index tour_generations_one_active on public.tour_generations(analysis_id)
where status in ('queued','generating','paused') or (engine='agent' and status='needs_configuration');
