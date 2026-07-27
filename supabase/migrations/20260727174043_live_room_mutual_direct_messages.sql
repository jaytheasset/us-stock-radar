begin;

-- Mutual-follow member direct messages are independent from public Live Room
-- chat and paid Alerts. Browsers never access these tables or functions
-- directly; same-origin routes use the server-held service role.

create table public.live_room_direct_conversations (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  member_low_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  member_high_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_low_user_id <> member_high_user_id),
  check (member_low_user_id::text < member_high_user_id::text),
  unique (member_low_user_id, member_high_user_id)
);

create index live_room_direct_conversations_low_updated_idx
  on public.live_room_direct_conversations
    (member_low_user_id, updated_at desc, id desc);

create index live_room_direct_conversations_high_updated_idx
  on public.live_room_direct_conversations
    (member_high_user_id, updated_at desc, id desc);

create table public.live_room_direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.live_room_direct_conversations(id) on delete cascade,
  sender_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  body text not null
    check (
      char_length(body) between 1 and 600
      and body = btrim(body)
    ),
  created_at timestamptz not null default now()
);

create index live_room_direct_messages_conversation_cursor_idx
  on public.live_room_direct_messages
    (conversation_id, created_at desc, id desc);

create index live_room_direct_messages_sender_recent_idx
  on public.live_room_direct_messages
    (sender_user_id, created_at desc, id desc);

create table public.live_room_direct_reads (
  conversation_id uuid not null
    references public.live_room_direct_conversations(id) on delete cascade,
  member_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  last_read_message_id uuid
    references public.live_room_direct_messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, member_user_id)
);

create index live_room_direct_reads_member_idx
  on public.live_room_direct_reads (member_user_id, updated_at desc);

create index live_room_direct_reads_message_idx
  on public.live_room_direct_reads (last_read_message_id)
  where last_read_message_id is not null;

alter table public.live_room_direct_conversations enable row level security;
alter table public.live_room_direct_messages enable row level security;
alter table public.live_room_direct_reads enable row level security;

revoke all privileges
on table public.live_room_direct_conversations
from public, anon, authenticated;

revoke all privileges
on table public.live_room_direct_messages
from public, anon, authenticated;

revoke all privileges
on table public.live_room_direct_reads
from public, anon, authenticated;

grant select, insert, update
on table public.live_room_direct_conversations
to service_role;

grant select, insert, update
on table public.live_room_direct_messages
to service_role;

grant select, insert, update
on table public.live_room_direct_reads
to service_role;

