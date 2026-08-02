begin;

-- Local-only Calendar QA fixtures. These rows are deterministic, carry no raw
-- provider payload, create no user follows/history/alert candidates, and are
-- applied after migrations by `supabase db reset --local`.
with fixture_events (
  canonical_identity_key,
  event_type,
  category,
  title,
  event_date,
  event_end_date,
  event_time,
  event_instant,
  time_status,
  market_session,
  lifecycle_status,
  schedule_confidence,
  impact_level,
  impact_scope
) as (
  values
    ('local-seed:company:aapl:earnings:2026q2', 'earnings', 'company', 'Apple Q2 2026 Earnings', date '2026-07-27', null::date, time '16:05', timestamptz '2026-07-27 20:05:00+00', 'exact', 'amc', 'released', 'confirmed', 'high', 'company'),
    ('local-seed:macro:cpi:2026-06', 'cpi', 'macro', 'Consumer Price Index — June 2026', date '2026-07-27', null::date, time '08:30', timestamptz '2026-07-27 12:30:00+00', 'exact', 'bmo', 'released', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:treasury-borrowing:2026q3', 'treasury-borrowing-estimate', 'policy', 'Treasury Quarterly Borrowing Estimate', date '2026-07-27', null::date, time '15:00', timestamptz '2026-07-27 19:00:00+00', 'exact', 'market-hours', 'released', 'confirmed', 'medium', 'market-wide'),

    ('local-seed:company:msft:dividend:2026q3', 'dividend', 'company', 'Microsoft Quarterly Dividend', date '2026-07-28', null::date, null::time, null::timestamptz, 'all-day', 'tna', 'released', 'confirmed', 'medium', 'company'),
    ('local-seed:macro:ppi:2026-06', 'ppi', 'macro', 'Producer Price Index — June 2026', date '2026-07-28', null::date, time '08:30', timestamptz '2026-07-28 12:30:00+00', 'exact', 'bmo', 'released', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:treasury-refunding:2026q3', 'treasury-refunding', 'policy', 'Treasury Quarterly Refunding Announcement', date '2026-07-28', null::date, time '09:00', timestamptz '2026-07-28 13:00:00+00', 'exact', 'market-hours', 'released', 'confirmed', 'medium', 'market-wide'),
    ('local-seed:policy:sec-open-meeting:2026q3-a', 'sec-open-meeting', 'policy', 'SEC Open Meeting on Market Structure', date '2026-07-28', null::date, time '10:00', timestamptz '2026-07-28 14:00:00+00', 'exact', 'market-hours', 'released', 'confirmed', 'medium', 'sector'),

    ('local-seed:company:nvda:split:2026', 'split', 'company', 'NVIDIA Forward Stock Split', date '2026-07-29', null::date, null::time, null::timestamptz, 'all-day', 'tna', 'released', 'confirmed', 'medium', 'company'),
    ('local-seed:macro:pce:2026-06', 'pce', 'macro', 'Personal Consumption Expenditures — June 2026', date '2026-07-29', null::date, time '08:30', timestamptz '2026-07-29 12:30:00+00', 'exact', 'bmo', 'released', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:fomc-minutes:2026-06', 'fomc-minutes', 'policy', 'FOMC Meeting Minutes', date '2026-07-29', null::date, time '14:00', timestamptz '2026-07-29 18:00:00+00', 'exact', 'market-hours', 'released', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:treasury-auction-10y:2026-07', 'treasury-auction-10y', 'policy', '10-Year Treasury Note Auction', date '2026-07-29', null::date, time '13:00', timestamptz '2026-07-29 17:00:00+00', 'exact', 'market-hours', 'released', 'confirmed', 'medium', 'market-wide'),

    ('local-seed:company:nova-space:ipo', 'ipo', 'company', 'Nova Space Technologies IPO', date '2026-07-30', null::date, null::time, null::timestamptz, 'time-not-announced', 'tna', 'scheduled', 'tentative', 'medium', 'company'),
    ('local-seed:macro:employment:2026-07', 'employment-situation', 'macro', 'Employment Situation — July 2026', date '2026-07-30', null::date, time '08:30', timestamptz '2026-07-30 12:30:00+00', 'exact', 'bmo', 'released', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:fed-testimony:2026-h2', 'fed-chair-testimony', 'policy', 'Fed Chair Semiannual Monetary Policy Testimony', date '2026-07-30', null::date, time '10:00', timestamptz '2026-07-30 14:00:00+00', 'exact', 'market-hours', 'released', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:sec-rule:market-data:effective', 'sec-rule-milestone', 'policy', 'SEC Market Data Rule Effective Date', date '2026-07-30', null::date, null::time, null::timestamptz, 'all-day', 'tna', 'scheduled', 'confirmed', 'medium', 'sector'),
    ('local-seed:policy:fda-adcom:cardiovex', 'fda-advisory-committee', 'policy', 'FDA Cardiovascular Advisory Committee', date '2026-08-01', date '2026-08-01', time '09:00', timestamptz '2026-08-01 13:00:00+00', 'exact', 'market-hours', 'scheduled', 'confirmed', 'high', 'sector'),

    ('local-seed:macro:jolts:2026-06', 'jolts', 'macro', 'JOLTS Job Openings — June 2026', date '2026-07-31', null::date, time '10:00', timestamptz '2026-07-31 14:00:00+00', 'exact', 'market-hours', 'scheduled', 'confirmed', 'high', 'market-wide'),
    ('local-seed:macro:gdp:2026q2-advance', 'gdp-advance', 'macro', 'GDP Advance Estimate — Q2 2026', date '2026-07-31', null::date, time '08:30', timestamptz '2026-07-31 12:30:00+00', 'exact', 'bmo', 'scheduled', 'confirmed', 'high', 'market-wide'),
    ('local-seed:macro:retail-sales:2026-07', 'retail-sales', 'macro', 'Retail Sales — July 2026', date '2026-08-01', null::date, time '08:30', timestamptz '2026-08-01 12:30:00+00', 'exact', 'bmo', 'scheduled', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:fomc-decision:2026-07', 'fomc-decision', 'policy', 'FOMC Policy Decision', date '2026-07-31', null::date, time '14:00', timestamptz '2026-07-31 18:00:00+00', 'exact', 'market-hours', 'scheduled', 'confirmed', 'high', 'market-wide'),
    ('local-seed:policy:treasury-auction-30y:2026-07', 'treasury-auction-30y', 'policy', '30-Year Treasury Bond Auction', date '2026-07-31', null::date, time '13:00', timestamptz '2026-07-31 17:00:00+00', 'exact', 'market-hours', 'scheduled', 'confirmed', 'medium', 'market-wide'),
    ('local-seed:policy:trade-action:semiconductors:2026', 'trade-policy-action', 'policy', 'Semiconductor Export Control Effective Date', date '2026-08-02', null::date, null::time, null::timestamptz, 'all-day', 'tna', 'scheduled', 'tentative', 'high', 'sector')
)
insert into public.calendar_events (
  canonical_identity_key,
  event_type,
  category,
  title,
  event_date,
  event_end_date,
  event_time,
  event_timezone,
  event_instant,
  time_status,
  market_session,
  lifecycle_status,
  schedule_confidence,
  impact_level,
  impact_scope,
  current_revision,
  first_seen_at,
  last_seen_at,
  created_at,
  updated_at
)
select
  canonical_identity_key,
  event_type,
  category,
  title,
  event_date,
  event_end_date,
  event_time,
  'America/New_York',
  event_instant,
  time_status,
  market_session,
  lifecycle_status,
  schedule_confidence,
  impact_level,
  impact_scope,
  1,
  timestamptz '2026-07-20 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-20 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00'
from fixture_events
on conflict (canonical_identity_key) do update
set
  event_type = excluded.event_type,
  category = excluded.category,
  title = excluded.title,
  event_date = excluded.event_date,
  event_end_date = excluded.event_end_date,
  event_time = excluded.event_time,
  event_timezone = excluded.event_timezone,
  event_instant = excluded.event_instant,
  time_status = excluded.time_status,
  market_session = excluded.market_session,
  lifecycle_status = excluded.lifecycle_status,
  schedule_confidence = excluded.schedule_confidence,
  impact_level = excluded.impact_level,
  impact_scope = excluded.impact_scope,
  last_seen_at = excluded.last_seen_at,
  updated_at = excluded.updated_at;

insert into public.calendar_event_sources (
  event_id,
  provider,
  source_agency,
  source_name,
  source_url,
  source_event_key,
  source_modified_at,
  fetched_at,
  checksum,
  confidence,
  raw_payload_id,
  created_at,
  updated_at
)
select
  event.id,
  case
    when event.category = 'company' then 'fmp'
    when event.event_type in ('cpi', 'ppi', 'employment-situation', 'jolts') then 'bls'
    when event.event_type in ('pce', 'gdp-advance') then 'bea'
    when event.event_type = 'retail-sales' then 'census'
    when event.event_type in ('fomc-decision', 'fomc-minutes', 'fed-chair-testimony') then 'federal-reserve'
    when event.event_type like 'treasury-%' then 'us-treasury'
    when event.event_type like 'sec-%' then 'sec'
    when event.event_type = 'trade-policy-action' then 'federal-register'
    when event.event_type = 'fda-advisory-committee' then 'fda'
    else 'other'
  end,
  case
    when event.category = 'company' then 'Financial Modeling Prep'
    when event.event_type in ('cpi', 'ppi', 'employment-situation', 'jolts') then 'BLS'
    when event.event_type in ('pce', 'gdp-advance') then 'BEA'
    when event.event_type = 'retail-sales' then 'U.S. Census Bureau'
    when event.event_type in ('fomc-decision', 'fomc-minutes', 'fed-chair-testimony') then 'Federal Reserve'
    when event.event_type like 'treasury-%' then 'U.S. Treasury'
    when event.event_type like 'sec-%' then 'SEC'
    when event.event_type = 'trade-policy-action' then 'Federal Register'
    when event.event_type = 'fda-advisory-committee' then 'FDA'
    else 'Calendar'
  end,
  'Deterministic local QA fixture',
  null,
  event.canonical_identity_key,
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00',
  'sha256:local-calendar-seed-v1:' || event.event_type,
  'medium',
  null,
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00'
from public.calendar_events as event
where event.canonical_identity_key like 'local-seed:%'
on conflict (provider, source_event_key) where source_event_key is not null
do update set
  event_id = excluded.event_id,
  source_agency = excluded.source_agency,
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  source_modified_at = excluded.source_modified_at,
  fetched_at = excluded.fetched_at,
  checksum = excluded.checksum,
  confidence = excluded.confidence,
  raw_payload_id = null,
  updated_at = excluded.updated_at;

with fixture_details (canonical_identity_key, detail) as (
  values
    ('local-seed:company:aapl:earnings:2026q2', jsonb_build_object('companyName', 'Apple Inc.', 'fiscalQuarter', 'Q2 2026', 'epsEstimate', 1.42, 'revenueEstimate', 89500000000, 'actualEps', 1.51, 'actualRevenue', 91200000000, 'outcome', 'beat')),
    ('local-seed:company:msft:dividend:2026q3', jsonb_build_object('companyName', 'Microsoft Corporation', 'dividendPerShare', 0.83, 'exDividendDate', '2026-07-28', 'recordDate', '2026-07-29', 'paymentDate', '2026-08-20', 'frequency', 'quarterly', 'currency', 'USD')),
    ('local-seed:company:nvda:split:2026', jsonb_build_object('companyName', 'NVIDIA Corporation', 'ratio', '10:1', 'splitKind', 'forward', 'effectiveDate', '2026-07-29', 'relatedTicker', 'NVDA')),
    ('local-seed:company:nova-space:ipo', jsonb_build_object('companyName', 'Nova Space Technologies', 'exchange', 'NASDAQ', 'priceRangeLow', 18, 'priceRangeHigh', 21, 'offerPrice', null, 'raiseAmount', 315000000, 'ipoStage', 'range-announced')),

    ('local-seed:macro:cpi:2026-06', jsonb_build_object('referencePeriod', 'June 2026', 'releaseNote', 'Local fixture with headline and core metrics.')),
    ('local-seed:macro:ppi:2026-06', jsonb_build_object('referencePeriod', 'June 2026', 'releaseNote', 'Local fixture with headline and core metrics.')),
    ('local-seed:macro:pce:2026-06', jsonb_build_object('referencePeriod', 'June 2026', 'releaseNote', 'Local fixture with headline and core metrics.')),
    ('local-seed:macro:employment:2026-07', jsonb_build_object('referencePeriod', 'July 2026', 'releaseNote', 'Local fixture combines payrolls, unemployment, and wages.')),
    ('local-seed:macro:jolts:2026-06', jsonb_build_object('referencePeriod', 'June 2026', 'releaseNote', 'Pre-release local fixture.')),
    ('local-seed:macro:gdp:2026q2-advance', jsonb_build_object('referencePeriod', 'Q2 2026', 'releaseNote', 'Advance estimate local fixture.')),
    ('local-seed:macro:retail-sales:2026-07', jsonb_build_object('referencePeriod', 'July 2026', 'releaseNote', 'Pre-release local fixture.')),

    ('local-seed:policy:fomc-decision:2026-07', jsonb_build_object('decisionTime', '14:00', 'pressConferenceTime', '14:30', 'includesSep', false, 'targetRangeLower', 4.25, 'targetRangeUpper', 4.50)),
    ('local-seed:policy:fomc-minutes:2026-06', jsonb_build_object('meetingPeriod', 'June 2026 meeting', 'documentTitle', 'Minutes of the Federal Open Market Committee')),
    ('local-seed:policy:fed-testimony:2026-h2', jsonb_build_object('witness', 'Federal Reserve Chair', 'committee', 'Senate Banking Committee', 'topic', 'Semiannual Monetary Policy Report')),
    ('local-seed:policy:treasury-borrowing:2026q3', jsonb_build_object('kind', 'announcement', 'maturity', null, 'amountBillions', 590, 'result', 'Estimate released')),
    ('local-seed:policy:treasury-refunding:2026q3', jsonb_build_object('kind', 'announcement', 'maturity', null, 'amountBillions', 125, 'result', 'Refunding terms announced')),
    ('local-seed:policy:treasury-auction-10y:2026-07', jsonb_build_object('kind', 'auction', 'maturity', '10-year', 'amountBillions', 42, 'result', 'High yield 4.18%')),
    ('local-seed:policy:treasury-auction-30y:2026-07', jsonb_build_object('kind', 'auction', 'maturity', '30-year', 'amountBillions', 25, 'result', null)),
    ('local-seed:policy:sec-open-meeting:2026q3-a', jsonb_build_object('ruleOrMeetingTitle', 'Open Meeting on Equity Market Structure', 'agenda', jsonb_build_array('Market data infrastructure', 'Order competition'), 'milestone', 'meeting', 'documentOrDocket', 'SEC-LOCAL-QA-001')),
    ('local-seed:policy:sec-rule:market-data:effective', jsonb_build_object('ruleOrMeetingTitle', 'Market Data Infrastructure Rule', 'agenda', jsonb_build_array(), 'milestone', 'effective-date', 'documentOrDocket', 'SEC-LOCAL-QA-002')),
    ('local-seed:policy:trade-action:semiconductors:2026', jsonb_build_object('actionType', 'export-control', 'targetCountries', jsonb_build_array('Country group D:5'), 'affectedIndustries', jsonb_build_array('Semiconductors', 'Advanced computing'), 'tariffOrRestriction', 'Expanded advanced-chip export controls', 'actionDateKind', 'effective-date')),
    ('local-seed:policy:fda-adcom:cardiovex', jsonb_build_object('committee', 'Cardiovascular and Renal Drugs Advisory Committee', 'product', 'CardioVex', 'sponsor', 'Meridian Therapeutics', 'indication', 'Chronic heart failure', 'meetingStartDate', '2026-08-01', 'meetingEndDate', '2026-08-01'))
)
insert into public.calendar_event_details (event_id, detail, schema_version, created_at, updated_at)
select
  event.id,
  fixture.detail,
  1,
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00'
from fixture_details as fixture
join public.calendar_events as event
  on event.canonical_identity_key = fixture.canonical_identity_key
on conflict (event_id) do update
set
  detail = excluded.detail,
  schema_version = excluded.schema_version,
  updated_at = excluded.updated_at;

with fixture_securities (canonical_identity_key, ticker, role) as (
  values
    ('local-seed:company:aapl:earnings:2026q2', 'AAPL', 'primary'),
    ('local-seed:company:msft:dividend:2026q3', 'MSFT', 'primary'),
    ('local-seed:company:nvda:split:2026', 'NVDA', 'primary'),
    ('local-seed:policy:sec-open-meeting:2026q3-a', 'COIN', 'related'),
    ('local-seed:policy:trade-action:semiconductors:2026', 'NVDA', 'related'),
    ('local-seed:policy:fda-adcom:cardiovex', 'MRK', 'primary')
)
insert into public.calendar_event_securities (event_id, ticker, role, created_at)
select event.id, fixture.ticker, fixture.role, timestamptz '2026-07-30 12:00:00+00'
from fixture_securities as fixture
join public.calendar_events as event
  on event.canonical_identity_key = fixture.canonical_identity_key
on conflict (event_id, ticker) do update set role = excluded.role;

with fixture_sectors (canonical_identity_key, sector, role) as (
  values
    ('local-seed:policy:sec-open-meeting:2026q3-a', 'Financials', 'affected'),
    ('local-seed:policy:sec-rule:market-data:effective', 'Financials', 'affected'),
    ('local-seed:policy:trade-action:semiconductors:2026', 'Technology', 'affected'),
    ('local-seed:policy:fda-adcom:cardiovex', 'Health Care', 'affected')
)
insert into public.calendar_event_sectors (event_id, sector, role, created_at)
select event.id, fixture.sector, fixture.role, timestamptz '2026-07-30 12:00:00+00'
from fixture_sectors as fixture
join public.calendar_events as event
  on event.canonical_identity_key = fixture.canonical_identity_key
on conflict (event_id, sector) do update set role = excluded.role;

with fixture_metrics (
  canonical_identity_key,
  metric_key,
  name,
  actual,
  consensus,
  previous,
  unit,
  unit_raw,
  release_stage,
  released
) as (
  values
    ('local-seed:macro:cpi:2026-06', 'headline-cpi-yoy', 'Headline CPI', 2.7::numeric, 2.6::numeric, 2.5::numeric, 'percent', '% YoY', 'monthly', true),
    ('local-seed:macro:cpi:2026-06', 'core-cpi-yoy', 'Core CPI', 2.9::numeric, 2.9::numeric, 2.8::numeric, 'percent', '% YoY', 'monthly', true),
    ('local-seed:macro:ppi:2026-06', 'headline-ppi-mom', 'Headline PPI', 0.3::numeric, 0.2::numeric, 0.1::numeric, 'percent', '% MoM', 'monthly', true),
    ('local-seed:macro:ppi:2026-06', 'core-ppi-mom', 'Core PPI', 0.2::numeric, 0.2::numeric, 0.2::numeric, 'percent', '% MoM', 'monthly', true),
    ('local-seed:macro:pce:2026-06', 'headline-pce-yoy', 'Headline PCE', 2.5::numeric, 2.5::numeric, 2.4::numeric, 'percent', '% YoY', 'monthly', true),
    ('local-seed:macro:pce:2026-06', 'core-pce-yoy', 'Core PCE', 2.7::numeric, 2.6::numeric, 2.6::numeric, 'percent', '% YoY', 'monthly', true),
    ('local-seed:macro:employment:2026-07', 'nonfarm-payrolls', 'Nonfarm Payrolls', 215::numeric, 190::numeric, 185::numeric, 'thousands', 'K jobs', 'monthly', true),
    ('local-seed:macro:employment:2026-07', 'unemployment-rate', 'Unemployment Rate', 4.1::numeric, 4.2::numeric, 4.1::numeric, 'percent', '%', 'monthly', true),
    ('local-seed:macro:employment:2026-07', 'average-hourly-earnings', 'Average Hourly Earnings', 3.8::numeric, 3.7::numeric, 3.7::numeric, 'percent', '% YoY', 'monthly', true),
    ('local-seed:macro:jolts:2026-06', 'job-openings', 'Job Openings', null::numeric, 7600::numeric, 7700::numeric, 'thousands', 'K openings', 'monthly', false),
    ('local-seed:macro:gdp:2026q2-advance', 'real-gdp-annualized', 'Real GDP', null::numeric, 2.3::numeric, 2.0::numeric, 'percent', '% SAAR', 'advance', false),
    ('local-seed:macro:retail-sales:2026-07', 'headline-retail-sales-mom', 'Headline Retail Sales', null::numeric, 0.4::numeric, 0.2::numeric, 'percent', '% MoM', 'monthly', false)
)
insert into public.calendar_event_metrics (
  event_id,
  metric_key,
  name,
  actual,
  consensus,
  previous,
  actual_text,
  consensus_text,
  previous_text,
  unit,
  unit_raw,
  release_stage,
  released,
  created_at,
  updated_at
)
select
  event.id,
  fixture.metric_key,
  fixture.name,
  fixture.actual,
  fixture.consensus,
  fixture.previous,
  null,
  null,
  null,
  fixture.unit,
  fixture.unit_raw,
  fixture.release_stage,
  fixture.released,
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00'
from fixture_metrics as fixture
join public.calendar_events as event
  on event.canonical_identity_key = fixture.canonical_identity_key
on conflict (event_id, metric_key, release_stage) do update
set
  name = excluded.name,
  actual = excluded.actual,
  consensus = excluded.consensus,
  previous = excluded.previous,
  actual_text = excluded.actual_text,
  consensus_text = excluded.consensus_text,
  previous_text = excluded.previous_text,
  unit = excluded.unit,
  unit_raw = excluded.unit_raw,
  released = excluded.released,
  updated_at = excluded.updated_at;

insert into public.event_calendar_items (
  id,
  source_event_id,
  raw_item_id,
  source_code,
  source_group,
  ticker,
  company_name,
  calendar_event_type,
  calendar_group,
  calendar_title,
  event_date,
  event_time,
  event_timezone,
  date_precision,
  estimated_start_date,
  estimated_end_date,
  is_estimated,
  confidence,
  source_url,
  evidence,
  created_at,
  updated_at,
  metadata,
  calendar_event_key,
  calendar_status,
  confirmation_source,
  confirmed_at,
  confirmed_by_event_id,
  superseded_by_item_id
)
select
  pg_catalog.md5('legacy:' || event.canonical_identity_key)::uuid,
  null,
  null,
  null,
  'market'::public.source_group,
  security.ticker,
  details.detail->>'companyName',
  case
    when event.event_type = 'earnings' then 'earnings_release'
    when event.event_type = 'dividend' then 'ex_dividend_date'
    when event.event_type = 'ipo' then 'ipo_expected_date'
    else 'other_scheduled_event'
  end,
  case
    when event.event_type = 'earnings' then 'earnings'
    when event.event_type = 'dividend' then 'dividends'
    when event.event_type = 'split' then 'shareholder'
    when event.event_type = 'ipo' then 'ipo'
    when event.event_type = 'fda-advisory-committee' then 'fda_clinical'
    when event.category = 'policy' then 'legal_policy'
    else 'other'
  end,
  event.title,
  event.event_date,
  event.event_time,
  event.event_timezone,
  'exact',
  null,
  null,
  event.schedule_confidence = 'tentative',
  case when event.schedule_confidence = 'confirmed' then 'high' else 'medium' end,
  null,
  'Deterministic local Calendar QA fixture; not a live provider observation.',
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00',
  jsonb_build_object(
    'fixture', 'calendar_local_seed_v1',
    'normalized_event_id', event.id,
    'normalized_event_type', event.event_type,
    'category', event.category,
    'provider', source.provider
  ),
  'calendar-local-seed:' || event.canonical_identity_key,
  case
    when event.lifecycle_status = 'cancelled' then 'cancelled'
    when event.schedule_confidence = 'confirmed' then 'confirmed'
    else 'tentative'
  end,
  'local-seed',
  case when event.schedule_confidence = 'confirmed' then timestamptz '2026-07-20 12:00:00+00' else null end,
  null,
  null
from public.calendar_events as event
left join public.calendar_event_details as details
  on details.event_id = event.id
left join public.calendar_event_securities as security
  on security.event_id = event.id and security.role = 'primary'
left join public.calendar_event_sources as source
  on source.event_id = event.id
where event.canonical_identity_key like 'local-seed:%'
on conflict (id) do update
set
  source_code = excluded.source_code,
  source_group = excluded.source_group,
  ticker = excluded.ticker,
  company_name = excluded.company_name,
  calendar_event_type = excluded.calendar_event_type,
  calendar_group = excluded.calendar_group,
  calendar_title = excluded.calendar_title,
  event_date = excluded.event_date,
  event_time = excluded.event_time,
  event_timezone = excluded.event_timezone,
  date_precision = excluded.date_precision,
  is_estimated = excluded.is_estimated,
  confidence = excluded.confidence,
  source_url = excluded.source_url,
  evidence = excluded.evidence,
  updated_at = excluded.updated_at,
  metadata = excluded.metadata,
  calendar_event_key = excluded.calendar_event_key,
  calendar_status = excluded.calendar_status,
  confirmation_source = excluded.confirmation_source,
  confirmed_at = excluded.confirmed_at;

-- BEGIN News/Filings local QA fixtures (news_filings_local_qa_v1)
-- Synthetic local-only rows for deterministic UI and taxonomy QA. These rows
-- are not provider observations and intentionally have no raw payloads, URLs,
-- user state, alert history, or delivery attempts.
insert into public.sources as existing (
  code,
  name,
  source_group,
  runtime_owner,
  enabled,
  poll_interval_seconds,
  metadata
)
values
  (
    'local-news-qa',
    'Local QA News',
    'news'::public.source_group,
    'manual'::public.runtime_owner,
    false,
    null,
    jsonb_build_object(
      'local_only', true,
      'synthetic', true,
      'not_provider_observation', true,
      'fixture_set', 'news_filings_local_qa_v1'
    )
  ),
  (
    'local-filings-qa',
    'Local QA Filings',
    'filings'::public.source_group,
    'manual'::public.runtime_owner,
    false,
    null,
    jsonb_build_object(
      'local_only', true,
      'synthetic', true,
      'not_provider_observation', true,
      'fixture_set', 'news_filings_local_qa_v1'
    )
  )
on conflict (code) do update
set
  name = excluded.name,
  source_group = excluded.source_group,
  runtime_owner = excluded.runtime_owner,
  enabled = excluded.enabled,
  poll_interval_seconds = excluded.poll_interval_seconds,
  metadata = excluded.metadata,
  updated_at = now();

with news_fixtures (
  id,
  event_type,
  ticker,
  company_name,
  market,
  sector,
  theme_group,
  sub_theme,
  score,
  delivery_level,
  impact,
  signal,
  market_scope,
  age,
  scenario_id,
  scenario
) as (
  values
    -- Existing non-archive News IDs: 22 deterministic feed/alert scenarios.
    ('94000000-0000-4000-8000-000000000001'::uuid, 'macro_market', 'JPM', 'JPMorgan Chase & Co.', 'NYSE', 'Financial Services', 'rates_credit_banks', 'interest_rates', 75, 'alert'::public.event_delivery_level, 'high'::public.event_impact, 'neutral'::public.event_signal, 'macro'::public.event_market_scope, interval '1 hour', 'news-macro-75', 'simulated rate-sensitive market scenario'),
    ('97000000-0000-4000-8000-000000000001', 'listing_risk', 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'Technology', 'ai_data_center', 'ai_chips_hbm', 50, 'feed', 'medium', 'bearish', 'company', interval '2 hours', 'news-listing-50', 'simulated listing-compliance review scenario'),
    ('97000000-0000-4000-8000-000000000002', 'dilution_risk', 'COIN', 'Coinbase Global, Inc.', 'NASDAQ', 'Financial Services', 'crypto_digital_assets', 'bitcoin', 74, 'feed', 'medium', 'bearish', 'company', interval '3 hours', 'news-dilution-74', 'simulated financing-overhang scenario'),
    ('97000000-0000-4000-8000-000000000003', 'earnings', 'LLY', 'Eli Lilly and Company', 'NYSE', 'Healthcare', 'healthcare_momentum', 'glp1_obesity_drugs', 83, 'alert', 'high', 'bullish', 'company', interval '4 hours', 'news-earnings-83', 'simulated earnings-reaction scenario'),
    ('97000000-0000-4000-8000-000000000004', 'sales_performance', 'CEG', 'Constellation Energy Corporation', 'NASDAQ', 'Utilities', 'power_energy_resources', 'nuclear_uranium', 81, 'alert', 'high', 'bullish', 'company', interval '5 hours', 'news-sales-81', 'simulated sales-momentum scenario'),
    ('97000000-0000-4000-8000-000000000005', 'product_update', 'LMT', 'Lockheed Martin Corporation', 'NYSE', 'Industrials', 'defense_geopolitics', 'defense_spending', 66, 'feed', 'medium', 'neutral', 'company', interval '6 hours', 'news-product-66', 'simulated product-milestone scenario'),
    ('97000000-0000-4000-8000-000000000006', 'leadership_governance', 'JPM', 'JPMorgan Chase & Co.', 'NYSE', 'Financial Services', 'rates_credit_banks', 'interest_rates', 58, 'feed', 'medium', 'neutral', 'company', interval '7 hours', 'news-governance-58', 'simulated governance-transition scenario'),
    ('97000000-0000-4000-8000-000000000007', 'insider_ownership', 'IONQ', 'IonQ, Inc.', 'NYSE', 'Technology', 'retail_momentum_flows', 'quantum_computing', 79, 'alert', 'high', 'bullish', 'company', interval '8 hours', 'news-ownership-79', 'simulated ownership-change scenario'),
    ('97000000-0000-4000-8000-000000000008', 'ipo_listing', 'CRWV', 'CoreWeave, Inc.', 'NASDAQ', 'Technology', 'ai_data_center', 'ai_data_centers', 69, 'feed', 'medium', 'volatile', 'company', interval '9 hours', 'news-ipo-69', 'simulated listing-readiness scenario'),
    ('97000000-0000-4000-8000-000000000009', 'shareholder_vote', 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'Technology', 'ai_data_center', 'ai_chips_hbm', 62, 'feed', 'medium', 'neutral', 'company', interval '10 hours', 'news-vote-62', 'simulated shareholder-vote scenario'),
    ('97000000-0000-4000-8000-000000000010', 'strategic_transaction', 'COIN', 'Coinbase Global, Inc.', 'NASDAQ', 'Financial Services', 'crypto_digital_assets', 'bitcoin', 88, 'alert', 'high', 'bullish', 'company', interval '11 hours', 'news-transaction-88', 'simulated strategic-partnership scenario'),
    ('97000000-0000-4000-8000-000000000011', 'financial_risk', 'LLY', 'Eli Lilly and Company', 'NYSE', 'Healthcare', 'healthcare_momentum', 'glp1_obesity_drugs', 71, 'feed', 'medium', 'bearish', 'company', interval '12 hours', 'news-financial-71', 'simulated liquidity-sensitivity scenario'),
    ('97000000-0000-4000-8000-000000000012', 'legal_risk', 'GOOGL', 'Alphabet Inc.', 'NASDAQ', 'Communication Services', 'policy_regulation', 'antitrust_big_tech_scrutiny', 86, 'alert', 'high', 'bearish', 'company', interval '13 hours', 'news-legal-86', 'simulated legal-review scenario'),
    ('97000000-0000-4000-8000-000000000013', 'dividends', 'CEG', 'Constellation Energy Corporation', 'NASDAQ', 'Utilities', 'power_energy_resources', 'nuclear_uranium', 55, 'feed', 'medium', 'bullish', 'company', interval '14 hours', 'news-dividend-55', 'simulated dividend-policy scenario'),
    ('97000000-0000-4000-8000-000000000014', 'capital_return', 'LMT', 'Lockheed Martin Corporation', 'NYSE', 'Industrials', 'defense_geopolitics', 'defense_spending', 77, 'alert', 'high', 'bullish', 'company', interval '15 hours', 'news-buyback-77', 'simulated capital-return scenario'),
    ('97000000-0000-4000-8000-000000000015', 'fda_clinical', 'LLY', 'Eli Lilly and Company', 'NYSE', 'Healthcare', 'healthcare_momentum', 'glp1_obesity_drugs', 92, 'alert', 'high', 'volatile', 'company', interval '16 hours', 'news-clinical-92', 'simulated clinical-catalyst scenario'),
    ('97000000-0000-4000-8000-000000000016', 'policy_regulation', 'GOOGL', 'Alphabet Inc.', 'NASDAQ', 'Communication Services', 'policy_regulation', 'antitrust_big_tech_scrutiny', 80, 'alert', 'high', 'bearish', 'sector', interval '17 hours', 'news-policy-80', 'simulated regulatory-policy scenario'),
    ('97000000-0000-4000-8000-000000000017', 'macro_market', 'JPM', 'JPMorgan Chase & Co.', 'NYSE', 'Financial Services', 'rates_credit_banks', 'interest_rates', 73, 'feed', 'medium', 'volatile', 'company', interval '18 hours', 'news-macro-73', 'simulated JPM rate-sensitivity and yield-curve scenario'),
    ('97000000-0000-4000-8000-000000000018', 'product_update', 'IONQ', 'IonQ, Inc.', 'NYSE', 'Technology', 'retail_momentum_flows', 'quantum_computing', 64, 'feed', 'medium', 'volatile', 'company', interval '19 hours', 'news-quantum-64', 'simulated quantum-product milestone scenario'),
    ('97000000-0000-4000-8000-000000000019', 'strategic_transaction', 'CRWV', 'CoreWeave, Inc.', 'NASDAQ', 'Technology', 'ai_data_center', 'ai_data_centers', 90, 'alert', 'high', 'bullish', 'company', interval '20 hours', 'news-datacenter-90', 'simulated data-center capacity agreement scenario'),
    ('97000000-0000-4000-8000-000000000020', 'financial_risk', 'COIN', 'Coinbase Global, Inc.', 'NASDAQ', 'Financial Services', 'crypto_digital_assets', 'bitcoin', 70, 'feed', 'medium', 'bearish', 'company', interval '21 hours', 'news-crypto-risk-70', 'simulated crypto-liquidity risk scenario'),
    ('97000000-0000-4000-8000-000000000021', 'legal_risk', 'LMT', 'Lockheed Martin Corporation', 'NYSE', 'Industrials', 'defense_geopolitics', 'defense_spending', 60, 'feed', 'medium', 'neutral', 'company', interval '22 hours', 'news-defense-legal-60', 'simulated contract-review scenario'),

    -- Fixed archive-only News IDs for stock detail and archive-page QA.
    ('97000000-0000-4000-8000-000000000022', 'earnings', 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'Technology', 'ai_data_center', 'ai_chips_hbm', 49, 'archive', 'low', 'neutral', 'company', interval '23 hours', 'news-archive-49', 'simulated low-score earnings archive scenario'),
    ('97000000-0000-4000-8000-000000000023', 'product_update', 'LLY', 'Eli Lilly and Company', 'NYSE', 'Healthcare', 'healthcare_momentum', 'glp1_obesity_drugs', 35, 'archive', 'low', 'neutral', 'company', interval '24 hours', 'news-archive-35', 'simulated low-score product archive scenario')
)
insert into public.events as existing (
  id,
  raw_item_id,
  source_code,
  source_group,
  source_name,
  source_url,
  published_at,
  ticker,
  market,
  event_type,
  score,
  delivery_level,
  impact,
  signal,
  market_scope,
  sector,
  industry_group,
  theme_group,
  sub_theme,
  title,
  quick_take,
  summary,
  reason,
  event_date,
  detected_at,
  group_dedupe_key,
  cross_group_event_key,
  metadata
)
select
  fixture.id,
  null,
  'local-news-qa',
  'news'::public.source_group,
  'Local QA News',
  null,
  transaction_timestamp() - fixture.age,
  fixture.ticker,
  fixture.market,
  fixture.event_type,
  fixture.score,
  fixture.delivery_level,
  fixture.impact,
  fixture.signal,
  fixture.market_scope,
  fixture.sector,
  null,
  fixture.theme_group,
  fixture.sub_theme,
  'Local QA: ' || fixture.scenario,
  'Local QA: synthetic scenario for News list and analysis UI validation.',
  'Local QA: ' || fixture.scenario || '; this deterministic row is not a real company event or provider observation.',
  'Local QA: validates taxonomy, score, delivery, and responsive presentation contracts.',
  (transaction_timestamp() - fixture.age)::date,
  transaction_timestamp() - fixture.age,
  'local-qa:news:' || fixture.scenario_id,
  'local-qa:news:' || fixture.scenario_id,
  jsonb_build_object(
    'fixture', true,
    'fixture_set', 'news_filings_local_qa_v1',
    'synthetic', true,
    'not_provider_observation', true,
    'company_name', fixture.company_name,
    'scenario_id', fixture.scenario_id
  )
from news_fixtures as fixture
on conflict (id) do update
set
  raw_item_id = null,
  source_code = excluded.source_code,
  source_group = excluded.source_group,
  source_name = excluded.source_name,
  source_url = null,
  published_at = excluded.published_at,
  ticker = excluded.ticker,
  market = excluded.market,
  event_type = excluded.event_type,
  score = excluded.score,
  delivery_level = excluded.delivery_level,
  impact = excluded.impact,
  signal = excluded.signal,
  market_scope = excluded.market_scope,
  sector = excluded.sector,
  industry_group = excluded.industry_group,
  theme_group = excluded.theme_group,
  sub_theme = excluded.sub_theme,
  title = excluded.title,
  quick_take = excluded.quick_take,
  summary = excluded.summary,
  reason = excluded.reason,
  event_date = excluded.event_date,
  detected_at = excluded.detected_at,
  group_dedupe_key = excluded.group_dedupe_key,
  cross_group_event_key = excluded.cross_group_event_key,
  metadata = excluded.metadata;

with filing_fixtures (
  id,
  event_type,
  ticker,
  company_name,
  market,
  sector,
  form_type,
  accession_number,
  score,
  delivery_level,
  impact,
  signal,
  age,
  scenario_id,
  scenario
) as (
  values
    ('94000000-0000-4000-8000-000000000002'::uuid, 'earnings', 'AAPL', 'Apple Inc.', 'NASDAQ', 'Technology', '10-Q', '0000000000-26-000001', 75, 'alert'::public.event_delivery_level, 'high'::public.event_impact, 'bullish'::public.event_signal, interval '2 days', 'filing-10q-75', 'simulated 10-Q earnings scenario'),
    ('98000000-0000-4000-8000-000000000001', 'dilution_risk', 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'Technology', 'S-3', '0000000000-26-000002', 74, 'feed', 'medium', 'bearish', interval '3 days', 'filing-s3-74', 'simulated S-3 registration scenario'),
    ('98000000-0000-4000-8000-000000000002', 'insider_ownership', 'JPM', 'JPMorgan Chase & Co.', 'NYSE', 'Financial Services', 'SC 13D', '0000000000-26-000003', 84, 'alert', 'high', 'volatile', interval '4 days', 'filing-13d-84', 'simulated beneficial-ownership scenario'),
    ('98000000-0000-4000-8000-000000000003', 'leadership_governance', 'MSFT', 'Microsoft Corporation', 'NASDAQ', 'Technology', '8-K', '0000000000-26-000004', 50, 'feed', 'medium', 'neutral', interval '5 days', 'filing-8k-50', 'simulated 8-K governance scenario'),
    ('98000000-0000-4000-8000-000000000004', 'financial_risk', 'CEG', 'Constellation Energy Corporation', 'NASDAQ', 'Utilities', '10-K', '0000000000-26-000005', 49, 'archive', 'low', 'neutral', interval '6 days', 'filing-10k-archive-49', 'simulated low-score 10-K archive scenario'),
    ('98000000-0000-4000-8000-000000000005', 'insider_ownership', 'LLY', 'Eli Lilly and Company', 'NYSE', 'Healthcare', '4', '0000000000-26-000006', 35, 'archive', 'low', 'neutral', interval '7 days', 'filing-form4-archive-35', 'simulated low-score Form 4 archive scenario')
)
insert into public.events as existing (
  id,
  raw_item_id,
  source_code,
  source_group,
  source_name,
  source_url,
  published_at,
  ticker,
  market,
  event_type,
  score,
  delivery_level,
  impact,
  signal,
  market_scope,
  sector,
  industry_group,
  theme_group,
  sub_theme,
  title,
  quick_take,
  summary,
  reason,
  event_date,
  detected_at,
  group_dedupe_key,
  cross_group_event_key,
  metadata
)
select
  fixture.id,
  null,
  'local-filings-qa',
  'filings'::public.source_group,
  'Local QA Filings',
  null,
  transaction_timestamp() - fixture.age,
  fixture.ticker,
  fixture.market,
  fixture.event_type,
  fixture.score,
  fixture.delivery_level,
  fixture.impact,
  fixture.signal,
  'company'::public.event_market_scope,
  fixture.sector,
  null,
  null,
  null,
  'Local QA: ' || fixture.scenario,
  'Local QA: synthetic scenario for Filings list and analysis UI validation.',
  'Local QA: ' || fixture.scenario || '; this deterministic row is not an SEC filing or provider observation.',
  'Local QA: validates filing form, score, delivery, and responsive presentation contracts.',
  (transaction_timestamp() - fixture.age)::date,
  transaction_timestamp() - fixture.age,
  'local-qa:filing:' || fixture.scenario_id,
  'local-qa:filing:' || fixture.scenario_id,
  jsonb_build_object(
    'fixture', true,
    'fixture_set', 'news_filings_local_qa_v1',
    'synthetic', true,
    'not_provider_observation', true,
    'company_name', fixture.company_name,
    'scenario_id', fixture.scenario_id,
    'accession_number', fixture.accession_number,
    'form_type', fixture.form_type
  )
from filing_fixtures as fixture
on conflict (id) do update
set
  raw_item_id = null,
  source_code = excluded.source_code,
  source_group = excluded.source_group,
  source_name = excluded.source_name,
  source_url = null,
  published_at = excluded.published_at,
  ticker = excluded.ticker,
  market = excluded.market,
  event_type = excluded.event_type,
  score = excluded.score,
  delivery_level = excluded.delivery_level,
  impact = excluded.impact,
  signal = excluded.signal,
  market_scope = excluded.market_scope,
  sector = excluded.sector,
  industry_group = excluded.industry_group,
  theme_group = excluded.theme_group,
  sub_theme = excluded.sub_theme,
  title = excluded.title,
  quick_take = excluded.quick_take,
  summary = excluded.summary,
  reason = excluded.reason,
  event_date = excluded.event_date,
  detected_at = excluded.detected_at,
  group_dedupe_key = excluded.group_dedupe_key,
  cross_group_event_key = excluded.cross_group_event_key,
  metadata = excluded.metadata;

-- Remove only the exact obsolete ad-hoc codes after every event reference has
-- been replaced. Canonical source and event-type rows are never candidates.
delete from public.sources as source
where source.code in ('browser-news', 'browser-filing')
  and not exists (
    select 1
    from public.events as event
    where event.source_code = source.code
  );

delete from public.event_types as event_type
where event_type.code in ('browser-news', 'browser-filing')
  and not exists (
    select 1
    from public.events as event
    where event.event_type = event_type.code
  );
-- END News/Filings local QA fixtures (news_filings_local_qa_v1)

commit;
