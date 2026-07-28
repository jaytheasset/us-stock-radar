-- Operational notes:
-- - The GIN index briefly takes the normal CREATE INDEX write lock while this
--   migration runs. At the current ~10k-row scale this is intentionally kept in
--   the migration transaction; schedule the migration before the app deploy.
-- - The read functions remain SECURITY INVOKER and are callable only by
--   service_role.
-- - Rollback: deploy the previous app, restore search_news_v2 and
--   get_news_v2_facets from migrations 20260724173656/20260724175356, then drop
--   the five *_news_feed_* indexes below and the two helper functions. No event
--   data or ingestion schema is rewritten by this migration.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.news_v2_source_label(
  p_source_code text,
  p_source_name text
)
returns text
language sql
immutable
parallel safe
security invoker
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
    when 'nasdaq_corporate_actions' then 'Nasdaq Corporate Actions'
    when 'nasdaq_trader' then 'Nasdaq Trader'
    when 'polygon' then 'Polygon'
    else coalesce(nullif(p_source_name, ''), nullif(p_source_code, ''), 'Unknown')
  end;
$$;

create or replace function public.news_v2_search_document(
  p_ticker text,
  p_company_name text,
  p_company text,
  p_issuer text,
  p_source_code text,
  p_source_name text,
  p_event_type text,
  p_sector text,
  p_theme_group text,
  p_sub_theme text,
  p_title text,
  p_summary text,
  p_quick_take text
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select lower(
    coalesce(p_ticker, '') || ' ' ||
    coalesce(p_company_name, '') || ' ' ||
    coalesce(p_company, '') || ' ' ||
    coalesce(p_issuer, '') || ' ' ||
    public.news_v2_source_label(p_source_code, p_source_name) || ' ' ||
    replace(coalesce(p_source_code, ''), '_', ' ') || ' ' ||
    coalesce(p_event_type, '') || ' ' ||
    replace(coalesce(p_event_type, ''), '_', ' ') || ' ' ||
    coalesce(p_sector, '') || ' ' ||
    coalesce(p_theme_group, '') || ' ' ||
    coalesce(p_sub_theme, '') || ' ' ||
    coalesce(p_title, '') || ' ' ||
    coalesce(p_summary, '') || ' ' ||
    coalesce(p_quick_take, '')
  );
$$;

create index if not exists events_news_feed_search_trgm_idx
on public.events using gin (
  public.news_v2_search_document(
    ticker,
    metadata ->> 'company_name',
    metadata ->> 'company',
    metadata ->> 'issuer',
    source_code,
    source_name,
    event_type,
    sector,
    theme_group,
    sub_theme,
    title,
    summary,
    quick_take
  ) extensions.gin_trgm_ops
)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_source_label_published_idx
on public.events (
  public.news_v2_source_label(source_code, source_name),
  (coalesce(published_at, detected_at)) desc,
  id desc
)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_sector_published_idx
on public.events (
  (nullif(btrim(sector), '')),
  (coalesce(published_at, detected_at)) desc,
  id desc
)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_theme_published_idx
on public.events (
  (nullif(btrim(theme_group), '')),
  (coalesce(published_at, detected_at)) desc,
  id desc
)
where source_group = 'news'
  and delivery_level <> 'archive'
  and coalesce(published_at, detected_at) is not null;

create index if not exists events_news_feed_sub_theme_published_idx
on public.events (
  (nullif(btrim(sub_theme), '')),
  (coalesce(published_at, detected_at)) desc,
  id desc
)
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
with bounds as (
  select
    current_timestamp as as_of,
    date_trunc(
      'day',
      current_timestamp at time zone 'America/New_York'
    ) at time zone 'America/New_York' as today_start
),
normalized as not materialized (
  select
    e.id,
    e.source_code,
    public.news_v2_source_label(e.source_code, e.source_name) as source_label,
    coalesce(e.published_at, e.detected_at) as effective_published_at,
    nullif(upper(btrim(e.ticker)), '') as ticker,
    coalesce(nullif(lower(btrim(e.event_type)), ''), 'event') as event_type,
    coalesce(e.score, 50) as score,
    coalesce(nullif(lower(btrim(e.signal::text)), ''), 'neutral') as signal,
    coalesce(nullif(lower(btrim(e.market_scope::text)), ''), 'company') as market_scope,
    nullif(btrim(e.sector), '') as sector,
    nullif(btrim(e.theme_group), '') as theme_group,
    nullif(btrim(e.sub_theme), '') as sub_theme,
    coalesce(nullif(e.title, ''), 'Untitled event') as title,
    coalesce(nullif(e.quick_take, ''), nullif(e.summary, ''), 'No summary available yet.') as summary,
    public.news_v2_search_document(
      e.ticker,
      e.metadata ->> 'company_name',
      e.metadata ->> 'company',
      e.metadata ->> 'issuer',
      e.source_code,
      e.source_name,
      e.event_type,
      e.sector,
      e.theme_group,
      e.sub_theme,
      e.title,
      e.summary,
      e.quick_take
    ) as search_document,
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
stats_filtered as materialized (
  select n.*
  from normalized n
  where p_include_total
    and (
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
      or n.search_document like '%' || lower(btrim(p_query)) || '%'
    )
),
paged as (
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
      or n.search_document like '%' || lower(btrim(p_query)) || '%'
    )
    and (
      p_cursor_published_at is null
      or p_cursor_id is null
      or (n.effective_published_at, n.id) < (p_cursor_published_at, p_cursor_id)
    )
  order by n.effective_published_at desc, n.id desc
  limit least(greatest(p_limit, 1), 25) + 1
),
visible_page as (
  select p.*
  from paged p
  order by p.effective_published_at desc, p.id desc
  limit least(greatest(p_limit, 1), 25)
),
source_groups as (
  select
    f.source_label,
    count(*) as total_count,
    round(avg(f.score))::integer as average_score,
    count(*) filter (
      where f.effective_published_at >= b.today_start
        and f.effective_published_at <= b.as_of
    ) as today_count,
    count(*) filter (
      where f.effective_published_at >= b.as_of - interval '5 days'
        and f.effective_published_at <= b.as_of
    ) as five_day_count,
    count(*) filter (
      where f.effective_published_at >= b.as_of - interval '1 month'
        and f.effective_published_at <= b.as_of
    ) as one_month_count,
    count(*) filter (
      where f.effective_published_at >= b.as_of - interval '3 months'
        and f.effective_published_at <= b.as_of
    ) as three_month_count
  from stats_filtered f
  cross join bounds b
  group by f.source_label
),
recent_themes as (
  select f.*
  from stats_filtered f
  cross join bounds b
  where f.theme_group is not null
    and f.effective_published_at >= b.as_of - interval '1 month'
    and f.effective_published_at <= b.as_of
),
theme_groups as (
  select
    theme_group,
    count(*) as event_count,
    round(avg(score))::integer as average_score,
    count(*) filter (where score >= 75) as high_impact_count,
    count(*) filter (where signal = 'bullish') as bullish_count,
    count(*) filter (where signal = 'bearish') as bearish_count,
    count(*) filter (where signal = 'neutral') as neutral_count,
    count(*) filter (where signal = 'volatile') as volatile_count
  from recent_themes
  group by theme_group
),
sub_theme_groups as (
  select
    theme_group,
    sub_theme,
    count(*) as event_count,
    round(avg(score))::integer as average_score,
    count(*) filter (where score >= 75) as high_impact_count,
    count(*) filter (where signal = 'bullish') as bullish_count,
    count(*) filter (where signal = 'bearish') as bearish_count,
    count(*) filter (where signal = 'neutral') as neutral_count,
    count(*) filter (where signal = 'volatile') as volatile_count
  from recent_themes
  where sub_theme is not null
  group by theme_group, sub_theme
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
  case when p_include_total then (select count(*) from stats_filtered) else null end,
  'has_more',
  (select count(*) from paged) > least(greatest(p_limit, 1), 25),
  'next_cursor',
  (
    select jsonb_build_object('published_at', v.effective_published_at, 'id', v.id)
    from visible_page v
    order by v.effective_published_at asc, v.id asc
    limit 1
  ),
  'statistics',
  case
    when not p_include_total then null
    else jsonb_build_object(
      'as_of', (select b.as_of from bounds b),
      'range_time_zone', 'America/New_York',
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
      ),
      'theme_activity',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'theme_group', groups.theme_group,
              'count', groups.event_count,
              'average_score', groups.average_score,
              'high_impact_count', groups.high_impact_count,
              'signal_counts', jsonb_build_object(
                'bullish', groups.bullish_count,
                'bearish', groups.bearish_count,
                'neutral', groups.neutral_count,
                'volatile', groups.volatile_count
              ),
              'sub_themes', coalesce(
                (
                  select jsonb_agg(
                    jsonb_build_object(
                      'sub_theme', sub_groups.sub_theme,
                      'count', sub_groups.event_count,
                      'average_score', sub_groups.average_score,
                      'high_impact_count', sub_groups.high_impact_count,
                      'signal_counts', jsonb_build_object(
                        'bullish', sub_groups.bullish_count,
                        'bearish', sub_groups.bearish_count,
                        'neutral', sub_groups.neutral_count,
                        'volatile', sub_groups.volatile_count
                      )
                    )
                    order by sub_groups.event_count desc, sub_groups.average_score desc, sub_groups.sub_theme
                  )
                  from sub_theme_groups sub_groups
                  where sub_groups.theme_group = groups.theme_group
                ),
                '[]'::jsonb
              )
            )
            order by groups.event_count desc, groups.average_score desc, groups.theme_group
          )
          from theme_groups groups
        ),
        '[]'::jsonb
      )
    )
  end
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
    public.news_v2_source_label(e.source_code, e.source_name) as source_label,
    coalesce(nullif(lower(btrim(e.event_type)), ''), 'event') as event_type,
    nullif(btrim(e.sector), '') as sector,
    nullif(btrim(e.theme_group), '') as theme_group,
    nullif(btrim(e.sub_theme), '') as sub_theme
  from public.events e
  where e.source_group = 'news'
    and e.delivery_level <> 'archive'
    and coalesce(e.published_at, e.detected_at) is not null
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
  'source_activity', '[]'::jsonb,
  'theme_activity', '[]'::jsonb
);
$$;

revoke all on function public.news_v2_source_label(text, text)
from public, anon, authenticated;
grant execute on function public.news_v2_source_label(text, text)
to service_role;

revoke all on function public.news_v2_search_document(
  text, text, text, text, text, text, text, text, text, text, text, text, text
)
from public, anon, authenticated;
grant execute on function public.news_v2_search_document(
  text, text, text, text, text, text, text, text, text, text, text, text, text
)
to service_role;

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

;