create or replace function public.start_live_room_direct_conversation(
  p_requester_user_id uuid,
  p_source_message_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_member_high uuid;
  v_member_low uuid;
  v_peer_user_id uuid;
begin
  if p_requester_user_id is null or p_source_message_id is null then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REQUEST';
  end if;

  select message.member_user_id
  into v_peer_user_id
  from public.live_room_messages as message
  where message.id = p_source_message_id
    and message.author_kind = 'member'
    and message.member_user_id is not null
    and message.visibility_status = 'visible';

  if v_peer_user_id is null then
    raise exception 'LIVE_ROOM_DIRECT_TARGET_NOT_FOUND';
  end if;

  if v_peer_user_id = p_requester_user_id then
    raise exception 'LIVE_ROOM_DIRECT_SELF';
  end if;

  if not (
    exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    and exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_MUTUAL_REQUIRED';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_BLOCKED';
  end if;

  if p_requester_user_id::text < v_peer_user_id::text then
    v_member_low := p_requester_user_id;
    v_member_high := v_peer_user_id;
  else
    v_member_low := v_peer_user_id;
    v_member_high := p_requester_user_id;
  end if;

  insert into public.live_room_direct_conversations (
    member_low_user_id,
    member_high_user_id
  )
  values (v_member_low, v_member_high)
  on conflict (member_low_user_id, member_high_user_id)
  do update set member_low_user_id = excluded.member_low_user_id
  returning * into v_conversation;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_at
  )
  values
    (v_conversation.id, v_member_low, now()),
    (v_conversation.id, v_member_high, now())
  on conflict (conversation_id, member_user_id) do nothing;

  return v_conversation.public_id;
end;
$$;

create or replace function public.send_live_room_direct_message(
  p_requester_user_id uuid,
  p_conversation_public_id uuid,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message_id uuid;
  v_peer_user_id uuid;
begin
  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    )
  for update;

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  if not (
    exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    and exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_READ_ONLY';
  end if;

  -- Serialize a sender across conversations so burst and duplicate checks
  -- cannot be bypassed with concurrent requests to different participants.
  perform pg_advisory_xact_lock(
    hashtextextended(p_requester_user_id::text, 0)
  );

  if v_body = '' then
    raise exception 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception 'LIVE_ROOM_MAX_LENGTH';
  end if;

  if lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
    like any (
      array[
        '%guaranteed return%',
        '%pump and dump%',
        '%risk-free profit%'
      ]
    )
  then
    raise exception 'LIVE_ROOM_BLOCKED_WORD';
  end if;

  if regexp_count(v_body, '\m(https?://|www\.)', 1, 'i') > 2 then
    raise exception 'LIVE_ROOM_EXCESSIVE_LINKS';
  end if;

  if exists (
    select 1
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= now() - interval '120 seconds'
      and lower(regexp_replace(recent.body, '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select count(*)
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= now() - interval '20 seconds'
  ) >= 3 then
    raise exception 'LIVE_ROOM_RATE_LIMIT';
  end if;

  insert into public.live_room_direct_messages (
    conversation_id,
    sender_user_id,
    body
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_body
  )
  returning id into v_message_id;

  update public.live_room_direct_conversations
  set updated_at = now()
  where id = v_conversation.id;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_message_id,
    now(),
    now()
  )
  on conflict (conversation_id, member_user_id)
  do update set
    last_read_message_id = excluded.last_read_message_id,
    last_read_at = excluded.last_read_at,
    updated_at = excluded.updated_at;

  return v_message_id;
end;
$$;

create or replace function public.get_live_room_direct_inbox(
  p_requester_user_id uuid,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with actor_conversations as (
    select
      conversation.id,
      conversation.public_id,
      conversation.updated_at,
      case
        when conversation.member_low_user_id = p_requester_user_id
          then conversation.member_high_user_id
        else conversation.member_low_user_id
      end as peer_user_id
    from public.live_room_direct_conversations as conversation
    where p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    )
    order by conversation.updated_at desc, conversation.id desc
    limit 50
  ),
  visible_conversations as (
    select actor.*
    from actor_conversations as actor
    where not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = 'member'
        and block.blocked_kind = 'member'
        and (
          (
            block.blocker_member_user_id = p_requester_user_id
            and block.blocked_member_user_id = actor.peer_user_id
          )
          or
          (
            block.blocker_member_user_id = actor.peer_user_id
            and block.blocked_member_user_id = p_requester_user_id
          )
        )
    )
  ),
  summaries as (
    select
      visible.id,
      visible.public_id,
      visible.updated_at,
      visible.peer_user_id,
      coalesce(profile.display_name, 'Member') as peer_display_name,
      coalesce(profile.emoji, '💬') as peer_emoji,
      case
        when subscription.status = 'active'
          and subscription.plan in (
            'free',
            'ad_free',
            'pro',
            'advanced',
            'ultimate'
          )
          then subscription.plan
        else 'free'
      end as peer_plan,
      latest.id as latest_message_id,
      latest.sender_user_id as latest_sender_user_id,
      latest.body as latest_body,
      latest.created_at as latest_created_at,
      (
        exists (
          select 1
          from public.live_room_member_follows as follow
          where follow.follower_user_id = p_requester_user_id
            and follow.followed_user_id = visible.peer_user_id
        )
        and exists (
          select 1
          from public.live_room_member_follows as follow
          where follow.follower_user_id = visible.peer_user_id
            and follow.followed_user_id = p_requester_user_id
        )
      ) as mutual_follow,
      (
        select count(*)::bigint
        from public.live_room_direct_messages as unread
        left join public.live_room_direct_reads as read_state
          on read_state.conversation_id = visible.id
          and read_state.member_user_id = p_requester_user_id
        where unread.conversation_id = visible.id
          and unread.sender_user_id <> p_requester_user_id
          and (
            read_state.last_read_at is null
            or unread.created_at > read_state.last_read_at
            or (
              unread.created_at = read_state.last_read_at
              and read_state.last_read_message_id is not null
              and unread.id > read_state.last_read_message_id
            )
          )
      ) as unread_count
    from visible_conversations as visible
    join public.live_room_member_profiles as profile
      on profile.user_id = visible.peer_user_id
    left join public.user_plan_subscriptions as subscription
      on subscription.user_id = visible.peer_user_id
    left join lateral (
      select message.id, message.sender_user_id, message.body, message.created_at
      from public.live_room_direct_messages as message
      where message.conversation_id = visible.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
  ),
  limited as (
    select summary.*
    from summaries as summary
    order by
      coalesce(summary.latest_created_at, summary.updated_at) desc,
      summary.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  )
  select jsonb_build_object(
    'isAuthenticated', true,
    'totalUnreadCount',
      coalesce((select sum(summary.unread_count) from summaries as summary), 0),
    'conversations',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', limited.public_id,
              'peerDisplayName', limited.peer_display_name,
              'peerEmoji', limited.peer_emoji,
              'peerPlan', limited.peer_plan,
              'latestBodyPreview',
                left(
                  regexp_replace(coalesce(limited.latest_body, ''), '[[:space:]]+', ' ', 'g'),
                  120
                ),
              'latestCreatedAt', limited.latest_created_at,
              'latestIsMine',
                limited.latest_sender_user_id = p_requester_user_id,
              'mutualFollow', limited.mutual_follow,
              'unreadCount', limited.unread_count
            )
            order by
              coalesce(limited.latest_created_at, limited.updated_at) desc,
              limited.id desc
          )
          from limited
        ),
        '[]'::jsonb
      )
  )
