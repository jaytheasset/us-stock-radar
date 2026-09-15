-- Keep direct XML facts readable while exposing structured context only when its
-- persisted AI lineage is a completed semantic-verifier summary tied to the
-- original ownership-context analysis and to the exact effective assertions.

create or replace function public.ownership_context_semantic_verifier_refs_valid(p_event_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with context_rows as (
    select 'row:form4:' || row_value.transaction_index::text as row_ref, row_value.context_facts as context_facts
    from public.event_form4_transactions as row_value
    where row_value.event_id = p_event_id and row_value.context_facts is not null
    union all
    select 'row:form144:' || row_value.proposed_sale_index::text as row_ref, row_value.context_facts as context_facts
    from public.event_form144_proposed_sales as row_value
    where row_value.event_id = p_event_id and row_value.context_facts is not null
  ), refs as (
    select distinct
      context_facts#>>'{ai_refs,run_id}' as run_id,
      context_facts#>>'{ai_refs,output_id}' as output_id
    from context_rows
  )
  select case
    when not exists (select 1 from context_rows) then true
    when (select pg_catalog.count(*) from refs) <> 1 then false
    else exists (
      select 1
      from refs
      join public.ai_runs as verifier_run on verifier_run.id::text = refs.run_id
      join public.ai_outputs as verifier_output on verifier_output.id::text = refs.output_id
        and verifier_output.ai_run_id = verifier_run.id
      join public.ai_runs as source_run
        on source_run.id::text = verifier_output.payload#>>'{source_analysis_refs,run_id}'
      join public.ai_outputs as source_output
        on source_output.id::text = verifier_output.payload#>>'{source_analysis_refs,output_id}'
        and source_output.ai_run_id = source_run.id
      where verifier_run.event_id = p_event_id
        and verifier_run.status = 'completed'
        and verifier_run.prompt_key = 'ownership_semantic_verifier'
        and verifier_run.prompt_version = 'ownership_semantic_verifier_v1'
        and verifier_run.metadata->>'purpose' = 'ownership_semantic_verifier'
        and verifier_output.event_id = p_event_id
        and verifier_output.output_type = 'ownership_context_v1'
        and verifier_output.payload->>'purpose' = 'ownership_semantic_verifier'
        and verifier_output.payload->>'contract_version' = 'ownership_semantic_verifier_v1'
        and pg_catalog.jsonb_typeof(verifier_output.payload->'original_structured_candidate') = 'object'
        and verifier_output.payload#>>'{original_structured_candidate,event_ref}' = 'event:' || p_event_id::text
        and verifier_output.payload#>>'{original_structured_candidate,source_fingerprint}'
          = public.ownership_context_source_fingerprint(p_event_id)
        and verifier_output.payload#>>'{original_structured_candidate,form}' = case
          pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(
            (select event_row.metadata->>'form_type' from public.events as event_row where event_row.id = p_event_id)
          ), '^FORM[[:space:]]+', ''))
          when '4' then 'form4' when '4/A' then 'form4'
          when '144' then 'form144' when '144/A' then 'form144'
          else null end
        and pg_catalog.jsonb_typeof(verifier_output.payload->'verifications') = 'array'
        and pg_catalog.jsonb_typeof(verifier_output.payload->'effective_contexts') = 'array'
        and pg_catalog.jsonb_array_length(verifier_output.payload->'effective_contexts')
          = (select pg_catalog.count(*) from context_rows)
        and source_run.event_id = p_event_id
        and source_run.status = 'completed'
        and source_run.prompt_key = 'ownership_structured_context'
        and source_output.event_id = p_event_id
        and source_output.output_type = 'ownership_context_v1'
        and source_output.payload->>'purpose' = 'ownership_structured_context'
        and source_output.payload->'mapped_canonical_output'
          = verifier_output.payload->'original_structured_candidate'
        and not exists (
          select 1 from context_rows as context_row
          where not exists (
            select 1
            from pg_catalog.jsonb_array_elements(verifier_output.payload->'effective_contexts') as effective(value)
            where effective.value->>'row_ref' = context_row.row_ref
              and effective.value->'assertions' = context_row.context_facts->'assertions'
          )
        )
    )
  end;
$function$;

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
      'source_group', event_row.source_group, 'event_type', event_row.event_type, 'metadata', event_row.metadata
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

revoke all on function public.ownership_context_semantic_verifier_refs_valid(uuid) from public, anon, authenticated;
revoke all on function public.read_event_ownership_context_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.ownership_context_semantic_verifier_refs_valid(uuid) to service_role;
grant execute on function public.read_event_ownership_context_snapshot(uuid) to service_role;

comment on function public.ownership_context_semantic_verifier_refs_valid(uuid) is
  'True only when stored ownership context is bound to a completed semantic-verifier trace and its exact effective assertions.';
