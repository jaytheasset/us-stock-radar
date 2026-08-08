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
        coalesce(
          nullif(e.metadata -> 'market_context' ->> 'market_cap', ''),
          nullif(e.metadata -> 'analysis_output' -> 'market_context' ->> 'market_cap', ''),
          nullif(e.metadata -> 'display_payload' -> 'data' -> 'market_context' ->> 'market_cap', '')
        ),
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
      or ('Mega' = any(p_market_caps) and n.market_cap >= 50000000000)
      or ('Large' = any(p_market_caps) and n.market_cap >= 10000000000 and n.market_cap < 50000000000)
      or ('Mid' = any(p_market_caps) and n.market_cap >= 1000000000 and n.market_cap < 10000000000)
      or ('Small' = any(p_market_caps) and n.market_cap >= 50000000 and n.market_cap < 1000000000)
      or ('Micro' = any(p_market_caps) and n.market_cap > 0 and n.market_cap < 50000000)
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
