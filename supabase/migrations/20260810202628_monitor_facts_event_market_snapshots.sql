-- Monitor phase 3 foundation. These tables are service-only persistence for
-- event-time market observations and deterministic SEC ownership parser facts.
-- Offering/dilution facts remain canonical in public.event_offering_terms.

create table public.event_market_snapshots (
  event_id uuid not null references public.events(id) on delete cascade,
  symbol text not null,
  security_key text not null default 'primary',
  exchange text,
  security_type text,
  snapshot_status text not null,
  event_time timestamptz not null,
  source_as_of timestamptz,
  price numeric(28, 8),
  price_quality text,
  market_cap numeric(32, 4),
  market_cap_quality text,
  source_kind text not null,
  source_name text,
  unavailable_reason text,
  provenance jsonb not null default '{}'::jsonb,
  field_sources jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, symbol, security_key),
  constraint event_market_snapshots_symbol_check
    check (symbol = upper(btrim(symbol)) and symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  constraint event_market_snapshots_security_key_check
    check (security_key = lower(btrim(security_key)) and security_key ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  constraint event_market_snapshots_status_check
    check (snapshot_status in ('available', 'partial', 'unavailable')),
  constraint event_market_snapshots_source_kind_check
    check (source_kind in ('analysis_context', 'local_market_snapshot', 'local_cache', 'mixed', 'unavailable')),
  constraint event_market_snapshots_price_check check (price is null or price >= 0),
  constraint event_market_snapshots_market_cap_check check (market_cap is null or market_cap >= 0),
  constraint event_market_snapshots_price_quality_check
    check (price_quality is null or price_quality in ('exact', 'unavailable')),
  constraint event_market_snapshots_market_cap_quality_check
    check (market_cap_quality is null or market_cap_quality in ('exact', 'unavailable')),
  constraint event_market_snapshots_availability_check check (
    (snapshot_status = 'available' and price is not null and market_cap is not null and unavailable_reason is null)
    or (snapshot_status = 'partial' and num_nonnulls(price, market_cap) = 1)
    or (snapshot_status = 'unavailable' and price is null and market_cap is null and unavailable_reason is not null)
  ),
  constraint event_market_snapshots_provenance_check check (jsonb_typeof(provenance) = 'object'),
  constraint event_market_snapshots_field_sources_check check (jsonb_typeof(field_sources) = 'object')
);

create index event_market_snapshots_symbol_time_idx
  on public.event_market_snapshots (symbol, event_time desc);

create table public.event_form4_transactions (
  event_id uuid not null references public.events(id) on delete cascade,
  transaction_index integer not null,
  symbol text,
  reporting_owner_names jsonb not null default '[]'::jsonb,
  transaction_kind text not null,
  security_title text,
  transaction_date date,
  deemed_execution_date date,
  transaction_code text,
  acquired_disposed_code text,
  shares numeric(32, 8),
  shares_quality text,
  price_per_share numeric(28, 8),
  price_per_share_quality text,
  transaction_value numeric(32, 4),
  transaction_value_quality text,
  direct_or_indirect_ownership text,
  nature_of_ownership text,
  confidence numeric(5, 4) not null,
  provenance jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  calculation_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, transaction_index),
  constraint event_form4_transactions_index_check check (transaction_index >= 0),
  constraint event_form4_transactions_symbol_check
    check (symbol is null or (symbol = upper(btrim(symbol)) and symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$')),
  constraint event_form4_transactions_kind_check
    check (transaction_kind in ('non_derivative', 'derivative')),
  constraint event_form4_transactions_code_check
    check (transaction_code is null or transaction_code ~ '^[A-Z]$'),
  constraint event_form4_transactions_side_check
    check (acquired_disposed_code is null or acquired_disposed_code in ('A', 'D')),
  constraint event_form4_transactions_shares_check check (shares is null or shares >= 0),
  constraint event_form4_transactions_price_check check (price_per_share is null or price_per_share >= 0),
  constraint event_form4_transactions_value_check check (transaction_value is null or transaction_value >= 0),
  constraint event_form4_transactions_shares_quality_check
    check (shares_quality is null or shares_quality = 'exact'),
  constraint event_form4_transactions_price_quality_check
    check (price_per_share_quality is null or price_per_share_quality = 'exact'),
  constraint event_form4_transactions_value_quality_check check (
    (transaction_value is null and transaction_value_quality is null)
    or (
      transaction_value is not null
      and transaction_value_quality = 'derived'
      and shares is not null
      and price_per_share is not null
    )
  ),
  constraint event_form4_transactions_ownership_kind_check
    check (direct_or_indirect_ownership is null or direct_or_indirect_ownership in ('D', 'I')),
  constraint event_form4_transactions_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint event_form4_transactions_owner_names_check check (jsonb_typeof(reporting_owner_names) = 'array'),
  constraint event_form4_transactions_provenance_check check (jsonb_typeof(provenance) = 'object'),
  constraint event_form4_transactions_evidence_check check (jsonb_typeof(evidence) = 'array'),
  constraint event_form4_transactions_calculation_basis_check check (jsonb_typeof(calculation_basis) = 'object')
);

create index event_form4_transactions_symbol_date_idx
  on public.event_form4_transactions (symbol, transaction_date desc);

create table public.event_form144_proposed_sales (
  event_id uuid not null references public.events(id) on delete cascade,
  proposed_sale_index integer not null,
  symbol text,
  seller_name text,
  security_title text,
  securities_to_be_sold numeric(32, 8),
  securities_to_be_sold_quality text,
  aggregate_market_value numeric(32, 4),
  aggregate_market_value_quality text,
  approximate_sale_date date,
  shares_outstanding numeric(32, 8),
  shares_outstanding_quality text,
  proposed_sale_percent numeric(18, 8),
  proposed_sale_percent_quality text,
  confidence numeric(5, 4) not null,
  provenance jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  calculation_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, proposed_sale_index),
  constraint event_form144_proposed_sales_index_check check (proposed_sale_index >= 0),
  constraint event_form144_proposed_sales_symbol_check
    check (symbol is null or (symbol = upper(btrim(symbol)) and symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$')),
  constraint event_form144_proposed_sales_shares_check check (securities_to_be_sold is null or securities_to_be_sold >= 0),
  constraint event_form144_proposed_sales_value_check check (aggregate_market_value is null or aggregate_market_value >= 0),
  constraint event_form144_proposed_sales_outstanding_check check (shares_outstanding is null or shares_outstanding >= 0),
  constraint event_form144_proposed_sales_percent_check check (proposed_sale_percent is null or proposed_sale_percent >= 0),
  constraint event_form144_proposed_sales_shares_quality_check
    check (securities_to_be_sold_quality is null or securities_to_be_sold_quality = 'exact'),
  constraint event_form144_proposed_sales_value_quality_check
    check (aggregate_market_value_quality is null or aggregate_market_value_quality = 'exact'),
  constraint event_form144_proposed_sales_outstanding_quality_check
    check (shares_outstanding_quality is null or shares_outstanding_quality = 'exact'),
  constraint event_form144_proposed_sales_percent_quality_check check (
    (proposed_sale_percent is null and proposed_sale_percent_quality is null)
    or (
      proposed_sale_percent is not null
      and proposed_sale_percent_quality = 'derived'
      and securities_to_be_sold is not null
      and shares_outstanding is not null
      and shares_outstanding > 0
    )
  ),
  constraint event_form144_proposed_sales_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint event_form144_proposed_sales_provenance_check check (jsonb_typeof(provenance) = 'object'),
  constraint event_form144_proposed_sales_evidence_check check (jsonb_typeof(evidence) = 'array'),
  constraint event_form144_proposed_sales_calculation_basis_check check (jsonb_typeof(calculation_basis) = 'object')
);

create index event_form144_proposed_sales_symbol_date_idx
  on public.event_form144_proposed_sales (symbol, approximate_sale_date desc);

alter table public.event_market_snapshots enable row level security;
alter table public.event_form4_transactions enable row level security;
alter table public.event_form144_proposed_sales enable row level security;

revoke all on table public.event_market_snapshots from anon, authenticated;
revoke all on table public.event_form4_transactions from anon, authenticated;
revoke all on table public.event_form144_proposed_sales from anon, authenticated;

grant select, insert, update, delete on table public.event_market_snapshots to service_role;
grant select, insert, update, delete on table public.event_form4_transactions to service_role;
grant select, insert, update, delete on table public.event_form144_proposed_sales to service_role;

comment on table public.event_market_snapshots is
  'Optional per-event, per-ticker/security market observation. Analysis context wins over fresh local cache data; unavailable observations are explicit.';
comment on table public.event_form4_transactions is
  'One deterministic ownership-parser row per Form 4 transaction. Rows are never buy/sell netted; transaction_value is derived from shares times price.';
comment on table public.event_form144_proposed_sales is
  'Typed deterministic Form 144 proposed-sale facts. Aggregate value is source-exact; proposed-sale percent is derived only from supplied numerator and denominator.';
