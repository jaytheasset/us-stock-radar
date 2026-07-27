begin;

-- Direct-message requests extend the existing canonical member-pair
-- conversation. They remain separate from public Live Room chat and paid
-- Alerts, and browsers continue to use same-origin service-role routes only.

alter table public.live_room_direct_conversations
  add column status text not null default 'accepted',
  add column request_sender_user_id uuid
    references public.user_profiles(id) on delete cascade,
  add column request_created_at timestamptz,
  add column accepted_at timestamptz,
  add column declined_at timestamptz,
  add column state_updated_at timestamptz not null default now();

update public.live_room_direct_conversations
set accepted_at = created_at,
    state_updated_at = updated_at
where accepted_at is null;

alter table public.live_room_direct_conversations
  add constraint live_room_direct_conversations_status_check
    check (status in ('accepted', 'pending', 'declined')),
  add constraint live_room_direct_conversations_request_sender_check
    check (
      request_sender_user_id is null
      or request_sender_user_id in (
        member_low_user_id,
        member_high_user_id
      )
    ),
  add constraint live_room_direct_conversations_state_check
    check (
      (status = 'accepted' and accepted_at is not null)
      or
      (
        status = 'pending'
        and request_sender_user_id is not null
        and request_created_at is not null
        and accepted_at is null
        and declined_at is null
      )
      or
      (
        status = 'declined'
        and request_sender_user_id is not null
        and request_created_at is not null
        and declined_at is not null
      )
    );

create index live_room_direct_conversations_request_sender_idx
  on public.live_room_direct_conversations (request_sender_user_id)
  where request_sender_user_id is not null;

create index live_room_direct_conversations_low_status_updated_idx
  on public.live_room_direct_conversations
    (member_low_user_id, status, updated_at desc, id desc);

create index live_room_direct_conversations_high_status_updated_idx
  on public.live_room_direct_conversations
    (member_high_user_id, status, updated_at desc, id desc);

alter table public.live_room_direct_messages
  add column message_kind text not null default 'chat',
  add column risk_flags text[] not null default '{}'::text[],
  add column risk_score smallint not null default 0;

alter table public.live_room_direct_messages
  add constraint live_room_direct_messages_kind_check
    check (message_kind in ('chat', 'request')),
  add constraint live_room_direct_messages_risk_flags_check
    check (
      risk_flags <@ array[
        'off_platform_contact',
        'money_transfer',
        'guaranteed_return',
        'paid_room',
        'crypto_wallet',
        'repeated_contact'
      ]::text[]
    ),
  add constraint live_room_direct_messages_risk_score_check
    check (risk_score between 0 and 100);

create unique index live_room_direct_messages_one_request_idx
  on public.live_room_direct_messages (conversation_id)
  where message_kind = 'request';

create unique index live_room_direct_messages_conversation_id_uidx
  on public.live_room_direct_messages (conversation_id, id);

