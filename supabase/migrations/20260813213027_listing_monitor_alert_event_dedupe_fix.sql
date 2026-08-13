begin;

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_listing_monitor_event_source_key,
  drop constraint user_alert_deliveries_listing_alert_shape_check;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_listing_monitor_event_key
    unique (listing_monitor_id, alert_event_id),
  add constraint user_alert_deliveries_listing_alert_shape_check
    check (
      listing_monitor_id is null
      or (
        alert_domain = 'listing'
        and listing_source_execution_id is not null
        and category = 'listing_risk'
        and alert_lane = 'listing_monitor'
        and delivery_status = 'queued'
        and delivered_channels = array[]::text[]
        and scheduled_for is null
        and sent_at is null
        and attempted_at is null
      )
    );

comment on constraint user_alert_deliveries_listing_monitor_event_key
  on public.user_alert_deliveries is
  'Atomic Listing Alert dedupe across monitor plus canonical event identity; source execution is provenance only.';

commit;
