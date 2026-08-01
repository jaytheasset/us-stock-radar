begin;

-- Browser access to delivery history is ownership-scoped. Application routes
-- still use the service role, but direct Data API access remains safe.
alter table public.user_alert_deliveries enable row level security;

revoke all on table public.user_alert_deliveries from anon, authenticated;
grant select on table public.user_alert_deliveries to authenticated;
grant update (read_at) on table public.user_alert_deliveries to authenticated;

drop policy if exists user_alert_deliveries_select_own
  on public.user_alert_deliveries;
create policy user_alert_deliveries_select_own
on public.user_alert_deliveries
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_alert_deliveries_update_read_own
  on public.user_alert_deliveries;
create policy user_alert_deliveries_update_read_own
on public.user_alert_deliveries
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- One durable state row per delivery/channel prevents a duplicate external
-- send when a cron event is repeated or concurrent workers see the same queue
-- row. An "uncertain" result is deliberately not eligible for auto-retry.
create table public.alert_delivery_channel_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.user_alert_deliveries (id)
    on update restrict
    on delete cascade,
  user_id uuid not null
    references public.user_profiles (id)
    on update restrict
    on delete cascade,
  channel text not null,
  status text not null default 'pending',
  attempt_token uuid,
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_delivery_channel_attempts_delivery_channel_key
    unique (delivery_id, channel),
  constraint alert_delivery_channel_attempts_channel_check
    check (channel in ('web', 'telegram', 'email', 'webhook', 'api')),
  constraint alert_delivery_channel_attempts_status_check
    check (status in (
      'pending',
      'attempting',
      'sent',
      'failed',
      'suppressed',
      'uncertain'
    )),
  constraint alert_delivery_channel_attempts_attempt_count_check
    check (attempt_count >= 0),
  constraint alert_delivery_channel_attempts_completed_after_started_check
    check (
      completed_at is null
      or started_at is null
      or completed_at >= started_at
    )
);

create index alert_delivery_channel_attempts_user_created_idx
  on public.alert_delivery_channel_attempts (user_id, created_at desc);
create index alert_delivery_channel_attempts_status_updated_idx
  on public.alert_delivery_channel_attempts (status, updated_at desc);

alter table public.alert_delivery_channel_attempts enable row level security;
revoke all on table public.alert_delivery_channel_attempts
  from public, anon, authenticated;
grant select on table public.alert_delivery_channel_attempts to authenticated;
grant select, insert, update, delete
  on table public.alert_delivery_channel_attempts
  to service_role;

create policy alert_delivery_channel_attempts_select_own
on public.alert_delivery_channel_attempts
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.claim_alert_delivery_channel_attempt(
  p_delivery_id uuid,
  p_user_id uuid,
  p_channel text,
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
  if p_channel not in ('web', 'telegram', 'email', 'webhook', 'api') then
    raise exception 'unsupported alert delivery channel';
  end if;

  insert into public.alert_delivery_channel_attempts (
    delivery_id,
    user_id,
    channel,
    status,
    attempt_token,
    attempt_count,
    started_at,
    completed_at,
    provider_message_id,
    last_error,
    created_at,
    updated_at
  )
  values (
    p_delivery_id,
    p_user_id,
    p_channel,
    'attempting',
    p_attempt_token,
    1,
    pg_catalog.now(),
    null,
    null,
    null,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (delivery_id, channel) do update
  set
    status = 'attempting',
    attempt_token = excluded.attempt_token,
    attempt_count =
      public.alert_delivery_channel_attempts.attempt_count + 1,
    started_at = pg_catalog.now(),
    completed_at = null,
    provider_message_id = null,
    last_error = null,
    updated_at = pg_catalog.now()
  where public.alert_delivery_channel_attempts.status = 'pending';

  select attempt.status, attempt.attempt_token
  into v_status, v_token
  from public.alert_delivery_channel_attempts as attempt
  where attempt.delivery_id = p_delivery_id
    and attempt.channel = p_channel;

  return query
  select
    v_status = 'attempting' and v_token = p_attempt_token,
    v_status;
end;
$$;

create or replace function public.finish_alert_delivery_channel_attempt(
  p_delivery_id uuid,
  p_channel text,
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
    raise exception 'unsupported alert delivery attempt status';
  end if;

  update public.alert_delivery_channel_attempts
  set
    status = p_status,
    provider_message_id = nullif(pg_catalog.btrim(p_provider_message_id), ''),
    last_error = nullif(pg_catalog.left(p_last_error, 500), ''),
    completed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where delivery_id = p_delivery_id
    and channel = p_channel
    and status = 'attempting'
    and attempt_token = p_attempt_token;

  get diagnostics v_row_count = row_count;
  return v_row_count = 1;
end;
$$;

revoke all on function public.claim_alert_delivery_channel_attempt(
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.claim_alert_delivery_channel_attempt(
  uuid,
  uuid,
  text,
  uuid
) to service_role;

revoke all on function public.finish_alert_delivery_channel_attempt(
  uuid,
  text,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.finish_alert_delivery_channel_attempt(
  uuid,
  text,
  uuid,
  text,
  text,
  text
) to service_role;

comment on table public.alert_delivery_channel_attempts is
  'Server-owned per-channel delivery state. Uncertain external sends are not automatically retried.';

commit;