$$;

create or replace function public.get_live_room_direct_conversation(
  p_requester_user_id uuid,
  p_conversation_public_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_mutual_follow boolean;
  v_page_size integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_peer_user_id uuid;
  v_result jsonb;
begin
  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    );

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_mutual_follow :=
    exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    and exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    );

  with eligible as (
    select
      message.id,
      message.body,
      message.sender_user_id,
      message.created_at,
      row_number() over (
        order by message.created_at desc, message.id desc
      ) as row_number
    from public.live_room_direct_messages as message
    where message.conversation_id = v_conversation.id
      and (
        p_before_created_at is null
        or (
          p_before_message_id is not null
          and (message.created_at, message.id)
            < (p_before_created_at, p_before_message_id)
        )
      )
    order by message.created_at desc, message.id desc
    limit v_page_size + 1
  ),
  page as (
    select eligible.*
    from eligible
    where eligible.row_number <= v_page_size
  )
  select jsonb_build_object(
    'conversationId', v_conversation.public_id,
    'peer',
      jsonb_build_object(
        'displayName', coalesce(profile.display_name, 'Member'),
        'emoji', coalesce(profile.emoji, '💬'),
        'plan',
          case
            when subscription.status = 'active'
              and subscription.plan in (
                'free',
                'ad_free',
                'pro',
                'advanced',
                'ultimate'
              )
              then subscription.plan
            else 'free'
          end
      ),
    'mutualFollow', v_mutual_follow,
    'canSend', v_mutual_follow,
    'readOnlyReason',
      case
        when v_mutual_follow then null
        else 'You can read this conversation, but messaging requires a mutual follow.'
      end,
    'messages',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', page.id,
              'body', page.body,
              'createdAt', page.created_at,
              'isMine', page.sender_user_id = p_requester_user_id
            )
            order by page.created_at asc, page.id asc
          )
          from page
        ),
        '[]'::jsonb
      ),
    'nextCursor',
      case
        when (select count(*) from eligible) > v_page_size then
          (
            select jsonb_build_object(
              'createdAt', page.created_at,
              'messageId', page.id
            )
            from page
            order by page.created_at asc, page.id asc
            limit 1
          )
        else null
      end
  )
  into v_result
  from public.live_room_member_profiles as profile
  left join public.user_plan_subscriptions as subscription
    on subscription.user_id = profile.user_id
  where profile.user_id = v_peer_user_id;

  return v_result;
