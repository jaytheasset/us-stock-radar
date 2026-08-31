-- Append-only Corporate Action adjustment projections for reviewed Dilution
-- Registry snapshots. Original snapshots remain immutable. This table does not
-- discover or calculate stock splits; payloads must bind to the canonical
-- fse:v1/rse:v1 execution identity and exact SEC contract evidence in the
-- application layer before this service-only append RPC is called.

alter table public.dilution_instruments
  drop constraint dilution_instruments_type_check,
  add constraint dilution_instruments_type_check
    check (instrument_type in (
      'convertible_note',
      'convertible_preferred',
      'warrant',
      'prefunded_warrant',
      'atm_program',
      'equity_line',
      'stock_option',
      'equity_award',
      'share_reserve'
    ));

alter table public.dilution_totals
  drop constraint dilution_totals_type_check,
  add constraint dilution_totals_type_check
    check (instrument_type in (
      'convertible_note',
      'convertible_preferred',
      'warrant',
      'prefunded_warrant',
      'atm_program',
      'equity_line',
      'stock_option',
      'equity_award',
      'share_reserve'
    ));

create table public.dilution_corporate_action_adjustments (
  id bigint generated always as identity primary key,
  projection_id text not null unique,
  projection_version text not null,
  issuer_cik text not null,
  instrument_id bigint not null
    references public.dilution_instruments(id),
  base_snapshot_id bigint not null
    references public.dilution_instrument_snapshots(id),
  canonical_security_class_id text not null,
  status text not null,
  review_reason text,
  as_of_date date not null,
  effective_date date,
  execution_ids text[] not null,
  supersedes_projection_id text unique
    references public.dilution_corporate_action_adjustments(projection_id),
  original_fields jsonb not null,
  adjusted_fields jsonb not null,
  field_evidence jsonb not null,
  source_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_corporate_action_adjustments_projection_id_check
    check (projection_id ~ '^dca:v1:[0-9a-f]{64}$'),
  constraint dilution_corporate_action_adjustments_version_check
    check (projection_version = 'dilution-corporate-action-adjustment-v1'),
  constraint dilution_corporate_action_adjustments_issuer_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  constraint dilution_corporate_action_adjustments_security_class_check
    check (canonical_security_class_id ~ '^sc:v1:[0-9]{10}:common_stock:'),
  constraint dilution_corporate_action_adjustments_status_check
    check (status in ('APPLIED', 'REVIEW')),
  constraint dilution_corporate_action_adjustments_shape_check
    check (
      pg_catalog.jsonb_typeof(original_fields) = 'object'
      and pg_catalog.jsonb_typeof(adjusted_fields) = 'object'
      and pg_catalog.jsonb_typeof(field_evidence) = 'array'
      and pg_catalog.jsonb_typeof(source_payload) = 'object'
      and (
        status = 'APPLIED'
        and review_reason is null
        and pg_catalog.cardinality(execution_ids) > 0
        and original_fields <> '{}'::jsonb
        and adjusted_fields <> '{}'::jsonb
        and pg_catalog.jsonb_array_length(field_evidence) > 0
        or status = 'REVIEW'
        and review_reason is not null
        and original_fields = '{}'::jsonb
        and adjusted_fields = '{}'::jsonb
      )
    )
);

create index dilution_corporate_action_adjustments_instrument_idx
  on public.dilution_corporate_action_adjustments
    (instrument_id, as_of_date desc, effective_date desc, id desc);

create index dilution_corporate_action_adjustments_base_snapshot_idx
  on public.dilution_corporate_action_adjustments
    (base_snapshot_id, id desc);

alter table public.dilution_corporate_action_adjustments enable row level security;

revoke all on table public.dilution_corporate_action_adjustments
  from public, anon, authenticated, service_role;
grant select, insert on table public.dilution_corporate_action_adjustments
  to service_role;
grant usage, select on sequence public.dilution_corporate_action_adjustments_id_seq
  to service_role;

comment on table public.dilution_corporate_action_adjustments is
  'Append-only, deterministic current-state projections for source-clause-authorized stock split adjustments. Original Dilution Registry snapshots are never updated.';
