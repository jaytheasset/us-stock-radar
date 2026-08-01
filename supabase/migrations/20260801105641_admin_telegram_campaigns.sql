begin;

create table public.admin_telegram_campaigns (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft',
  notice_type text,
  title text,
  body text,
  ticker text,
  source_label text,
  source_url text,
  analysis_url text,
  live_room_url text,
  scheduled_for timestamptz,
  scheduled_by uuid references public.user_profiles(id) on delete set null,
  scheduled_by_role text,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  sent_by uuid references public.user_profiles(id) on delete set null,
  canceled_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  canceled_at timestamptz,
  attempt_token uuid,
  attempt_count integer not null default 0,
  attempt_actor_user_id uuid references public.user_profiles(id) on delete set null,
  attempt_actor_role text,
  attempt_trigger text,
  started_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  delivery_outcome text not null default 'none',
  retry_allowed boolean not null default false,
  last_error text,
  version integer not null default 1,
  constraint admin_telegram_campaigns_status_check check (
    status in ('draft', 'scheduled', 'sending', 'sent', 'canceled', 'failed')
  ),
  constraint admin_telegram_campaigns_notice_type_check check (
    notice_type is null or notice_type in (
      'general',
      'special_issue',
      'company_event',
      'macro_policy',
      'live_room'
    )
  ),
  constraint admin_telegram_campaigns_title_check check (
    title is null or char_length(title) between 1 and 160
  ),
  constraint admin_telegram_campaigns_body_check check (
    body is null or char_length(body) between 1 and 3500
  ),
  constraint admin_telegram_campaigns_content_check check (
    coalesce(char_length(title), 0) > 0 or coalesce(char_length(body), 0) > 0
  ),
  constraint admin_telegram_campaigns_ticker_check check (
    ticker is null or ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'
  ),
  constraint admin_telegram_campaigns_source_label_check check (
    source_label is null or char_length(source_label) between 1 and 120
  ),
  constraint admin_telegram_campaigns_source_url_check check (
    source_url is null or source_url ~* '^https?://[^[:space:]]+$'
  ),
  constraint admin_telegram_campaigns_analysis_url_check check (
    analysis_url is null or analysis_url ~* '^https?://[^[:space:]]+$'
  ),
  constraint admin_telegram_campaigns_live_room_url_check check (
    live_room_url is null or live_room_url ~* '^https?://[^[:space:]]+$'
  ),
  constraint admin_telegram_campaigns_schedule_state_check check (
    status <> 'scheduled'
    or (scheduled_for is not null and scheduled_by_role is not null)
  ),
  constraint admin_telegram_campaigns_attempt_count_check check (
    attempt_count >= 0
  ),
  constraint admin_telegram_campaigns_attempt_trigger_check check (
    attempt_trigger is null or attempt_trigger in ('admin', 'scheduler', 'local_mock')
  ),
  constraint admin_telegram_campaigns_delivery_outcome_check check (
    delivery_outcome in ('none', 'sent', 'not_sent', 'uncertain')
  ),
  constraint admin_telegram_campaigns_retry_policy_check check (
    retry_allowed = false or (status = 'failed' and delivery_outcome = 'not_sent')
  ),
  constraint admin_telegram_campaigns_version_check check (version > 0),
  constraint admin_telegram_campaigns_completed_after_started_check check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

comment on table public.admin_telegram_campaigns is
  'Server-only operator-authored campaigns for the free public Telegram channel. Provider secrets and channel identifiers are never stored here.';

create index admin_telegram_campaigns_status_schedule_idx
  on public.admin_telegram_campaigns (status, scheduled_for, created_at)
  where status in ('scheduled', 'sending', 'failed');

create index admin_telegram_campaigns_created_idx
  on public.admin_telegram_campaigns (created_at desc, id desc);

create index admin_telegram_campaigns_created_by_idx
  on public.admin_telegram_campaigns (created_by, created_at desc);

alter table public.admin_telegram_campaigns enable row level security;

revoke all on table public.admin_telegram_campaigns
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.admin_telegram_campaigns
  to service_role;

create function private.admin_telegram_campaign_role(p_actor_user_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'operations']
  )
