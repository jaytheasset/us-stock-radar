create table public.saved_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content_type text not null,
  content_id uuid not null,
  created_at timestamptz not null default now(),
  constraint saved_content_type_check
    check (content_type in ('news', 'filing', 'live_room_post')),
  constraint saved_content_user_type_content_key
    unique (user_id, content_type, content_id)
);

comment on table public.saved_content is
  'Authenticated user saves for individual news, filing, and public Live Room post content. This is separate from stock Watchlist and Calendar Follow Event state.';

create index saved_content_user_created_idx
  on public.saved_content (user_id, created_at desc, id desc);

create index saved_content_user_type_created_idx
  on public.saved_content (user_id, content_type, created_at desc, id desc);

alter table public.saved_content enable row level security;

revoke all on table public.saved_content from public, anon, authenticated;
grant select, insert, delete on table public.saved_content to authenticated;
grant select, insert, delete on table public.saved_content to service_role;

create policy "Users can read their own saved content"
on public.saved_content
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can save content for themselves"
on public.saved_content
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can remove their own saved content"
on public.saved_content
for delete
to authenticated
using ((select auth.uid()) = user_id);
