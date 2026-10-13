begin;
alter table public.financial_monitors add column target jsonb,
  add constraint financial_monitor_target_shape check (target is null or coalesce(
    jsonb_typeof(target) = 'object' and target->>'version' = 'financial_monitor_target_v1'
    and target->>'scope' = 'issuer' and target->>'ticker' ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'
    and target->>'issuerCik' ~ '^[0-9]{10}$' and target->>'issuerCik' <> '0000000000'
    and target->>'sourceRawId' ~ '^[0-9a-f-]{36}$'
    and target->>'contentHash' ~ '^[0-9a-f]{64}$' and target->>'refreshSequence' ~ '^[1-9][0-9]*$'
    and length(btrim(target->>'companyName')) > 0 and length(btrim(target->>'exchange')) > 0
    and length(target->>'confirmedAt') > 0 and length(target->>'verifiedAt') > 0, false));
create function public.preserve_financial_monitor_target() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.target is null then raise exception 'financial_monitor_target_required'; end if;
  elsif new.target is distinct from old.target then
    raise exception 'financial_monitor_target_immutable';
  end if;
  return new;
end $$;
revoke all on function public.preserve_financial_monitor_target() from public, anon, authenticated;
create trigger preserve_financial_target before insert or update on public.financial_monitors
for each row execute function public.preserve_financial_monitor_target();

create function public.bind_financial_alert_target() returns trigger language plpgsql set search_path = '' as $$
declare saved_target jsonb;
begin
  if new.financial_monitor_id is null then return new; end if;
  select target into saved_target from public.financial_monitors where id = new.financial_monitor_id;
  if saved_target is not null and not coalesce(
    new.financial_match_evidence->'target'->'selected' = saved_target
    and new.financial_issuer_cik = saved_target->>'issuerCik'
    and new.financial_match_evidence->'target'->'confirmed'->>'issuerCik' = saved_target->>'issuerCik'
    and new.financial_match_evidence->'target'->'confirmed'->>'ticker' = saved_target->>'ticker', false)
  then raise exception 'financial_alert_target_mismatch'; end if;
  return new;
end $$;
revoke all on function public.bind_financial_alert_target() from public, anon, authenticated;
create trigger bind_financial_alert_target before insert on public.user_alert_deliveries
for each row execute function public.bind_financial_alert_target();
comment on column public.financial_monitors.target is 'Immutable verified SEC issuer selection; null only for pre-existing legacy all-issuer monitors. Never backfilled.';
notify pgrst, 'reload schema';
commit;
