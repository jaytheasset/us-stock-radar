-- Reverse Split Execution Update Safety V1.
-- The semantic relation remains inside the existing immutable canonical fact
-- JSON. This bounded service-role reader exposes only candidate lineage; the
-- application official reader still verifies current Primary/child lineage.

create index event_corporate_action_facts_execution_update_idx
  on public.event_corporate_action_facts (issuer_cik, source_execution_id)
  where event_kind = 'reverse_split'
    and facts_payload ? 'execution_update';

create or replace function public.read_reverse_split_execution_update_candidates(
  p_issuer_cik text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_issuer_cik !~ '^[0-9]{10}$' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'issuer_cik', p_issuer_cik,
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', candidate.event_id,
        'source_execution_id', candidate.source_execution_id,
        'persisted_at', candidate.persisted_at
      ) order by candidate.persisted_at, candidate.source_execution_id)
      from (
        select facts.event_id, facts.source_execution_id, facts.persisted_at
        from public.event_corporate_action_facts as facts
        where facts.event_kind = 'reverse_split'
          and facts.issuer_cik = p_issuer_cik
          and facts.facts_payload ? 'execution_update'
        order by facts.persisted_at desc, facts.source_execution_id desc
        limit 512
      ) as candidate
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.read_reverse_split_execution_update_candidates(text)
  from public, anon, authenticated, service_role;
grant execute on function public.read_reverse_split_execution_update_candidates(text)
  to service_role;

comment on function public.read_reverse_split_execution_update_candidates(text) is
  'Returns bounded reverse-split execution-update lineage candidates for official current-result verification; performs no lifecycle inference or share arithmetic.';
