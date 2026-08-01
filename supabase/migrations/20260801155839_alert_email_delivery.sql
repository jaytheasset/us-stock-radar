begin;

alter table public.alert_delivery_channel_attempts
  add column if not exists next_retry_at timestamptz,
  add column if not exists provider_status text,
  add column if not exists provider_status_at timestamptz,
  add column if not exists provider_status_reason text;

create unique index if not exists alert_delivery_email_provider_message_unique
  on public.alert_delivery_channel_attempts (provider_message_id)
  where channel = 'email' and provider_message_id is not null;

create table if not exists public.alert_email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  webhook_id text not null unique,
  provider_message_id text not null,
  event_type text not null check (
    event_type in ('email.delivered', 'email.bounced', 'email.complained', 'email.suppressed')
  ),
  event_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

alter table public.alert_email_webhook_events enable row level security;
revoke all on table public.alert_email_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on table public.alert_email_webhook_events to service_role;

drop function if exists public.claim_alert_delivery_channel_attempt(uuid, uuid, text, uuid);
create function public.claim_alert_delivery_channel_attempt(
  p_delivery_id uuid,
  p_user_id uuid,
  p_channel text,
  p_attempt_token uuid
)
returns table (acquired boolean, attempt_status text, retry_at timestamptz, attempt_number integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_token uuid;
  v_retry_at timestamptz;
  v_attempt_count integer;
begin
  if p_channel not in ('web', 'telegram', 'email', 'webhook', 'api') then
    raise exception 'unsupported alert delivery channel';
  end if;

  insert into public.alert_delivery_channel_attempts (
    delivery_id, user_id, channel, status, attempt_token, attempt_count,
    started_at, completed_at, provider_message_id, last_error, next_retry_at,
    created_at, updated_at
  ) values (
    p_delivery_id, p_user_id, p_channel, 'attempting', p_attempt_token, 1,
    now(), null, null, null, null, now(), now()
  )
  on conflict (delivery_id, channel) do update set
    status = 'attempting',
    attempt_token = excluded.attempt_token,
    attempt_count = public.alert_delivery_channel_attempts.attempt_count + 1,
    started_at = now(),
    completed_at = null,
    provider_message_id = null,
    last_error = null,
    next_retry_at = null,
    updated_at = now()
  where public.alert_delivery_channel_attempts.status = 'pending'
    or (
      public.alert_delivery_channel_attempts.channel = 'email'
      and public.alert_delivery_channel_attempts.status = 'failed'
      and public.alert_delivery_channel_attempts.next_retry_at <= now()
      and public.alert_delivery_channel_attempts.attempt_count < 3
    );

  select attempt.status, attempt.attempt_token, attempt.next_retry_at, attempt.attempt_count
  into v_status, v_token, v_retry_at, v_attempt_count
  from public.alert_delivery_channel_attempts as attempt
  where attempt.delivery_id = p_delivery_id and attempt.channel = p_channel;

  return query select
    v_status = 'attempting' and v_token = p_attempt_token,
    v_status,
    v_retry_at,
    v_attempt_count;
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
  v_user_id uuid;
  v_provider_status text;
  v_provider_status_at timestamptz;
begin
  if p_status not in ('sent', 'failed', 'suppressed', 'uncertain') then
    raise exception 'unsupported alert delivery attempt status';
  end if;

  update public.alert_delivery_channel_attempts set
    status = p_status,
    provider_message_id = nullif(btrim(p_provider_message_id), ''),
    last_error = nullif(left(p_last_error, 500), ''),
    next_retry_at = case
      when channel = 'email' and p_status = 'failed' and attempt_count < 3
        then now() + interval '5 minutes'
      else null
    end,
    completed_at = now(),
    updated_at = now()
  where delivery_id = p_delivery_id
    and channel = p_channel
    and status = 'attempting'
    and attempt_token = p_attempt_token;

  get diagnostics v_row_count = row_count;
  if v_row_count = 1 and p_channel = 'email' and nullif(btrim(p_provider_message_id), '') is not null then
    select event_type, event_created_at
    into v_provider_status, v_provider_status_at
    from public.alert_email_webhook_events
    where provider_message_id = p_provider_message_id
    order by event_created_at desc, received_at desc
    limit 1;

    if v_provider_status is not null then
      update public.alert_delivery_channel_attempts set
        provider_status = v_provider_status,
        provider_status_at = v_provider_status_at,
        provider_status_reason = case
          when v_provider_status in ('email.bounced', 'email.complained', 'email.suppressed')
            then v_provider_status
          else null
        end,
        updated_at = now()
      where delivery_id = p_delivery_id and channel = 'email'
      returning user_id into v_user_id;

      if v_user_id is not null and v_provider_status in ('email.bounced', 'email.complained', 'email.suppressed') then
        update public.user_delivery_channels set
          enabled = false,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'email_suppressed', true,
            'email_suppression_reason', v_provider_status,
            'email_suppressed_at', v_provider_status_at
          ),
          updated_at = now()
        where user_id = v_user_id and channel = 'email';
      end if;
    end if;
  end if;
  return v_row_count = 1;
end;
$$;

create or replace function public.record_alert_email_webhook_event(
  p_webhook_id text,
  p_provider_message_id text,
  p_event_type text,
  p_event_created_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_user_id uuid;
begin
  if p_event_type not in ('email.delivered', 'email.bounced', 'email.complained', 'email.suppressed') then
    raise exception 'unsupported email webhook event';
  end if;

  insert into public.alert_email_webhook_events (
    webhook_id, provider_message_id, event_type, event_created_at
  ) values (
    left(btrim(p_webhook_id), 255), left(btrim(p_provider_message_id), 255),
    p_event_type, p_event_created_at
  ) on conflict (webhook_id) do nothing;
  get diagnostics v_inserted = row_count;
  update public.alert_delivery_channel_attempts set
    provider_status = p_event_type,
    provider_status_at = p_event_created_at,
    provider_status_reason = case
      when p_event_type in ('email.bounced', 'email.complained', 'email.suppressed')
        then p_event_type
      else null
    end,
    updated_at = now()
  where channel = 'email'
    and provider_message_id = p_provider_message_id
    and (provider_status_at is null or provider_status_at <= p_event_created_at)
  returning user_id into v_user_id;

  if v_user_id is not null and p_event_type in ('email.bounced', 'email.complained', 'email.suppressed') then
    update public.user_delivery_channels set
      enabled = false,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'email_suppressed', true,
        'email_suppression_reason', p_event_type,
        'email_suppressed_at', p_event_created_at
      ),
      updated_at = now()
    where user_id = v_user_id and channel = 'email';
  end if;

  return v_inserted = 1;
end;
$$;

revoke all on function public.record_alert_email_webhook_event(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_alert_email_webhook_event(text, text, text, timestamptz)
  to service_role;
revoke all on function public.claim_alert_delivery_channel_attempt(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_alert_delivery_channel_attempt(uuid, uuid, text, uuid)
  to service_role;

comment on table public.alert_email_webhook_events is
  'Service-role-only durable idempotency ledger for verified Resend webhooks.';
comment on column public.alert_delivery_channel_attempts.next_retry_at is
  'Email-only bounded retry schedule. Uncertain external outcomes never retry.';

commit;
