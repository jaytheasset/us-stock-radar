create index if not exists events_news_feed_effective_published_idx
on public.events ((coalesce(published_at, detected_at)) desc, id desc)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_signal_published_idx
on public.events (signal, (coalesce(published_at, detected_at)) desc, id desc)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_type_published_idx
on public.events (event_type, (coalesce(published_at, detected_at)) desc, id desc)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_source_published_idx
on public.events (source_code, (coalesce(published_at, detected_at)) desc, id desc)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create or replace function public.search_news_v2(
  p_query text default null,
  p_signals text[] default '{}'::text[],
  p_market_caps text[] default '{}'::text[],
  p_event_types text[] default '{}'::text[],
  p_sources text[] default '{}'::text[],
  p_sectors text[] default '{}'::text[],
  p_themes text[] default '{}'::text[],
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null,
  p_include_total boolean default true,
  p_limit integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with normalized as (
  select
    e.id,
    e.source_code,
    case lower(coalesce(e.source_code, ''))
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
      when 'nasdaq_corporate_actions' then 'Nasdaq Corporate Actions'
      when 'nasdaq_trader' then 'Nasdaq Trader'
      when 'polygon' then 'Polygon'
      else coalesce(nullif(e.source_name, ''), nullif(e.source_code, ''), 'Unknown')
    end as source_label,
    coalesce(e.published_at, e.detected_at) as effective_published_at,
    nullif(upper(btrim(e.ticker)), '') as ticker,
    coalesce(nullif(lower(btrim(e.event_type)), ''), 'event') as event_type,
    coalesce(e.score, 50) as score,
    coalesce(nullif(lower(btrim(e.signal::text)), ''), 'neutral') as signal,
    coalesce(nullif(lower(btrim(e.market_scope::text)), ''), 'company') as market_scope,
    nullif(btrim(e.sector), '') as sector,
    nullif(btrim(e.theme_group), '') as theme_group,
    nullif(btrim(e.sub_theme), '') as sub_theme,
    coalesce(
      nullif(e.metadata ->> 'company_name', ''),
      nullif(e.metadata ->> 'company', ''),
      nullif(e.metadata ->> 'issuer', ''),
      ''
    ) as company_name,
    coalesce(nullif(e.title, ''), 'Untitled event') as title,
    coalesce(nullif(e.quick_take, ''), nullif(e.summary, ''), 'No summary available yet.') as summary,
    e.delivery_level,
    t.market_cap,
    case
      when t.market_cap >= 200000000000 then 'Mega'
      when t.market_cap >= 10000000000 then 'Large'
      when t.market_cap >= 2000000000 then 'Mid'
      when t.market_cap >= 300000000 then 'Small'
      when t.market_cap > 0 then 'Micro'
      else null
    end as market_cap_band
  from public.events e
  left join public.tickers t
    on t.symbol = nullif(upper(btrim(e.ticker)), '')
  where e.source_group = 'news'
    and e.delivery_level <> 'archive'
    and coalesce(e.published_at, e.detected_at) is not null
),
filtered as (
  select n.*
  from normalized n
  where (
      coalesce(array_length(p_signals, 1), 0) = 0
      or n.signal = any(p_signals)
    )
    and (
      coalesce(array_length(p_market_caps, 1), 0) = 0
      or n.market_cap_band = any(p_market_caps)
    )
    and (
      coalesce(array_length(p_event_types, 1), 0) = 0
      or n.event_type = any(p_event_types)
    )
    and (
      coalesce(array_length(p_sources, 1), 0) = 0
      or n.source_label = any(p_sources)
    )
    and (
      coalesce(array_length(p_sectors, 1), 0) = 0
      or n.sector = any(p_sectors)
    )
    and (
      coalesce(array_length(p_themes, 1), 0) = 0
      or n.theme_group = any(p_themes)
      or n.sub_theme = any(p_themes)
    )
    and (
      nullif(btrim(p_query), '') is null
      or concat_ws(
        ' ',
        n.ticker,
        n.company_name,
        n.source_label,
        n.event_type,
        replace(n.event_type, '_', ' '),
        n.sector,
        n.theme_group,
        n.sub_theme,
        n.title,
        n.summary
      ) ilike '%' || btrim(p_query) || '%'
    )
),
paged as (
  select f.*
  from filtered f
  where p_cursor_published_at is null
    or p_cursor_id is null
    or (f.effective_published_at, f.id) < (p_cursor_published_at, p_cursor_id)
  order by f.effective_published_at desc, f.id desc
  limit least(greatest(p_limit, 1), 25) + 1
),
visible_page as (
  select p.*
  from paged p
  order by p.effective_published_at desc, p.id desc
  limit least(greatest(p_limit, 1), 25)
)
select jsonb_build_object(
  'items',
  coalesce(
    (
      select jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', v.id,
            'published_at', v.effective_published_at,
            'headline', v.title,
            'summary', v.summary,
            'source', v.source_label,
            'ticker', v.ticker,
            'signal', v.signal,
            'score', v.score,
            'market_scope', v.market_scope,
            'sector', v.sector,
            'theme_group', v.theme_group,
            'sub_theme', v.sub_theme,
            'event_type', v.event_type,
            'market_cap', v.market_cap,
            'market_cap_band', v.market_cap_band,
            'delivery_level', v.delivery_level
          )
        )
        order by v.effective_published_at desc, v.id desc
      )
      from visible_page v
    ),
    '[]'::jsonb
  ),
  'total',
  case when p_include_total then (select count(*) from filtered) else null end,
  'has_more',
  (select count(*) from paged) > least(greatest(p_limit, 1), 25),
  'next_cursor',
  (
    select jsonb_build_object('published_at', v.effective_published_at, 'id', v.id)
    from visible_page v
    order by v.effective_published_at asc, v.id asc
    limit 1
  )
);
$$;

