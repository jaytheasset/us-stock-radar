-- New alerts only. Legacy rows remain NULL; no backfill or changes to RLS/dedupe.
begin;
alter table public.user_alert_deliveries
  add column secondary_match_evidence jsonb,
  add constraint user_alert_secondary_evidence_object_check
    check (secondary_match_evidence is null or coalesce(
      jsonb_typeof(secondary_match_evidence) = 'object'
      and secondary_match_evidence->>'version' = 'secondary_monitor_evidence_v1'
      and secondary_match_evidence->>'family' = 'form144'
      and (alert_event_id is null or secondary_match_evidence->>'eventId' = alert_event_id::text)
      and secondary_match_evidence->>'sourceExecutionId' = listing_source_execution_id::text
      and alert_lane = 'listing_monitor' and alert_domain = 'listing', false));

create function public.preserve_secondary_monitor_match_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.secondary_match_evidence is not null and new.listing_monitor_id is null then
      raise exception 'secondary_monitor_required';
    end if;
    return new;
  end if;
  -- Also prohibit filling legacy snapshots after the fact.
  if new.secondary_match_evidence is distinct from old.secondary_match_evidence
    or (old.secondary_match_evidence is not null and (
      new.user_id is distinct from old.user_id
      or new.listing_source_execution_id is distinct from old.listing_source_execution_id
      or (new.alert_event_id is not null and new.alert_event_id is distinct from old.alert_event_id)
      or (new.listing_monitor_id is not null and new.listing_monitor_id is distinct from old.listing_monitor_id)
    )) then raise exception 'secondary_monitor_evidence_immutable'; end if;
  return new;
end $$;
revoke all on function public.preserve_secondary_monitor_match_evidence() from public, anon, authenticated;
create trigger preserve_secondary_monitor_match
before insert or update on public.user_alert_deliveries
for each row execute function public.preserve_secondary_monitor_match_evidence();

comment on column public.user_alert_deliveries.secondary_match_evidence is
  'Immutable match-time display snapshot: condition values, exact matched direct FACT row and source lineage. Never reconstruct from current Monitor or reader.';
notify pgrst, 'reload schema';
commit;