comment on column public.dilution_corporate_action_adjustments.supersedes_projection_id is
  'Optional deterministic replacement edge. The referenced projection remains historical; uniqueness prevents divergent replacement branches.';
comment on column public.dilution_corporate_action_adjustments.adjusted_fields is
  'Only allowlisted share-denominated and per-share price fields changed by verified contract clauses. Dollar amount/commitment fields are never projected.';

create table public.dilution_corporate_action_clause_bindings (
  id bigint generated always as identity primary key,
  binding_id text not null unique,
  binding_version text not null,
  issuer_cik text not null,
  instrument_id bigint not null references public.dilution_instruments(id),
  execution_id text not null,
  canonical_security_class_id text not null,
  contract_raw_item_id uuid not null references public.raw_items(id),
  contract_accession text not null,
  source_ref text not null,
  source_document_url text not null,
  field_adjustments jsonb not null,
  supersedes_binding_id text unique
    references public.dilution_corporate_action_clause_bindings(binding_id),
  source_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_corporate_action_clause_bindings_id_check
    check (binding_id ~ '^dcab:v1:[0-9a-f]{64}$'),
  constraint dilution_corporate_action_clause_bindings_version_check
    check (binding_version = 'dilution-corporate-action-clause-binding-v1'),
  constraint dilution_corporate_action_clause_bindings_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  constraint dilution_corporate_action_clause_bindings_execution_check
    check (execution_id ~ '^(fse|rse):v1:[0-9a-f]{64}$'),
  constraint dilution_corporate_action_clause_bindings_class_check
    check (canonical_security_class_id ~ '^sc:v1:[0-9]{10}:common_stock:'),
  constraint dilution_corporate_action_clause_bindings_accession_check
    check (contract_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint dilution_corporate_action_clause_bindings_source_ref_check
    check (source_ref ~ '^sec-raw:v1:[0-9a-f-]{36}:[0-9a-f]{64}$'),
  constraint dilution_corporate_action_clause_bindings_source_shape_check
    check (
      pg_catalog.jsonb_typeof(field_adjustments) = 'array'
      and pg_catalog.jsonb_array_length(field_adjustments) > 0
      and pg_catalog.jsonb_typeof(source_payload) = 'object'
    )
);

create index dilution_corporate_action_clause_bindings_issuer_idx
  on public.dilution_corporate_action_clause_bindings
    (issuer_cik, canonical_security_class_id, execution_id, instrument_id, id);

alter table public.dilution_corporate_action_clause_bindings enable row level security;
revoke all on table public.dilution_corporate_action_clause_bindings
  from public, anon, authenticated, service_role;
grant select, insert on table public.dilution_corporate_action_clause_bindings
  to service_role;
grant usage, select on sequence public.dilution_corporate_action_clause_bindings_id_seq
  to service_role;

comment on table public.dilution_corporate_action_clause_bindings is
  'Append-only reviewed links from one live Dilution instrument and canonical split execution to exact persisted SEC contract evidence.';

create or replace function public.append_dilution_corporate_action_clause_binding_v1(
  p_binding jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_binding_id text := p_binding->>'bindingId';
  v_raw_item_id uuid;
  v_instrument_id bigint;
  v_supersedes text := p_binding->>'supersedesBindingId';
  v_existing_payload jsonb;
  v_raw public.raw_items%rowtype;
  v_document_text text;
  v_document_count integer;
  v_expected_source_ref text;
  v_inserted integer := 0;
  v_allowed_fields constant text[] := array[
    'original_units', 'remaining_units', 'converted_units',
    'exercised_units', 'cancelled_units', 'expired_units',
    'remaining_potential_shares', 'shares_issued', 'shares_sold',
    'registered_resale_shares', 'option_shares', 'award_units',
    'share_reserve', 'share_cap', 'conversion_price', 'exercise_price',
    'floor_price'
  ];
begin
  if pg_catalog.jsonb_typeof(p_binding) is distinct from 'object'
    or coalesce(v_binding_id, '') !~ '^dcab:v1:[0-9a-f]{64}$'
    or coalesce(p_binding->>'version', '') <> 'dilution-corporate-action-clause-binding-v1'
    or coalesce(p_binding->>'issuerCik', '') !~ '^[0-9]{10}$'
    or p_binding->>'issuerCik' = '0000000000'
    or pg_catalog.btrim(coalesce(p_binding->>'instrumentKey', '')) = ''
    or coalesce(p_binding->>'executionId', '') !~ '^(fse|rse):v1:[0-9a-f]{64}$'
    or coalesce(p_binding->>'canonicalSecurityClassId', '') !~ '^sc:v1:[0-9]{10}:common_stock:'
    or coalesce(p_binding->>'contractAccession', '') !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
    or coalesce(p_binding->>'contractRawItemId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(p_binding->>'sourceRef', '') !~ '^sec-raw:v1:[0-9a-f-]{36}:[0-9a-f]{64}$'
    or coalesce(p_binding->>'sourceDocumentUrl', '') !~ '^https://www\.sec\.gov/Archives/edgar/data/'
    or pg_catalog.jsonb_typeof(p_binding->'fieldAdjustments') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_binding->'fieldAdjustments') = 0
  then
    raise exception using errcode = '22023',
      message = 'dilution corporate action clause binding shape is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dilution-corporate-action-binding|' || v_binding_id, 0)
  );
  select binding.source_payload into v_existing_payload
  from public.dilution_corporate_action_clause_bindings as binding
  where binding.binding_id = v_binding_id;
  if found then
    if v_existing_payload is distinct from p_binding then
      raise exception using errcode = '23514',
        message = 'dilution corporate action clause binding identity payload mismatch';
    end if;
    return pg_catalog.jsonb_build_object(
      'already_saved', true, 'binding_id', v_binding_id, 'added', 0
    );
  end if;

  begin
    v_raw_item_id := (p_binding->>'contractRawItemId')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023',
      message = 'dilution corporate action clause binding raw item identity is invalid';
  end;

  select instrument.id into v_instrument_id
  from public.dilution_instruments as instrument
  where instrument.instrument_key = p_binding->>'instrumentKey'
    and instrument.issuer_cik = p_binding->>'issuerCik';
  if v_instrument_id is null then
    raise exception using errcode = '23503',
      message = 'dilution corporate action clause binding instrument is unavailable';
  end if;

  select raw_item.* into v_raw
  from public.raw_items as raw_item
  where raw_item.id = v_raw_item_id;
  if not found
    or v_raw.source_code <> 'sec_edgar'
    or coalesce(v_raw.raw_payload->>'accession_number', v_raw.source_unique_id, '')
      is distinct from p_binding->>'contractAccession'
    or pg_catalog.lpad(pg_catalog.regexp_replace(
      coalesce(v_raw.raw_payload->>'cik', v_raw.metadata->>'cik', ''), '[^0-9]', '', 'g'
    ), 10, '0') is distinct from p_binding->>'issuerCik'
  then
    raise exception using errcode = '23514',
      message = 'dilution corporate action clause binding SEC raw item identity is invalid';
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.max(document.text)
  into v_document_count, v_document_text
  from (
    select v_raw.body_text as text
    where v_raw.source_url = p_binding->>'sourceDocumentUrl'
      or v_raw.raw_payload->>'primary_document_url' = p_binding->>'sourceDocumentUrl'
    union all
    select attachment.item->>'text'
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(v_raw.raw_payload->'attachment_texts') = 'array'
        then v_raw.raw_payload->'attachment_texts' else '[]'::jsonb end
    ) as attachment(item)
    where attachment.item->>'url' = p_binding->>'sourceDocumentUrl'
  ) as document
  where document.text is not null and document.text <> '';
  if v_document_count <> 1 then
    raise exception using errcode = '23514',
      message = 'dilution corporate action clause source document is missing or ambiguous';
  end if;

  v_expected_source_ref := 'sec-raw:v1:' || pg_catalog.lower(v_raw_item_id::text) || ':' ||
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_binding->>'sourceDocumentUrl', 'UTF8'), 'sha256'),
      'hex'
    );
  if p_binding->>'sourceRef' is distinct from v_expected_source_ref
    or pg_catalog.strpos(
      p_binding->>'sourceDocumentUrl',
      '/' || pg_catalog.ltrim(p_binding->>'issuerCik', '0') || '/' ||
        pg_catalog.replace(p_binding->>'contractAccession', '-', '') || '/'
    ) = 0
  then
    raise exception using errcode = '23514',
      message = 'dilution corporate action clause source identity is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_binding->'fieldAdjustments') as adjustment(item)
    where pg_catalog.jsonb_typeof(adjustment.item) is distinct from 'object'
      or not ((adjustment.item->>'field') = any(v_allowed_fields))
      or adjustment.item->>'operation' is distinct from case
        when adjustment.item->>'field' = any(array[
          'conversion_price', 'exercise_price', 'floor_price'
        ]) then 'divide_by_split_ratio'
        else 'multiply_by_split_ratio'
      end
      or pg_catalog.jsonb_typeof(adjustment.item->'evidenceIdentity') is distinct from 'object'
      or adjustment.item#>>'{evidenceIdentity,version}'
        is distinct from 'corporate_action_evidence_identity_v1'
      or adjustment.item#>>'{evidenceIdentity,source_ref}'
        is distinct from p_binding->>'sourceRef'
      or adjustment.item#>>'{evidenceIdentity,exact_source}' is distinct from 'true'
      or coalesce(adjustment.item#>>'{evidenceIdentity,range_start}', '') !~ '^[0-9]+$'
      or coalesce(adjustment.item#>>'{evidenceIdentity,range_end}', '') !~ '^[0-9]+$'
      or (adjustment.item#>>'{evidenceIdentity,range_end}')::integer
        <= (adjustment.item#>>'{evidenceIdentity,range_start}')::integer
      or (adjustment.item#>>'{evidenceIdentity,range_end}')::integer
        > pg_catalog.length(v_document_text)
      or coalesce(adjustment.item#>>'{evidenceIdentity,source_content_hash}', '') !~ '^[0-9a-f]{64}$'
      or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.substr(
          v_document_text,
          (adjustment.item#>>'{evidenceIdentity,range_start}')::integer + 1,
          (adjustment.item#>>'{evidenceIdentity,range_end}')::integer
            - (adjustment.item#>>'{evidenceIdentity,range_start}')::integer
        ), 'UTF8'
      ), 'sha256'), 'hex') is distinct from
        adjustment.item#>>'{evidenceIdentity,source_content_hash}'
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(p_binding->'fieldAdjustments') as adjustment(item)
  ) <> (
    select pg_catalog.count(distinct adjustment.item->>'field')
    from pg_catalog.jsonb_array_elements(p_binding->'fieldAdjustments') as adjustment(item)
  ) then
    raise exception using errcode = '22023',
      message = 'dilution corporate action clause field evidence is invalid';
  end if;

  if v_supersedes is not null and (
    v_supersedes !~ '^dcab:v1:[0-9a-f]{64}$'
    or v_supersedes = v_binding_id
    or not exists (
      select 1 from public.dilution_corporate_action_clause_bindings as prior
      where prior.binding_id = v_supersedes
        and prior.instrument_id = v_instrument_id
        and prior.execution_id = p_binding->>'executionId'
    )
  ) then
    raise exception using errcode = '23514',
      message = 'dilution corporate action clause binding supersession is invalid';
  end if;

  insert into public.dilution_corporate_action_clause_bindings (
    binding_id, binding_version, issuer_cik, instrument_id, execution_id,
    canonical_security_class_id, contract_raw_item_id, contract_accession,
    source_ref, source_document_url, field_adjustments,
    supersedes_binding_id, source_payload
  ) values (
    v_binding_id, p_binding->>'version', p_binding->>'issuerCik', v_instrument_id,
    p_binding->>'executionId', p_binding->>'canonicalSecurityClassId', v_raw_item_id,
    p_binding->>'contractAccession', p_binding->>'sourceRef',
    p_binding->>'sourceDocumentUrl', p_binding->'fieldAdjustments',
    v_supersedes, p_binding
  );
  get diagnostics v_inserted = row_count;
  return pg_catalog.jsonb_build_object(
    'already_saved', false, 'binding_id', v_binding_id, 'added', v_inserted
  );
end;
$function$;

revoke all on function public.append_dilution_corporate_action_clause_binding_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.append_dilution_corporate_action_clause_binding_v1(jsonb)
  to service_role;

create or replace function public.read_dilution_corporate_action_context_v1(
  p_issuer_cik text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_instruments jsonb;
  v_bindings jsonb;
  v_documents jsonb;
begin
  if coalesce(p_issuer_cik, '') !~ '^[0-9]{10}$' or p_issuer_cik = '0000000000' then
    raise exception using errcode = '22023',
      message = 'dilution corporate action context issuer is invalid';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'issuerCik', instrument.issuer_cik,
    'instrumentKey', instrument.instrument_key,
    'instrumentId', instrument.id::text,
    'baseSnapshotId', snapshot.id::text,
    'canonicalSecurityClassId', '',
    'asOfDate', snapshot.as_of_date::text,
    'status', snapshot.status,
    'values', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'original_units', snapshot.original_units::text,
      'remaining_units', snapshot.remaining_units::text,
      'converted_units', snapshot.converted_units::text,
      'exercised_units', snapshot.exercised_units::text,
      'cancelled_units', snapshot.cancelled_units::text,
      'expired_units', snapshot.expired_units::text,
      'remaining_potential_shares', snapshot.remaining_potential_shares::text,
      'shares_issued', snapshot.shares_issued::text,
      'shares_sold', snapshot.shares_sold::text,
      'registered_resale_shares', snapshot.registered_resale_shares::text,
      'conversion_price', snapshot.conversion_price::text,
      'exercise_price', snapshot.exercise_price::text,
      'floor_price', snapshot.floor_price::text
    )),
    'supersedesProjectionId', active_projection.projection_id
  ) order by instrument.id), '[]'::jsonb)
  into v_instruments
  from public.dilution_instruments as instrument
  join lateral (
    select candidate.* from public.dilution_instrument_snapshots as candidate
    where candidate.instrument_id = instrument.id
    order by candidate.as_of_date desc, candidate.id desc
    limit 1
  ) as snapshot on true
  left join lateral (
    select adjustment.projection_id
    from public.dilution_corporate_action_adjustments as adjustment
    where adjustment.base_snapshot_id = snapshot.id
      and not exists (
        select 1 from public.dilution_corporate_action_adjustments as replacement
        where replacement.supersedes_projection_id = adjustment.projection_id
      )
    order by adjustment.id desc
    limit 1
  ) as active_projection on true
  where instrument.issuer_cik = p_issuer_cik;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'instrumentKey', instrument.instrument_key,
    'executionId', binding.execution_id,
    'canonicalSecurityClassId', binding.canonical_security_class_id,
    'contractAccession', binding.contract_accession,
    'sourceRef', binding.source_ref,
    'sourceDocumentUrl', binding.source_document_url,
    'fieldAdjustments', binding.field_adjustments
  ) order by binding.id), '[]'::jsonb)
  into v_bindings
  from public.dilution_corporate_action_clause_bindings as binding
  join public.dilution_instruments as instrument on instrument.id = binding.instrument_id
  where binding.issuer_cik = p_issuer_cik
    and not exists (
      select 1 from public.dilution_corporate_action_clause_bindings as replacement
      where replacement.supersedes_binding_id = binding.binding_id
    );

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'source_ref', source.source_ref,
    'label', source.contract_accession,
    'text', source.document_text
  ) order by source.source_ref), '[]'::jsonb)
  into v_documents
  from (
    select distinct on (binding.source_ref)
      binding.source_ref,
      binding.contract_accession,
      document.document_text
    from public.dilution_corporate_action_clause_bindings as binding
    join public.raw_items as raw_item on raw_item.id = binding.contract_raw_item_id
    join lateral (
      select pg_catalog.max(candidate.text) as document_text
      from (
        select raw_item.body_text as text
        where raw_item.source_url = binding.source_document_url
          or raw_item.raw_payload->>'primary_document_url' = binding.source_document_url
        union all
        select attachment.item->>'text'
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(raw_item.raw_payload->'attachment_texts') = 'array'
            then raw_item.raw_payload->'attachment_texts' else '[]'::jsonb end
        ) as attachment(item)
        where attachment.item->>'url' = binding.source_document_url
      ) as candidate
      having pg_catalog.count(*) = 1
    ) as document on true
    where binding.issuer_cik = p_issuer_cik
      and not exists (
        select 1 from public.dilution_corporate_action_clause_bindings as replacement
        where replacement.supersedes_binding_id = binding.binding_id
      )
    order by binding.source_ref, binding.id desc
  ) as source;

  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'issuer_cik', p_issuer_cik,
    'instruments', v_instruments,
    'clause_bindings', v_bindings,
    'source_documents', v_documents
  );