create table public.live_room_direct_message_settings (
  member_user_id uuid primary key
    references public.user_profiles(id) on delete cascade,
  receive_mode text not null default 'followers'
    check (
      receive_mode in (
        'mutual_only',
        'people_i_follow',
        'followers',
        'everyone',
        'nobody'
      )
    ),
  request_filter text not null default 'any'
    check (
      request_filter in (
        'any',
        'moderators',
        'verified',
        'pro_members'
      )
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.live_room_direct_message_reports (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.live_room_direct_conversations(id) on delete cascade,
  message_id uuid not null
    references public.live_room_direct_messages(id) on delete cascade,
  reporter_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  reason text not null
    check (
      reason in (
        'spam',
        'harassment',
        'scam',
        'misinformation',
        'other'
      )
    ),
  priority smallint not null
    check (priority between 0 and 200),
  risk_score_snapshot smallint not null
    check (risk_score_snapshot between 0 and 100),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_user_id),
  foreign key (conversation_id, message_id)
    references public.live_room_direct_messages(conversation_id, id)
    on delete cascade
);

create index live_room_direct_message_reports_conversation_idx
  on public.live_room_direct_message_reports
    (conversation_id, created_at desc);

create index live_room_direct_message_reports_message_idx
  on public.live_room_direct_message_reports (message_id);

create index live_room_direct_message_reports_reporter_idx
  on public.live_room_direct_message_reports
    (reporter_user_id, created_at desc);

create index live_room_direct_message_reports_priority_idx
  on public.live_room_direct_message_reports
    (priority desc, created_at asc);

alter table public.live_room_direct_message_settings
  enable row level security;

alter table public.live_room_direct_message_reports
  enable row level security;

revoke all privileges
on table public.live_room_direct_message_settings
from public, anon, authenticated;

revoke all privileges
on table public.live_room_direct_message_reports
from public, anon, authenticated;

grant select, insert, update
on table public.live_room_direct_message_settings
to service_role;

grant select, insert
on table public.live_room_direct_message_reports
to service_role;

drop function public.start_live_room_direct_conversation(uuid, uuid);

create function public.start_live_room_direct_conversation(
  p_requester_user_id uuid,
  p_source_message_id uuid,
  p_body text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_conversation public.live_room_direct_conversations%rowtype;
  v_filter text;
  v_is_mutual boolean;
  v_is_request_allowed boolean;
  v_member_high uuid;
  v_member_low uuid;
  v_message_id uuid;
  v_now timestamptz := now();
  v_peer jsonb;
  v_peer_user_id uuid;
  v_receive_mode text;
  v_risk_flags text[] := '{}'::text[];
  v_risk_score smallint := 0;
begin
  if p_requester_user_id is null or p_source_message_id is null then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REQUEST';
  end if;

  select
    message.member_user_id,
    jsonb_build_object(
      'displayName', coalesce(profile.display_name, 'Member'),
      'emoji', coalesce(profile.emoji, '💬')
    )
  into v_peer_user_id, v_peer
  from public.live_room_messages as message
  join public.live_room_member_profiles as profile
    on profile.user_id = message.member_user_id
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

  if p_requester_user_id::text < v_peer_user_id::text then
    v_member_low := p_requester_user_id;
    v_member_high := v_peer_user_id;
  else
    v_member_low := v_peer_user_id;
    v_member_high := p_requester_user_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_member_low::text || ':' || v_member_high::text,
      0
    )
  );

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

  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.member_low_user_id = v_member_low
    and conversation.member_high_user_id = v_member_high
  for update;

  v_is_mutual :=
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

  if v_conversation.id is not null
    and v_conversation.status = 'accepted'
  then
    return jsonb_build_object(
      'mode', 'accepted',
      'conversationId', v_conversation.public_id,
      'peer', v_peer
    );
  end if;

  if v_is_mutual then
    if v_conversation.id is null then
      insert into public.live_room_direct_conversations (
        member_low_user_id,
        member_high_user_id,
        status,
        accepted_at,
        state_updated_at
      )
      values (
        v_member_low,
        v_member_high,
        'accepted',
        v_now,
        v_now
      )
      returning * into v_conversation;
    else
      update public.live_room_direct_conversations
      set status = 'accepted',
          accepted_at = v_now,
          declined_at = null,
          state_updated_at = v_now,
          updated_at = v_now
      where id = v_conversation.id
      returning * into v_conversation;
    end if;

    insert into public.live_room_direct_reads (
      conversation_id,
      member_user_id,
      last_read_at,
      updated_at
    )
    values
      (v_conversation.id, v_member_low, v_now, v_now),
      (v_conversation.id, v_member_high, v_now, v_now)
    on conflict (conversation_id, member_user_id) do nothing;

    return jsonb_build_object(
      'mode', 'accepted',
      'conversationId', v_conversation.public_id,
      'peer', v_peer
    );
  end if;

  if v_conversation.id is not null then
    if v_conversation.status = 'pending' then
      return jsonb_build_object(
        'mode', 'pending',
        'conversationId', v_conversation.public_id,
        'isRequestSender',
          v_conversation.request_sender_user_id = p_requester_user_id,
        'peer', v_peer
      );
    end if;
    raise exception 'LIVE_ROOM_DIRECT_REQUEST_UNAVAILABLE';
  end if;

  select
    coalesce(setting.receive_mode, 'followers'),
    coalesce(setting.request_filter, 'any')
  into v_receive_mode, v_filter
  from (select 1) as singleton
  left join public.live_room_direct_message_settings as setting
    on setting.member_user_id = v_peer_user_id;

  v_is_request_allowed := case v_receive_mode
    when 'people_i_follow' then exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = v_peer_user_id
        and follow.followed_user_id = p_requester_user_id
    )
    when 'followers' then exists (
      select 1
      from public.live_room_member_follows as follow
      where follow.follower_user_id = p_requester_user_id
        and follow.followed_user_id = v_peer_user_id
    )
    when 'everyone' then true
    else false
  end;

  if v_is_request_allowed then
    v_is_request_allowed := case v_filter
      when 'any' then true
      when 'moderators' then exists (
        select 1
        from public.live_room_moderators as moderator
        where moderator.user_id = p_requester_user_id
          and moderator.active = true
          and moderator.role in ('moderator', 'admin')
      )
      when 'verified' then exists (
        select 1
        from public.live_room_social_verifications as verification
        where verification.member_user_id = p_requester_user_id
          and verification.status = 'verified'
      )
      when 'pro_members' then exists (
        select 1
        from public.user_plan_subscriptions as subscription
        where subscription.user_id = p_requester_user_id
          and subscription.status = 'active'
          and subscription.plan in ('pro', 'advanced', 'ultimate')
      )
      else false
    end;
  end if;

  if not v_is_request_allowed then
    raise exception 'LIVE_ROOM_DIRECT_REQUEST_UNAVAILABLE';
  end if;

  if p_body is null then
    return jsonb_build_object(
      'mode', 'request_required',
      'conversationId', null,
      'peer', v_peer
    );
  end if;

  if v_body = '' then
    raise exception 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception 'LIVE_ROOM_MAX_LENGTH';
  end if;

  if v_body ~* (
    '(https?://|www\.|mailto:|'
    || '[a-z0-9][a-z0-9-]*\.(com|net|org|io|me|gg|co|kr)'
    || '([/[:space:]]|$))'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_REQUEST_LINK';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_requester_user_id::text, 0)
  );

  if exists (
    select 1
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= v_now - interval '120 seconds'
      and lower(regexp_replace(recent.body, '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
  ) then
    raise exception 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select count(*)
    from public.live_room_direct_messages as recent
    where recent.sender_user_id = p_requester_user_id
      and recent.created_at >= v_now - interval '20 seconds'
  ) >= 3 then
    raise exception 'LIVE_ROOM_RATE_LIMIT';
  end if;

  if v_body ~* '(telegram|텔레그램|whats\s*app|왓츠앱|kakao\s*talk|카카오톡|discord|디스코드)' then
    v_risk_flags := array_append(v_risk_flags, 'off_platform_contact');
  end if;
  if v_body ~* '(wire transfer|bank transfer|deposit|account number|송금|입금|계좌\s*번호|계좌번호)' then
    v_risk_flags := array_append(v_risk_flags, 'money_transfer');
  end if;
  if v_body ~* '(guaranteed?\s+(return|profit)|risk[- ]?free profit|수익\s*보장|원금\s*보장|확정\s*수익)' then
    v_risk_flags := array_append(v_risk_flags, 'guaranteed_return');
  end if;
  if v_body ~* '(paid\s+(room|group)|vip\s*(room|group)|premium\s+signals?|유료\s*방|유료방|vip\s*방|리딩\s*방)' then
    v_risk_flags := array_append(v_risk_flags, 'paid_room');
  end if;
  if v_body ~* '(wallet\s*address|send\s+(btc|eth|usdt|crypto)|crypto\s+transfer|지갑\s*주소|암호화폐\s*전송|코인\s*전송)' then
    v_risk_flags := array_append(v_risk_flags, 'crypto_wallet');
  end if;
  if (
    regexp_count(
      v_body,
      '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
      1,
      'i'
    )
    + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
    >= 2
    or (
      regexp_count(
        v_body,
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
        1,
        'i'
      )
      + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
      >= 1
      and exists (
        select 1
        from public.live_room_direct_messages as recent
        where recent.sender_user_id = p_requester_user_id
          and recent.created_at >= v_now - interval '120 seconds'
          and (
            regexp_count(
              recent.body,
              '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
              1,
              'i'
            )
            + regexp_count(
              recent.body,
              '\+?[0-9][0-9 ()-]{7,}[0-9]',
              1,
              'i'
            )
          ) >= 1
      )
    )
  )
  then
    v_risk_flags := array_append(v_risk_flags, 'repeated_contact');
  end if;
  v_risk_score := least(100, cardinality(v_risk_flags) * 20);

  insert into public.live_room_direct_conversations (
    member_low_user_id,
    member_high_user_id,
    status,
    request_sender_user_id,
    request_created_at,
    accepted_at,
    declined_at,
    state_updated_at,
    updated_at
  )
  values (
    v_member_low,
    v_member_high,
    'pending',
    p_requester_user_id,
    v_now,
    null,
    null,
    v_now,
    v_now
  )
  returning * into v_conversation;

  insert into public.live_room_direct_messages (
    conversation_id,
    sender_user_id,
    body,
    message_kind,
    risk_flags,
    risk_score,
    created_at
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_body,
    'request',
    v_risk_flags,
    v_risk_score,
    v_now
  )
  returning id into v_message_id;

  insert into public.live_room_direct_reads (
    conversation_id,
    member_user_id,
    last_read_message_id,
    last_read_at,
    updated_at
  )
  values
    (
      v_conversation.id,
      p_requester_user_id,
      v_message_id,
      v_now,
      v_now
    ),
    (
      v_conversation.id,
      v_peer_user_id,
      null,
      v_now - interval '1 microsecond',
      v_now
    );

  return jsonb_build_object(
    'mode', 'pending',
    'conversationId', v_conversation.public_id,
    'isRequestSender', true,
    'peer', v_peer
  );
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
  v_risk_flags text[] := '{}'::text[];
  v_risk_score smallint := 0;
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

  if v_conversation.status <> 'accepted' then
    raise exception 'LIVE_ROOM_DIRECT_READ_ONLY';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_requester_user_id::text, 0)
  );

  if v_body = '' then
    raise exception 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception 'LIVE_ROOM_MAX_LENGTH';
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

  if v_body ~* '(telegram|텔레그램|whats\s*app|왓츠앱|kakao\s*talk|카카오톡|discord|디스코드)' then
    v_risk_flags := array_append(v_risk_flags, 'off_platform_contact');
  end if;
  if v_body ~* '(wire transfer|bank transfer|deposit|account number|송금|입금|계좌\s*번호|계좌번호)' then
    v_risk_flags := array_append(v_risk_flags, 'money_transfer');
  end if;
  if v_body ~* '(guaranteed?\s+(return|profit)|risk[- ]?free profit|수익\s*보장|원금\s*보장|확정\s*수익)' then
    v_risk_flags := array_append(v_risk_flags, 'guaranteed_return');
  end if;
  if v_body ~* '(paid\s+(room|group)|vip\s*(room|group)|premium\s+signals?|유료\s*방|유료방|vip\s*방|리딩\s*방)' then
    v_risk_flags := array_append(v_risk_flags, 'paid_room');
  end if;
  if v_body ~* '(wallet\s*address|send\s+(btc|eth|usdt|crypto)|crypto\s+transfer|지갑\s*주소|암호화폐\s*전송|코인\s*전송)' then
    v_risk_flags := array_append(v_risk_flags, 'crypto_wallet');
  end if;
  if (
    regexp_count(
      v_body,
      '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
      1,
      'i'
    )
    + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
    >= 2
    or (
      regexp_count(
        v_body,
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
        1,
        'i'
      )
      + regexp_count(v_body, '\+?[0-9][0-9 ()-]{7,}[0-9]', 1, 'i')
      >= 1
      and exists (
        select 1
        from public.live_room_direct_messages as recent
        where recent.sender_user_id = p_requester_user_id
          and recent.created_at >= v_now - interval '120 seconds'
          and (
            regexp_count(
              recent.body,
              '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
              1,
              'i'
            )
            + regexp_count(
              recent.body,
              '\+?[0-9][0-9 ()-]{7,}[0-9]',
              1,
              'i'
            )
          ) >= 1
      )
    )
  )
  then
    v_risk_flags := array_append(v_risk_flags, 'repeated_contact');
  end if;
  v_risk_score := least(100, cardinality(v_risk_flags) * 20);

  insert into public.live_room_direct_messages (
    conversation_id,
    sender_user_id,
    body,
    message_kind,
    risk_flags,
    risk_score
  )
  values (
    v_conversation.id,
    p_requester_user_id,
    v_body,
    'chat',
    v_risk_flags,
    v_risk_score
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
      conversation.status,
      conversation.request_sender_user_id,
      conversation.request_created_at,
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
      and conversation.status in ('accepted', 'pending')
    order by conversation.updated_at desc, conversation.id desc
    limit 50
  ),
  visible as (
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
  enriched as (
    select
      visible.*,
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
      latest.risk_flags as latest_risk_flags,
      latest.risk_score as latest_risk_score,
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
      case
        when visible.status <> 'accepted' then 0
        else (
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
        )
      end as unread_count
    from visible
    join public.live_room_member_profiles as profile
      on profile.user_id = visible.peer_user_id
    left join public.user_plan_subscriptions as subscription
      on subscription.user_id = visible.peer_user_id
    left join lateral (
      select
        message.id,
        message.sender_user_id,
        message.body,
        message.created_at,
        message.risk_flags,
        message.risk_score
      from public.live_room_direct_messages as message
      where message.conversation_id = visible.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
  ),
  accepted_limited as (
    select enriched.*
    from enriched
    where enriched.status = 'accepted'
    order by
      coalesce(enriched.latest_created_at, enriched.updated_at) desc,
      enriched.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  ),
  incoming_limited as (
    select enriched.*
    from enriched
    where enriched.status = 'pending'
      and enriched.request_sender_user_id <> p_requester_user_id
    order by enriched.request_created_at desc, enriched.id desc
    limit 20
  ),
  outgoing_limited as (
    select enriched.*
    from enriched
    where enriched.status = 'pending'
      and enriched.request_sender_user_id = p_requester_user_id
    order by enriched.request_created_at desc, enriched.id desc
    limit 20
  )
  select jsonb_build_object(
    'isAuthenticated', true,
    'totalUnreadCount',
      coalesce(
        (
          select sum(enriched.unread_count)
          from enriched
          where enriched.status = 'accepted'
        ),
        0
      )
      + (
        select count(*)
        from enriched
        where enriched.status = 'pending'
          and enriched.request_sender_user_id <> p_requester_user_id
      ),
    'pendingRequestCount',
      (
        select count(*)
        from enriched
        where enriched.status = 'pending'
          and enriched.request_sender_user_id <> p_requester_user_id
      ),
    'conversations',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', accepted.public_id,
              'status', accepted.status,
              'peerDisplayName', accepted.peer_display_name,
              'peerEmoji', accepted.peer_emoji,
              'peerPlan', accepted.peer_plan,
              'latestBodyPreview',
                left(
                  regexp_replace(
                    coalesce(accepted.latest_body, ''),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  120
                ),
              'latestCreatedAt', accepted.latest_created_at,
              'latestIsMine',
                accepted.latest_sender_user_id = p_requester_user_id,
              'mutualFollow', accepted.mutual_follow,
              'unreadCount', accepted.unread_count
            )
            order by
              coalesce(accepted.latest_created_at, accepted.updated_at) desc,
              accepted.id desc
          )
          from accepted_limited as accepted
        ),
        '[]'::jsonb
      ),
    'incomingRequests',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', incoming.public_id,
              'peerDisplayName', incoming.peer_display_name,
              'peerEmoji', incoming.peer_emoji,
              'peerPlan', incoming.peer_plan,
              'bodyPreview',
                left(
                  regexp_replace(
                    coalesce(incoming.latest_body, ''),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  160
                ),
              'createdAt', incoming.request_created_at,
              'riskFlags', incoming.latest_risk_flags,
              'riskScore', incoming.latest_risk_score
            )
            order by incoming.request_created_at desc, incoming.id desc
          )
          from incoming_limited as incoming
        ),
        '[]'::jsonb
      ),
    'outgoingRequests',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'conversationId', outgoing.public_id,
              'peerDisplayName', outgoing.peer_display_name,
              'peerEmoji', outgoing.peer_emoji,
              'peerPlan', outgoing.peer_plan,
              'bodyPreview',
                left(
                  regexp_replace(
                    coalesce(outgoing.latest_body, ''),
                    '[[:space:]]+',
                    ' ',
                    'g'
                  ),
                  160
                ),
              'createdAt', outgoing.request_created_at,
              'riskFlags', outgoing.latest_risk_flags,
              'riskScore', outgoing.latest_risk_score
            )
            order by outgoing.request_created_at desc, outgoing.id desc
          )
          from outgoing_limited as outgoing
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
    and conversation.status in ('accepted', 'pending')
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
      message.message_kind,
      message.risk_flags,
      message.risk_score,
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
    'status', v_conversation.status,
    'requestRole',
      case
        when v_conversation.status <> 'pending' then null
        when v_conversation.request_sender_user_id = p_requester_user_id
          then 'sender'
        else 'recipient'
      end,
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
    'canSend', v_conversation.status = 'accepted',
    'canRespond',
      v_conversation.status = 'pending'
      and v_conversation.request_sender_user_id <> p_requester_user_id,
    'readOnlyReason',
      case
        when v_conversation.status = 'accepted' then null
        when v_conversation.request_sender_user_id = p_requester_user_id
          then 'Your message request is pending.'
        else 'Accept this message request before replying.'
      end,
    'messages',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', page.id,
              'body', page.body,
              'createdAt', page.created_at,
              'isMine', page.sender_user_id = p_requester_user_id,
              'kind', page.message_kind,
              'riskFlags', page.risk_flags,
              'riskScore', page.risk_score
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
    and conversation.status = 'accepted'
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

