-- Resumable harness work shares the generation journal and its ownership/deletion lifecycle.
create index agent_events_workspace_key on public.agent_events(generation_id,(data->>'key'),id desc)
where type='workspace.saved';
