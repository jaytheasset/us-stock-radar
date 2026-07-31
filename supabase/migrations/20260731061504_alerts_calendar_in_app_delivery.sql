begin;

alter table public.alert_preferences
  add column if not exists market_cap_filters text[] not null
    default array['mega', 'large', 'mid', 'small', 'micro']::text[],
  add column if not exists filing_type_filters text[] not null
    default array[
      '8-k', '10-q', '10-k', '6-k', '20-f',
      's-1', 's-3', 's-4', 's-8', 'f-1', 'f-3', 'f-4',
      '424b', '424b3', '424b4', '424b5',
      'def-14a', 'pre-14a', 'defa14a',
      'sc-13d', 'sc-13g', 'form-4', '144',
      'sc-to-i', 'sc-to-t', 'sc-14d9', '25-nse', 'pos-am', 'effect',
      '8-k-a', '10-q-a', '10-k-a', 'nt-10-k', 'nt-10-q'
    ]::text[];

alter table public.alert_preferences
  drop constraint if exists alert_preferences_market_cap_filters_check,
  add constraint alert_preferences_market_cap_filters_check
    check (
      market_cap_filters <@ array['mega', 'large', 'mid', 'small', 'micro']::text[]
    ),
  drop constraint if exists alert_preferences_filing_type_filters_check,
  add constraint alert_preferences_filing_type_filters_check
    check (
      filing_type_filters <@ array[
        '8-k', '10-q', '10-k', '6-k', '20-f',
        's-1', 's-3', 's-4', 's-8', 'f-1', 'f-3', 'f-4',
        '424b', '424b3', '424b4', '424b5',
        'def-14a', 'pre-14a', 'defa14a',
        'sc-13d', 'sc-13g', 'form-4', '144',
        'sc-to-i', 'sc-to-t', 'sc-14d9', '25-nse', 'pos-am', 'effect',
        '8-k-a', '10-q-a', '10-k-a', 'nt-10-k', 'nt-10-q'
      ]::text[]
    );

alter table public.user_discovery_categories
  drop constraint if exists user_discovery_categories_category_check,
  add constraint user_discovery_categories_category_check
    check (
      category in (
        'earnings',
        'sales_performance',
        'product_update',
        'leadership_governance',
        'insider_ownership',
        'shareholder_vote',
        'strategic_transaction',
        'dividends',
        'capital_return',
        'ipo_listing',
        'policy_regulation',
        'macro_market',
        'dilution_risk',
        'listing_risk',
        'financial_risk',
        'legal_risk',
        'fda_clinical',
        'other'
      )
    );

alter table public.user_alert_deliveries
  add column if not exists calendar_event_id uuid,
  add column if not exists read_at timestamptz;

alter table public.user_alert_deliveries
  drop constraint if exists user_alert_deliveries_calendar_event_id_fkey,
  add constraint user_alert_deliveries_calendar_event_id_fkey
    foreign key (calendar_event_id)
    references public.calendar_events (id)
    on update restrict
    on delete set null,
  drop constraint if exists user_alert_deliveries_alert_lane_check,
  add constraint user_alert_deliveries_alert_lane_check
    check (alert_lane in ('watchlist', 'market_discovery', 'calendar_follow'));

create index if not exists user_alert_deliveries_calendar_event_idx
  on public.user_alert_deliveries (calendar_event_id)
  where calendar_event_id is not null;

create index if not exists user_alert_deliveries_user_unread_idx
  on public.user_alert_deliveries (user_id, delivered_at desc)
  where read_at is null and delivery_status = 'sent';

drop trigger if exists user_calendar_event_follows_set_updated_at
  on public.user_calendar_event_follows;
create trigger user_calendar_event_follows_set_updated_at
before update on public.user_calendar_event_follows
for each row execute function public.set_user_alert_updated_at();

create or replace function private.enqueue_calendar_alert_candidate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate_kind text;
begin
  v_candidate_kind := case
    when new.after_schedule->>'lifecycle_status' = 'cancelled' then 'cancelled'
    when new.after_schedule->>'lifecycle_status' = 'postponed' then 'postponed'
    when new.change_kind = 'registered' then 'event-registered'
    else new.change_kind
  end;

  insert into public.calendar_alert_candidates (
    event_id,
    event_revision,
    candidate_kind,
    candidate_key,
    available_at,
    status,
    payload,
    created_at,
    updated_at
  )
  values (
    new.event_id,
    new.revision,
    v_candidate_kind,
    'calendar:event:' || new.event_id::text ||
      ':revision:' || new.revision::text ||
      ':kind:' || v_candidate_kind,
    new.observed_at,
    'pending',
    pg_catalog.jsonb_build_object(
      'historyId', new.id,
      'beforeSchedule', new.before_schedule,
      'afterSchedule', new.after_schedule,
      'observedAt', new.observed_at
    ),
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (candidate_key) do nothing;

  return new;
end;
$$;

revoke all on function private.enqueue_calendar_alert_candidate() from public;

drop trigger if exists calendar_event_history_enqueue_alert_candidate
  on public.calendar_event_history;
create trigger calendar_event_history_enqueue_alert_candidate
after insert on public.calendar_event_history
for each row execute function private.enqueue_calendar_alert_candidate();

insert into public.calendar_alert_candidates (
  event_id,
  event_revision,
  candidate_kind,
  candidate_key,
  available_at,
  status,
  payload,
  created_at,
  updated_at
)
select
  history.event_id,
  history.revision,
  case
    when history.after_schedule->>'lifecycle_status' = 'cancelled' then 'cancelled'
    when history.after_schedule->>'lifecycle_status' = 'postponed' then 'postponed'
    when history.change_kind = 'registered' then 'event-registered'
    else history.change_kind
  end,
  'calendar:event:' || history.event_id::text ||
    ':revision:' || history.revision::text ||
    ':kind:' ||
    case
      when history.after_schedule->>'lifecycle_status' = 'cancelled' then 'cancelled'
      when history.after_schedule->>'lifecycle_status' = 'postponed' then 'postponed'
      when history.change_kind = 'registered' then 'event-registered'
      else history.change_kind
    end,
  history.observed_at,
  'pending',
  pg_catalog.jsonb_build_object(
    'historyId', history.id,
    'beforeSchedule', history.before_schedule,
    'afterSchedule', history.after_schedule,
    'observedAt', history.observed_at
  ),
  pg_catalog.now(),
  pg_catalog.now()
from public.calendar_event_history as history
on conflict (candidate_key) do nothing;

commit;
