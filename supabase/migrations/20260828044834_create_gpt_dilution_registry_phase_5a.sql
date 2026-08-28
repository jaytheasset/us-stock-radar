-- GPT dilution registry Phase 5A.
--
-- Stores reviewed dilution instruments, point-in-time snapshots, activity, and
-- issuer-level totals without calculating or supplying analysis values.

create table public.dilution_instruments (
  id bigint generated always as identity primary key,
  instrument_key text not null unique,
  issuer_cik text not null,
  instrument_type text not null,
  name text not null,
  series_or_tranche text,
  holders text[],
  first_source_accession text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_instruments_issuer_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  constraint dilution_instruments_type_check
    check (instrument_type in (
      'convertible_note',
      'convertible_preferred',
      'warrant',
      'prefunded_warrant',
      'atm_program',
      'equity_line'
    ))
);

create table public.dilution_instrument_snapshots (
  id bigint generated always as identity primary key,
  instrument_id bigint not null
    references public.dilution_instruments(id),
  as_of_date date not null,
  status text not null,
  closed_reason text,
  can_convert_or_exercise boolean,
  restriction text,
  currency text,
  original_amount numeric,
  remaining_amount numeric,
  converted_amount numeric,
  repaid_amount numeric,
  interest_rate numeric,
  interest_converted numeric,
  original_units numeric,
  remaining_units numeric,
  converted_units numeric,
  exercised_units numeric,
  cancelled_units numeric,
  expired_units numeric,
  stated_value numeric,
  original_capacity numeric,
  used_amount numeric,
  remaining_capacity numeric,
  shares_issued numeric,
  shares_sold numeric,
  gross_proceeds numeric,
  remaining_potential_shares numeric,
  price_type text,
  conversion_price numeric,
  exercise_price numeric,
  floor_price numeric,
  price_formula text,
  available_date date,
  start_date date,
  end_date date,
  end_date_type text,
  term_months numeric,
  resale_status text,
  registered_resale_shares numeric,
  share_basis_date date,
  source_accession text,
  source_note text,
  review_note text,
  last_checked date,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_instrument_snapshots_status_check
    check (status in ('current', 'old', 'closed'))
);

create table public.dilution_instrument_activity (
  id bigint generated always as identity primary key,
  issuer_cik text not null,
  instrument_id bigint
    references public.dilution_instruments(id),
  related_instrument_keys text[],
  activity_type text not null,
  activity_date date,
  period_start date,
  period_end date,
  currency text,
  units_issued numeric,
  amount_converted numeric,
  amount_repaid numeric,
  interest_converted numeric,
  units_converted numeric,
  units_exercised numeric,
  units_cancelled numeric,
  units_expired numeric,
  used_amount numeric,
  shares_issued numeric,
  shares_sold numeric,
  gross_proceeds numeric,
  details text,
  source_accession text,
  source_note text,
  last_checked date,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_instrument_activity_issuer_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000')
);

create table public.dilution_totals (
  id bigint generated always as identity primary key,
  issuer_cik text not null,
  instrument_type text not null,
  name text not null,
  total_shares numeric,
  other_shares numeric,
  total_amount numeric,
  other_amount numeric,
  currency text,
  as_of_date date,
  status text,
  included_instrument_keys text[],
  source_accession text,
  source_note text,
  review_note text,
  last_checked date,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_totals_issuer_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  constraint dilution_totals_type_check
    check (instrument_type in (
      'convertible_note',
      'convertible_preferred',
      'warrant',
      'prefunded_warrant',
      'atm_program',
      'equity_line'
    )),
  constraint dilution_totals_status_check
    check (status is null or status in ('current', 'old', 'closed'))
);

create index dilution_instrument_snapshots_instrument_date_idx
  on public.dilution_instrument_snapshots (instrument_id, as_of_date desc, id desc);

create index dilution_instrument_activity_issuer_date_idx
  on public.dilution_instrument_activity (issuer_cik, activity_date desc, id desc);

create index dilution_instrument_activity_instrument_idx
  on public.dilution_instrument_activity (instrument_id, id)
  where instrument_id is not null;

create index dilution_totals_issuer_date_idx
  on public.dilution_totals (issuer_cik, as_of_date desc, id desc);

alter table public.dilution_instruments enable row level security;
alter table public.dilution_instrument_snapshots enable row level security;
alter table public.dilution_instrument_activity enable row level security;
alter table public.dilution_totals enable row level security;

revoke all on table public.dilution_instruments
  from public, anon, authenticated, service_role;
revoke all on table public.dilution_instrument_snapshots
  from public, anon, authenticated, service_role;
revoke all on table public.dilution_instrument_activity
  from public, anon, authenticated, service_role;
revoke all on table public.dilution_totals
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.dilution_instruments
  to service_role;
grant select, insert, update, delete on table public.dilution_instrument_snapshots
  to service_role;
grant select, insert, update, delete on table public.dilution_instrument_activity
  to service_role;
grant select, insert, update, delete on table public.dilution_totals
  to service_role;

grant usage, select on sequence public.dilution_instruments_id_seq
  to service_role;
grant usage, select on sequence public.dilution_instrument_snapshots_id_seq
  to service_role;
grant usage, select on sequence public.dilution_instrument_activity_id_seq
  to service_role;
grant usage, select on sequence public.dilution_totals_id_seq
  to service_role;

comment on table public.dilution_instruments is
  'Reviewed dilution instruments keyed by issuer-stable instrument_key; stores supplied analysis values without deriving them.';
comment on table public.dilution_instrument_snapshots is
  'Point-in-time reviewed values for one dilution instrument; unknown values remain null.';
comment on table public.dilution_instrument_activity is
  'Dilution activity that may reference one instrument or preserve multiple related instrument keys.';
comment on table public.dilution_totals is
  'Reviewed issuer-level dilution totals and their explicitly included instrument keys.';
