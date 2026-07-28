begin;

alter table public.live_room_community_rooms
  add column if not exists themes text[] not null default array[]::text[],
  add column if not exists industries text[] not null default array[]::text[];

create or replace function public.live_room_community_themes_valid(
  p_values text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 0 and 3
    and pg_catalog.array_position(p_values, null) is null
    and p_values <@ array[
      'ai_data_center',
      'crypto_digital_assets',
      'healthcare_momentum',
      'power_energy_resources',
      'defense_geopolitics',
      'rates_credit_banks',
      'retail_momentum_flows',
      'policy_regulation',
      'ai_infrastructure',
      'ai_data_centers',
      'ai_chips_hbm',
      'ai_software_agents',
      'cloud_capex',
      'data_center_power_demand',
      'bitcoin',
      'stablecoins',
      'tokenization',
      'crypto_regulation',
      'crypto_mining',
      'glp1_obesity_drugs',
      'oncology_breakthroughs',
      'gene_editing',
      'rare_disease_drugs',
      'medical_ai_diagnostics',
      'nuclear_uranium',
      'lng_energy_security',
      'oil_supply_refining_margins',
      'grid_bottlenecks',
      'critical_minerals_copper',
      'gold_precious_metals',
      'defense_spending',
      'drones_autonomous_warfare',
      'space_satellites',
      'sanctions_export_controls',
      'china_risk',
      'tariffs_trade_war',
      'middle_east_risk',
      'interest_rates',
      'federal_reserve',
      'inflation',
      'regional_bank_stress',
      'credit_tightening',
      'commercial_real_estate_stress',
      'meme_stocks',
      'short_squeeze',
      'retail_trading',
      'high_short_interest',
      'small_cap_risk_on',
      'quantum_computing',
      'antitrust_big_tech_scrutiny',
      'deregulation_beneficiaries',
      'government_contracts',
      'cannabis_legalization',
      'fda_policy_risk'
    ]::text[]
    and (
      select pg_catalog.count(distinct theme)
      from pg_catalog.unnest(p_values) as theme
    ) = pg_catalog.cardinality(p_values)
$$;

create or replace function public.live_room_community_industries_valid(
  p_values text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_values is not null
    and pg_catalog.cardinality(p_values) between 0 and 3
    and pg_catalog.array_position(p_values, null) is null
    and p_values <@ array[
      'semiconductors_compute',
      'software_cloud',
      'cybersecurity',
      'it_services',
      'hardware_electronics',
      'internet_platforms',
      'media_entertainment',
      'gaming',
      'telecom_connectivity',
      'advertising_information_services',
      'autos_mobility',
      'retail_ecommerce',
      'restaurants',
      'travel_leisure',
      'home_lifestyle',
      'apparel_luxury',
      'food_beverage',
      'household_personal_care',
      'grocery_discount_retail',
      'agriculture_staples',
      'tobacco_cannabis_alternatives',
      'biotechnology',
      'pharmaceuticals',
      'medical_devices_diagnostics',
      'healthcare_services',
      'health_insurance_managed_care',
      'banks',
      'capital_markets_exchanges',
      'insurance',
      'asset_wealth_management',
      'payments_lending',
      'fintech_digital_assets',
      'diversified_finance',
      'aerospace_defense',
      'machinery_equipment',
      'transportation_logistics',
      'construction_infrastructure',
      'industrial_services_manufacturing',
      'environmental_waste',
      'business_services',
      'conglomerates',
      'oil_gas_refining',
      'midstream_lng',
      'energy_services_equipment',
      'renewable_energy',
      'nuclear_uranium',
      'coal',
      'electric_utilities',
      'power_generation_grid',
      'water_multi_utilities',
      'gas_utilities',
      'metals_mining',
      'precious_metals',
      'chemicals',
      'agricultural_inputs',
      'packaging_materials',
      'reits',
      'residential_real_estate',
      'commercial_real_estate',
      'industrial_logistics_real_estate',
      'real_estate_services',
      'shell_spac_undefined',
      'etf_funds_government_cef',
      'education'
    ]::text[]
    and (
      select pg_catalog.count(distinct industry)
      from pg_catalog.unnest(p_values) as industry
    ) = pg_catalog.cardinality(p_values)
$$;

revoke all privileges
on function public.live_room_community_themes_valid(text[])
from public, anon, authenticated;

revoke all privileges
on function public.live_room_community_industries_valid(text[])
from public, anon, authenticated;

grant execute
on function public.live_room_community_themes_valid(text[])
to service_role;

grant execute
on function public.live_room_community_industries_valid(text[])
to service_role;

alter table public.live_room_community_rooms
  add constraint live_room_community_rooms_themes_check
    check (public.live_room_community_themes_valid(themes)) not valid,
  add constraint live_room_community_rooms_industries_check
    check (public.live_room_community_industries_valid(industries)) not valid;

create index live_room_community_rooms_themes_gin_idx
  on public.live_room_community_rooms using gin (themes);

create index live_room_community_rooms_industries_gin_idx
  on public.live_room_community_rooms using gin (industries);

drop function public.create_live_room_community_room(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  text[]
);

drop function public.list_live_room_community_rooms(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  integer
);

create function public.create_live_room_community_room(
  p_owner_user_id uuid,
  p_slug text,
  p_name text,
  p_summary text,
  p_topic text,
  p_room_style text,
  p_focus_tags text[],
  p_language text,
  p_related_tickers text[],
  p_themes text[],
  p_industries text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_room_id uuid;
  v_slug text := pg_catalog.lower(pg_catalog.btrim(p_slug));
  v_name text := pg_catalog.btrim(p_name);
  v_summary text := pg_catalog.btrim(p_summary);
  v_related_tickers text[] :=
    coalesce(p_related_tickers, array[]::text[]);
  v_themes text[] := coalesce(p_themes, array[]::text[]);
  v_industries text[] := coalesce(p_industries, array[]::text[]);
begin
  if p_owner_user_id is null
    or not exists (
      select 1
      from public.user_profiles as profile
      where profile.id = p_owner_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_MEMBER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'community-room-owner:' || p_owner_user_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.live_room_community_rooms as room
    where room.owner_user_id = p_owner_user_id
      and room.created_at >= v_now - interval '5 minutes'
  )
  or (
    select pg_catalog.count(*)
    from public.live_room_community_rooms as room
    where room.owner_user_id = p_owner_user_id
      and room.created_at >= v_now - interval '24 hours'
  ) >= 5
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_CREATE_RATE_LIMIT';
  end if;

  if pg_catalog.char_length(v_slug) not between 8 and 64
    or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SLUG';
  end if;

  if exists (
    select 1
    from public.live_room_community_rooms as room
    where room.slug = v_slug
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_SLUG_TAKEN';
  end if;

  if pg_catalog.char_length(v_name) not between 4 and 60
    or v_name ~ '[[:cntrl:]]'
    or v_name ~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_NAME';
  end if;

  if pg_catalog.char_length(v_summary) not between 12 and 160
    or v_summary ~ '[[:cntrl:]]'
    or v_summary ~* '(<[^>]*>|(https?|ftp)://|mailto:|javascript:|data:[[:alnum:].+-]+/|www[.]|discord[.]gg|t[.]me/|wa[.]me/|([[:alnum:]-]+[.])+[[:alpha:]]{2,63}(:[0-9]+)?(/|[[:space:]]|$))'
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SUMMARY';
  end if;

  if p_topic not in (
    'market_macro',
    'sector_industry',
    'events_catalysts',
    'trading_strategy',
    'learning_qna',
    'creator_community'
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_TOPIC';
  end if;

  if p_room_style not in (
    'live_reaction',
    'deep_research',
    'beginner_friendly',
    'open_discussion'
  )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_STYLE';
  end if;

  if p_language not in ('en', 'ko', 'ja') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_LANGUAGE';
  end if;

  if not public.live_room_community_focus_tags_valid(p_focus_tags) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_FOCUS_TAGS';
  end if;

  if not public.live_room_community_tickers_valid(v_related_tickers) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_RELATED_TICKERS';
  end if;

  if not public.live_room_community_themes_valid(v_themes) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_THEMES';
  end if;

  if not public.live_room_community_industries_valid(v_industries) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_INDUSTRIES';
  end if;

  if pg_catalog.cardinality(v_related_tickers) = 0
    and pg_catalog.cardinality(v_themes) = 0
    and pg_catalog.cardinality(v_industries) = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_DISCOVERY_ANCHOR_REQUIRED';
  end if;

  insert into public.live_room_rooms (ticker, issuer_id, room_kind)
  values (null, null, 'community')
  returning id into v_room_id;

  insert into public.live_room_community_rooms (
    room_id,
    slug,
    owner_user_id,
    name,
    summary,
    topic,
    room_style,
    focus_tags,
    language,
    related_tickers,
    themes,
    industries,
    last_activity_at,
    created_at,
    updated_at
  )
  values (
    v_room_id,
    v_slug,
    p_owner_user_id,
    v_name,
    v_summary,
    p_topic,
    p_room_style,
    p_focus_tags,
    p_language,
    v_related_tickers,
    v_themes,
    v_industries,
    v_now,
    v_now,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'slug', v_slug,
    'name', v_name,
    'summary', v_summary,
    'topic', p_topic,
    'roomStyle', p_room_style,
    'focusTags', p_focus_tags,
    'language', p_language,
    'relatedTickers', v_related_tickers,
    'themes', v_themes,
    'industries', v_industries,
    'lastActivityAt', v_now,
    'createdAt', v_now
  );
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_SLUG_TAKEN';
end
$$;

create or replace function public.get_live_room_community_room(
  p_slug text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'slug', room.slug,
    'name', room.name,
    'summary', room.summary,
    'topic', room.topic,
    'roomStyle', room.room_style,
    'focusTags', room.focus_tags,
    'language', room.language,
    'relatedTickers', room.related_tickers,
    'themes', room.themes,
    'industries', room.industries,
    'lastActivityAt', room.last_activity_at,
    'createdAt', room.created_at
  )
  from public.live_room_community_rooms as room
  where room.slug = pg_catalog.lower(pg_catalog.btrim(p_slug))
$$;

create function public.list_live_room_community_rooms(
  p_topic text default null,
  p_room_style text default null,
  p_focus_tag text default null,
  p_language text default null,
  p_theme text default null,
  p_industry text default null,
  p_search text default null,
  p_sort text default 'activity',
  p_after_at timestamptz default null,
  p_after_slug text default null,
  p_limit integer default 20
)
returns table (
  slug text,
  name text,
  summary text,
  topic text,
  room_style text,
  focus_tags text[],
  language text,
  related_tickers text[],
  themes text[],
  industries text[],
  last_activity_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_search text := nullif(pg_catalog.btrim(p_search), '');
begin
  if p_topic is not null
    and p_topic not in (
      'market_macro',
      'sector_industry',
      'events_catalysts',
      'trading_strategy',
      'learning_qna',
      'creator_community'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_TOPIC';
  end if;

  if p_room_style is not null
    and p_room_style not in (
      'live_reaction',
      'deep_research',
      'beginner_friendly',
      'open_discussion'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_STYLE';
  end if;

  if p_focus_tag is not null
    and p_focus_tag not in (
      'company_news',
      'sec_filings',
      'earnings',
      'fda_clinical',
      'dilution_listing',
      'legal_financial_risk',
      'macro_policy',
      'mna_strategy',
      'product_leadership'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_FOCUS_TAGS';
  end if;

  if p_language is not null
    and p_language not in ('en', 'ko', 'ja')
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_LANGUAGE';
  end if;

  if p_theme is not null
    and not public.live_room_community_themes_valid(
      array[p_theme]::text[]
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_THEMES';
  end if;

  if p_industry is not null
    and not public.live_room_community_industries_valid(
      array[p_industry]::text[]
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_INDUSTRIES';
  end if;

  if p_sort not in ('activity', 'newest') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SORT';
  end if;

  if v_search is not null
    and pg_catalog.char_length(v_search) > 80
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_SEARCH';
  end if;

  if (p_after_at is null) <> (p_after_slug is null) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_INVALID_CURSOR';
  end if;

  if p_sort = 'newest' then
    return query
    select
      room.slug,
      room.name,
      room.summary,
      room.topic,
      room.room_style,
      room.focus_tags,
      room.language,
      room.related_tickers,
      room.themes,
      room.industries,
      room.last_activity_at,
      room.created_at
    from public.live_room_community_rooms as room
    where (p_topic is null or room.topic = p_topic)
      and (p_room_style is null or room.room_style = p_room_style)
      and (
        p_focus_tag is null
        or room.focus_tags @> array[p_focus_tag]::text[]
      )
      and (p_language is null or room.language = p_language)
      and (
        p_theme is null
        or room.themes @> array[p_theme]::text[]
      )
      and (
        p_industry is null
        or room.industries @> array[p_industry]::text[]
      )
      and (
        v_search is null
        or room.search_document @@ pg_catalog.websearch_to_tsquery(
          'simple'::pg_catalog.regconfig,
          v_search
        )
      )
      and (
        p_after_at is null
        or (room.created_at, room.slug) < (p_after_at, p_after_slug)
      )
    order by room.created_at desc, room.slug desc
    limit v_limit + 1;
  else
    return query
    select
      room.slug,
      room.name,
      room.summary,
      room.topic,
      room.room_style,
      room.focus_tags,
      room.language,
      room.related_tickers,
      room.themes,
      room.industries,
      room.last_activity_at,
      room.created_at
    from public.live_room_community_rooms as room
    where (p_topic is null or room.topic = p_topic)
      and (p_room_style is null or room.room_style = p_room_style)
      and (
        p_focus_tag is null
        or room.focus_tags @> array[p_focus_tag]::text[]
      )
      and (p_language is null or room.language = p_language)
      and (
        p_theme is null
        or room.themes @> array[p_theme]::text[]
      )
      and (
        p_industry is null
        or room.industries @> array[p_industry]::text[]
      )
      and (
        v_search is null
        or room.search_document @@ pg_catalog.websearch_to_tsquery(
          'simple'::pg_catalog.regconfig,
          v_search
        )
      )
      and (
        p_after_at is null
        or (room.last_activity_at, room.slug) <
          (p_after_at, p_after_slug)
      )
    order by room.last_activity_at desc, room.slug desc
    limit v_limit + 1;
  end if;
end
$$;

revoke all privileges
on function public.create_live_room_community_room(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  text[],
  text[],
  text[]
)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_community_room(text)
from public, anon, authenticated;

revoke all privileges
on function public.list_live_room_community_rooms(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  integer
)
from public, anon, authenticated;

grant execute
on function public.create_live_room_community_room(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  text[],
  text[],
  text[]
)
to service_role;

grant execute
on function public.get_live_room_community_room(text)
to service_role;

grant execute
on function public.list_live_room_community_rooms(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  integer
)
to service_role;

comment on column public.live_room_community_rooms.themes is
  'Canonical market theme-group or specific subtheme slugs, maximum three.';

comment on column public.live_room_community_rooms.industries is
  'Canonical sectorMappings subCategory slugs, maximum three.';

commit;
;
