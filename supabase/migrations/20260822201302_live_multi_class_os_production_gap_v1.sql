-- Live Multi-Class O/S Production Gap V1.
--
-- Adds the generic source-backed custom taxonomy member identity, a V2
-- append-only universe result, and authoritative class-observation lineage for
-- an exact aggregate-plus-complete-class filing context. It does not backfill,
-- infer a missing class, or add a public write surface.

alter table public.issuer_common_class_universe_snapshots
  drop constraint issuer_common_class_universe_snapshot_version_check,
  add constraint issuer_common_class_universe_snapshot_version_check
    check (snapshot_version in (
      'issuer-common-class-universe-snapshot-v1',
      'issuer-common-class-universe-snapshot-v2'
    ));

alter table public.share_count_history
  drop constraint share_count_history_canonical_security_class_check,
  drop constraint share_count_history_source_concept_check,
  drop constraint share_count_history_authoritative_check,
  add constraint share_count_history_canonical_security_class_check
    check (coalesce((
      pg_catalog.jsonb_typeof(canonical_security_class_provenance) = 'object'
      and canonical_security_class_provenance <> '{}'::jsonb
      and (
        (canonical_security_class_status = 'mapped'
          and canonical_security_class_kind = 'common_stock'
          and canonical_security_class_id ~ (
            '^sc:v1:' || issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
          ))
        or
        (canonical_security_class_status = 'unavailable'
          and canonical_security_class_id is null
          and canonical_security_class_kind is null)
      )
      and (source_type <> 'sec_authoritative_os' or canonical_security_class_status = 'mapped')
      and (source_type <> 'sec_filing_text_level2'
        or canonical_security_class_status = 'unavailable'
        or security_class_metadata ->> 'sourceDeclaredClassKind' = 'common_stock')
    ), false)),
  add constraint share_count_history_source_concept_check
    check (
      (source_type = 'sec_authoritative_os'
        and (
          (source_concept_namespace_uri ~ '^https?://xbrl\.sec\.gov/dei/[0-9]{4}$'
            and source_concept_local_name = 'EntityCommonStockSharesOutstanding')
          or
          (source_concept_namespace_uri ~ '^http://fasb\.org/us-gaap/[0-9]{4}$'
            and source_concept_local_name = 'CommonStockSharesOutstanding')
        ))
      or
      (source_type = 'sec_filing_text_level2'
        and source_concept_namespace_uri is null
        and source_concept_local_name is null)
    ),
  add constraint share_count_history_authoritative_check
    check (coalesce((
      (source_type = 'sec_authoritative_os'
        and authoritative_status = 'ELIGIBLE'
        and (
          (authoritative_decision_version = 'authoritative-os-extraction-v1'
            and authoritative_decision_reason in (
              'ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT',
              'ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT'
            ))
          or
          (authoritative_decision_version = 'authoritative-multi-class-os-extraction-v1'
            and authoritative_decision_reason = 'ELIGIBLE_COMPLETE_MULTI_COMMON_STOCK_CONTEXT')
        )
        and pg_catalog.jsonb_typeof(authoritative_decision_lineage) = 'object'
        and authoritative_decision_lineage ->> 'status' = 'ELIGIBLE'
        and authoritative_decision_lineage ->> 'decisionVersion' = authoritative_decision_version
        and authoritative_decision_lineage ->> 'reason' = authoritative_decision_reason
        and authoritative_decision_lineage #>> '{candidate,issuerCik}' = issuer_cik
        and authoritative_decision_lineage #>> '{candidate,sharesOutstanding}' = shares_outstanding::text
        and authoritative_decision_lineage #>> '{candidate,asOf}' = as_of::text
        and authoritative_decision_lineage #>> '{candidate,accession}' = accession_number
        and authoritative_decision_lineage #>> '{candidate,form}' = form
        and authoritative_decision_lineage #>> '{candidate,filedDate}' = filed_date::text
        and pg_catalog.jsonb_typeof(authoritative_decision_lineage -> 'filingFacts') = 'array'
        and pg_catalog.jsonb_array_length(authoritative_decision_lineage -> 'filingFacts') > 0
        and authoritative_decision_lineage -> 'filingFacts'
          @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('factKey', source_fact_key)))
      or
      (source_type = 'sec_filing_text_level2'
        and authoritative_status is null
        and authoritative_decision_version is null
        and authoritative_decision_reason is null
        and authoritative_decision_lineage is null)
    ), false));

