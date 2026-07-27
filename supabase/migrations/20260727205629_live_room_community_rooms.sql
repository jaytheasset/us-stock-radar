begin;

alter table public.live_room_rooms
  add column if not exists room_kind text not null default 'company';

alter table public.live_room_rooms
  alter column ticker drop not null;

alter table public.live_room_rooms
  drop constraint if exists live_room_rooms_room_kind_check;

alter table public.live_room_rooms
  add constraint live_room_rooms_room_kind_check
  check (
    (
      room_kind = 'company'
      and ticker is not null
    )
    or
    (
      room_kind = 'community'
      and ticker is null
      and issuer_id is null
    )
  );

create or replace function public.live_room_community_focus_tags_valid(
  p_values text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 1 and 3
    and pg_catalog.array_position(p_values, null) is null
    and p_values <@ array[
      'company_news',
      'sec_filings',
      'earnings',
      'fda_clinical',
      'dilution_listing',
      'legal_financial_risk',
      'macro_policy',
      'mna_strategy',
      'product_leadership'
    ]::text[]
    and (
      select pg_catalog.count(distinct tag)
      from pg_catalog.unnest(p_values) as tag
    ) = pg_catalog.cardinality(p_values)
$$;

create or replace function public.live_room_community_tickers_valid(
  p_values text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 0 and 5
    and pg_catalog.array_position(p_values, null) is null
    and not exists (
      select 1
      from pg_catalog.unnest(p_values) as ticker
      where ticker <> pg_catalog.upper(pg_catalog.btrim(ticker))
        or ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'
    )
    and (
      select pg_catalog.count(distinct ticker)
      from pg_catalog.unnest(p_values) as ticker
    ) = pg_catalog.cardinality(p_values)
$$;

revoke all privileges
on function public.live_room_community_focus_tags_valid(text[])
from public, anon, authenticated;

revoke all privileges
on function public.live_room_community_tickers_valid(text[])
from public, anon, authenticated;

grant execute
on function public.live_room_community_focus_tags_valid(text[])
to service_role;

grant execute
on function public.live_room_community_tickers_valid(text[])
to service_role;

create table public.live_room_community_rooms (
  room_id uuid primary key
    references public.live_room_rooms(id) on delete cascade,
  slug text not null unique
    check (
      pg_catalog.char_length(slug) between 8 and 64
      and slug = pg_catalog.lower(pg_catalog.btrim(slug))
      and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  owner_user_id uuid not null
    references public.user_profiles(id) on delete restrict,
  name text not null
    check (
      pg_catalog.char_length(name) between 4 and 60
      and name = pg_catalog.btrim(name)
      and name !~ '[[:cntrl:]]'
      and name !~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
    ),
  summary text not null
    check (
      pg_catalog.char_length(summary) between 12 and 160
      and summary = pg_catalog.btrim(summary)
      and summary !~ '[[:cntrl:]]'
      and summary !~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
    ),
  topic text not null
    check (
      topic in (
        'market_macro',
        'sector_industry',
        'events_catalysts',
        'trading_strategy',
        'learning_qna',
        'creator_community'
      )
    ),
  room_style text not null
    check (
      room_style in (
        'live_reaction',
        'deep_research',
        'beginner_friendly',
        'open_discussion'
      )
    ),
  focus_tags text[] not null,
  language text not null
    check (language in ('en', 'ko', 'ja')),
  related_tickers text[] not null default array[]::text[],
  search_document tsvector generated always as (
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'simple'::pg_catalog.regconfig,
        coalesce(name, '')
      ),
      'A'
    )
    ||
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'simple'::pg_catalog.regconfig,
        coalesce(summary, '')
      ),
      'B'
    )
  ) stored,
  last_activity_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint live_room_community_rooms_focus_tags_check
    check (
      public.live_room_community_focus_tags_valid(focus_tags)
    ),
  constraint live_room_community_rooms_related_tickers_check
    check (
      public.live_room_community_tickers_valid(related_tickers)
    )
);

create index live_room_community_rooms_owner_created_idx
  on public.live_room_community_rooms
    (owner_user_id, created_at desc);

create index live_room_community_rooms_activity_idx
  on public.live_room_community_rooms
    (last_activity_at desc, slug desc);

create index live_room_community_rooms_created_idx
  on public.live_room_community_rooms
    (created_at desc, slug desc);

create index live_room_community_rooms_topic_activity_idx
  on public.live_room_community_rooms
    (topic, last_activity_at desc, slug desc);

create index live_room_community_rooms_style_activity_idx
  on public.live_room_community_rooms
    (room_style, last_activity_at desc, slug desc);

create index live_room_community_rooms_language_activity_idx
  on public.live_room_community_rooms
    (language, last_activity_at desc, slug desc);

create index live_room_community_rooms_focus_tags_gin_idx
  on public.live_room_community_rooms using gin (focus_tags);

create index live_room_community_rooms_search_gin_idx
  on public.live_room_community_rooms using gin (search_document);

