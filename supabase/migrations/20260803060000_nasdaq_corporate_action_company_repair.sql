create or replace function public.news_v2_source_label(
  p_source_code text,
  p_source_name text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(coalesce(p_source_code, ''))
    when 'accesswire' then 'Accesswire'
    when 'sec_edgar' then 'SEC'
    when 'globe' then 'GlobeNewswire'
    when 'globenewswire' then 'GlobeNewswire'
    when 'businesswire' then 'Business Wire'
    when 'prnewswire' then 'PR Newswire'
    when 'newsfile' then 'Newsfile'
    when 'ofac' then 'OFAC'
    when 'doj' then 'DOJ'
    when 'dea' then 'DEA'
    when 'whitehouse' then 'White House'
    when 'white-house' then 'White House'
    when 'fmp' then 'FMP'
    when 'nasdaq_corporate_actions' then 'Nasdaq Trader'
    when 'nasdaq_trader' then 'Nasdaq Trader'
    when 'polygon' then 'Polygon'
    else coalesce(nullif(p_source_name, ''), nullif(p_source_code, ''), 'Unknown')
  end;
$$;

reindex index public.events_news_feed_source_label_published_idx;

with repair_candidates as (
  select
    e.id,
    btrim(r.raw_payload #>> '{corporate_action,company_name}') as company_name
  from public.events e
  join public.raw_items r on r.id = e.raw_item_id
  where e.source_group = 'news'
    and e.source_code = 'nasdaq_corporate_actions'
    and r.source_code = 'nasdaq_corporate_actions'
    and jsonb_typeof(r.raw_payload -> 'corporate_action') = 'object'
    and nullif(btrim(r.raw_payload #>> '{corporate_action,company_name}'), '') is not null
    and nullif(btrim(e.metadata ->> 'issuer'), '') is not null
    and lower(btrim(e.metadata ->> 'issuer')) <> lower(btrim(r.raw_payload #>> '{corporate_action,company_name}'))
    and (
      lower(btrim(e.metadata ->> 'issuer')) = lower(btrim(r.raw_payload ->> 'source_name'))
      or lower(btrim(e.metadata ->> 'issuer')) = lower(btrim(r.raw_payload ->> 'provider'))
      or lower(btrim(e.metadata ->> 'issuer')) = lower(btrim(e.source_name))
    )
)
update public.events e
set metadata = jsonb_set(
  jsonb_set(coalesce(e.metadata, '{}'::jsonb), '{issuer}', to_jsonb(c.company_name), true),
  '{company_name}',
  to_jsonb(c.company_name),
  true
)
from repair_candidates c
where e.id = c.id;