$function$;

create function private.admin_telegram_campaign_reason(p_reason text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if pg_catalog.char_length(v_reason) < 4 then
    raise exception 'ADMIN_REASON_REQUIRED';
  end if;
  return pg_catalog.left(v_reason, 2000);
end
$function$;

create function private.admin_telegram_campaign_url(p_value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_value text := nullif(pg_catalog.btrim(coalesce(p_value, '')), '');
begin
  if v_value is not null and v_value !~* '^https?://[^[:space:]]+$' then
    raise exception 'ADMIN_TELEGRAM_URL_INVALID';
  end if;
  return v_value;
end
$function$;

create function private.admin_telegram_campaign_role_required(
  p_actor_user_id uuid
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_role text;
begin
  v_role := private.admin_telegram_campaign_role(p_actor_user_id);
  if v_role is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  return v_role;
end
$function$;

create function public.admin_save_telegram_campaign(
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_notice_type text,
  p_title text,
  p_body text,
  p_ticker text,
  p_source_label text,
  p_source_url text,
  p_analysis_url text,
  p_live_room_url text,
  p_reason text,
  p_request_id text default null,
  p_expected_version integer default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_campaign_id uuid;
  v_reason text;
  v_notice_type text := nullif(pg_catalog.btrim(coalesce(p_notice_type, '')), '');
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
  v_ticker text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_ticker, ''))), '');
  v_source_label text := nullif(pg_catalog.btrim(coalesce(p_source_label, '')), '');
  v_source_url text;
  v_analysis_url text;
  v_live_room_url text;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  v_reason := private.admin_telegram_campaign_reason(p_reason);
  v_source_url := private.admin_telegram_campaign_url(p_source_url);
  v_analysis_url := private.admin_telegram_campaign_url(p_analysis_url);
  v_live_room_url := private.admin_telegram_campaign_url(p_live_room_url);

  if v_notice_type is not null and v_notice_type not in (
    'general', 'special_issue', 'company_event', 'macro_policy', 'live_room'
  ) then
    raise exception 'ADMIN_TELEGRAM_NOTICE_TYPE_INVALID';
  end if;
  if v_title is null and v_body is null then
    raise exception 'ADMIN_TELEGRAM_CONTENT_REQUIRED';
  end if;
  if v_title is not null and pg_catalog.char_length(v_title) > 160 then
    raise exception 'ADMIN_TELEGRAM_TITLE_TOO_LONG';
  end if;
  if v_body is not null and pg_catalog.char_length(v_body) > 3500 then
    raise exception 'ADMIN_TELEGRAM_BODY_TOO_LONG';
  end if;
  if v_ticker is not null and v_ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,11}$' then
    raise exception 'ADMIN_TELEGRAM_TICKER_INVALID';
  end if;
  if v_source_label is not null and pg_catalog.char_length(v_source_label) > 120 then
    raise exception 'ADMIN_TELEGRAM_SOURCE_LABEL_TOO_LONG';
  end if;

  if p_campaign_id is null then
    insert into public.admin_telegram_campaigns (
      notice_type,
      title,
      body,
      ticker,
      source_label,
      source_url,
      analysis_url,
      live_room_url,
      created_by,
      updated_by
    ) values (
      v_notice_type,
      v_title,
      v_body,
      v_ticker,
      v_source_label,
      v_source_url,
      v_analysis_url,
      v_live_room_url,
      p_actor_user_id,
      p_actor_user_id
    ) returning id into v_campaign_id;

    insert into public.admin_audit_logs (
      actor_user_id, actor_role, action, target_type, target_id,
      reason, after_data, request_id
    ) values (
      p_actor_user_id, v_actor_role, 'telegram_campaign.created',
      'telegram_campaign', v_campaign_id::text, v_reason,
      pg_catalog.jsonb_build_object(
        'notice_type', v_notice_type,
        'ticker', v_ticker,
        'has_source_url', v_source_url is not null,
        'has_analysis_url', v_analysis_url is not null,
        'has_live_room_url', v_live_room_url is not null
      ),
      nullif(pg_catalog.btrim(p_request_id), '')
    );
    return v_campaign_id;
  end if;

  select * into v_campaign
  from public.admin_telegram_campaigns
  where id = p_campaign_id
  for update;
  if not found then raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND'; end if;
  if v_campaign.status not in ('draft', 'scheduled') then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_EDITABLE';
  end if;
  if v_campaign.status = 'scheduled' and v_campaign.scheduled_for <= pg_catalog.now() then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT';
  end if;
  if p_expected_version is not null and v_campaign.version <> p_expected_version then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT';
  end if;

  update public.admin_telegram_campaigns
  set
    notice_type = v_notice_type,
    title = v_title,
    body = v_body,
    ticker = v_ticker,
    source_label = v_source_label,
    source_url = v_source_url,
    analysis_url = v_analysis_url,
    live_room_url = v_live_room_url,
    updated_by = p_actor_user_id,
    updated_at = pg_catalog.now(),
    version = version + 1
  where id = p_campaign_id;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, before_data, after_data, request_id
  ) values (
    p_actor_user_id, v_actor_role, 'telegram_campaign.updated',
    'telegram_campaign', p_campaign_id::text, v_reason,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'version', v_campaign.version,
      'ticker', v_campaign.ticker
    ),
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'version', v_campaign.version + 1,
      'ticker', v_ticker,
      'has_source_url', v_source_url is not null,
      'has_analysis_url', v_analysis_url is not null,
      'has_live_room_url', v_live_room_url is not null
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  );
  return p_campaign_id;
