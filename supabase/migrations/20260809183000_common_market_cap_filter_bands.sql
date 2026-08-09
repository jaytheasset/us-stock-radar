-- Unify user-facing market-cap filter bands across Filings and News.
-- This migration only updates read/filter functions; it does not rewrite stored events or ticker data.

drop function if exists public.search_filings_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  timestamp with time zone,
  timestamp with time zone,
  uuid,
  boolean,
  integer
);

create function public.search_filings_v2(
  p_query text default null,
  p_signals text[] default '{}'::text[],
  p_market_caps text[] default '{}'::text[],
  p_form_types text[] default '{}'::text[],
  p_effective_filing_forms text[] default '{}'::text[],
  p_include_effectiveness boolean default false,
  p_event_types text[] default '{}'::text[],
  p_impacts text[] default '{}'::text[],
  p_published_after timestamp with time zone default null,
  p_cursor_published_at timestamp with time zone default null,
  p_cursor_id uuid default null,
  p_include_total boolean default true,
  p_limit integer default 25
) returns jsonb
language sql
stable
set search_path to ''
as $_$
with normalized as (
  select
    e.*,
    coalesce(nullif(e.metadata ->> 'form_type', ''), 'SEC filing') as form_type,
    nullif(
      e.metadata -> 'display_payload' -> 'data' ->> 'effective_filing_form',
      ''
    ) as effective_filing_form,
    coalesce(
      nullif(e.metadata ->> 'issuer', ''),
      nullif(e.metadata ->> 'company_name', ''),
      nullif(e.metadata ->> 'company', ''),
      e.ticker,
      'Issuer not available'
    ) as issuer,
    coalesce(
      nullif(e.metadata ->> 'accession_number', ''),
      nullif(e.metadata ->> 'accession', ''),
      ''
    ) as accession_number,
    case
      when cap.normalized_value ~ '^[0-9]+(\.[0-9]+)?[KMBT]?$' then
        (regexp_match(cap.normalized_value, '^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$'))[1]::numeric
        * case (regexp_match(cap.normalized_value, '^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$'))[2]
            when 'T' then 1000000000000
            when 'B' then 1000000000
            when 'M' then 1000000
            when 'K' then 1000
            else 1
          end
      else null
    end as market_cap,
    array(
      select distinct mapped.event_tag
      from (
        select case lower(raw.event_type)
          when 'earnings' then 'earnings'
          when 'insider' then 'insider'
          when 'insider_ownership' then 'insider'
          when 'offering' then 'offering'
          when 'securities_offering' then 'offering'
          when 'dilution' then 'dilution'
          when 'dilution_risk' then 'dilution'
          when 'ipo_listing' then 'listing'
          when 'listing' then 'listing'
          when 'listing_risk' then 'listing'
          when 'financial_risk' then 'legal'
          when 'legal' then 'legal'
          when 'legal_risk' then 'legal'
          when 'ma' then 'ma'
          when 'strategic_transaction' then 'ma'
          when 'governance' then 'governance'
          when 'leadership_governance' then 'governance'
          when 'shareholder_vote' then 'governance'
          when 'fda' then 'fda'
          when 'fda_clinical' then 'fda'
          when 'operating_update' then 'operating'
          when 'capital_return' then 'capital_return'
          when 'dividends' then 'capital_return'
          else null
        end as event_tag
        from (
          select e.event_type
          union all
          select coalesce(
            material_event ->> 'event_type',
            material_event ->> 'type',
            material_event ->> 'category'
          )
          from jsonb_array_elements(
            case
              when jsonb_typeof(e.metadata -> 'material_events') = 'array'
                then e.metadata -> 'material_events'
              else '[]'::jsonb
            end
          ) as material_event
        ) as raw
      ) as mapped
      where mapped.event_tag is not null
    ) as event_tags
  from public.events e
  cross join lateral (
    select upper(
      regexp_replace(
        case
          when jsonb_typeof(e.metadata -> 'resolved_market_cap') = 'object'
            then nullif(e.metadata -> 'resolved_market_cap' ->> 'value', '')
          else coalesce(
            nullif(e.metadata -> 'market_context' ->> 'market_cap', ''),
            nullif(e.metadata -> 'analysis_output' -> 'market_context' ->> 'market_cap', ''),
            nullif(e.metadata -> 'display_payload' -> 'data' -> 'market_context' ->> 'market_cap', '')
          )
        end,
        '[$,\s]',
        '',
        'g'
      )
    ) as normalized_value
  ) as cap
  where e.source_group = 'filings'
    and e.delivery_level <> 'archive'
    and e.published_at is not null
),
filtered as (
  select n.*
  from normalized n
  where (
      coalesce(array_length(p_signals, 1), 0) = 0
      or n.signal::text = any(p_signals)
    )
    and (
      (
        coalesce(array_length(p_form_types, 1), 0) = 0
        and coalesce(array_length(p_effective_filing_forms, 1), 0) = 0
        and not p_include_effectiveness
      )
      or upper(regexp_replace(btrim(n.form_type), '\s+', ' ', 'g')) = any(p_form_types)
      or (
        upper(regexp_replace(btrim(n.form_type), '\s+', ' ', 'g')) = 'EFFECT'
        and (
          p_include_effectiveness
          or upper(regexp_replace(btrim(n.effective_filing_form), '\s+', ' ', 'g'))
            = any(p_effective_filing_forms)
        )
      )
    )
    and (
      coalesce(array_length(p_event_types, 1), 0) = 0
      or n.event_tags && p_event_types
    )
    and (
      coalesce(array_length(p_impacts, 1), 0) = 0
      or ('Alerts 75+' = any(p_impacts) and n.score >= 75)
      or ('50-74' = any(p_impacts) and n.score between 50 and 74)
    )
    and (
      coalesce(array_length(p_market_caps, 1), 0) = 0
      or ('Mega' = any(p_market_caps) and n.market_cap >= 200000000000)
      or ('Large' = any(p_market_caps) and n.market_cap >= 10000000000 and n.market_cap < 200000000000)
      or ('Mid' = any(p_market_caps) and n.market_cap >= 2000000000 and n.market_cap < 10000000000)
      or ('Small' = any(p_market_caps) and n.market_cap >= 100000000 and n.market_cap < 2000000000)
      or ('Micro' = any(p_market_caps) and n.market_cap >= 0 and n.market_cap < 100000000)
    )
    and (p_published_after is null or n.published_at >= p_published_after)
    and (
      nullif(btrim(p_query), '') is null
      or concat_ws(
        ' ',
        n.ticker,
        n.issuer,
        n.form_type,
        n.title,
        n.quick_take,
        n.summary,
        n.accession_number,
        array_to_string(n.event_tags, ' ')
      ) ilike '%' || btrim(p_query) || '%'
    )
),
paged as (
  select f.*
  from filtered f
  where p_cursor_published_at is null
    or p_cursor_id is null
    or (f.published_at, f.id) < (p_cursor_published_at, p_cursor_id)
  order by f.published_at desc, f.id desc
  limit least(greatest(p_limit, 1), 25) + 1
),
visible_page as (
  select p.*
  from paged p
  order by p.published_at desc, p.id desc
  limit least(greatest(p_limit, 1), 25)
)
select jsonb_build_object(
  'records',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'source_code', v.source_code,
          'source_name', v.source_name,
          'source_url', v.source_url,
          'published_at', v.published_at,
          'detected_at', v.detected_at,
          'ticker', v.ticker,
          'event_type', v.event_type,
          'event_tags', v.event_tags,
          'score', v.score,
          'signal', v.signal,
          'title', v.title,
          'quick_take', v.quick_take,
          'summary', v.summary,
          'form_type', v.form_type,
          'effective_filing_form', v.effective_filing_form,
          'issuer', v.issuer,
          'accession_number', v.accession_number,
          'market_cap', v.market_cap,
          'price', coalesce(
            v.metadata -> 'market_context' -> 'price',
            v.metadata -> 'analysis_output' -> 'market_context' -> 'price',
            v.metadata -> 'display_payload' -> 'data' -> 'market_context' -> 'price'
          ),
          'change_percent', coalesce(
            v.metadata -> 'market_context' -> 'change_percent',
            v.metadata -> 'analysis_output' -> 'market_context' -> 'change_percent',
            v.metadata -> 'display_payload' -> 'data' -> 'market_context' -> 'change_percent'
          ),
          'metadata', jsonb_strip_nulls(
            jsonb_build_object(
              'key_evidence', v.metadata -> 'key_evidence',
              'key_points', v.metadata -> 'key_points',
              'analysis_output', jsonb_strip_nulls(
                jsonb_build_object(
                  'key_evidence', v.metadata -> 'analysis_output' -> 'key_evidence',
                  'key_points', v.metadata -> 'analysis_output' -> 'key_points'
                )
              ),
              'display_payload', jsonb_build_object(
                'data', jsonb_strip_nulls(
                  jsonb_build_object(
                    'key_evidence', v.metadata -> 'display_payload' -> 'data' -> 'key_evidence',
                    'key_points', v.metadata -> 'display_payload' -> 'data' -> 'key_points',
                    'key_changes', v.metadata -> 'display_payload' -> 'data' -> 'key_changes'
                  )
                )
              ),
              'material_events', v.metadata -> 'material_events',
              'related_filing_contexts', v.metadata -> 'related_filing_contexts',
              'related_filings', v.metadata -> 'related_filings',
              'related_events', v.metadata -> 'related_events'
            )
          )
        )
        order by v.published_at desc, v.id desc
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
    select jsonb_build_object('published_at', v.published_at, 'id', v.id)
    from visible_page v
    order by v.published_at asc, v.id asc
    limit 1
  )
);
$_$;

