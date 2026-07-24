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
    coalesce(nullif(lower(btrim(e.signal::text)), ''), 'neutral') as signal,
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
),
recent_themes as (
  select n.*
  from normalized n
  cross join anchor a
  where n.theme_group is not null
    and n.effective_published_at >= a.latest_at - interval '30 days'
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
);
$$;

revoke all on function public.get_news_v2_facets()
from public, anon, authenticated;

grant execute on function public.get_news_v2_facets()
to service_role;