end
$function$;

create function public.admin_schedule_telegram_campaign(
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_scheduled_for timestamptz,
  p_reason text,
  p_request_id text default null,
  p_expected_version integer default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_reason text;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  v_reason := private.admin_telegram_campaign_reason(p_reason);
  if p_scheduled_for is null or p_scheduled_for <= pg_catalog.now() + interval '30 seconds' then
    raise exception 'ADMIN_TELEGRAM_SCHEDULE_INVALID';
  end if;
  select * into v_campaign
  from public.admin_telegram_campaigns
  where id = p_campaign_id
  for update;
  if not found then raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND'; end if;
  if v_campaign.status not in ('draft', 'scheduled') then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_SCHEDULABLE';
  end if;
  if p_expected_version is not null and v_campaign.version <> p_expected_version then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT';
  end if;

  update public.admin_telegram_campaigns
  set
    status = 'scheduled',
    scheduled_for = p_scheduled_for,
    scheduled_by = p_actor_user_id,
    scheduled_by_role = v_actor_role,
    updated_by = p_actor_user_id,
    updated_at = pg_catalog.now(),
    canceled_by = null,
    canceled_at = null,
    version = version + 1
  where id = p_campaign_id;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, before_data, after_data, request_id
  ) values (
    p_actor_user_id, v_actor_role, 'telegram_campaign.scheduled',
    'telegram_campaign', p_campaign_id::text, v_reason,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'scheduled_for', v_campaign.scheduled_for,
      'version', v_campaign.version
    ),
    pg_catalog.jsonb_build_object(
      'status', 'scheduled',
      'scheduled_for', p_scheduled_for,
      'version', v_campaign.version + 1
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  );
  return true;
end
$function$;