create function public.respond_live_room_direct_request(
  p_requester_user_id uuid,
  p_conversation_public_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.live_room_direct_conversations%rowtype;
  v_message public.live_room_direct_messages%rowtype;
  v_peer_profile public.live_room_member_profiles%rowtype;
  v_peer_user_id uuid;
  v_now timestamptz := now();
begin
  if p_action not in ('accept', 'decline', 'block') then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_ACTION';
  end if;

  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and conversation.status = 'pending'
    and p_requester_user_id in (
      conversation.member_low_user_id,
      conversation.member_high_user_id
    )
  for update;

  if not found
    or v_conversation.request_sender_user_id = p_requester_user_id
  then
    raise exception 'LIVE_ROOM_DIRECT_NOT_FOUND';
  end if;

  v_peer_user_id := v_conversation.request_sender_user_id;

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

  if p_action = 'accept' then
    update public.live_room_direct_conversations
    set status = 'accepted',
        accepted_at = v_now,
        declined_at = null,
        state_updated_at = v_now,
        updated_at = v_now
    where id = v_conversation.id;

    select message.*
    into v_message
    from public.live_room_direct_messages as message
    where message.conversation_id = v_conversation.id
      and message.message_kind = 'request'
    limit 1;

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
      v_now
    )
    on conflict (conversation_id, member_user_id)
    do update set
      last_read_message_id = excluded.last_read_message_id,
      last_read_at = excluded.last_read_at,
      updated_at = excluded.updated_at;

    return jsonb_build_object(
      'status', 'accepted',
      'conversationId', v_conversation.public_id
    );
  end if;

  if p_action = 'block' then
    select profile.*
    into v_peer_profile
    from public.live_room_member_profiles as profile
    where profile.user_id = v_peer_user_id;

    insert into public.live_room_actor_blocks (
      blocker_kind,
      blocker_member_user_id,
      blocker_guest_session_id,
      blocked_kind,
      blocked_member_user_id,
      blocked_guest_session_id,
      blocked_display_name,
      blocked_emoji
    )
    values (
      'member',
      p_requester_user_id,
      null,
      'member',
      v_peer_user_id,
      null,
      coalesce(v_peer_profile.display_name, 'Member'),
      coalesce(v_peer_profile.emoji, '💬')
    )
    on conflict (
      blocker_kind,
      blocker_actor_id,
      blocked_kind,
      blocked_actor_id
    )
    do update set
      blocked_display_name = excluded.blocked_display_name,
      blocked_emoji = excluded.blocked_emoji;
  end if;

  update public.live_room_direct_conversations
  set status = 'declined',
      declined_at = v_now,
      state_updated_at = v_now,
      updated_at = v_now
  where id = v_conversation.id;

  return jsonb_build_object(
    'status', case when p_action = 'block' then 'blocked' else 'declined' end,
    'conversationId', null
  );
