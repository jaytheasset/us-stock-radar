begin;

create function private.admin_telegram_delivery_lease_interval()
returns interval
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.make_interval(mins => 10)
$function$;

alter table public.admin_telegram_campaigns
  add column lease_expires_at timestamptz;

update public.admin_telegram_campaigns
set lease_expires_at =
  coalesce(started_at, updated_at, pg_catalog.now())
  + private.admin_telegram_delivery_lease_interval()
where status = 'sending'
  and lease_expires_at is null;

alter table public.admin_telegram_campaigns
  add constraint admin_telegram_campaigns_sending_lease_check check (
    status <> 'sending' or lease_expires_at is not null
  );

comment on column public.admin_telegram_campaigns.lease_expires_at is
  'DB-authored delivery claim lease. An expired sending row is reconciled to failed/uncertain and is never retried automatically.';

create index admin_telegram_campaigns_expired_lease_idx
  on public.admin_telegram_campaigns (lease_expires_at, id)
  where status = 'sending';

create function private.set_admin_telegram_delivery_lease()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'sending'
    and (
      tg_op = 'INSERT'
      or old.status is distinct from 'sending'
      or new.started_at is distinct from old.started_at
      or new.lease_expires_at is null
    )
  then
    new.lease_expires_at :=
      coalesce(new.started_at, pg_catalog.now())
      + private.admin_telegram_delivery_lease_interval();
  end if;
  return new;
end
$function$;

create trigger admin_telegram_campaigns_set_delivery_lease
  before insert or update of status, started_at, lease_expires_at
  on public.admin_telegram_campaigns
  for each row execute function private.set_admin_telegram_delivery_lease();

