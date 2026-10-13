-- NT uses the existing internal Monitor lane, with its own financial_risk label.
-- Preserve the existing family branches and monitor/event unique constraint.
begin;

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_listing_alert_shape_check;
alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_listing_alert_shape_check check (
    listing_monitor_id is null or (
      alert_domain = 'listing'
      and listing_source_execution_id is not null and alert_event_id is not null
      and (
        (offering_plan_match_evidence is null and (
          (listing_match_evidence is null and category = 'listing_risk')
          or (listing_match_evidence is not null and category = 'insider_ownership')
        ))
        or (offering_plan_match_evidence is not null and category = 'dilution_risk')
        or coalesce((
          category = 'financial_risk'
          and source_type = 'other' and source_label = 'SEC Filing Monitor'
          and title in ('SEC late-filing notice filed', 'Delayed periodic report filed')
          -- Fail closed for nullable identity fields in this new branch.
          and alert_domain = 'listing'
          and listing_match_evidence is null and offering_plan_match_evidence is null
          and effect_match_evidence is null and effect_registration_key is null
          and projected_fact_id is null and projected_monitor_id is null
          and projected_alert_key is null and projected_scenario is null
          and offering_monitor_id is null and offering_registry_snapshot_id is null
          and offering_registry_accession is null
          and financial_monitor_id is null and financial_source_execution_id is null
          and financial_accession is null and financial_issuer_cik is null
          and sc13_monitor_id is null and sc13_match_evidence is null
          and sc13_position_key is null and sc13_root_accession is null
          and sc13_head_accession is null and sc13_reporter_cik is null
          and sc13_security_class is null and sc13_cusips is null
          and ticker_match is null and calendar_event_id is null
          and severity is null and dedupe_key is null
        ), false)
      )
      and alert_lane = 'listing_monitor' and delivery_status = 'queued'
      and delivered_channels = ARRAY[]::text[]
      and scheduled_for is null and sent_at is null and attempted_at is null
    )
  );

commit;
