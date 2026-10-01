-- Align the existing ledger with SEC ingestion; preserve historical spelling and ACLs.
create or replace function public.read_sec_filing_amendment_ledger(
  p_root_raw_item_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_root public.raw_items;
  v_cik text;
  v_family text;
  v_filing_date text;
  v_legacy_date text;
  v_date text;
begin
  select raw_row.* into v_root
  from public.raw_items as raw_row
  where raw_row.id = p_root_raw_item_id;
  if v_root.id is null or v_root.source_code <> 'sec_edgar' then
    return jsonb_build_object('status', 'not_ready', 'reason', 'root_raw_item_missing');
  end if;
  v_cik := regexp_replace(coalesce(v_root.raw_payload->>'cik', ''), '^0+', '');
  v_family := regexp_replace(upper(btrim(coalesce(v_root.raw_payload->>'form_type', ''))), '/A$', '');
  if v_cik = '' or v_family = '' or upper(btrim(v_root.raw_payload->>'form_type')) like '%/A' then
    return jsonb_build_object('status', 'not_ready', 'reason', 'root_raw_identity_invalid');
  end if;

  -- Only explicit source filing dates; never substitute the acceptance timestamp.
  v_filing_date := nullif(v_root.raw_payload->>'filing_date', '');
  v_legacy_date := nullif(v_root.raw_payload->>'filed_date', '');
  if v_filing_date is null and v_legacy_date is null then
    return jsonb_build_object('status', 'not_ready', 'reason', 'root_filing_date_missing');
  end if;
  foreach v_date in array array[v_filing_date, v_legacy_date] loop
    if v_date is not null then
      if v_date !~ '^\d{4}-\d{2}-\d{2}$' or left(v_date,4) = '0000' then
        return jsonb_build_object('status', 'not_ready', 'reason', 'root_filing_date_invalid');
      end if;
      begin
        if to_char(v_date::date, 'YYYY-MM-DD') <> v_date then
          return jsonb_build_object('status', 'not_ready', 'reason', 'root_filing_date_invalid');
        end if;
      exception when datetime_field_overflow or invalid_datetime_format then
        return jsonb_build_object('status', 'not_ready', 'reason', 'root_filing_date_invalid');
      end;
    end if;
  end loop;
  if v_filing_date is not null and v_legacy_date is not null and v_filing_date <> v_legacy_date then
    return jsonb_build_object('status', 'not_ready', 'reason', 'root_filing_date_conflict');
  end if;

  return jsonb_build_object(
    'status', 'available',
    'root', jsonb_build_object(
      'rawItemId', v_root.id,
      'sourceCode', v_root.source_code,
      'issuerCik', v_root.raw_payload->>'cik',
      'accessionNumber', v_root.raw_payload->>'accession_number',
      'formType', v_root.raw_payload->>'form_type',
      'filedDate', coalesce(v_filing_date, v_legacy_date),
      'primaryDocumentUrl', v_root.raw_payload->>'primary_document_url',
      'indexUrl', v_root.source_url
    ),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', observation.decision,
        'version', 'sec_amendment_lineage_v1',
        'amendment', observation.amendment_identity,
        'prior', observation.prior_identity,
        'formFamily', observation.form_family,
        'operation', observation.operation,
        'operationEvidence', observation.operation_evidence,
        'targetEvidence', observation.target_evidence,
        'affectedFactKeys', to_jsonb(observation.affected_fact_keys),
        'factScopeEvidence', observation.fact_scope_evidence,
        'reviewTarget', observation.review_target_identity,
        'evidence', observation.evidence,
        'reason', observation.resolution_reason,
        'observationKey', observation.observation_key
      ) order by observation.recorded_at, observation.observation_key)
      from public.sec_filing_lineage_observations as observation
      where observation.issuer_cik = v_cik and observation.form_family = v_family
    ), '[]'::jsonb),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rawItemId', fact.raw_item_id,
        'sourceAccessionNumber', fact.source_accession,
        'semanticFactKey', fact.semantic_fact_key,
        'factPayload', fact.fact_payload,
        'sourceRef', fact.source_ref,
        'eventId', fact.event_id,
        'sourceExecutionId', fact.source_execution_id
      ) order by fact.recorded_at, fact.history_key)
      from public.sec_filing_semantic_fact_history as fact
      where fact.issuer_cik = v_cik and fact.form_family = v_family
    ), '[]'::jsonb)
  );
end;
$$;
