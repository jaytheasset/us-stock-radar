begin;
alter table public.user_alert_deliveries add column financial_match_evidence jsonb,
  add constraint financial_monitor_evidence_shape check (financial_match_evidence is null or coalesce(
    jsonb_typeof(financial_match_evidence) = 'object'
    and financial_match_evidence->>'version' = 'financial_monitor_evidence_v1'
    and financial_match_evidence->>'eventId' = alert_event_id::text
    and financial_match_evidence->>'sourceExecutionId' = financial_source_execution_id::text
    and financial_match_evidence->>'accession' = financial_accession
    and financial_match_evidence->>'issuerCik' = financial_issuer_cik
    and alert_lane = 'financial_monitor' and alert_domain = 'financial', false));
create function public.preserve_financial_monitor_match_evidence() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.financial_match_evidence is not null and new.financial_monitor_id is null then raise exception 'financial_monitor_required'; end if;
    return new;
  end if;
  if new.financial_match_evidence is distinct from old.financial_match_evidence or (old.financial_match_evidence is not null and (
    new.user_id is distinct from old.user_id or new.alert_event_id is distinct from old.alert_event_id
    or new.financial_source_execution_id is distinct from old.financial_source_execution_id
    or new.financial_accession is distinct from old.financial_accession or new.financial_issuer_cik is distinct from old.financial_issuer_cik
    or (new.financial_monitor_id is not null and new.financial_monitor_id is distinct from old.financial_monitor_id)
  )) then raise exception 'financial_monitor_evidence_immutable'; end if;
  return new;
end $$;
revoke all on function public.preserve_financial_monitor_match_evidence() from public, anon, authenticated;
create trigger preserve_financial_monitor_match before insert or update on public.user_alert_deliveries
for each row execute function public.preserve_financial_monitor_match_evidence();
comment on column public.user_alert_deliveries.financial_match_evidence is 'Immutable matched exact-decimal financial observations, source references, periods and conditions. No legacy reconstruction.';
notify pgrst, 'reload schema';
commit;