alter table public.live_room_community_rooms enable row level security;

revoke all privileges
on table public.live_room_community_rooms
from public, anon, authenticated;

grant select, insert, update, delete
on table public.live_room_community_rooms
to service_role;

create or replace function public.create_live_room_community_room(
  p_owner_user_id uuid,
  p_slug text,
  p_name text,
  p_summary text,
  p_topic text,
  p_room_style text,
  p_focus_tags text[],
  p_language text,
  p_related_tickers text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_room_id uuid;
  v_slug text := pg_catalog.lower(pg_catalog.btrim(p_slug));
  v_name text := pg_catalog.btrim(p_name);
  v_summary text := pg_catalog.btrim(p_summary);
begin
  if p_owner_user_id is null
    or not exists (
      select 1
      from public.user_profiles as profile
      where profile.id = p_owner_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_MEMBER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'community-room-owner:' || p_owner_user_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.live_room_community_rooms as room
    where room.owner_user_id = p_owner_user_id
      and room.created_at >= v_now - interval '5 minutes'
  )
  or (
    select pg_catalog.count(*)
    from public.live_room_community_rooms as room
    where room.owner_user_id = p_owner_user_id
      and room.created_at >= v_now - interval '24 hours'
  ) >= 5
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_CREATE_RATE_LIMIT';
  end if;

  if pg_catalog.char_length(v_slug) not between 8 and 64
    or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SLUG';
  end if;

  if exists (
    select 1
    from public.live_room_community_rooms as room
    where room.slug = v_slug
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_SLUG_TAKEN';
  end if;

  if pg_catalog.char_length(v_name) not between 4 and 60
    or v_name ~ '[[:cntrl:]]'
    or v_name ~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_NAME';
  end if;

  if pg_catalog.char_length(v_summary) not between 12 and 160
    or v_summary ~ '[[:cntrl:]]'
    or v_summary ~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SUMMARY';
  end if;

  if p_topic not in (
    'market_macro',
    'sector_industry',
    'events_catalysts',
    'trading_strategy',
    'learning_qna',
    'creator_community'
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_TOPIC';
  end if;

  if p_room_style not in (
    'live_reaction',
    'deep_research',
    'beginner_friendly',
    'open_discussion'
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_STYLE';
  end if;

  if p_language not in ('en', 'ko', 'ja') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_LANGUAGE';
  end if;

  if not public.live_room_community_focus_tags_valid(p_focus_tags) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_FOCUS_TAGS';
  end if;

  if not public.live_room_community_tickers_valid(
    coalesce(p_related_tickers, array[]::text[])
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_RELATED_TICKERS';
  end if;

  insert into public.live_room_rooms (ticker, issuer_id, room_kind)
  values (null, null, 'community')
  returning id into v_room_id;

  insert into public.live_room_community_rooms (
    room_id,
    slug,
    owner_user_id,
    name,
    summary,
    topic,
    room_style,
    focus_tags,
    language,
    related_tickers,
    last_activity_at,
    created_at,
    updated_at
  )
  values (
    v_room_id,
    v_slug,
    p_owner_user_id,
    v_name,
    v_summary,
    p_topic,
    p_room_style,
    p_focus_tags,
    p_language,
    coalesce(p_related_tickers, array[]::text[]),
    v_now,
    v_now,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'slug', v_slug,
    'name', v_name,
    'summary', v_summary,
    'topic', p_topic,
    'roomStyle', p_room_style,
    'focusTags', p_focus_tags,
    'language', p_language,
    'relatedTickers', coalesce(p_related_tickers, array[]::text[]),
    'lastActivityAt', v_now,
    'createdAt', v_now
  );
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_SLUG_TAKEN';
end
$$;

create or replace function public.get_live_room_community_room(
  p_slug text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'slug', room.slug,
    'name', room.name,
    'summary', room.summary,
    'topic', room.topic,
    'roomStyle', room.room_style,
    'focusTags', room.focus_tags,
    'language', room.language,
    'relatedTickers', room.related_tickers,
    'lastActivityAt', room.last_activity_at,
    'createdAt', room.created_at
  )
  from public.live_room_community_rooms as room
  where room.slug = pg_catalog.lower(pg_catalog.btrim(p_slug))
$$;

create or replace function public.list_live_room_community_rooms(
  p_topic text default null,
  p_room_style text default null,
  p_focus_tag text default null,
  p_language text default null,
  p_search text default null,
  p_sort text default 'activity',
  p_after_at timestamptz default null,
  p_after_slug text default null,
  p_limit integer default 20
)
returns table (
  slug text,
  name text,
  summary text,
  topic text,
  room_style text,
  focus_tags text[],
  language text,
  related_tickers text[],
  last_activity_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_search text := nullif(pg_catalog.btrim(p_search), '');
begin
  if p_topic is not null
    and p_topic not in (
      'market_macro',
      'sector_industry',
      'events_catalysts',
      'trading_strategy',
      'learning_qna',
      'creator_community'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_TOPIC';
  end if;

  if p_room_style is not null
    and p_room_style not in (
      'live_reaction',
      'deep_research',
      'beginner_friendly',
      'open_discussion'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_STYLE';
  end if;

  if p_focus_tag is not null
    and p_focus_tag not in (
      'company_news',
      'sec_filings',
      'earnings',
      'fda_clinical',
      'dilution_listing',
      'legal_financial_risk',
      'macro_policy',
      'mna_strategy',
      'product_leadership'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_FOCUS_TAGS';
  end if;

  if p_language is not null
    and p_language not in ('en', 'ko', 'ja')
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_LANGUAGE';
  end if;

  if p_sort not in ('activity', 'newest') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SORT';
  end if;

  if v_search is not null
    and pg_catalog.char_length(v_search) > 80
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SEARCH';
  end if;

  if (p_after_at is null) <> (p_after_slug is null) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_CURSOR';
  end if;

  if p_sort = 'newest' then
    return query
    select
      room.slug,
      room.name,
      room.summary,
      room.topic,
      room.room_style,
      room.focus_tags,
      room.language,
      room.related_tickers,
      room.last_activity_at,
      room.created_at
    from public.live_room_community_rooms as room
    where (p_topic is null or room.topic = p_topic)
      and (p_room_style is null or room.room_style = p_room_style)
      and (
        p_focus_tag is null
        or room.focus_tags @> array[p_focus_tag]::text[]
      )
      and (p_language is null or room.language = p_language)
      and (
        v_search is null
        or room.search_document @@ pg_catalog.websearch_to_tsquery(
          'simple'::pg_catalog.regconfig,
          v_search
        )
      )
      and (
        p_after_at is null
        or (room.created_at, room.slug) < (p_after_at, p_after_slug)
      )
    order by room.created_at desc, room.slug desc
    limit v_limit + 1;
  else
    return query
    select
      room.slug,
      room.name,
      room.summary,
      room.topic,
      room.room_style,
      room.focus_tags,
      room.language,
      room.related_tickers,
      room.last_activity_at,
      room.created_at
    from public.live_room_community_rooms as room
    where (p_topic is null or room.topic = p_topic)
      and (p_room_style is null or room.room_style = p_room_style)
      and (
        p_focus_tag is null
        or room.focus_tags @> array[p_focus_tag]::text[]
      )
      and (p_language is null or room.language = p_language)
      and (
        v_search is null
        or room.search_document @@ pg_catalog.websearch_to_tsquery(
          'simple'::pg_catalog.regconfig,
          v_search
        )
      )
      and (
        p_after_at is null
        or (room.last_activity_at, room.slug) <
          (p_after_at, p_after_slug)
      )
    order by room.last_activity_at desc, room.slug desc
    limit v_limit + 1;
  end if;
end
$$;

revoke all privileges
on function public.create_live_room_community_room(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  text[]
)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_community_room(text)
from public, anon, authenticated;

revoke all privileges
on function public.list_live_room_community_rooms(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  integer
)
from public, anon, authenticated;

grant execute
on function public.create_live_room_community_room(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  text[]
)
to service_role;

grant execute
on function public.get_live_room_community_room(text)
to service_role;

grant execute
on function public.list_live_room_community_rooms(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  integer
)
to service_role;

create or replace function private.touch_live_room_community_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.visibility_status = 'visible' then
    update public.live_room_community_rooms as room
    set
      last_activity_at = case
        when room.last_activity_at < new.created_at then new.created_at
        else room.last_activity_at
      end,
      updated_at = pg_catalog.now()
    where room.room_id = new.room_id;
  end if;
  return new;
end
$$;

revoke all privileges
on function private.touch_live_room_community_activity()
from public, anon, authenticated;

drop trigger if exists live_room_messages_touch_community_activity
  on public.live_room_messages;

create trigger live_room_messages_touch_community_activity
after insert on public.live_room_messages
for each row
execute function private.touch_live_room_community_activity();

create or replace function private.broadcast_live_room_message_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_topic text;
  v_action text;
begin
  select
    case
      when room.room_kind = 'company' then room.ticker
      when room.room_kind = 'community' then
        'community:' || community.slug
      else null
    end
  into v_room_topic
  from public.live_room_rooms as room
  left join public.live_room_community_rooms as community
    on community.room_id = room.id
  where room.id = new.room_id;

  if v_room_topic is null then
    return new;
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'created'
    else new.visibility_status
  end;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'roomId', new.room_id,
      'messageId', new.id,
      'action', v_action
    ),
    'live-room-changed',
    'live-room:' || v_room_topic,
    false
  );

  return new;
end
$$;

revoke all privileges
on function private.broadcast_live_room_message_change()
from public, anon, authenticated;

comment on table public.live_room_community_rooms is
  'Service-only structured metadata for public member-created Community Rooms. Browser roles remain default-deny.';

comment on table public.live_room_messages is
  'Company and Community Room chat. Hidden/deleted rows are retained for moderation audit; no client hard-delete API is exposed.';

commit;
