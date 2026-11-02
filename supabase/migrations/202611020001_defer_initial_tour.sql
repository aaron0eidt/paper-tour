-- Existing integrations retain automatic generation; interactive uploads choose in the reader.
alter table public.documents add column defer_tour boolean not null default false;
