begin;

create table public.public_telegram_broadcast_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.events (id)
    on update restrict
    on delete cascade,
  channel text not null default 'telegram_public',
  status text not null default 'pending',
  scheduled_for timestamptz not null,
  next_retry_at timestamptz,
  attempt_token uuid,
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_telegram_broadcast_event_channel_key
    unique (event_id, channel),
  constraint public_telegram_broadcast_channel_check
    check (channel = 'telegram_public'),
  constraint public_telegram_broadcast_status_check
    check (status in (
      'pending',
      'attempting',
      'sent',
      'failed',
      'suppressed',
      'uncertain'
    )),
  constraint public_telegram_broadcast_attempt_count_check
    check (attempt_count >= 0),
  constraint public_telegram_broadcast_completed_after_started_check
    check (
      completed_at is null
      or started_at is null
      or completed_at >= started_at
    )
);

create index public_telegram_broadcast_due_idx
  on public.public_telegram_broadcast_deliveries (
    status,
    scheduled_for,
    next_retry_at,
    created_at
  );

alter table public.public_telegram_broadcast_deliveries
  enable row level security;

revoke all on table public.public_telegram_broadcast_deliveries
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.public_telegram_broadcast_deliveries
  to service_role;

create or replace function public.enqueue_public_telegram_broadcast()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.score >= 75
    and pg_catalog.btrim(coalesce(new.quick_take, '')) <> ''
  then
    insert into public.public_telegram_broadcast_deliveries (
      event_id,
      channel,
      status,
      scheduled_for
    )
    values (
      new.id,
      'telegram_public',
      'pending',
      coalesce(
        new.published_at,
        new.detected_at,
        pg_catalog.now()
      ) + interval '5 minutes'
    )
    on conflict (event_id, channel) do update
    set
      scheduled_for = excluded.scheduled_for,
      updated_at = pg_catalog.now()
    where public_telegram_broadcast_deliveries.status = 'pending'
      and public_telegram_broadcast_deliveries.attempt_count = 0;
  end if;

  return new;
end;
$$;

create trigger events_enqueue_public_telegram_broadcast
after insert or update of score, quick_take, published_at, detected_at
on public.events
for each row
execute function public.enqueue_public_telegram_broadcast();

create or replace function public.claim_public_telegram_broadcast(
  p_delivery_id uuid,
  p_attempt_token uuid
)
returns table (
  acquired boolean,
  attempt_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_token uuid;
begin
  update public.public_telegram_broadcast_deliveries
  set
    status = 'attempting',
    attempt_token = p_attempt_token,
    attempt_count = attempt_count + 1,
    started_at = pg_catalog.now(),
    completed_at = null,
    provider_message_id = null,
    last_error = null,
    next_retry_at = null,
    updated_at = pg_catalog.now()
  where id = p_delivery_id
    and status in ('pending', 'failed')
    and scheduled_for <= pg_catalog.now()
    and (
      next_retry_at is null
      or next_retry_at <= pg_catalog.now()
    );

  select delivery.status, delivery.attempt_token
  into v_status, v_token
  from public.public_telegram_broadcast_deliveries as delivery
  where delivery.id = p_delivery_id;

  return query
  select
    v_status = 'attempting' and v_token = p_attempt_token,
    v_status;
end;
$$;

create or replace function public.finish_public_telegram_broadcast(
  p_delivery_id uuid,
  p_attempt_token uuid,
  p_status text,
  p_provider_message_id text default null,
  p_last_error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row_count integer := 0;
begin
  if p_status not in ('sent', 'failed', 'suppressed', 'uncertain') then
    raise exception 'unsupported public Telegram broadcast status';
  end if;

  update public.public_telegram_broadcast_deliveries
  set
    status = p_status,
    provider_message_id = nullif(pg_catalog.btrim(p_provider_message_id), ''),
    last_error = nullif(pg_catalog.left(p_last_error, 500), ''),
    completed_at = pg_catalog.now(),
    next_retry_at = case
      when p_status = 'failed' then pg_catalog.now() + interval '5 minutes'
      else null
    end,
    updated_at = pg_catalog.now()
  where id = p_delivery_id
    and status = 'attempting'
    and attempt_token = p_attempt_token;

  get diagnostics v_row_count = row_count;
  return v_row_count = 1;
end;
$$;

revoke all on function public.claim_public_telegram_broadcast(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_public_telegram_broadcast(uuid, uuid)
  to service_role;

revoke all on function public.finish_public_telegram_broadcast(
  uuid,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.finish_public_telegram_broadcast(
  uuid,
  uuid,
  text,
  text,
  text
) to service_role;

revoke all on function public.enqueue_public_telegram_broadcast()
  from public, anon, authenticated;
grant execute on function public.enqueue_public_telegram_broadcast()
  to service_role;

comment on table public.public_telegram_broadcast_deliveries is
  'Server-only event+channel delivery state for the free public Telegram broadcast. Failed provider responses retry; uncertain outcomes require reconciliation.';

commit;
