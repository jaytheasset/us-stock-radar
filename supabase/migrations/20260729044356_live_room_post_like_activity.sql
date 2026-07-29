create type public.live_room_post_signal as enum (
  'earnings_beat',
  'earnings_miss',
  'guidance_raised',
  'guidance_cut',
  'short_squeeze',
  'dilution',
  'secondary_offering',
  'mergers_and_acquisitions',
  'buyback',
  'insider_activity',
  'regulatory_fda',
  'contract_partnership',
  'positive_catalyst',
  'risk_alert',
  'technical_breakout',
  'technical_breakdown'
);

create or replace function public.live_room_post_signals_valid(
  p_values public.live_room_post_signal[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) <= 3
    and pg_catalog.array_position(p_values, null) is null
    and pg_catalog.cardinality(p_values) = (
      select pg_catalog.count(distinct signal)::integer
      from pg_catalog.unnest(p_values) as signal
    )
$function$;

alter function public.live_room_post_signals_valid(
  public.live_room_post_signal[]
)
  owner to postgres;

alter table public.live_room_posts
  add column like_count bigint not null default 0,
  add column visible_comment_count bigint not null default 0,
  add column signal_labels public.live_room_post_signal[]
    not null
    default array[]::public.live_room_post_signal[];

alter table public.live_room_posts
  add constraint live_room_posts_like_count_check
  check (like_count >= 0),
  add constraint live_room_posts_visible_comment_count_check
  check (visible_comment_count >= 0),
  add constraint live_room_posts_signal_labels_check
  check (public.live_room_post_signals_valid(signal_labels));

create index live_room_posts_room_popular_idx
  on public.live_room_posts (
    room_id,
    like_count desc,
    visible_comment_count desc,
    created_at desc,
    id desc
  )
  where visibility_status = 'visible';

create index live_room_posts_signal_labels_gin_idx
  on public.live_room_posts using gin (signal_labels)
  where visibility_status = 'visible'
    and pg_catalog.cardinality(signal_labels) > 0;

create table public.live_room_post_likes (
  post_id uuid not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint live_room_post_likes_pkey
    primary key (post_id, actor_user_id),
  constraint live_room_post_likes_post_id_fkey
    foreign key (post_id)
    references public.live_room_posts (id)
    on delete cascade,
  constraint live_room_post_likes_actor_user_id_fkey
    foreign key (actor_user_id)
    references public.live_room_member_profiles (user_id)
    on delete cascade
);

comment on table public.live_room_post_likes is
  'Service-only Live Room post likes. One member may like a post once.';

alter table public.live_room_post_likes enable row level security;

create index live_room_post_likes_actor_created_idx
  on public.live_room_post_likes (actor_user_id, created_at desc);

create or replace function private.sync_live_room_post_like_count()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    update public.live_room_posts
    set like_count = like_count + 1
    where id = new.post_id;
    return new;
  end if;

  update public.live_room_posts
  set like_count = greatest(like_count - 1, 0)
  where id = old.post_id;
  return old;
end
$function$;

alter function private.sync_live_room_post_like_count()
  owner to postgres;

create trigger live_room_post_likes_sync_count
after insert or delete on public.live_room_post_likes
for each row execute function private.sync_live_room_post_like_count();

create or replace function private.sync_live_room_post_comment_count()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.visibility_status = 'visible' then
      update public.live_room_posts
      set visible_comment_count = visible_comment_count + 1
      where id = new.post_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.visibility_status = 'visible' then
      update public.live_room_posts
      set visible_comment_count = greatest(
        visible_comment_count - 1,
        0
      )
      where id = old.post_id;
    end if;
    return old;
  end if;

  if old.post_id = new.post_id then
    if old.visibility_status <> 'visible'
      and new.visibility_status = 'visible'
    then
      update public.live_room_posts
      set visible_comment_count = visible_comment_count + 1
      where id = new.post_id;
    elsif old.visibility_status = 'visible'
      and new.visibility_status <> 'visible'
    then
      update public.live_room_posts
      set visible_comment_count = greatest(
        visible_comment_count - 1,
        0
      )
      where id = old.post_id;
    end if;
    return new;
  end if;

  if old.visibility_status = 'visible' then
    update public.live_room_posts
    set visible_comment_count = greatest(
      visible_comment_count - 1,
      0
    )
    where id = old.post_id;
  end if;
  if new.visibility_status = 'visible' then
    update public.live_room_posts
    set visible_comment_count = visible_comment_count + 1
    where id = new.post_id;
  end if;
  return new;
end
$function$;

alter function private.sync_live_room_post_comment_count()
  owner to postgres;

create trigger live_room_post_comments_sync_count
after insert or delete or update of post_id, visibility_status
on public.live_room_post_comments
for each row execute function private.sync_live_room_post_comment_count();

update public.live_room_posts as post
set visible_comment_count = (
  select count(*)::bigint
  from public.live_room_post_comments as comment
  where comment.post_id = post.id
    and comment.visibility_status = 'visible'
);

alter function public.create_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid
)
  rename to create_live_room_post_without_signals;

create function public.create_live_room_post(
  p_room_id uuid,
  p_author_user_id uuid,
  p_title text,
  p_body text,
  p_related_tickers text[] default array[]::text[],
  p_referenced_event_id uuid default null,
  p_signal_labels public.live_room_post_signal[]
    default array[]::public.live_room_post_signal[]
)
returns public.live_room_posts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_post public.live_room_posts;
  v_signal_labels public.live_room_post_signal[] := coalesce(
    p_signal_labels,
    array[]::public.live_room_post_signal[]
  );