create or replace function public.get_news_v2_facets()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with normalized as (
  select
    case lower(coalesce(e.source_code, ''))
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
      when 'nasdaq_corporate_actions' then 'Nasdaq Corporate Actions'
      when 'nasdaq_trader' then 'Nasdaq Trader'
      when 'polygon' then 'Polygon'
      else coalesce(nullif(e.source_name, ''), nullif(e.source_code, ''), 'Unknown')
    end as source_label,
    coalesce(e.published_at, e.detected_at) as effective_published_at,
    coalesce(nullif(lower(btrim(e.event_type)), ''), 'event') as event_type,
    nullif(btrim(e.sector), '') as sector,
    nullif(btrim(e.theme_group), '') as theme_group,
    nullif(btrim(e.sub_theme), '') as sub_theme,
    coalesce(e.score, 50) as score
  from public.events e
  where e.source_group = 'news'
    and e.delivery_level <> 'archive'
    and coalesce(e.published_at, e.detected_at) is not null
),
anchor as (
  select max(effective_published_at) as latest_at
  from normalized
),
source_groups as (
  select
    n.source_label,
    count(*) as total_count,
    round(avg(n.score))::integer as average_score,
    count(*) filter (where n.effective_published_at >= a.latest_at - interval '1 day') as today_count,
    count(*) filter (where n.effective_published_at >= a.latest_at - interval '5 days') as five_day_count,
    count(*) filter (where n.effective_published_at >= a.latest_at - interval '30 days') as one_month_count,
    count(*) filter (where n.effective_published_at >= a.latest_at - interval '90 days') as three_month_count
  from normalized n
  cross join anchor a
  group by n.source_label
)
select jsonb_build_object(
  'event_types',
  coalesce(
    (
      select jsonb_agg(options.event_type order by options.event_type)
      from (select distinct event_type from normalized) options
    ),
    '[]'::jsonb
  ),
  'sources',
  coalesce(
    (
      select jsonb_agg(options.source_label order by options.source_label)
      from (select distinct source_label from normalized) options
    ),
    '[]'::jsonb
  ),
  'sectors',
  coalesce(
    (
      select jsonb_agg(options.sector order by options.sector)
      from (select distinct sector from normalized where sector is not null) options
    ),
    '[]'::jsonb
  ),
  'themes',
  coalesce(
    (
      select jsonb_agg(options.theme order by options.theme)
      from (
        select distinct theme_group as theme from normalized where theme_group is not null
        union
        select distinct sub_theme as theme from normalized where sub_theme is not null
      ) options
    ),
    '[]'::jsonb
  ),
  'source_activity',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'source', source_label,
          'count', total_count,
          'average_score', average_score,
          'range_counts', jsonb_build_object(
            'Today', today_count,
            '5D', five_day_count,
            '1M', one_month_count,
            '3M', three_month_count
          )
        )
        order by total_count desc, average_score desc, source_label
      )
      from source_groups
    ),
    '[]'::jsonb
  )
);
$$;

revoke all on function public.search_news_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[],
  timestamptz,
  uuid,
  boolean,
  integer
) from public, anon, authenticated;

grant execute on function public.search_news_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[],
  timestamptz,
  uuid,
  boolean,
  integer
) to service_role;

revoke all on function public.get_news_v2_facets()
from public, anon, authenticated;

grant execute on function public.get_news_v2_facets()
to service_role;
