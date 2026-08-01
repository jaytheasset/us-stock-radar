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

commit;
