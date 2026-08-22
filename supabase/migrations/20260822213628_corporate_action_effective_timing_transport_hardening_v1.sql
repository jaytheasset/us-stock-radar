alter table public.event_corporate_action_facts
  drop constraint event_corporate_action_facts_effective_timing_materialization_check,
  add constraint event_corporate_action_facts_effective_timing_materialization_check
    check (coalesce((
      (effective_timing_payload is null
        and effective_timing_status is null
        and effective_timing_kind is null
        and effective_timestamp is null)
      or
      (pg_catalog.jsonb_typeof(effective_timing_payload) = 'object'
        and effective_timing_status = effective_timing_payload ->> 'availability'
        and effective_timing_status in ('available', 'unavailable')
        and (
          (effective_timing_status = 'unavailable'
            and effective_timing_kind is null
            and effective_timestamp is null
            and effective_timing_payload ->> 'reason' in ('not_provided', 'date_only', 'ambiguous'))
          or
          (effective_timing_status = 'available'
            and effective_timing_kind = effective_timing_payload ->> 'kind'
            and effective_timing_payload #>> '{evidence,availability}' = 'available'
            and pg_catalog.btrim(coalesce(effective_timing_payload ->> 'source_ref', '')) <> ''
            and effective_timing_kind in (
              'date_only',
              'business_day_open',
              'market_open',
              'start_of_trading',
              'after_market_close',
              'exact_timestamp'
            )
            and (
              (effective_timing_kind = 'exact_timestamp'
                and effective_timestamp = (effective_timing_payload ->> 'timestamp')::timestamptz)
              or
              (effective_timing_kind <> 'exact_timestamp'
                and effective_timestamp is null
                and effective_timing_payload -> 'timestamp' = 'null'::jsonb)
            ))
        ))
    ), false));

comment on constraint event_corporate_action_facts_effective_timing_materialization_check
  on public.event_corporate_action_facts is
  'Preserves source-backed date/session timing without synthesizing intraday timestamps.';