create function public.admin_cancel_telegram_campaign(
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_reason text,
  p_request_id text default null,
  p_expected_version integer default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_reason text;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  v_reason := private.admin_telegram_campaign_reason(p_reason);
  select * into v_campaign
  from public.admin_telegram_campaigns
  where id = p_campaign_id
  for update;
  if not found then raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND'; end if;
  if v_campaign.status <> 'scheduled' then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_CANCELABLE';
  end if;
  if p_expected_version is not null and v_campaign.version <> p_expected_version then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT';
  end if;

  update public.admin_telegram_campaigns
  set
    status = 'canceled',
    canceled_by = p_actor_user_id,
    canceled_at = pg_catalog.now(),
    updated_by = p_actor_user_id,
    updated_at = pg_catalog.now(),
    retry_allowed = false,
    version = version + 1
  where id = p_campaign_id;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, before_data, after_data, request_id
  ) values (
    p_actor_user_id, v_actor_role, 'telegram_campaign.canceled',
    'telegram_campaign', p_campaign_id::text, v_reason,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'scheduled_for', v_campaign.scheduled_for,
      'version', v_campaign.version
    ),
    pg_catalog.jsonb_build_object(
      'status', 'canceled',
      'version', v_campaign.version + 1
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  );
  return true;
end
$function$;

create function public.admin_claim_telegram_campaign(
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_attempt_token uuid,
  p_reason text,
  p_request_id text default null,
  p_expected_version integer default null
)
returns setof public.admin_telegram_campaigns
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_reason text;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  v_reason := private.admin_telegram_campaign_reason(p_reason);
  select * into v_campaign
  from public.admin_telegram_campaigns
  where id = p_campaign_id
  for update;
  if not found then raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND'; end if;
  if not (
    v_campaign.status = 'draft'
    or (v_campaign.status = 'failed' and v_campaign.retry_allowed = true)
  ) then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_SENDABLE';
  end if;
  if p_expected_version is not null and v_campaign.version <> p_expected_version then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT';
  end if;

  return query
  update public.admin_telegram_campaigns
  set
    status = 'sending',
    attempt_token = p_attempt_token,
    attempt_count = attempt_count + 1,
    attempt_actor_user_id = p_actor_user_id,
    attempt_actor_role = v_actor_role,
    attempt_trigger = 'admin',
    started_at = pg_catalog.now(),
    completed_at = null,
    provider_message_id = null,
    delivery_outcome = 'none',
    retry_allowed = false,
    last_error = null,
    sent_by = p_actor_user_id,
    updated_by = p_actor_user_id,
    updated_at = pg_catalog.now(),
    version = version + 1
  where id = p_campaign_id
  returning *;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, before_data, after_data, request_id
  ) values (
    p_actor_user_id, v_actor_role, 'telegram_campaign.send_started',
    'telegram_campaign', p_campaign_id::text, v_reason,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'attempt_count', v_campaign.attempt_count,
      'version', v_campaign.version
    ),
    pg_catalog.jsonb_build_object(
      'status', 'sending',
      'attempt_count', v_campaign.attempt_count + 1,
      'version', v_campaign.version + 1
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  );
end
$function$;

create function public.claim_due_admin_telegram_campaign(
  p_attempt_token uuid,
  p_trigger text default 'scheduler',
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_request_id text default null
)
returns setof public.admin_telegram_campaigns
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_actor_user_id uuid;
  v_actor_role text;
  v_reason text;
