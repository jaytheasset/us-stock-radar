begin;

-- Existing Monitor/outbox only. No delivery scheduler or Registry snapshot changes.
alter table public.user_alert_deliveries
  add column effect_registration_key text,
  add column effect_match_evidence jsonb,
  add constraint effect_monitor_registration_once unique(listing_monitor_id, effect_registration_key);

create function public.effect_monitor_target(p_conditions jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v jsonb; n integer;
begin
  if not exists(select 1 from jsonb_array_elements(p_conditions) c where c->>'key' like 'effect.%') then return null; end if;
  select count(distinct c->>'key'), jsonb_object_agg(c->>'key',c->'value') into n,v from jsonb_array_elements(p_conditions) c;
  if jsonb_array_length(p_conditions) <> 5 or n <> 5 or exists(
    select 1 from jsonb_array_elements(p_conditions) c where c->>'operator' is distinct from 'eq'
    or c->>'key' not in ('effect.observed','effect.issuer_cik','effect.file_number','effect.registration_form','effect.registration_accession'))
    or (v->'effect.observed') is distinct from 'true'::jsonb
    or coalesce(v->>'effect.issuer_cik','') !~ '^[0-9]{10}$'
    or coalesce(v->>'effect.file_number','') !~ '^333-[0-9]+(-[0-9]+)?$'
    or coalesce(v->>'effect.registration_form','') not in ('S-1','S-3','F-1','F-3')
    or coalesce(v->>'effect.registration_accession','') !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
  then raise exception 'EFFECT_TARGET_CONFIRMATION_REQUIRED'; end if;
  return jsonb_build_object('cik',v->>'effect.issuer_cik','fileNumber',v->>'effect.file_number',
    'form',v->>'effect.registration_form','accession',v->>'effect.registration_accession');
end $$;

create function public.validate_effect_monitor_target() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare t jsonb; matched integer;
begin
  t := public.effect_monitor_target(new.conditions);
  if tg_op = 'UPDATE' and public.effect_monitor_target(old.conditions) is not null and t is null then
    raise exception 'EFFECT_TARGET_REMOVAL_FORBIDDEN';
  end if;
  if t is null then return new; end if;
  select count(*) into matched from public.raw_items r
    where r.source_code='sec_edgar' and r.source_unique_id=t->>'accession'
    and r.raw_payload->>'accession_number'=t->>'accession'
    and lpad(r.raw_payload->>'cik',10,'0')=t->>'cik'
    and r.raw_payload->>'file_number'=t->>'fileNumber'
    and regexp_replace(r.raw_payload->>'form_type','/A$','')=t->>'form'
    and r.source_url ~ ('^https://www[.]sec[.]gov/Archives/edgar/data/[0-9]+/' || replace(t->>'accession','-','') || '/[^/]+$');
  if matched <> 1 then raise exception 'EFFECT_REGISTRATION_EVIDENCE_UNAVAILABLE'; end if;
  return new;
end $$;
create trigger validate_effect_monitor_target before insert or update of conditions on public.listing_monitors
for each row execute function public.validate_effect_monitor_target();

create function public.create_effect_monitor_alert(p_monitor_id uuid,p_event_id uuid,p_evidence jsonb)
returns table(alert_id uuid,created_new boolean)
language plpgsql security invoker set search_path = '' as $$
declare m public.listing_monitors; e public.events; r public.raw_items; t jsonb; s jsonb;
  v_key text; v_id uuid; v_xml xml; v_ref text; v_form text; v_date text; v_count integer;
begin
  -- Serialize target edits/pause with delivery; unique constraint serializes competing notices/replays.
  select * into m from public.listing_monitors where id=p_monitor_id for update;
  if m.id is null or not m.is_active then raise exception 'EFFECT_MONITOR_INACTIVE'; end if;
  t := public.effect_monitor_target(m.conditions);
  if t is null then raise exception 'EFFECT_TARGET_MISSING'; end if;
  v_key := (t->>'cik') || ':' || (t->>'fileNumber');
  if p_evidence->>'kind' is distinct from 'effect_registration_v1' or p_evidence->>'registrationKey' is distinct from v_key
    or p_evidence->>'registrationAccession' is distinct from t->>'accession'
    or p_evidence->>'registrationForm' is distinct from t->>'form'
    or p_evidence->>'cik' is distinct from t->>'cik'
    or p_evidence->>'fileNumber' is distinct from t->>'fileNumber' then raise exception 'EFFECT_TARGET_CONFLICT'; end if;
  select * into e from public.events where id=p_event_id;
  -- Recheck registration evidence at notification time, including edits after creation.
  if not exists(select 1 from public.raw_items x where x.source_code='sec_edgar'
    and x.source_unique_id=t->>'accession' and x.raw_payload->>'accession_number'=t->>'accession'
    and lpad(x.raw_payload->>'cik',10,'0')=t->>'cik' and x.raw_payload->>'file_number'=t->>'fileNumber'
    and regexp_replace(x.raw_payload->>'form_type','/A$','')=t->>'form'
    and x.source_url ~ ('^https://www[.]sec[.]gov/Archives/edgar/data/[0-9]+/' || replace(t->>'accession','-','') || '/[^/]+$'))
  then raise exception 'EFFECT_REGISTRATION_EVIDENCE_UNAVAILABLE'; end if;
  select * into r from public.raw_items where id=e.raw_item_id for share;
  if e.source_code is distinct from 'sec_edgar' or r.source_code is distinct from 'sec_edgar' or r.raw_payload->>'form_type' is distinct from 'EFFECT'
    or r.raw_payload->>'accession_number' is distinct from r.source_unique_id
    or r.source_unique_id is distinct from p_evidence->>'effectAccession'
    or e.metadata->>'accession_number' is distinct from r.source_unique_id then raise exception 'EFFECT_EVENT_CONFLICT'; end if;
  select count(*), (jsonb_agg(d->'effectOriginalSource'))->0 into v_count,s
    from jsonb_array_elements(r.raw_payload->'documents') d
    where d->'effectOriginalSource'->>'version'='effect_source_v1';
  if v_count <> 1 or s->>'sha256' is distinct from p_evidence->>'sourceHash'
    or s->>'xml' is null or length(s->>'xml') > 100000 or s->>'xml' ~* '<!(DOCTYPE|ENTITY)'
    or encode(extensions.digest(s->>'xml','sha256'),'hex') is distinct from s->>'sha256'
    or s->>'url' is distinct from p_evidence->>'sourceUrl' then raise exception 'EFFECT_SOURCE_CHANGED'; end if;
  v_xml := xmlparse(document s->>'xml');
  if cardinality(xpath('/edgarSubmission/effectiveData',v_xml)) <> 1
    or cardinality(xpath('/edgarSubmission/submissionType',v_xml)) <> 1
    or cardinality(xpath('/edgarSubmission/testOrLive',v_xml)) <> 1
    or cardinality(xpath('/edgarSubmission/effectiveData/finalEffectivenessDispDate',v_xml)) <> 1
    or cardinality(xpath('/edgarSubmission/effectiveData/form',v_xml)) > 1
    or cardinality(xpath('/edgarSubmission/effectiveData/submissionType',v_xml)) > 1
    or cardinality(xpath('/edgarSubmission/effectiveData/accessionNumber',v_xml)) > 1
    or cardinality(xpath('//seriesClassContractData',v_xml)) > 0
  then raise exception 'EFFECT_SOURCE_AMBIGUOUS'; end if;
  v_form := coalesce(nullif((xpath('/edgarSubmission/effectiveData/form/text()',v_xml))[1]::text,''),
    (xpath('/edgarSubmission/effectiveData/submissionType/text()',v_xml))[1]::text);
  v_ref := (xpath('/edgarSubmission/effectiveData/accessionNumber/text()',v_xml))[1]::text;
  v_date := (xpath('/edgarSubmission/effectiveData/finalEffectivenessDispDate/text()',v_xml))[1]::text;
  if coalesce(v_date,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(v_date::date,'YYYY-MM-DD') <> v_date
    or (cardinality(xpath('/edgarSubmission/effectiveData/form',v_xml))=1
      and cardinality(xpath('/edgarSubmission/effectiveData/submissionType',v_xml))=1
      and (xpath('/edgarSubmission/effectiveData/submissionType/text()',v_xml))[1]::text is distinct from v_form)
    or exists(select 1 from xmltable('/edgarSubmission/effectiveData/filer' passing v_xml
      columns issuer text path 'cik', file_no text path 'fileNumber') f
      where coalesce(f.issuer,'') !~ '^[0-9]{1,10}$' or coalesce(f.file_no,'') !~ '^333-[0-9]+(-[0-9]+)?$')
    or not exists(select 1 from xmltable('/edgarSubmission/effectiveData/filer' passing v_xml
      columns issuer text path 'cik') f where lpad(f.issuer,10,'0')=lpad(r.raw_payload->>'cik',10,'0'))
    or s->>'url' !~ ('^https://www[.]sec[.]gov/Archives/edgar/data/[0-9]+/' || replace(r.source_unique_id,'-','') || '/[^/]+$')
  then raise exception 'EFFECT_SOURCE_AMBIGUOUS'; end if;
  if (xpath('/edgarSubmission/submissionType/text()',v_xml))[1]::text is distinct from 'EFFECT'
    or (xpath('/edgarSubmission/testOrLive/text()',v_xml))[1]::text is distinct from 'LIVE'
    or v_date is distinct from p_evidence->>'effectiveDate'
    or not exists(select 1 from xmltable('/edgarSubmission/effectiveData/filer' passing v_xml
       columns issuer text path 'cik', file_no text path 'fileNumber') f
       where lpad(f.issuer,10,'0')=t->>'cik' and f.file_no=t->>'fileNumber')
    or (regexp_replace(v_form,'/A$','') is distinct from t->>'form' and v_form is distinct from 'POS AM')
  then raise exception 'EFFECT_SOURCE_TARGET_CONFLICT'; end if;
  if v_form='POS AM' and v_ref is null then raise exception 'EFFECT_REFERENCE_REQUIRED'; end if;
  if v_ref is not null and not exists(select 1 from public.raw_items x
    where x.source_code='sec_edgar' and x.source_unique_id=v_ref
    and x.raw_payload->>'accession_number'=v_ref
    and lpad(x.raw_payload->>'cik',10,'0')=t->>'cik' and x.raw_payload->>'file_number'=t->>'fileNumber'
    and x.source_url ~ ('^https://www[.]sec[.]gov/Archives/edgar/data/[0-9]+/' || replace(v_ref,'-','') || '/[^/]+$')
    and (regexp_replace(x.raw_payload->>'form_type','/A$','')=t->>'form' or x.raw_payload->>'form_type'='POS AM'))
  then raise exception 'EFFECT_REFERENCE_UNRESOLVED'; end if;
  insert into public.user_alert_deliveries(user_id,alert_event_id,title,category,source_type,source_label,
    alert_lane,delivered_channels,delivery_status,delivered_at,listing_monitor_id,alert_domain,listing_source_execution_id,
    effect_registration_key,effect_match_evidence)
  values(m.user_id,e.id,'Registration EFFECT confirmed','listing_risk','other','SEC EFFECT Monitor',
    'listing_monitor',array[]::text[],'queued',now(),m.id,'listing',r.id,v_key,p_evidence)
  on conflict(listing_monitor_id,effect_registration_key) do nothing returning id into v_id;
  if v_id is not null then return query select v_id,true; return; end if;
  return query select a.id,false from public.user_alert_deliveries a where a.listing_monitor_id=m.id and a.effect_registration_key=v_key;
end $$;
revoke all on function public.create_effect_monitor_alert(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_effect_monitor_alert(uuid,uuid,jsonb) to service_role;
revoke all on function public.effect_monitor_target(jsonb),public.validate_effect_monitor_target() from public,anon;
grant execute on function public.effect_monitor_target(jsonb),public.validate_effect_monitor_target() to authenticated,service_role;
commit;
