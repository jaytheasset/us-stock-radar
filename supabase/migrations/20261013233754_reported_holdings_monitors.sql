begin;
create table public.reported_holding_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target jsonb not null,
  settings jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint reported_holding_target_shape check (coalesce(
    jsonb_typeof(target) = 'object' and target->>'version' = 'financial_monitor_target_v1'
    and target->>'scope' = 'issuer' and target->>'ticker' ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'
    and target->>'issuerCik' ~ '^[0-9]{10}$' and target->>'issuerCik' <> '0000000000'
    and target->>'sourceRawId' ~ '^[0-9a-f-]{36}$' and target->>'contentHash' ~ '^[0-9a-f]{64}$'
    and target->>'refreshSequence' ~ '^[1-9][0-9]*$'
    and length(btrim(target->>'companyName')) > 0 and length(btrim(target->>'exchange')) > 0
    and length(target->>'confirmedAt') > 0 and length(target->>'verifiedAt') > 0, false)),
  constraint reported_holding_settings_shape check (coalesce(
    jsonb_typeof(settings) = 'object' and settings->>'form' in ('3','5')
    and length(btrim(settings->>'securityTitle')) between 1 and 200
    and settings->>'operator' in ('eq','gte','lte')
    and jsonb_typeof(settings->'amount') = 'string'
    and settings->>'amount' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    and length(settings->>'amount') <= 100
    and settings - array['form','securityTitle','operator','amount'] = '{}'::jsonb, false))
);
create index reported_holding_owner_idx on public.reported_holding_monitors(user_id, created_at, id);
alter table public.reported_holding_monitors enable row level security;
revoke all on public.reported_holding_monitors from anon, authenticated;
grant select on public.reported_holding_monitors to authenticated;
grant select, insert on public.reported_holding_monitors to service_role;
create policy reported_holding_owner_read on public.reported_holding_monitors
for select to authenticated using ((select auth.uid()) = user_id);

create function public.preserve_reported_holding_monitor() returns trigger language plpgsql set search_path = '' as $$
begin
  if new is distinct from old then raise exception 'reported_holding_monitor_immutable'; end if;
  return new;
end $$;
revoke all on function public.preserve_reported_holding_monitor() from public, anon, authenticated;
create trigger preserve_reported_holding_monitor before update on public.reported_holding_monitors
for each row execute function public.preserve_reported_holding_monitor();

alter table public.user_alert_deliveries
  add column reported_holding_monitor_id uuid references public.reported_holding_monitors(id) on delete restrict,
  add column reported_holding_accession text references public.sec_section16_filings(accession_number) on delete restrict,
  add column reported_holding_evidence jsonb,
  add constraint reported_holding_once unique(reported_holding_monitor_id, reported_holding_accession),
  drop constraint user_alert_deliveries_alert_lane_check,
  drop constraint user_alert_deliveries_alert_domain_check;
alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_alert_lane_check check (alert_lane in ('watchlist','market_discovery','calendar_follow','listing_monitor','offering_monitor','financial_monitor','sc13_monitor','reported_holdings')),
  add constraint user_alert_deliveries_alert_domain_check check (alert_domain is null or alert_domain in ('listing','offering','financial','sc13','reported_holdings')),
  add constraint reported_holding_alert_shape check (
    (reported_holding_monitor_id is null and reported_holding_accession is null and reported_holding_evidence is null
      and alert_lane <> 'reported_holdings' and alert_domain is distinct from 'reported_holdings')
    or (reported_holding_monitor_id is not null and reported_holding_accession is not null
      and reported_holding_evidence is not null
      and reported_holding_evidence->>'version' = 'reported_holdings_evidence_v1'
      and reported_holding_evidence->>'family' = 'section16_holdings'
      and reported_holding_evidence->>'accessionNumber' = reported_holding_accession
      and jsonb_typeof(reported_holding_evidence->'matches') = 'array'
      and jsonb_array_length(reported_holding_evidence->'matches') > 0
      and alert_lane = 'reported_holdings' and alert_domain = 'reported_holdings'
      and alert_event_id is null and ticker is null and category = 'insider_ownership'
      and source_type = 'other' and source_label = 'Form 3/5 Reported Holdings'
      and delivery_status = 'queued' and delivered_channels = array[]::text[]
      and scheduled_for is null and sent_at is null and attempted_at is null and dedupe_key is null
      and listing_monitor_id is null and listing_source_execution_id is null and listing_match_evidence is null
      and offering_monitor_id is null and offering_registry_snapshot_id is null and offering_registry_accession is null
      and financial_monitor_id is null and financial_match_evidence is null and financial_source_execution_id is null
      and financial_accession is null and financial_issuer_cik is null
      and sc13_monitor_id is null and sc13_match_evidence is null and sc13_position_key is null
      and sc13_root_accession is null and sc13_head_accession is null and sc13_reporter_cik is null
      and sc13_security_class is null and sc13_cusips is null and sc13_reporter_index is null
      and secondary_match_evidence is null and offering_plan_match_evidence is null
      and effect_match_evidence is null and effect_registration_key is null
      and projected_fact_id is null and projected_monitor_id is null and projected_alert_key is null and projected_scenario is null
      and ticker_match is null and calendar_event_id is null and severity is null) is true
  );
create index reported_holding_accession_idx on public.user_alert_deliveries(reported_holding_accession) where reported_holding_accession is not null;

create function public.bind_reported_holding_alert() returns trigger language plpgsql set search_path = '' as $$
declare m public.reported_holding_monitors; f public.sec_section16_filings;
begin
  if tg_op = 'UPDATE' and (old.reported_holding_monitor_id is not null or new.reported_holding_monitor_id is not null) then
    if new is distinct from old then raise exception 'reported_holding_alert_immutable'; end if;
    return new;
  end if;
  if new.reported_holding_monitor_id is null then return new; end if;
  select * into m from public.reported_holding_monitors where id = new.reported_holding_monitor_id;
  select * into f from public.sec_section16_filings where accession_number = new.reported_holding_accession;
  if not coalesce(m.is_active and m.user_id = new.user_id
    and new.reported_holding_evidence->'target' = m.target
    and new.reported_holding_evidence->'settings' = m.settings
    and (new.reported_holding_evidence->>'monitorCreatedAt')::timestamptz = m.created_at
    and m.target->>'issuerCik' = f.issuer_cik
    and new.reported_holding_evidence->>'issuerCik' = f.issuer_cik
    and new.reported_holding_evidence->'confirmedTarget'->>'issuerCik' = f.issuer_cik
    and new.reported_holding_evidence->'confirmedTarget'->>'ticker' = m.target->>'ticker'
    and new.reported_holding_evidence->>'rawItemId' = f.raw_item_id::text
    and new.reported_holding_evidence->>'sourceSha256' = f.source_sha256
    and new.reported_holding_evidence->>'sourceUrl' = f.source_url
    and new.reported_holding_evidence->>'parserVersion' = f.parser_version
    and m.settings->>'form' = f.form_type_raw and f.form_type_raw in ('3','5')
    and new.reported_holding_evidence->>'filingForm' = f.form_type_raw, false)
  then raise exception 'reported_holding_alert_binding_invalid'; end if;
  return new;
end $$;
revoke all on function public.bind_reported_holding_alert() from public, anon, authenticated;
create trigger bind_reported_holding_alert before insert or update on public.user_alert_deliveries
for each row execute function public.bind_reported_holding_alert();
comment on table public.reported_holding_monitors is 'Verified issuer Form 3/5 non-derivative reported holdings; one row AND match, no aggregation or current balance inference. Service-only creation after authenticated target verification.';
comment on column public.user_alert_deliveries.reported_holding_evidence is 'Immutable first matched canonical holding rows and SEC source provenance; one internal alert per monitor/accession. No Primary event or external send.';
notify pgrst, 'reload schema';
commit;
