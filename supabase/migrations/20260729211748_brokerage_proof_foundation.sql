create table public.brokerage_connections (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  provider text not null default 'snaptrade' check (provider = 'snaptrade'),
  provider_user_id text not null unique,
  encrypted_user_secret text,
  secret_iv text,
  secret_auth_tag text,
  secret_key_version smallint,
  status text not null default 'registered'
    check (status in ('registered', 'connecting', 'connected', 'disconnected', 'disabled', 'deleting')),
  terms_version text,
  terms_accepted_at timestamptz,
  public_consent_version text,
  public_consent_at timestamptz,
  has_live_account boolean not null default false,
  has_paper_account boolean not null default false,
  connected_at timestamptz,
  last_synced_at timestamptz,
  disconnected_at timestamptz,
  disabled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brokerage_connections_secret_complete check (
    (
      encrypted_user_secret is null
      and secret_iv is null
      and secret_auth_tag is null
      and secret_key_version is null
    )
    or (
      encrypted_user_secret is not null
      and secret_iv is not null
      and secret_auth_tag is not null
      and secret_key_version is not null
    )
  )
);

create table public.brokerage_proofs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles(id) on delete cascade,
  kind text not null check (kind in ('position', 'execution')),
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  side text not null check (side in ('LONG', 'SHORT', 'BUY', 'SELL')),
  account_type text not null check (account_type in ('live', 'paper')),
  verification_stage text not null
    check (verification_stage in ('current', 'historical', 'provisional', 'final')),
  verified_as_of timestamptz not null,
  execution_date date,
  units numeric,
  average_cost numeric,
  execution_price numeric,
  execution_quantity numeric,
  broker_name text,
  disclose_units boolean not null default false,
  disclose_average_cost boolean not null default false,
  disclose_execution_price boolean not null default false,
  disclose_execution_quantity boolean not null default false,
  disclose_broker_name boolean not null default false,
  source_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint brokerage_proofs_kind_fields check (
    (
      kind = 'position'
      and side in ('LONG', 'SHORT')
      and verification_stage in ('current', 'historical')
      and execution_date is null
      and execution_price is null
      and execution_quantity is null
    )
    or (
      kind = 'execution'
      and side in ('BUY', 'SELL')
      and verification_stage in ('provisional', 'final')
      and execution_date is not null
      and units is null
      and average_cost is null
    )
  ),
  constraint brokerage_proofs_disclosure_values check (
    (not disclose_units or units is not null)
    and (not disclose_average_cost or average_cost is not null)
    and (not disclose_execution_price or execution_price is not null)
    and (not disclose_execution_quantity or execution_quantity is not null)
    and (not disclose_broker_name or nullif(btrim(broker_name), '') is not null)
  ),
  unique (owner_user_id, source_fingerprint)
);