begin
  if p_trigger not in ('scheduler', 'local_mock') then
    raise exception 'ADMIN_TELEGRAM_TRIGGER_INVALID';
  end if;
  if p_trigger = 'local_mock' then
    v_actor_user_id := p_actor_user_id;
    v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
    v_reason := private.admin_telegram_campaign_reason(p_reason);
  end if;

  select * into v_campaign
  from public.admin_telegram_campaigns
  where status = 'scheduled'
    and scheduled_for <= pg_catalog.now()
  order by scheduled_for asc, created_at asc
  limit 1
  for update skip locked;
  if not found then return; end if;

  return query
  update public.admin_telegram_campaigns
  set
    status = 'sending',
    attempt_token = p_attempt_token,
    attempt_count = attempt_count + 1,
    attempt_actor_user_id = case when p_trigger = 'local_mock'
      then v_actor_user_id else scheduled_by end,
    attempt_actor_role = case when p_trigger = 'local_mock'
      then v_actor_role else scheduled_by_role end,
    attempt_trigger = p_trigger,
    started_at = pg_catalog.now(),
    completed_at = null,
    provider_message_id = null,
    delivery_outcome = 'none',
    retry_allowed = false,
    last_error = null,
    sent_by = case when p_trigger = 'local_mock'
      then v_actor_user_id else scheduled_by end,
    updated_at = pg_catalog.now(),
    version = version + 1
  where id = v_campaign.id
  returning *;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, before_data, after_data, request_id
  ) values (
    case when p_trigger = 'local_mock'
      then v_actor_user_id else v_campaign.scheduled_by end,
    case when p_trigger = 'local_mock'
      then v_actor_role else v_campaign.scheduled_by_role end,
    'telegram_campaign.send_started',
    'telegram_campaign',
    v_campaign.id::text,
    case when p_trigger = 'local_mock'
      then v_reason
      else 'Scheduled campaign became due.'
    end,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'scheduled_for', v_campaign.scheduled_for,
      'version', v_campaign.version
    ),
    pg_catalog.jsonb_build_object(
      'status', 'sending',
      'trigger', p_trigger,
      'attempt_count', v_campaign.attempt_count + 1,
      'version', v_campaign.version + 1
    ),
    case when p_trigger = 'local_mock'
      then nullif(pg_catalog.btrim(p_request_id), '') else null end
  );
end
$function$;

create function public.finish_admin_telegram_campaign(
  p_campaign_id uuid,
  p_attempt_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_last_error text default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_status text;
  v_action text;
  v_error text := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_last_error, '')), 500), '');
begin
  if p_outcome not in ('sent', 'not_sent', 'uncertain') then
    raise exception 'ADMIN_TELEGRAM_OUTCOME_INVALID';
  end if;
  select * into v_campaign
  from public.admin_telegram_campaigns
  where id = p_campaign_id
    and status = 'sending'
    and attempt_token = p_attempt_token
  for update;
  if not found then return false; end if;

  v_status := case when p_outcome = 'sent' then 'sent' else 'failed' end;
  v_action := case p_outcome
    when 'sent' then 'telegram_campaign.sent'
    when 'not_sent' then 'telegram_campaign.failed'
    else 'telegram_campaign.delivery_uncertain'
  end;

  update public.admin_telegram_campaigns
  set
    status = v_status,
    provider_message_id = case when p_outcome = 'sent'
      then nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_provider_message_id, '')), 240), '')
      else null
    end,
    delivery_outcome = p_outcome,
    retry_allowed = p_outcome = 'not_sent',
    last_error = v_error,
    completed_at = pg_catalog.now(),
    sent_at = case when p_outcome = 'sent' then pg_catalog.now() else null end,
    updated_at = pg_catalog.now(),
    version = version + 1
  where id = p_campaign_id;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, before_data, after_data, request_id
  ) values (
    v_campaign.attempt_actor_user_id,
    v_campaign.attempt_actor_role,
    v_action,
    'telegram_campaign',
    p_campaign_id::text,
    case p_outcome
      when 'sent' then 'Telegram provider confirmed delivery.'
      when 'not_sent' then 'Telegram provider confirmed the attempt was not delivered.'
      else 'Telegram delivery could not be confirmed; automatic retry is blocked.'
    end,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'attempt_count', v_campaign.attempt_count,
      'version', v_campaign.version
    ),
    pg_catalog.jsonb_build_object(
      'status', v_status,
      'delivery_outcome', p_outcome,
      'retry_allowed', p_outcome = 'not_sent',
      'provider_message_id', case when p_outcome = 'sent'
        then nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_provider_message_id, '')), 240), '')
        else null
      end,
      'error', v_error,
      'version', v_campaign.version + 1
    ),
    null
  );
  return true;
end
$function$;

