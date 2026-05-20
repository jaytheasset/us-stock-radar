-- Development seed only. Not a schema migration.
-- Purpose: populate user_alert_deliveries so the /alerts Delivered Alerts UI can be reviewed.
-- Safe to run repeatedly: skips rows with the same user_id + ticker + title.
-- Scope: user-specific delivered alert log only. Does not touch events/feed source tables.

with seed_rows as (
  select
    '00000000-0000-4000-8000-000000000001'::uuid as user_id,
    null::uuid as alert_event_id,
    'XYZ'::text as ticker,
    'XYZ files $75M offering'::text as title,
    'dilution_risk'::text as category,
    'filing'::text as source_type,
    'SEC filing'::text as source_label,
    'market_discovery'::text as alert_lane,
    'high'::text as severity,
    array['web']::text[] as delivered_channels,
    'sent'::text as delivery_status,
    now() - interval '7 minutes' as delivered_at
  union all
  select
    '00000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    'ABC'::text,
    'ABC receives FDA approval'::text,
    'fda_clinical'::text,
    'news'::text,
    'Press release'::text,
    'market_discovery'::text,
    'high'::text,
    array['web', 'telegram']::text[],
    'sent'::text,
    now() - interval '14 minutes'
  union all
  select
    '00000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    'NVDA'::text,
    'NVDA earnings date added to calendar'::text,
    'earnings'::text,
    'calendar'::text,
    'Calendar'::text,
    'watchlist'::text,
    'medium'::text,
    array['web']::text[],
    'sent'::text,
    now() - interval '31 minutes'
)
insert into user_alert_deliveries (
  user_id,
  alert_event_id,
  ticker,
  title,
  category,
  source_type,
  source_label,
  alert_lane,
  severity,
  delivered_channels,
  delivery_status,
  delivered_at
)
select
  seed_rows.user_id,
  seed_rows.alert_event_id,
  seed_rows.ticker,
  seed_rows.title,
  seed_rows.category,
  seed_rows.source_type,
  seed_rows.source_label,
  seed_rows.alert_lane,
  seed_rows.severity,
  seed_rows.delivered_channels,
  seed_rows.delivery_status,
  seed_rows.delivered_at
from seed_rows
where not exists (
  select 1
  from user_alert_deliveries existing
  where existing.user_id = seed_rows.user_id
    and coalesce(existing.ticker, '') = coalesce(seed_rows.ticker, '')
    and existing.title = seed_rows.title
);