create table public.brokerage_proof_status (
  proof_id uuid primary key references public.brokerage_proofs(id) on delete cascade,
  connection_state text not null default 'connected'
    check (connection_state in ('connected', 'expired', 'disconnected')),
  revoked_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.live_room_message_brokerage_proofs (
  message_id uuid primary key references public.live_room_messages(id) on delete cascade,
  proof_id uuid not null references public.brokerage_proofs(id) on delete restrict,
  attached_at timestamptz not null default now()
);

create table public.live_room_post_brokerage_proofs (
  post_id uuid primary key references public.live_room_posts(id) on delete cascade,
  proof_id uuid not null references public.brokerage_proofs(id) on delete restrict,
  attached_at timestamptz not null default now()
);

create table public.brokerage_webhook_events (
  webhook_id text primary key,
  event_type text not null,
  event_timestamp timestamptz not null,
  payload_sha256 text not null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index brokerage_connections_status_idx
  on public.brokerage_connections (status, user_id);
create index brokerage_proofs_owner_created_idx
  on public.brokerage_proofs (owner_user_id, created_at desc);
create index brokerage_proofs_ticker_created_idx
  on public.brokerage_proofs (ticker, created_at desc);
create index brokerage_proof_status_connection_idx
  on public.brokerage_proof_status (connection_state, proof_id);
create index live_room_message_brokerage_proofs_proof_idx
  on public.live_room_message_brokerage_proofs (proof_id);
create index live_room_post_brokerage_proofs_proof_idx
  on public.live_room_post_brokerage_proofs (proof_id);
create index brokerage_webhook_events_timestamp_idx
  on public.brokerage_webhook_events (event_timestamp desc);

alter table public.brokerage_connections enable row level security;
alter table public.brokerage_proofs enable row level security;
alter table public.brokerage_proof_status enable row level security;
alter table public.live_room_message_brokerage_proofs enable row level security;
alter table public.live_room_post_brokerage_proofs enable row level security;
alter table public.brokerage_webhook_events enable row level security;

revoke all on table public.brokerage_connections from public, anon, authenticated;
revoke all on table public.brokerage_proofs from public, anon, authenticated;
revoke all on table public.brokerage_proof_status from public, anon, authenticated;
revoke all on table public.live_room_message_brokerage_proofs from public, anon, authenticated;
revoke all on table public.live_room_post_brokerage_proofs from public, anon, authenticated;
revoke all on table public.brokerage_webhook_events from public, anon, authenticated;

grant select, insert, update, delete on table public.brokerage_connections to service_role;
grant select, insert, delete on table public.brokerage_proofs to service_role;
grant select, insert, update, delete on table public.brokerage_proof_status to service_role;
grant select, insert, delete on table public.live_room_message_brokerage_proofs to service_role;
grant select, insert, delete on table public.live_room_post_brokerage_proofs to service_role;
grant select, insert, update, delete on table public.brokerage_webhook_events to service_role;

create function private.brokerage_effective_plan_is_eligible(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    (
      select case
        when subscription.trial_plan in ('pro', 'advanced')
          and subscription.trial_started_at is not null
          and subscription.trial_ends_at > now()
          and (
            case subscription.trial_plan
              when 'advanced' then 3
              when 'pro' then 2
              else 0
            end
          ) >= 2
          then true
        when subscription.status = 'active'
          and subscription.plan in ('pro', 'advanced', 'ultimate')
          then true
        else false
      end
      from public.user_plan_subscriptions as subscription
      where subscription.user_id = p_user_id
    ),
    false
  );
$function$;

create function private.assert_brokerage_proof_attachable(
  p_owner_user_id uuid,
  p_proof_id uuid,
  p_public_sharing_enabled boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_proof_id is null then
    return;
  end if;
  if not coalesce(p_public_sharing_enabled, false) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_PUBLIC_SHARING_DISABLED';
  end if;
  if not private.brokerage_effective_plan_is_eligible(p_owner_user_id) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_PLAN_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.brokerage_proofs as proof
    join public.brokerage_proof_status as proof_status
      on proof_status.proof_id = proof.id
    where proof.id = p_proof_id
      and proof.owner_user_id = p_owner_user_id
      and proof_status.revoked_at is null
      and (proof_status.expires_at is null or proof_status.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_PROOF_NOT_ATTACHABLE';
  end if;
end
$function$;

create function public.create_brokerage_proof(
  p_owner_user_id uuid,
  p_kind text,
  p_ticker text,
  p_side text,
  p_account_type text,
  p_verification_stage text,
  p_verified_as_of timestamptz,
  p_execution_date date,
  p_units numeric,
  p_average_cost numeric,
  p_execution_price numeric,
  p_execution_quantity numeric,
  p_broker_name text,
  p_disclose_units boolean,
  p_disclose_average_cost boolean,
  p_disclose_execution_price boolean,
  p_disclose_execution_quantity boolean,
  p_disclose_broker_name boolean,
  p_source_fingerprint text,
  p_public_sharing_enabled boolean
)
returns public.brokerage_proofs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_proof public.brokerage_proofs;
begin
  if not coalesce(p_public_sharing_enabled, false) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_PUBLIC_SHARING_DISABLED';
  end if;
  if not private.brokerage_effective_plan_is_eligible(p_owner_user_id) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_PLAN_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.brokerage_connections as connection
    where connection.user_id = p_owner_user_id
      and connection.status = 'connected'
      and connection.terms_accepted_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_CONNECTION_REQUIRED';
  end if;

  insert into public.brokerage_proofs (
    owner_user_id, kind, ticker, side, account_type, verification_stage,
    verified_as_of, execution_date, units, average_cost, execution_price,
    execution_quantity, broker_name, disclose_units, disclose_average_cost,
    disclose_execution_price, disclose_execution_quantity, disclose_broker_name,
    source_fingerprint
  )
  values (
    p_owner_user_id, p_kind, upper(btrim(p_ticker)), p_side, p_account_type,
    p_verification_stage, p_verified_as_of, p_execution_date, p_units,
    p_average_cost, p_execution_price, p_execution_quantity,
    nullif(btrim(p_broker_name), ''), coalesce(p_disclose_units, false),
    coalesce(p_disclose_average_cost, false),
    coalesce(p_disclose_execution_price, false),
    coalesce(p_disclose_execution_quantity, false),
    coalesce(p_disclose_broker_name, false), p_source_fingerprint
  )
  on conflict (owner_user_id, source_fingerprint)
  do nothing
  returning * into v_proof;

  if v_proof.id is null then
    select *
    into v_proof
    from public.brokerage_proofs as proof
    where proof.owner_user_id = p_owner_user_id
      and proof.source_fingerprint = p_source_fingerprint;
  end if;

  insert into public.brokerage_proof_status (proof_id)
  values (v_proof.id)
  on conflict (proof_id) do nothing;
  return v_proof;
end
$function$;

create function public.insert_live_room_message_with_proof(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_author_display_name text,
  p_author_emoji text,
  p_author_plan text,
  p_body text,
  p_referenced_event_id uuid default null,
  p_reply_to_message_id uuid default null,
  p_proof_id uuid default null,
  p_public_sharing_enabled boolean default false
)
returns public.live_room_messages
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_message public.live_room_messages;
begin
  if p_proof_id is not null and (p_actor_kind <> 'member' or p_member_user_id is null) then
    raise exception using errcode = 'P0001', message = 'BROKERAGE_MEMBER_REQUIRED';
  end if;
  perform private.assert_brokerage_proof_attachable(
    p_member_user_id, p_proof_id, p_public_sharing_enabled
  );
  v_message := public.insert_live_room_message(
    p_room_id, p_actor_kind, p_member_user_id, p_guest_session_id,
    p_author_display_name, p_author_emoji, p_author_plan, p_body,
    p_referenced_event_id, p_reply_to_message_id
  );
  if p_proof_id is not null then
    insert into public.live_room_message_brokerage_proofs (message_id, proof_id)
    values (v_message.id, p_proof_id);
  end if;
  return v_message;
end
$function$;

create function public.create_live_room_post_with_proof(
  p_room_id uuid,
  p_author_user_id uuid,
  p_title text,
  p_body text,
  p_related_tickers text[] default array[]::text[],
  p_referenced_event_id uuid default null,
  p_signal_labels public.live_room_post_signal[] default array[]::public.live_room_post_signal[],
  p_proof_id uuid default null,
  p_public_sharing_enabled boolean default false
)
returns public.live_room_posts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_post public.live_room_posts;
begin
  perform private.assert_brokerage_proof_attachable(
    p_author_user_id, p_proof_id, p_public_sharing_enabled
  );
  v_post := public.create_live_room_post(
    p_room_id, p_author_user_id, p_title, p_body, p_related_tickers,
    p_referenced_event_id, p_signal_labels
  );
  if p_proof_id is not null then
    insert into public.live_room_post_brokerage_proofs (post_id, proof_id)
    values (v_post.id, p_proof_id);
  end if;
  return v_post;
end
$function$;

create function private.prevent_brokerage_proof_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = 'P0001', message = 'BROKERAGE_PROOF_IMMUTABLE';
end
$function$;

create trigger brokerage_proofs_immutable
before update on public.brokerage_proofs
for each row execute function private.prevent_brokerage_proof_mutation();

revoke all on function private.brokerage_effective_plan_is_eligible(uuid)
  from public, anon, authenticated;
revoke all on function private.assert_brokerage_proof_attachable(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.prevent_brokerage_proof_mutation()
  from public, anon, authenticated;
grant execute on function private.brokerage_effective_plan_is_eligible(uuid)
  to service_role;
grant execute on function private.assert_brokerage_proof_attachable(uuid, uuid, boolean)
  to service_role;
grant execute on function private.prevent_brokerage_proof_mutation()
  to service_role;

revoke all on function public.create_brokerage_proof(
  uuid, text, text, text, text, text, timestamptz, date, numeric, numeric,
  numeric, numeric, text, boolean, boolean, boolean, boolean, boolean, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_brokerage_proof(
  uuid, text, text, text, text, text, timestamptz, date, numeric, numeric,
  numeric, numeric, text, boolean, boolean, boolean, boolean, boolean, text, boolean
) to service_role;

revoke all on function public.insert_live_room_message_with_proof(
  uuid, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.insert_live_room_message_with_proof(
  uuid, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, boolean
) to service_role;

revoke all on function public.create_live_room_post_with_proof(
  uuid, uuid, text, text, text[], uuid, public.live_room_post_signal[], uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_live_room_post_with_proof(
  uuid, uuid, text, text, text[], uuid, public.live_room_post_signal[], uuid, boolean
) to service_role;