alter function public.search_filings_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  boolean,
  text[],
  text[],
  timestamp with time zone,
  timestamp with time zone,
  uuid,
  boolean,
  integer
) owner to postgres;

revoke all on function public.search_filings_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  boolean,
  text[],
  text[],
  timestamp with time zone,
  timestamp with time zone,
  uuid,
  boolean,
  integer
) from public;

grant all on function public.search_filings_v2(
  text,
  text[],
  text[],
  text[],
  text[],
  boolean,
  text[],
  text[],
  timestamp with time zone,
  timestamp with time zone,
  uuid,
  boolean,
  integer
) to service_role;

CREATE OR REPLACE FUNCTION "public"."search_news_v2"("p_query" "text" DEFAULT NULL::"text", "p_signals" "text"[] DEFAULT '{}'::"text"[], "p_market_caps" "text"[] DEFAULT '{}'::"text"[], "p_event_types" "text"[] DEFAULT '{}'::"text"[], "p_sources" "text"[] DEFAULT '{}'::"text"[], "p_sectors" "text"[] DEFAULT '{}'::"text"[], "p_themes" "text"[] DEFAULT '{}'::"text"[], "p_cursor_published_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_id" "uuid" DEFAULT NULL::"uuid", "p_include_total" boolean DEFAULT true, "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
      when t.market_cap >= 100000000 then 'Small'
      when t.market_cap >= 0 then 'Micro'
      else null
    end as market_cap_band
  from public.events e
  left join public.tickers t
    on t.symbol = nullif(upper(btrim(e.ticker)), '')
  where e.source_group = 'news'
    and e.delivery_level <> 'archive'
    and (
      coalesce(
        nullif(lower(btrim(e.market_scope::text)), ''),
        'company'
      ) not in ('sector', 'theme', 'macro')
      or coalesce(e.score, 50) >= 75
    )
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


ALTER FUNCTION "public"."search_news_v2"("p_query" "text", "p_signals" "text"[], "p_market_caps" "text"[], "p_event_types" "text"[], "p_sources" "text"[], "p_sectors" "text"[], "p_themes" "text"[], "p_cursor_published_at" timestamp with time zone, "p_cursor_id" "uuid", "p_include_total" boolean, "p_limit" integer) OWNER TO "postgres";
