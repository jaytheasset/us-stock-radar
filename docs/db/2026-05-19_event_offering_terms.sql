-- Shared structured storage for dilution_risk / offering-specific detail pages.
-- News and filing events each get their own row keyed by event_id.
-- Source precedence/confidence is stored in metadata and field_confidence.

create table if not exists event_offering_terms (
  event_id uuid primary key references events(id) on delete cascade,
  raw_item_id uuid references raw_items(id) on delete set null,

  sec_form_type text,
  prospectus_type text not null default 'unknown'
    check (prospectus_type in (
      'base',
      'supplement',
      'registration_statement',
      'current_report',
      'warrant_indenture',
      'other',
      'unknown'
    )),
  offering_type text not null default 'unknown'
    check (offering_type in (
      'atm',
      'registered_direct',
      'private_placement',
      'shelf_registration',
      'resale_registration',
      'warrant_exercise',
      'convertible_financing',
      'rights_offering',
      'mixed',
      'other',
      'unknown'
    )),
  security_type text not null default 'unknown'
    check (security_type in (
      'common_stock',
      'common_shares',
      'ordinary_shares',
      'ads',
      'units',
      'warrants',
      'prefunded_warrants',
      'convertible_notes',
      'debt',
      'mixed',
      'other',
      'unknown'
    )),
  primary_or_resale text not null default 'not_disclosed'
    check (primary_or_resale in ('primary', 'resale', 'mixed', 'not_disclosed')),
  registration_status text not null default 'not_disclosed'
    check (registration_status in (
      'filed',
      'effective',
      'not_effective',
      'withdrawn',
      'prospectus_supplement',
      'not_disclosed'
    )),

  offering_amount_text text,
  offering_amount numeric(24, 4),
  offering_amount_currency text,

  shelf_capacity_text text,
  shelf_capacity numeric(24, 4),
  shelf_capacity_currency text,

  amount_remaining_text text,
  amount_remaining numeric(24, 4),
  amount_remaining_currency text,

  atm_program_size_text text,
  atm_program_size numeric(24, 4),
  atm_program_size_currency text,

  shares_offered_text text,
  shares_offered numeric(28, 4),

  resale_share_count_text text,
  resale_share_count numeric(28, 4),

  current_shares_outstanding_text text,
  current_shares_outstanding numeric(28, 4),

  public_float_text text,
  public_float numeric(28, 4),

  market_reference_price numeric(24, 8),
  market_reference_price_source text,
  market_context_as_of timestamptz,

  market_cap numeric(28, 4),
  market_cap_source text,

  shares_outstanding_market numeric(28, 4),
  shares_outstanding_market_source text,

  public_float_market numeric(28, 4),
  public_float_market_source text,

  public_float_percent numeric(12, 4),
  volume numeric(28, 4),
  avg_volume numeric(28, 4),
  market_context jsonb not null default '{}'::jsonb,

  authorized_shares_text text,
  authorized_shares numeric(28, 4),

  offering_price_text text,
  offering_price numeric(24, 8),
  offering_price_currency text,

  discount_to_market_percent numeric(12, 4),
  discount_to_market_basis text,

  warrant_coverage_text text,
  warrant_coverage_ratio numeric(18, 8),

  warrant_exercise_price_text text,
  warrant_exercise_price numeric(24, 8),
  warrant_exercise_price_currency text,

  conversion_price_text text,
  conversion_price numeric(24, 8),
  conversion_price_currency text,

  use_of_proceeds text,
  sales_agent text,
  selling_shareholders jsonb not null default '[]'::jsonb,

  effective_date date,
  closing_date date,

  estimated_dilution_percent numeric(12, 4),
  float_overhang_percent numeric(12, 4),
  offering_amount_percent_of_market_cap numeric(12, 4),
  max_share_impact_percent numeric(12, 4),
  dilution_scale text not null default 'unknown'
    check (dilution_scale in ('low', 'moderate', 'elevated', 'high', 'severe', 'unknown')),
  preliminary_score_floor integer
    check (preliminary_score_floor is null or (preliminary_score_floor >= 0 and preliminary_score_floor <= 100)),
  preliminary_score_cap integer
    check (preliminary_score_cap is null or (preliminary_score_cap >= 0 and preliminary_score_cap <= 100)),
  delivery_hint text
    check (delivery_hint is null or delivery_hint in ('skip', 'archive', 'feed', 'alert', 'urgent')),
  score_policy_reasons jsonb not null default '[]'::jsonb,
  dilution_calculation_basis jsonb not null default '{}'::jsonb,

  overhang_level text not null default 'unknown'
    check (overhang_level in ('low', 'moderate', 'elevated', 'high', 'severe', 'unknown')),
  dilution_risk_summary text,
  next_trigger text,

  field_confidence jsonb not null default '{}'::jsonb,
  field_evidence jsonb not null default '{}'::jsonb,
  needs_human_review boolean not null default false,

  extraction_model text,
  prompt_key text,
  prompt_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (offering_amount is null or offering_amount >= 0),
  check (shelf_capacity is null or shelf_capacity >= 0),
  check (amount_remaining is null or amount_remaining >= 0),
  check (atm_program_size is null or atm_program_size >= 0),
  check (shares_offered is null or shares_offered >= 0),
  check (resale_share_count is null or resale_share_count >= 0),
  check (current_shares_outstanding is null or current_shares_outstanding >= 0),
  check (public_float is null or public_float >= 0),
  check (market_reference_price is null or market_reference_price >= 0),
  check (market_cap is null or market_cap >= 0),
  check (shares_outstanding_market is null or shares_outstanding_market >= 0),
  check (public_float_market is null or public_float_market >= 0),
  check (public_float_percent is null or public_float_percent >= 0),
  check (volume is null or volume >= 0),
  check (avg_volume is null or avg_volume >= 0),
  check (authorized_shares is null or authorized_shares >= 0),
  check (estimated_dilution_percent is null or estimated_dilution_percent >= 0),
  check (float_overhang_percent is null or float_overhang_percent >= 0),
  check (offering_amount_percent_of_market_cap is null or offering_amount_percent_of_market_cap >= 0),
  check (max_share_impact_percent is null or max_share_impact_percent >= 0),
  check (discount_to_market_percent is null or discount_to_market_percent > -100)
);

create index if not exists event_offering_terms_raw_item_idx
  on event_offering_terms(raw_item_id)
  where raw_item_id is not null;

create index if not exists event_offering_terms_type_idx
  on event_offering_terms(offering_type, security_type, overhang_level);

create index if not exists event_offering_terms_dates_idx
  on event_offering_terms(effective_date, closing_date);

create index if not exists event_offering_terms_amount_idx
  on event_offering_terms(offering_amount desc)
  where offering_amount is not null;

create index if not exists event_offering_terms_dilution_idx
  on event_offering_terms(estimated_dilution_percent desc)
  where estimated_dilution_percent is not null;

create index if not exists event_offering_terms_float_overhang_idx
  on event_offering_terms(float_overhang_percent desc)
  where float_overhang_percent is not null;

create index if not exists event_offering_terms_market_cap_pct_idx
  on event_offering_terms(offering_amount_percent_of_market_cap desc)
  where offering_amount_percent_of_market_cap is not null;

-- Follow-up before using new calendar event types:
-- 1. Add `registration_effective_date` to lib/calendarEventRegistry.ts if product wants it on the calendar.
-- 2. Use existing `shareholder_vote` for shareholder approval dates, or add a narrower
--    `shareholder_approval_deadline` calendar type if UI filtering needs the distinction.