create function private.expire_admin_telegram_campaign_leases(
  p_limit integer default 50
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_campaign public.admin_telegram_campaigns%rowtype;
  v_expired integer := 0;
  v_limit integer := greatest(
    1,
    least(coalesce(p_limit, 50), 250)
  );
begin
  for v_campaign in
    select campaign.*
    from public.admin_telegram_campaigns as campaign
    where campaign.status = 'sending'
      and campaign.lease_expires_at <= pg_catalog.now()
    order by campaign.lease_expires_at asc, campaign.id asc
    limit v_limit
    for update skip locked
  loop
    update public.admin_telegram_campaigns
    set
      status = 'failed',
      delivery_outcome = 'uncertain',
      retry_allowed = false,
      completed_at = pg_catalog.now(),
      last_error = 'Delivery lease expired before a provider outcome was recorded.',
      updated_at = pg_catalog.now(),
      version = version + 1
    where id = v_campaign.id;

    insert into public.admin_audit_logs (
      actor_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      reason,
      before_data,
      after_data,
      request_id
    ) values (
      v_campaign.attempt_actor_user_id,
      coalesce(v_campaign.attempt_actor_role, v_campaign.scheduled_by_role, 'operations'),
      'telegram_campaign.delivery_lease_expired',
      'telegram_campaign',
      v_campaign.id::text,
      'Delivery claim expired without a recorded provider outcome. Automatic retry remains blocked.',
      pg_catalog.jsonb_build_object(
        'status', v_campaign.status,
        'delivery_outcome', v_campaign.delivery_outcome,
        'retry_allowed', v_campaign.retry_allowed,
        'started_at', v_campaign.started_at,
        'lease_expires_at', v_campaign.lease_expires_at,
        'attempt_count', v_campaign.attempt_count,
        'version', v_campaign.version
      ),
      pg_catalog.jsonb_build_object(
        'status', 'failed',
        'delivery_outcome', 'uncertain',
        'retry_allowed', false,
        'version', v_campaign.version + 1
      ),
      null
    );

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end
$function$;

create function public.expire_admin_telegram_campaign_leases(
  p_limit integer default 50
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $function$
  select private.expire_admin_telegram_campaign_leases(p_limit)
$function$;

create function public.admin_reconcile_telegram_campaign(
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_reconciliation text,
  p_reason text,
  p_expected_version integer,
  p_request_id text default null
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
  v_status text;
  v_outcome text;
  v_retry_allowed boolean;
  v_action text;
begin
  v_actor_role := private.admin_telegram_campaign_role_required(p_actor_user_id);
  v_reason := private.admin_telegram_campaign_reason(p_reason);

  if p_expected_version is null then
    raise exception 'ADMIN_TELEGRAM_EXPECTED_VERSION_REQUIRED';
  end if;
  if p_reconciliation not in ('delivered', 'not_delivered') then
    raise exception 'ADMIN_TELEGRAM_RECONCILIATION_INVALID';
  end if;

  select campaign.* into v_campaign
  from public.admin_telegram_campaigns as campaign
  where campaign.id = p_campaign_id
  for update;

  if not found then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND';
  end if;
  if v_campaign.version <> p_expected_version then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT';
  end if;
  if not (
    (
      v_campaign.status = 'failed'
      and v_campaign.delivery_outcome = 'uncertain'
      and v_campaign.retry_allowed = false
    )
    or (
      v_campaign.status = 'sending'
      and v_campaign.lease_expires_at <= pg_catalog.now()
    )
  ) then
    raise exception 'ADMIN_TELEGRAM_CAMPAIGN_NOT_RECONCILABLE';
  end if;

  v_status := case when p_reconciliation = 'delivered' then 'sent' else 'failed' end;
  v_outcome := case when p_reconciliation = 'delivered' then 'sent' else 'not_sent' end;
  v_retry_allowed := p_reconciliation = 'not_delivered';
  v_action := case
    when p_reconciliation = 'delivered'
      then 'telegram_campaign.reconciled_delivered'
    else 'telegram_campaign.reconciled_not_delivered'
  end;

  return query
  update public.admin_telegram_campaigns
  set
    status = v_status,
    delivery_outcome = v_outcome,
    retry_allowed = v_retry_allowed,
    provider_message_id = case
      when p_reconciliation = 'delivered' then provider_message_id
      else null
    end,
    sent_at = case
      when p_reconciliation = 'delivered' then pg_catalog.now()
      else null
    end,
    completed_at = pg_catalog.now(),
    last_error = null,
    updated_by = p_actor_user_id,
    updated_at = pg_catalog.now(),
    version = version + 1
  where id = p_campaign_id
  returning *;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data,
    request_id
  ) values (
    p_actor_user_id,
    v_actor_role,
    v_action,
    'telegram_campaign',
    p_campaign_id::text,
    v_reason,
    pg_catalog.jsonb_build_object(
      'status', v_campaign.status,
      'delivery_outcome', v_campaign.delivery_outcome,
      'retry_allowed', v_campaign.retry_allowed,
      'lease_expires_at', v_campaign.lease_expires_at,
      'version', v_campaign.version
    ),
    pg_catalog.jsonb_build_object(
      'status', v_status,
      'delivery_outcome', v_outcome,
      'retry_allowed', v_retry_allowed,
      'telegram_send_invoked', false,
      'version', v_campaign.version + 1
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  );
end
$function$;

revoke all on function private.admin_telegram_delivery_lease_interval()
  from public, anon, authenticated, service_role;
revoke all on function private.set_admin_telegram_delivery_lease()
  from public, anon, authenticated, service_role;
revoke all on function private.expire_admin_telegram_campaign_leases(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.expire_admin_telegram_campaign_leases(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_reconcile_telegram_campaign(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;

grant execute on function private.admin_telegram_delivery_lease_interval()
  to service_role;
grant execute on function private.set_admin_telegram_delivery_lease()
  to service_role;
grant execute on function private.expire_admin_telegram_campaign_leases(integer)
  to service_role;
grant execute on function public.expire_admin_telegram_campaign_leases(integer)
  to service_role;
grant execute on function public.admin_reconcile_telegram_campaign(
  uuid, uuid, text, text, integer, text
) to service_role;

commit;
