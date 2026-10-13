begin;

alter table public.sc13_monitors
  add column reporter_scope text not null default 'specific',
  alter column reporting_person_cik drop not null,
  add constraint sc13_monitors_reporter_scope_check check (
    (reporter_scope = 'specific' and reporting_person_cik is not null)
    or (reporter_scope = 'all' and reporting_person_cik is null)
  );

alter table public.user_alert_deliveries
  add column sc13_reporter_index integer,
  add constraint user_alert_deliveries_sc13_reporter_index_check check (
    sc13_reporter_index is null or (sc13_reporter_index >= 0 and sc13_reporter_index < 100)
  ),
  add constraint user_alert_deliveries_sc13_filing_reporter_key
    unique (sc13_monitor_id, sc13_head_accession, sc13_reporter_index),
  drop constraint user_alert_deliveries_sc13_alert_shape_check;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_sc13_alert_shape_check check (
    sc13_monitor_id is null or (
      alert_domain = 'sc13' and alert_event_id is null
      and sc13_position_key is not null and btrim(sc13_position_key) <> ''
      and sc13_head_accession is not null
      and sc13_security_class is not null and btrim(sc13_security_class) <> ''
      and sc13_cusips is not null and cardinality(sc13_cusips) > 0
      and sc13_match_evidence is not null and jsonb_typeof(sc13_match_evidence) = 'object'
      and (
        (sc13_reporter_index is null and sc13_root_accession is not null and sc13_reporter_cik is not null
          and sc13_match_evidence @> '{"scope":"complete_stored_history_not_sec_global","meaning":"latest_saved_filing_value_not_realtime_ownership"}'::jsonb
          and not (sc13_match_evidence ? 'reporterScope'))
        or
        (sc13_reporter_index is not null and sc13_root_accession is null
          and sc13_match_evidence @> jsonb_build_object(
            'reporterScope', 'all', 'scope', 'single_stored_filing',
            'meaning', 'reported_filing_value_not_realtime_ownership',
            'rootAccessionNumber', null, 'headAccessionNumber', sc13_head_accession,
            'reportingPersonIndex', sc13_reporter_index, 'reportingPersonCik', sc13_reporter_cik)
          and coalesce(sc13_match_evidence->>'sourceSha256', '') ~ '^[a-f0-9]{64}$')
      )
      and category = 'insider_ownership' and source_type = 'other'
      and source_label = 'Schedule 13 Monitor' and alert_lane = 'sc13_monitor'
      and delivery_status = 'queued' and delivered_channels = array[]::text[]
      and scheduled_for is null and sent_at is null and attempted_at is null and dedupe_key is null
    ) is true
  );

comment on column public.sc13_monitors.reporter_scope is
  'specific preserves verified-CIK/current-lineage semantics; all evaluates each canonical reporter row of the triggering filing independently.';
comment on column public.user_alert_deliveries.sc13_reporter_index is
  'Canonical zero-based reporter index, only for all-reporters per-filing alerts; never a cross-filing person identifier.';
comment on constraint user_alert_deliveries_sc13_filing_reporter_key on public.user_alert_deliveries is
  'Atomic all-reporters dedupe by monitor, exact filing accession and reporter index. Specific alerts retain NULL index and their existing root/reporter unique key.';

commit;