create function public.admin_claim_telegram_ai_draft(
  p_actor_user_id uuid,
  p_reason text,
  p_request_id text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_reason text;
  v_count integer;
  v_audit_id uuid;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  v_reason := private.admin_telegram_campaign_reason(p_reason);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('admin_telegram_ai:' || p_actor_user_id::text)
  );
  select pg_catalog.count(*) into v_count
  from public.admin_audit_logs
  where actor_user_id = p_actor_user_id
    and action = 'telegram_campaign.ai_draft_requested'
    and created_at >= pg_catalog.now() - interval '1 hour';
  if v_count >= 20 then
    raise exception 'ADMIN_TELEGRAM_AI_RATE_LIMITED';
  end if;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, after_data, request_id
  ) values (
    p_actor_user_id, v_actor_role, 'telegram_campaign.ai_draft_requested',
    'telegram_campaign_ai', null, v_reason,
    pg_catalog.jsonb_build_object('window', '1 hour', 'request_number', v_count + 1),
    nullif(pg_catalog.btrim(p_request_id), '')
  ) returning id into v_audit_id;
  return v_audit_id;
end
$function$;

create function public.admin_finish_telegram_ai_draft(
  p_actor_user_id uuid,
  p_request_audit_id uuid,
  p_status text,
  p_model text,
  p_response_id text default null,
  p_error_code text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_audit_id uuid;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  if p_status not in ('succeeded', 'failed') then
    raise exception 'ADMIN_TELEGRAM_AI_STATUS_INVALID';
  end if;
  if not exists (
    select 1 from public.admin_audit_logs
    where id = p_request_audit_id
      and actor_user_id = p_actor_user_id
      and action = 'telegram_campaign.ai_draft_requested'
  ) then
    raise exception 'ADMIN_TELEGRAM_AI_REQUEST_INVALID';
  end if;

  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    reason, after_data
  ) values (
    p_actor_user_id,
    v_actor_role,
    'telegram_campaign.ai_draft_' || p_status,
    'telegram_campaign_ai',
    p_request_audit_id::text,
    case when p_status = 'succeeded'
      then 'AI draft returned for administrator review.'
      else 'AI draft failed; manual editing remains available.'
    end,
    pg_catalog.jsonb_build_object(
      'model', pg_catalog.left(pg_catalog.btrim(coalesce(p_model, '')), 120),
      'response_id', nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_response_id, '')), 240), ''),
      'error_code', nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_error_code, '')), 120), '')
    )
  ) returning id into v_audit_id;
  return v_audit_id;
end
$function$;

revoke all on function private.admin_telegram_campaign_role(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_telegram_campaign_reason(text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_telegram_campaign_url(text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_telegram_campaign_role_required(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.admin_telegram_campaign_role(uuid) to service_role;
grant execute on function private.admin_telegram_campaign_reason(text) to service_role;
grant execute on function private.admin_telegram_campaign_url(text) to service_role;
grant execute on function private.admin_telegram_campaign_role_required(uuid) to service_role;

revoke all on function public.admin_save_telegram_campaign(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_telegram_campaign(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, integer
) to service_role;

revoke all on function public.admin_schedule_telegram_campaign(
  uuid, uuid, timestamptz, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_schedule_telegram_campaign(
  uuid, uuid, timestamptz, text, text, integer
) to service_role;

revoke all on function public.admin_cancel_telegram_campaign(
  uuid, uuid, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_telegram_campaign(
  uuid, uuid, text, text, integer
) to service_role;

revoke all on function public.admin_claim_telegram_campaign(
  uuid, uuid, uuid, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_claim_telegram_campaign(
  uuid, uuid, uuid, text, text, integer
) to service_role;

revoke all on function public.claim_due_admin_telegram_campaign(
  uuid, text, uuid, text, text
)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_admin_telegram_campaign(
  uuid, text, uuid, text, text
)
  to service_role;

revoke all on function public.finish_admin_telegram_campaign(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.finish_admin_telegram_campaign(
  uuid, uuid, text, text, text
) to service_role;

revoke all on function public.admin_claim_telegram_ai_draft(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_claim_telegram_ai_draft(uuid, text, text)
  to service_role;

revoke all on function public.admin_finish_telegram_ai_draft(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_finish_telegram_ai_draft(
  uuid, uuid, text, text, text, text
) to service_role;

commit;
