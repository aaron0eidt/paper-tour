-- Document defaults do not imply consent to Contributor training terms.
alter table public.documents add column tour_model text not null default 'muse-spark-1.3';
alter table public.documents add column tour_allow_training boolean not null default false;
update public.documents d set tour_model = coalesce(
  (select g.model from public.tour_generations g where g.document_id=d.id order by g.created_at desc,g.id desc limit 1),
  d.tour_model
);
