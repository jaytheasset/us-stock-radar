begin;

-- Listing Monitor alerts reuse the existing owner-scoped Alert history/outbox.
-- The three identity columns are deliberately narrow: the Alert references the
-- monitor and exact current Listing result without copying facts or evidence.
alter table public.user_alert_deliveries
  add column listing_monitor_id uuid,
  add column alert_domain text,
  add column listing_source_execution_id uuid;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_listing_monitor_id_fkey
    foreign key (listing_monitor_id)
    references public.listing_monitors (id)
    on update restrict
    on delete set null,
  add constraint user_alert_deliveries_alert_domain_check
    check (alert_domain is null or alert_domain = 'listing'),
  add constraint user_alert_deliveries_listing_alert_shape_check
    check (
      listing_monitor_id is null
      or (
        alert_domain = 'listing'
        and listing_source_execution_id is not null
        and alert_event_id is not null
        and category = 'listing_risk'
        and alert_lane = 'listing_monitor'
        and delivery_status = 'queued'
        and delivered_channels = array[]::text[]
        and scheduled_for is null
        and sent_at is null
        and attempted_at is null
      )
    ),
  add constraint user_alert_deliveries_listing_monitor_event_source_key
    unique (listing_monitor_id, alert_event_id, listing_source_execution_id);

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_alert_lane_check,
  add constraint user_alert_deliveries_alert_lane_check
    check (
      alert_lane in (
        'watchlist',
        'market_discovery',
        'calendar_follow',
        'listing_monitor'
      )
    );

comment on column public.user_alert_deliveries.listing_monitor_id is
  'Listing Monitor that produced this internal Alert; null for other Alert lanes and after monitor deletion.';
comment on column public.user_alert_deliveries.alert_domain is
  'Monitor domain for internal rule alerts. V1 accepts only listing.';
comment on column public.user_alert_deliveries.listing_source_execution_id is
  'Exact current Listing analyzer execution returned by the official reader.';
comment on constraint user_alert_deliveries_listing_monitor_event_source_key
  on public.user_alert_deliveries is
  'Atomic Listing Alert dedupe across monitor plus canonical event/current source execution identity.';

commit;