end;
$$;

create function public.get_live_room_direct_message_settings(
  p_member_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'receiveMode', coalesce(setting.receive_mode, 'followers'),
    'requestFilter', coalesce(setting.request_filter, 'any')
  )
  from (select 1) as singleton
  left join public.live_room_direct_message_settings as setting
    on setting.member_user_id = p_member_user_id
$$;

create function public.set_live_room_direct_message_settings(
  p_member_user_id uuid,
  p_receive_mode text,
  p_request_filter text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_receive_mode not in (
    'mutual_only',
    'people_i_follow',
    'followers',
    'everyone',
    'nobody'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_RECEIVE_MODE';
  end if;

  if p_request_filter not in (
    'any',
    'moderators',
    'verified',
    'pro_members'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REQUEST_FILTER';
  end if;

  insert into public.live_room_direct_message_settings (
    member_user_id,
    receive_mode,
    request_filter,
    updated_at
  )
  values (
    p_member_user_id,
    p_receive_mode,
    p_request_filter,
    now()
  )
  on conflict (member_user_id)
  do update set
    receive_mode = excluded.receive_mode,
    request_filter = excluded.request_filter,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'receiveMode', p_receive_mode,
    'requestFilter', p_request_filter
  );
end;
$$;

create function public.report_live_room_direct_message(
  p_requester_user_id uuid,
  p_conversation_public_id uuid,
  p_message_id uuid,
  p_reason text
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
  if p_reason not in (
    'spam',
    'harassment',
    'scam',
    'misinformation',
    'other'
  ) then
    raise exception 'LIVE_ROOM_DIRECT_INVALID_REPORT_REASON';
  end if;

  select conversation.*
  into v_conversation
  from public.live_room_direct_conversations as conversation
  where conversation.public_id = p_conversation_public_id
    and conversation.status in ('accepted', 'pending')
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

  select message.*
  into v_message
  from public.live_room_direct_messages as message
  where message.id = p_message_id
    and message.conversation_id = v_conversation.id
    and message.sender_user_id <> p_requester_user_id;

  if not found then
    raise exception 'LIVE_ROOM_DIRECT_MESSAGE_NOT_FOUND';
  end if;

  insert into public.live_room_direct_message_reports (
    conversation_id,
    message_id,
    reporter_user_id,
    reason,
    priority,
    risk_score_snapshot
  )
  values (
    v_conversation.id,
    v_message.id,
    p_requester_user_id,
    p_reason,
    case
      when v_message.risk_score > 0
        then least(200, 100 + v_message.risk_score)
      else 10
    end,
    v_message.risk_score
  )
  on conflict (message_id, reporter_user_id) do nothing;

  return true;
end;
$$;

revoke all privileges
on function public.start_live_room_direct_conversation(uuid, uuid, text)
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

revoke all privileges
on function public.respond_live_room_direct_request(uuid, uuid, text)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_direct_message_settings(uuid)
from public, anon, authenticated;

revoke all privileges
on function public.set_live_room_direct_message_settings(
  uuid,
  text,
  text
)
from public, anon, authenticated;

revoke all privileges
on function public.report_live_room_direct_message(
  uuid,
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

grant execute
on function public.start_live_room_direct_conversation(uuid, uuid, text)
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

grant execute
on function public.respond_live_room_direct_request(uuid, uuid, text)
to service_role;

grant execute
on function public.get_live_room_direct_message_settings(uuid)
to service_role;

grant execute
on function public.set_live_room_direct_message_settings(
  uuid,
  text,
  text
)
to service_role;

grant execute
on function public.report_live_room_direct_message(
  uuid,
  uuid,
  uuid,
  text
)
to service_role;

comment on table public.live_room_direct_message_settings is
  'Service-only member privacy settings for non-mutual direct-message requests.';

comment on table public.live_room_direct_message_reports is
  'Service-only participant reports. Stored risk scores raise moderation priority without blocking accepted messages.';

comment on column public.live_room_direct_conversations.status is
  'accepted conversations permit chat until blocked; pending is one request; declined is retained to prevent repeats.';

comment on column public.live_room_direct_messages.risk_flags is
  'Safety cues for warnings and report prioritization, not investment expertise or paid advice access.';

commit;
