-- Conversations belong to a document analysis, never to a mutable saved tour.
create table public.document_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, analysis_id) references public.analyses(document_id, id)
);
create index document_conversations_document_updated on public.document_conversations(document_id, updated_at desc);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.document_conversations(id) on delete cascade,
  question text not null check (length(question) > 0),
  context jsonb not null,
  answer jsonb,
  status text not null check (status in ('pending', 'completed', 'cancelled', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index conversation_messages_thread_created on public.conversation_messages(conversation_id, created_at, id);
-- One model turn at a time keeps follow-up history deterministic across browser tabs.
create unique index conversation_messages_one_pending on public.conversation_messages(conversation_id) where status = 'pending';

alter table public.document_conversations enable row level security;
alter table public.conversation_messages enable row level security;
revoke all on public.document_conversations, public.conversation_messages from anon, authenticated;
grant select on public.document_conversations, public.conversation_messages to authenticated;
create policy conversations_owner_read on public.document_conversations for select to authenticated using (
  owner_id = auth.uid() and exists (
    select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid() and d.deleted_at is null
  )
);
create policy conversation_messages_owner_read on public.conversation_messages for select to authenticated using (
  exists (select 1 from public.document_conversations c where c.id = conversation_id and c.owner_id = auth.uid())
);