begin
  if not public.live_room_post_signals_valid(v_signal_labels) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_SIGNALS';
  end if;

  v_post := public.create_live_room_post_without_signals(
    p_room_id,
    p_author_user_id,
    p_title,
    p_body,
    p_related_tickers,
    p_referenced_event_id
  );

  update public.live_room_posts
  set signal_labels = v_signal_labels
  where id = v_post.id
  returning * into v_post;

  return v_post;
end
$function$;

alter function public.create_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid,
  public.live_room_post_signal[]
)
  owner to postgres;

alter function public.update_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid
)
  rename to update_live_room_post_without_signals;

create function public.update_live_room_post(
  p_post_id uuid,
  p_author_user_id uuid,
  p_title text,
  p_body text,
  p_related_tickers text[] default array[]::text[],
  p_referenced_event_id uuid default null,
  p_signal_labels public.live_room_post_signal[]
    default array[]::public.live_room_post_signal[]
)
returns public.live_room_posts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_post public.live_room_posts;
  v_signal_labels public.live_room_post_signal[] := coalesce(
    p_signal_labels,
    array[]::public.live_room_post_signal[]
  );
begin
  if not public.live_room_post_signals_valid(v_signal_labels) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_SIGNALS';
  end if;

  v_post := public.update_live_room_post_without_signals(
    p_post_id,
    p_author_user_id,
    p_title,
    p_body,
    p_related_tickers,
    p_referenced_event_id
  );

  update public.live_room_posts
  set signal_labels = v_signal_labels
  where id = v_post.id
  returning * into v_post;

  return v_post;
end
$function$;

alter function public.update_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid,
  public.live_room_post_signal[]
)
  owner to postgres;

create or replace function public.toggle_live_room_post_like(
  p_post_id uuid,
  p_actor_user_id uuid
)
returns table (
  liked boolean,
  like_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_deleted_post_id uuid;
begin
  if p_actor_user_id is null
    or not exists (
      select 1
      from public.live_room_member_profiles as profile
      where profile.user_id = p_actor_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live-room-post-like:'
        || p_post_id::text
        || ':'
        || p_actor_user_id::text,
      0
    )
  );

  perform 1
  from public.live_room_posts as post
  where post.id = p_post_id
    and post.visibility_status = 'visible'
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  delete from public.live_room_post_likes as post_like
  where post_like.post_id = p_post_id
    and post_like.actor_user_id = p_actor_user_id
  returning post_like.post_id into v_deleted_post_id;

  if v_deleted_post_id is null then
    insert into public.live_room_post_likes (
      post_id,
      actor_user_id
    )
    values (
      p_post_id,
      p_actor_user_id
    );
    liked := true;
  else
    liked := false;
  end if;

  return query
  select
    liked,
    post.like_count
  from public.live_room_posts as post
  where post.id = p_post_id;
end
$function$;

alter function public.toggle_live_room_post_like(uuid, uuid)
  owner to postgres;

create or replace function public.get_live_room_member_received_like_count(
  p_member_user_id uuid
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(sum(post.like_count), 0)::bigint
  from public.live_room_posts as post
  where post.author_user_id = p_member_user_id
    and post.visibility_status = 'visible'
$function$;

alter function public.get_live_room_member_received_like_count(uuid)
  owner to postgres;

revoke all on table public.live_room_post_likes
  from public, anon, authenticated;
grant all on table public.live_room_post_likes
  to service_role;

revoke usage on type public.live_room_post_signal
  from public, anon, authenticated;
grant usage on type public.live_room_post_signal
  to service_role;

revoke all on function public.live_room_post_signals_valid(
  public.live_room_post_signal[]
)
  from public, anon, authenticated;
grant execute on function public.live_room_post_signals_valid(
  public.live_room_post_signal[]
)
  to service_role;

revoke all on function public.create_live_room_post_without_signals(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid
)
  from public, anon, authenticated;
grant execute on function public.create_live_room_post_without_signals(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid
)
  to service_role;

revoke all on function public.create_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid,
  public.live_room_post_signal[]
)
  from public, anon, authenticated;
grant execute on function public.create_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid,
  public.live_room_post_signal[]
)
  to service_role;

revoke all on function public.update_live_room_post_without_signals(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid
)
  from public, anon, authenticated;
grant execute on function public.update_live_room_post_without_signals(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid
)
  to service_role;

revoke all on function public.update_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid,
  public.live_room_post_signal[]
)
  from public, anon, authenticated;
grant execute on function public.update_live_room_post(
  uuid,
  uuid,
  text,
  text,
  text[],
  uuid,
  public.live_room_post_signal[]
)
  to service_role;

revoke all on function private.sync_live_room_post_like_count()
  from public, anon, authenticated;
grant execute on function private.sync_live_room_post_like_count()
  to service_role;

revoke all on function private.sync_live_room_post_comment_count()
  from public, anon, authenticated;
grant execute on function private.sync_live_room_post_comment_count()
  to service_role;

revoke all on function public.toggle_live_room_post_like(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.toggle_live_room_post_like(uuid, uuid)
  to service_role;

revoke all on function public.get_live_room_member_received_like_count(uuid)
  from public, anon, authenticated;
grant execute on function public.get_live_room_member_received_like_count(uuid)
  to service_role;
