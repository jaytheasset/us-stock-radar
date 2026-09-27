begin;

alter table public.listing_monitors
  add column monitor_kind text not null default 'condition_set',
  add column form4_purchase_settings jsonb;

alter table public.listing_monitors
  add constraint listing_monitors_kind_check
    check (monitor_kind in ('condition_set', 'form4_insider_purchase')),
  add constraint listing_monitors_form4_purchase_settings_check
    check (
      (
        monitor_kind = 'condition_set'
        and form4_purchase_settings is null
      )
      or (
        monitor_kind = 'form4_insider_purchase'
        and pg_catalog.jsonb_typeof(form4_purchase_settings) = 'object'
        and form4_purchase_settings ?& array['target', 'role', 'minimumShares']
        and form4_purchase_settings->>'role' in ('officer', 'director', 'officer_or_director')
        and case
          when form4_purchase_settings->'minimumShares' = 'null'::jsonb then true
          when pg_catalog.jsonb_typeof(form4_purchase_settings->'minimumShares') = 'number' then
            (form4_purchase_settings->>'minimumShares')::numeric > 0
            and pg_catalog.trunc((form4_purchase_settings->>'minimumShares')::numeric)
              = (form4_purchase_settings->>'minimumShares')::numeric
          else false
        end
        and pg_catalog.jsonb_typeof(form4_purchase_settings->'target') = 'object'
        and (
          (
            form4_purchase_settings#>>'{target,scope}' = 'watchlist'
          )
          or (
            form4_purchase_settings#>>'{target,scope}' = 'ticker'
            and form4_purchase_settings#>>'{target,ticker}' ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'
          )
        )
      )
    );

comment on column public.listing_monitors.monitor_kind is
  'Existing Listing Monitor execution kind. form4_insider_purchase is the typed public Form 4 officer/director purchase setting.';
comment on column public.listing_monitors.form4_purchase_settings is
  'Strict target, role, and optional minimum-share settings for one public Form 4 purchase monitor; null for generic condition sets.';

alter table public.user_alert_deliveries
  add column listing_match_evidence jsonb;

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_listing_alert_shape_check,
  add constraint user_alert_deliveries_listing_alert_shape_check
    check (
      listing_monitor_id is null
      or (
        alert_domain = 'listing'
        and listing_source_execution_id is not null
        and alert_event_id is not null
        and (
          (listing_match_evidence is null and category = 'listing_risk')
          or (
            listing_match_evidence is not null
            and category = 'insider_ownership'
          )
        )
        and alert_lane = 'listing_monitor'
        and delivery_status = 'queued'
        and delivered_channels = array[]::text[]
        and scheduled_for is null
        and sent_at is null
        and attempted_at is null
      )
    ),
  add constraint user_alert_deliveries_listing_match_evidence_check
    check (
      listing_match_evidence is null
      or (
        pg_catalog.jsonb_typeof(listing_match_evidence) = 'object'
        and listing_match_evidence->>'version' = 'form4_insider_purchase_match_v1'
        and listing_match_evidence->>'kind' = 'form4_insider_purchase'
        and listing_match_evidence->>'ticker' ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'
        and listing_match_evidence->>'accessionNumber' ~ '^\d{10}-\d{2}-\d{6}$'
        and pg_catalog.jsonb_typeof(listing_match_evidence->'matches') = 'array'
        and pg_catalog.jsonb_array_length(listing_match_evidence->'matches') between 1 and 1000
      )
    );

comment on column public.user_alert_deliveries.listing_match_evidence is
  'Immutable first-created Form 4 purchase match payload. One monitor+filing alert retains every matching transaction row and its validated relation evidence.';

create or replace function public.read_event_ownership_context_snapshot(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'event', (select pg_catalog.jsonb_build_object(
      'id', event_row.id, 'raw_item_id', event_row.raw_item_id, 'source_code', event_row.source_code,
      'source_group', event_row.source_group, 'event_type', event_row.event_type,
      'published_at', event_row.published_at, 'metadata', event_row.metadata
    ) from public.events as event_row where event_row.id = p_event_id),
    'ownership_source_text', (select raw_row.raw_payload->>'ownership_source_text'
      from public.events as event_row join public.raw_items as raw_row on raw_row.id = event_row.raw_item_id
      where event_row.id = p_event_id),
    'form4_rows', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value) order by row_value.transaction_index), '[]'::jsonb)
      from public.event_form4_transactions as row_value where row_value.event_id = p_event_id),
    'form144_rows', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value) order by row_value.proposed_sale_index), '[]'::jsonb)
      from public.event_form144_proposed_sales as row_value where row_value.event_id = p_event_id),
    'context_fingerprint', public.get_event_ownership_context_fingerprint(p_event_id),
    'context_semantic_verifier_refs_valid', public.ownership_context_semantic_verifier_refs_valid(p_event_id)
  );
$function$;

revoke all on function public.read_event_ownership_context_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.read_event_ownership_context_snapshot(uuid) to service_role;

commit;