alter table public.event_corporate_action_facts
  drop constraint event_corporate_action_facts_applicability_materialization_check,
  add constraint event_corporate_action_facts_applicability_materialization_check check (coalesce((
    (applicability_payload is null
      and issuer_cik is null
      and applicability_status is null
      and affected_security_type is null
      and canonical_security_class_id is null)
    or
    (pg_catalog.jsonb_typeof(applicability_payload) = 'object'
      and (
        (event_kind = 'reverse_split'
          and applicability_payload ->> 'version' = 'reverse_split_applicability_v1'
          and applicability_payload ->> 'basis_change_capability' = 'reverse_split_only')
        or
        (event_kind = 'forward_split'
          and applicability_payload ->> 'version' = 'forward_split_applicability_v1'
          and applicability_payload ->> 'basis_change_capability' = 'forward_split_only')
      )
      and applicability_status in ('mapped', 'unavailable')
      and (
        (applicability_status = 'mapped'
          and applicability_payload #>> '{issuer,availability}' = 'available'
          and issuer_cik = applicability_payload #>> '{issuer,issuer_cik}'
          and issuer_cik ~ '^[0-9]{10}$'
          and applicability_payload #>> '{affected_security,availability}' = 'available'
          and affected_security_type = 'common_stock'
          and affected_security_type = applicability_payload #>> '{affected_security,security_type}'
          and canonical_security_class_id = applicability_payload #>> '{affected_security,canonical_security_class_id}'
          and applicability_payload #>> '{affected_security,evidence,availability}' = 'available'
          and pg_catalog.btrim(coalesce(applicability_payload #>> '{affected_security,source_ref}', '')) <> ''
          and pg_catalog.btrim(coalesce(applicability_payload #>> '{affected_security,source_security_title}', '')) <> ''
          and canonical_security_class_id ~ (
            '^sc:v1:' || issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
          ))
        or
        (applicability_status = 'unavailable'
          and canonical_security_class_id is null
          and affected_security_type is null
          and applicability_payload #>> '{affected_security,availability}' = 'unavailable'
          and (
            (applicability_payload #>> '{issuer,availability}' = 'available'
              and issuer_cik = applicability_payload #>> '{issuer,issuer_cik}')
            or
            (applicability_payload #>> '{issuer,availability}' = 'unavailable'
              and issuer_cik is null)
          ))
      ))
  ), false));

create or replace function public.read_reverse_split_history_candidates(
  p_issuer_cik text,
  p_canonical_security_class_id text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_issuer_cik !~ '^[0-9]{10}$'
    or p_from is null or p_to is null or p_from > p_to
    or (p_canonical_security_class_id is not null and p_canonical_security_class_id !~ (
      '^sc:v1:' || p_issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
    ))
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'issuer_cik', p_issuer_cik,
    'canonical_security_class_id', p_canonical_security_class_id,
    'from', p_from,
    'to', p_to,
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', facts.event_id,
        'source_execution_id', facts.source_execution_id,
        'issuer_cik', facts.issuer_cik,
        'canonical_security_class_id', facts.canonical_security_class_id,
        'effective_date', facts.effective_date,
        'effective_timing', facts.effective_timing_payload,
        'facts', facts.facts_payload,
        'persisted_at', facts.persisted_at
      ) order by facts.effective_date, facts.source_execution_id)
      from public.event_corporate_action_facts as facts
      where facts.event_kind = 'reverse_split'
        and facts.applicability_status = 'mapped'
        and facts.issuer_cik = p_issuer_cik
        and (p_canonical_security_class_id is null
          or facts.canonical_security_class_id = p_canonical_security_class_id)
        and facts.effective_date between p_from and p_to
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.read_stock_split_history_candidates(
  p_action_kind text,
  p_issuer_cik text,
  p_canonical_security_class_id text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_action_kind not in ('reverse_split', 'forward_split')
    or p_issuer_cik !~ '^[0-9]{10}$'
    or p_from is null or p_to is null or p_from > p_to
    or (p_canonical_security_class_id is not null and p_canonical_security_class_id !~ (
      '^sc:v1:' || p_issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
    ))
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'action_kind', p_action_kind,
    'issuer_cik', p_issuer_cik,
    'canonical_security_class_id', p_canonical_security_class_id,
    'from', p_from,
    'to', p_to,
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', facts.event_id,
        'source_execution_id', facts.source_execution_id,
        'issuer_cik', facts.issuer_cik,
        'canonical_security_class_id', facts.canonical_security_class_id,
        'effective_date', facts.effective_date,
        'effective_timing', facts.effective_timing_payload,
        'facts', facts.facts_payload,
        'persisted_at', facts.persisted_at
      ) order by facts.effective_date, facts.source_execution_id)
      from public.event_corporate_action_facts as facts
      where facts.event_kind = p_action_kind
        and facts.applicability_status = 'mapped'
        and facts.issuer_cik = p_issuer_cik
        and (p_canonical_security_class_id is null
          or facts.canonical_security_class_id = p_canonical_security_class_id)
        and facts.effective_date between p_from and p_to
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.read_reverse_split_history_candidates(text, text, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.read_stock_split_history_candidates(text, text, text, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.read_reverse_split_history_candidates(text, text, date, date)
  to service_role;
grant execute on function public.read_stock_split_history_candidates(text, text, text, date, date)
  to service_role;

comment on constraint issuer_common_class_universe_snapshot_version_check
  on public.issuer_common_class_universe_snapshots is
  'V2 supersedes a V1 result for the same filing observation without mutating append-only history.';
comment on constraint share_count_history_canonical_security_class_check
  on public.share_count_history is
  'Mapped issuer-scoped common classes admit single, backward-compatible us-gaap members, or exact custom namespace-URI hashes plus local names.';