end;
$$;

create or replace function public.mark_live_room_direct_conversation_read(
  p_requester_user_id uuid,
  p_conversation_public_id uuid,
  p_message_id uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message public.live_room_direct_messages%rowtype;
  v_peer_user_id uuid;
begin
  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    );

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := case
    when v_conversation.member_low_user_id = p_requester_user_id
      then v_conversation.member_high_user_id
    else v_conversation.member_low_user_id
  end;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_peer_user_id
        )
        or
        (
          block.blocker_member_user_id = v_peer_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  if p_message_id is null then
    select message.*
    into v_message
    from public.live_room_direct_messages as message
    where message.conversation_id = v_conversation.id
    order by message.created_at desc, message.id desc
    limit 1;
  else
    select message.*
    into v_message
    from public.live_room_direct_messages as message
    where message.id = p_message_id
      and message.conversation_id = v_conversation.id;

    if not found then
      raise exception 'LIVE_ROOM_DIRECT_MESSAGE_NOT_FOUND';
    end if;
  end if;

  if v_message.id is null then
    return true;
  end if;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_message.id,
    v_message.created_at,
    now()
  )
  on conflict (conversation_id, member_user_id)
  do update set
    last_read_message_id = case
      when excluded.last_read_at > public.live_room_direct_reads.last_read_at
        or (
          excluded.last_read_at = public.live_room_direct_reads.last_read_at
          and (
            public.live_room_direct_reads.last_read_message_id is null
            or excluded.last_read_message_id
              > public.live_room_direct_reads.last_read_message_id
          )
        )
        then excluded.last_read_message_id
      else public.live_room_direct_reads.last_read_message_id
    end,
    last_read_at = greatest(
      public.live_room_direct_reads.last_read_at,
      excluded.last_read_at
    ),
    updated_at = now();

  return true;
end;
$$;

revoke all privileges
on function public.start_live_room_direct_conversation(uuid, uuid)
from public, anon, authenticated;

revoke all privileges
on function public.send_live_room_direct_message(uuid, uuid, text)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_direct_inbox(uuid, integer)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_direct_conversation(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
)
from public, anon, authenticated;

revoke all privileges
on function public.mark_live_room_direct_conversation_read(
  uuid,
  uuid,
  uuid
)
from public, anon, authenticated;

grant execute
on function public.start_live_room_direct_conversation(uuid, uuid)
to service_role;

grant execute
on function public.send_live_room_direct_message(uuid, uuid, text)
to service_role;

grant execute
on function public.get_live_room_direct_inbox(uuid, integer)
to service_role;

grant execute
on function public.get_live_room_direct_conversation(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
)
to service_role;

grant execute
on function public.mark_live_room_direct_conversation_read(
  uuid,
  uuid,
  uuid
)
to service_role;

comment on table public.live_room_direct_conversations is
  'Service-only canonical member pairs for mutual-follow direct messages. This is unrelated to paid Alerts.';

comment on table public.live_room_direct_messages is
  'Service-only direct-message history. Browsers use participant-checking same-origin routes.';

comment on table public.live_room_direct_reads is
  'Service-only exact per-participant direct-message read cursors.';

commit;
