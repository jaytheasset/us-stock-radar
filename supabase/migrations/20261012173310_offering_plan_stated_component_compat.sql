-- New opt-in meaning; keep the applied legacy validator and stored records unchanged.
-- Both contracts reuse the same immutable evidence column, ownership, lane and unique key.
begin;
create function public.valid_offering_plan_stated_component_evidence(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare c jsonb; r jsonb; q jsonb; keys text[]; seen text[] := '{}';
begin
 if jsonb_typeof(v) is distinct from 'object' then return false; end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(v) k;
 if keys is distinct from array['accession','candidateIndex','component','conditions','contractVersion','decisionId','eventId','filedAt','meaning','outputHash','rawId','runId','sourceFingerprint','version'] then return false; end if;
 if not coalesce(v->>'version'='offering_plan_match_v1' and v->>'meaning'='stated_plan_component_not_execution'
  and v->>'accession' ~ '^\d{10}-\d{2}-\d{6}$' and v->>'filedAt' ~ '^\d{4}-\d{2}-\d{2}$'
  and jsonb_typeof(v->'contractVersion')='string' and length(v->>'contractVersion') between 1 and 100
  and jsonb_typeof(v->'sourceFingerprint')='string' and jsonb_typeof(v->'outputHash')='string' and v->>'sourceFingerprint' ~ '^[a-f0-9]{64}$' and v->>'outputHash' ~ '^[a-f0-9]{64}$',false) then return false;end if;
 for r in select value from jsonb_each(v) where key in ('runId','rawId','eventId') loop
  if jsonb_typeof(r) is distinct from 'string' or not coalesce(r #>> '{}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) then return false;end if;
 end loop;
 if v->'decisionId'='null'::jsonb then
  if v->'candidateIndex' is distinct from 'null'::jsonb then return false;end if;
 elsif not coalesce(jsonb_typeof(v->'decisionId')='string' and v->>'decisionId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  and jsonb_typeof(v->'candidateIndex')='number' and v->>'candidateIndex' ~ '^\d+$',false) then return false;end if;
 c:=v->'component';if jsonb_typeof(c) is distinct from 'object' then return false;end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(c) k;
 if keys is distinct from array['id','label','quantity','references','scenario','security','seller','unit'] then return false;end if;
 if not coalesce(jsonb_typeof(c->'id')='string' and length(c->>'id') between 1 and 200
  and jsonb_typeof(c->'label')='string' and length(c->>'label') between 1 and 2000
  and jsonb_typeof(c->'quantity')='string' and length(c->>'quantity')<=80 and c->>'quantity' ~ '^(0|[1-9]\d*)(\.\d+)?$'
  and jsonb_typeof(c->'unit')='string' and length(btrim(c->>'unit')) between 1 and 100
  and c->>'seller' in ('issuer','selling_shareholders') and c->>'security' in ('common_stock','ordinary_shares','ads')
  and (c->'scenario'='null'::jsonb or (jsonb_typeof(c->'scenario')='string' and length(c->>'scenario') between 1 and 2000)),false) then return false;end if;
 if jsonb_typeof(c->'references') is distinct from 'array' or jsonb_array_length(c->'references') not between 1 and 100 then return false;end if;
 for r in select value from jsonb_array_elements(c->'references') loop
  if jsonb_typeof(r) is distinct from 'object' then return false;end if;
  select array_agg(k order by k) into keys from jsonb_object_keys(r) k;
  if keys is distinct from array['blockId','lineEnd','lineStart','sha256','url'] then return false;end if;
  if not coalesce(jsonb_typeof(r->'blockId')='string' and length(r->>'blockId') between 1 and 200
   and jsonb_typeof(r->'sha256')='string' and r->>'sha256' ~ '^[a-f0-9]{64}$' and r->>'url' ~ '^https://www\.sec\.gov/Archives/edgar/data/[^[:space:]]+$'
   and jsonb_typeof(r->'lineStart')='number' and r->>'lineStart' ~ '^[1-9]\d*$'
   and jsonb_typeof(r->'lineEnd')='number' and r->>'lineEnd' ~ '^[1-9]\d*$'
   and (r->>'lineEnd')::numeric >= (r->>'lineStart')::numeric,false) then return false;end if;
 end loop;
 if jsonb_typeof(v->'conditions') is distinct from 'array' or jsonb_array_length(v->'conditions')<>4 then return false;end if;
 for q in select value from jsonb_array_elements(v->'conditions') loop
  if jsonb_typeof(q) is distinct from 'object' then return false;end if;
  select array_agg(k order by k) into keys from jsonb_object_keys(q) k;
  if keys is distinct from array['key','operator','value'] or jsonb_typeof(q->'value') is distinct from 'string' then return false;end if;
  if q->>'key'=any(seen) then return false;end if;seen:=array_append(seen,q->>'key');
  case q->>'key'
  when 'offering_plan.stated_component_quantity' then
   if not coalesce(q->>'operator'='gte' and length(q->>'value')<=80 and q->>'value' ~ '^(0|[1-9]\d*)(\.\d+)?$'
    and (c->>'quantity')::numeric >= (q->>'value')::numeric,false) then return false;end if;
  when 'offering_plan.seller_type' then if not coalesce(q->>'operator'='eq' and q->>'value'=c->>'seller',false) then return false;end if;
  when 'offering_plan.security_type' then if not coalesce(q->>'operator'='eq' and q->>'value'=c->>'security',false) then return false;end if;
  when 'offering_plan.quantity_unit' then if not coalesce(q->>'operator'='eq' and q->>'value'=c->>'unit',false) then return false;end if;
  else return false;
  end case;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.valid_offering_plan_stated_component_evidence(jsonb) from public,anon,authenticated;
grant execute on function public.valid_offering_plan_stated_component_evidence(jsonb) to service_role;

alter table public.user_alert_deliveries drop constraint offering_plan_match_shape;
alter table public.user_alert_deliveries add constraint offering_plan_match_shape check (
 offering_plan_match_evidence is null or coalesce(
 (public.valid_offering_plan_match_evidence(offering_plan_match_evidence)
  or public.valid_offering_plan_stated_component_evidence(offering_plan_match_evidence))
 and listing_source_execution_id::text=offering_plan_match_evidence->>'runId'
 and alert_event_id::text=offering_plan_match_evidence->>'eventId'
 and alert_domain='listing' and alert_lane='listing_monitor' and category='dilution_risk'
 and listing_match_evidence is null and effect_match_evidence is null and effect_registration_key is null
 and projected_fact_id is null and projected_monitor_id is null and projected_alert_key is null and projected_scenario is null
 and offering_monitor_id is null and offering_registry_snapshot_id is null and offering_registry_accession is null
 and financial_monitor_id is null and financial_source_execution_id is null and financial_accession is null and financial_issuer_cik is null
 and sc13_monitor_id is null and sc13_match_evidence is null
 and sc13_position_key is null and sc13_root_accession is null and sc13_head_accession is null and sc13_reporter_cik is null and sc13_security_class is null and sc13_cusips is null and ticker_match is null and calendar_event_id is null
 and delivery_status='queued' and delivered_channels=ARRAY[]::text[] and scheduled_for is null and sent_at is null and attempted_at is null,false));

notify pgrst,'reload schema';
commit;