end;
$function$;

revoke all on function public.read_dilution_corporate_action_context_v1(text)
  from public, anon, authenticated;
grant execute on function public.read_dilution_corporate_action_context_v1(text)
  to service_role;

create or replace function public.append_dilution_corporate_action_adjustment_v1(
  p_projection jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_projection_id text := p_projection->>'projectionId';
  v_instrument_id bigint;
  v_base_snapshot_id bigint;
  v_supersedes text := p_projection->>'supersedesProjectionId';
  v_existing_payload jsonb;
  v_inserted integer := 0;
  v_allowed_fields constant text[] := array[
    'original_units', 'remaining_units', 'converted_units',
    'exercised_units', 'cancelled_units', 'expired_units',
    'remaining_potential_shares', 'shares_issued', 'shares_sold',
    'registered_resale_shares', 'option_shares', 'award_units',
    'share_reserve', 'share_cap', 'conversion_price', 'exercise_price',
    'floor_price'
  ];
begin
  if pg_catalog.jsonb_typeof(p_projection) is distinct from 'object'
    or coalesce(v_projection_id, '') !~ '^dca:v1:[0-9a-f]{64}$'
    or coalesce(p_projection->>'version', '') <> 'dilution-corporate-action-adjustment-v1'
    or coalesce(p_projection->>'status', '') not in ('APPLIED', 'REVIEW')
    or coalesce(p_projection->>'issuerCik', '') !~ '^[0-9]{10}$'
    or p_projection->>'issuerCik' = '0000000000'
    or coalesce(p_projection->>'instrumentKey', '') = ''
    or coalesce(p_projection->>'canonicalSecurityClassId', '') !~ '^sc:v1:[0-9]{10}:common_stock:'
    or coalesce(p_projection->>'asOfDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or pg_catalog.jsonb_typeof(p_projection->'executionIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_projection->'originalFields') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_projection->'adjustedFields') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_projection->'fieldEvidence') is distinct from 'array'
  then
    raise exception using errcode = '22023',
      message = 'dilution corporate action projection shape is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dilution-corporate-action|' || v_projection_id, 0)
  );

  select adjustment.source_payload
  into v_existing_payload
  from public.dilution_corporate_action_adjustments as adjustment
  where adjustment.projection_id = v_projection_id;

  if found then
    if v_existing_payload is distinct from p_projection then
      raise exception using errcode = '23514',
        message = 'dilution corporate action projection identity payload mismatch';
    end if;
    return pg_catalog.jsonb_build_object(
      'already_saved', true,
      'projection_id', v_projection_id,
      'added', 0
    );
  end if;

  begin
    v_instrument_id := (p_projection->>'instrumentId')::bigint;
    v_base_snapshot_id := (p_projection->>'baseSnapshotId')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023',
      message = 'dilution corporate action projection identity is invalid';
  end;

  if v_instrument_id <= 0 or v_base_snapshot_id <= 0
    or not exists (
      select 1
      from public.dilution_instruments as instrument
      join public.dilution_instrument_snapshots as snapshot
        on snapshot.instrument_id = instrument.id
      where instrument.id = v_instrument_id
        and snapshot.id = v_base_snapshot_id
        and instrument.issuer_cik = p_projection->>'issuerCik'
        and instrument.instrument_key = p_projection->>'instrumentKey'
        and snapshot.as_of_date = (p_projection->>'asOfDate')::date
        and snapshot.status = 'current'
    )
  then
    raise exception using errcode = '23514',
      message = 'dilution corporate action base snapshot is not a matching live instrument state';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_projection->'originalFields') as field(key)
    where not (field.key = any(v_allowed_fields))
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_projection->'adjustedFields') as field(key)
    where not (field.key = any(v_allowed_fields))
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_projection->'originalFields') as field(key, value)
    where pg_catalog.jsonb_typeof(field.value) <> 'string'
      or field.value#>>'{}' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_projection->'adjustedFields') as field(key, value)
    where pg_catalog.jsonb_typeof(field.value) <> 'string'
      or field.value#>>'{}' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(p_projection->'executionIds') as execution(value)
    where execution.value !~ '^(fse|rse):v1:[0-9a-f]{64}$'
  )
  then
    raise exception using errcode = '22023',
      message = 'dilution corporate action projection fields or execution identity are invalid';
  end if;

  if (p_projection->>'status' = 'APPLIED' and (
      p_projection->'adjustedFields' = '{}'::jsonb
      or p_projection->'originalFields' = '{}'::jsonb
      or (select pg_catalog.array_agg(key order by key)
          from pg_catalog.jsonb_object_keys(p_projection->'originalFields') as original(key))
        is distinct from
         (select pg_catalog.array_agg(key order by key)
          from pg_catalog.jsonb_object_keys(p_projection->'adjustedFields') as adjusted(key))
      or pg_catalog.jsonb_array_length(p_projection->'fieldEvidence') = 0
      or pg_catalog.jsonb_array_length(p_projection->'executionIds') = 0
      or not (p_projection ? 'reviewReason')
      or p_projection->'reviewReason' is distinct from 'null'::jsonb
    )) or (p_projection->>'status' = 'REVIEW' and (
      p_projection->'adjustedFields' <> '{}'::jsonb
      or p_projection->'originalFields' <> '{}'::jsonb
      or pg_catalog.btrim(coalesce(p_projection->>'reviewReason', '')) = ''
    ))
  then
    raise exception using errcode = '22023',
      message = 'dilution corporate action applied or review state is invalid';
  end if;

  if v_supersedes is not null and (
    v_supersedes !~ '^dca:v1:[0-9a-f]{64}$'
    or v_supersedes = v_projection_id
    or not exists (
      select 1
      from public.dilution_corporate_action_adjustments as prior
      where prior.projection_id = v_supersedes
        and prior.instrument_id = v_instrument_id
        and prior.base_snapshot_id = v_base_snapshot_id
    )
  ) then
    raise exception using errcode = '23514',
      message = 'dilution corporate action supersession target is invalid';
  end if;

  insert into public.dilution_corporate_action_adjustments (
    projection_id,
    projection_version,
    issuer_cik,
    instrument_id,
    base_snapshot_id,
    canonical_security_class_id,
    status,
    review_reason,
    as_of_date,
    effective_date,
    execution_ids,
    supersedes_projection_id,
    original_fields,
    adjusted_fields,
    field_evidence,
    source_payload
  ) values (
    v_projection_id,
    p_projection->>'version',
    p_projection->>'issuerCik',
    v_instrument_id,
    v_base_snapshot_id,
    p_projection->>'canonicalSecurityClassId',
    p_projection->>'status',
    p_projection->>'reviewReason',
    (p_projection->>'asOfDate')::date,
    nullif(p_projection->>'effectiveDate', '')::date,
    array(select pg_catalog.jsonb_array_elements_text(p_projection->'executionIds')),
    v_supersedes,
    p_projection->'originalFields',
    p_projection->'adjustedFields',
    p_projection->'fieldEvidence',
    p_projection
  );
  get diagnostics v_inserted = row_count;

  return pg_catalog.jsonb_build_object(
    'already_saved', false,
    'projection_id', v_projection_id,
    'added', v_inserted
  );
end;
$function$;

revoke all on function public.append_dilution_corporate_action_adjustment_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.append_dilution_corporate_action_adjustment_v1(jsonb)
  to service_role;

comment on function public.append_dilution_corporate_action_adjustment_v1(jsonb) is
  'Idempotently appends one deterministic Dilution Corporate Action projection. It never updates or deletes Registry history.';
