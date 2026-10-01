-- Reuse the exact SEC cover-row proof for current, officially validated Listing Risk facts.
-- The existing writer independently checks currentness/lineage and source hashes.
create or replace function public.sec_listing_cover_binding_valid(p_observation jsonb,p_identity jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare
  c jsonb:=p_observation#>'{attachment,coverRow}'; s jsonb:=p_observation->'scope';
  r public.sec_cover_observation_results%rowtype; o jsonb; x jsonb; matches integer:=0;
  title_pattern text:=',\s*(par value\s+\$[\d.]+|\$[\d.]+\s+par value)(\s+per share)?$';
begin
  if p_observation->>'form' !~ '^(8-K|6-K)(/A)?$' or (jsonb_typeof(p_observation->'sourceEvent') is distinct from 'object' and (
      p_observation#>>'{listingRisk,status}' is distinct from 'available'
      or p_observation#>>'{listingRisk,facts,affected_security,title,value}' is distinct from s->>'securityTitle'
      or p_observation#>>'{listingRisk,facts,exchange,value}' is distinct from s->>'exchange'))
    or jsonb_typeof(c) is distinct from 'object' then return false; end if;
  select * into r from public.sec_cover_observation_results where id=(c->>'resultId')::uuid;
  if r.id is null or r.raw_item_id is distinct from (p_observation->>'rawItemId')::uuid
    or r.issuer_cik is distinct from s->>'issuerCik' or r.source_sha256 is distinct from c->>'sourceHash'
    or r.source_sha256 is distinct from encode(extensions.digest(convert_to(p_observation#>>'{sourceSnapshot,raw_payload,primary_document_html}','UTF8'),'sha256'),'hex')
    or r.source_state<>'available' then return false; end if;
  for x in select value from jsonb_array_elements(r.result_payload->'observations') loop
    if lower(regexp_replace(btrim(s->>'securityTitle'),'\s+',' ','g')) in (
      lower(regexp_replace(btrim(x#>>'{securityTitle,parsedTextValue}'),'\s+',' ','g')),
      regexp_replace(lower(regexp_replace(btrim(x#>>'{securityTitle,parsedTextValue}'),'\s+',' ','g')),title_pattern,''))
      and lower(regexp_replace(btrim(s->>'exchange'),'\s+',' ','g')) in (
      lower(regexp_replace(btrim(x#>>'{exchange,parsedTextValue}'),'\s+',' ','g')),
      regexp_replace(lower(regexp_replace(btrim(x#>>'{exchange,parsedTextValue}'),'\s+',' ','g')),'\s+llc$','')) then
      matches:=matches+1; o:=x;
    end if;
  end loop;
  if matches<>1 or o->>'observationKey' is distinct from c->>'observationKey'
    or o#>>'{securityTitle,parsedTextValue}' is distinct from c->>'securityTitle'
    or o#>>'{tradingSymbol,parsedTextValue}' is distinct from c->>'ticker'
    or o#>>'{exchange,parsedTextValue}' is distinct from c->>'exchange'
    or coalesce(o#>>'{securityTitle,status}','') not in ('observed','duplicate_equal')
    or coalesce(o#>>'{tradingSymbol,status}','') not in ('observed','duplicate_equal')
    or coalesce(o#>>'{exchange,status}','') not in ('observed','duplicate_equal')
    or o#>>'{securityTitle,parsedTextValue}' ~* '\m(rights?|warrants?|units?)\M'
    or lower(btrim(c->>'ticker')) in ('none','n/a','')
    or lower(regexp_replace(btrim(c->>'securityTitle'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(p_identity->>'after_security_title'),'\s+',' ','g'))
    or lower(regexp_replace(btrim(c->>'exchange'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(p_identity#>>'{identity_payload,after,exchange}'),'\s+',' ','g'))
    or c->>'ticker' is distinct from p_identity#>>'{identity_payload,after,tradingSymbol}'
    or exists(select 1 from jsonb_array_elements(r.result_payload->'observations') sibling
      where sibling->>'observationKey' is distinct from o->>'observationKey' and (
        coalesce(sibling#>>'{securityTitle,parsedTextValue}','')='' or coalesce(sibling#>>'{tradingSymbol,parsedTextValue}','')=''
        or coalesce(sibling#>>'{exchange,parsedTextValue}','')=''
        or lower(btrim(sibling#>>'{tradingSymbol,parsedTextValue}'))=lower(btrim(c->>'ticker'))))
  then return false; end if;
  return true;
end $fn$;
revoke all on function public.sec_listing_cover_binding_valid(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sec_listing_cover_binding_valid(jsonb,jsonb) to service_role;
