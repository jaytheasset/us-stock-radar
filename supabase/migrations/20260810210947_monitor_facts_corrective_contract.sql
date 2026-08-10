-- Corrective, additive contract for Monitor phase 3 facts.
-- The preceding foundation migration remains immutable. Existing legacy quality
-- columns are retained for compatibility; new writes use value_quality plus
-- availability so absence is never represented as a quality.

alter table public.event_market_snapshots
  add column shares_outstanding numeric(32, 8),
  add column float_shares numeric(32, 8),
  add column price_value_quality text,
  add column price_availability text,
  add column market_cap_value_quality text,
  add column market_cap_availability text,
  add column shares_outstanding_value_quality text,
  add column shares_outstanding_availability text,
  add column float_shares_value_quality text,
  add column float_shares_availability text;

alter table public.event_market_snapshots
  add constraint event_market_snapshots_shares_outstanding_check
    check (shares_outstanding is null or shares_outstanding >= 0),
  add constraint event_market_snapshots_float_shares_check
    check (float_shares is null or float_shares >= 0),
  add constraint event_market_snapshots_price_value_contract_check
    check (
      (price_value_quality is null and price_availability is null)
      or (price_availability = 'available' and price is not null and price_value_quality in ('exact', 'derived', 'estimated'))
      or (price_availability = 'unavailable' and price is null and price_value_quality = 'unknown')
    ),
  add constraint event_market_snapshots_market_cap_value_contract_check
    check (
      (market_cap_value_quality is null and market_cap_availability is null)
      or (market_cap_availability = 'available' and market_cap is not null and market_cap_value_quality in ('exact', 'derived', 'estimated'))
      or (market_cap_availability = 'unavailable' and market_cap is null and market_cap_value_quality = 'unknown')
    ),
  add constraint event_market_snapshots_shares_outstanding_value_contract_check
    check (
      (shares_outstanding_value_quality is null and shares_outstanding_availability is null)
      or (shares_outstanding_availability = 'available' and shares_outstanding is not null and shares_outstanding_value_quality in ('exact', 'derived', 'estimated'))
      or (shares_outstanding_availability = 'unavailable' and shares_outstanding is null and shares_outstanding_value_quality = 'unknown')
    ),
  add constraint event_market_snapshots_float_shares_value_contract_check
    check (
      (float_shares_value_quality is null and float_shares_availability is null)
      or (float_shares_availability = 'available' and float_shares is not null and float_shares_value_quality in ('exact', 'derived', 'estimated'))
      or (float_shares_availability = 'unavailable' and float_shares is null and float_shares_value_quality = 'unknown')
    );

alter table public.event_form4_transactions
  add column post_transaction_shares numeric(32, 8),
  add column reporting_owner_roles jsonb not null default '[]'::jsonb,
  add column officer_titles jsonb not null default '[]'::jsonb,
  add column is_officer boolean,
  add column is_director boolean,
  add column is_10_percent_owner boolean,
  add column officer_title text,
  add column is_10b5_1 boolean,
  add column fact_as_of date,
  add column shares_value_quality text,
  add column shares_availability text,
  add column price_per_share_value_quality text,
  add column price_per_share_availability text,
  add column transaction_value_value_quality text,
  add column transaction_value_availability text,
  add column post_transaction_shares_value_quality text,
  add column post_transaction_shares_availability text;

alter table public.event_form4_transactions
  add constraint event_form4_post_transaction_shares_check
    check (post_transaction_shares is null or post_transaction_shares >= 0),
  add constraint event_form4_reporting_owner_roles_check
    check (jsonb_typeof(reporting_owner_roles) = 'array'),
  add constraint event_form4_officer_titles_check
    check (jsonb_typeof(officer_titles) = 'array'),
  add constraint event_form4_shares_value_contract_check
    check (
      (shares_value_quality is null and shares_availability is null)
      or (shares_availability = 'available' and shares is not null and shares_value_quality in ('exact', 'derived', 'estimated'))
      or (shares_availability = 'unavailable' and shares is null and shares_value_quality = 'unknown')
    ),
  add constraint event_form4_price_value_contract_check
    check (
      (price_per_share_value_quality is null and price_per_share_availability is null)
      or (price_per_share_availability = 'available' and price_per_share is not null and price_per_share_value_quality in ('exact', 'derived', 'estimated'))
      or (price_per_share_availability = 'unavailable' and price_per_share is null and price_per_share_value_quality = 'unknown')
    ),
  add constraint event_form4_transaction_value_contract_check
    check (
      (transaction_value_value_quality is null and transaction_value_availability is null)
      or (transaction_value_availability = 'available' and transaction_value is not null and transaction_value_value_quality in ('exact', 'derived', 'estimated'))
      or (transaction_value_availability = 'unavailable' and transaction_value is null and transaction_value_value_quality = 'unknown')
    ),
  add constraint event_form4_post_shares_value_contract_check
    check (
      (post_transaction_shares_value_quality is null and post_transaction_shares_availability is null)
      or (post_transaction_shares_availability = 'available' and post_transaction_shares is not null and post_transaction_shares_value_quality in ('exact', 'derived', 'estimated'))
      or (post_transaction_shares_availability = 'unavailable' and post_transaction_shares is null and post_transaction_shares_value_quality = 'unknown')
    );

alter table public.event_form144_proposed_sales
  add column exchange text,
  add column fact_as_of date,
  add column securities_to_be_sold_value_quality text,
  add column securities_to_be_sold_availability text,
  add column aggregate_market_value_value_quality text,
  add column aggregate_market_value_availability text,
  add column shares_outstanding_value_quality text,
  add column shares_outstanding_availability text,
  add column proposed_sale_percent_value_quality text,
  add column proposed_sale_percent_availability text;

alter table public.event_form144_proposed_sales
  add constraint event_form144_shares_value_contract_check
    check (
      (securities_to_be_sold_value_quality is null and securities_to_be_sold_availability is null)
      or (securities_to_be_sold_availability = 'available' and securities_to_be_sold is not null and securities_to_be_sold_value_quality in ('exact', 'derived', 'estimated'))
      or (securities_to_be_sold_availability = 'unavailable' and securities_to_be_sold is null and securities_to_be_sold_value_quality = 'unknown')
    ),
  add constraint event_form144_value_value_contract_check
    check (
      (aggregate_market_value_value_quality is null and aggregate_market_value_availability is null)
      or (aggregate_market_value_availability = 'available' and aggregate_market_value is not null and aggregate_market_value_value_quality in ('exact', 'derived', 'estimated'))
      or (aggregate_market_value_availability = 'unavailable' and aggregate_market_value is null and aggregate_market_value_value_quality = 'unknown')
    ),
  add constraint event_form144_outstanding_value_contract_check
    check (
      (shares_outstanding_value_quality is null and shares_outstanding_availability is null)
      or (shares_outstanding_availability = 'available' and shares_outstanding is not null and shares_outstanding_value_quality in ('exact', 'derived', 'estimated'))
      or (shares_outstanding_availability = 'unavailable' and shares_outstanding is null and shares_outstanding_value_quality = 'unknown')
    ),
  add constraint event_form144_percent_value_contract_check
    check (
      (proposed_sale_percent_value_quality is null and proposed_sale_percent_availability is null)
      or (proposed_sale_percent_availability = 'available' and proposed_sale_percent is not null and proposed_sale_percent_value_quality in ('exact', 'derived', 'estimated'))
      or (proposed_sale_percent_availability = 'unavailable' and proposed_sale_percent is null and proposed_sale_percent_value_quality = 'unknown')
    );

create or replace function public.replace_event_market_snapshots(
  p_event_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_count integer;
begin
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  delete from public.event_market_snapshots where event_id = p_event_id;

  insert into public.event_market_snapshots (
    event_id, symbol, security_key, exchange, security_type, snapshot_status,
    event_time, source_as_of, price, market_cap, shares_outstanding, float_shares,
    price_value_quality, price_availability,
    market_cap_value_quality, market_cap_availability,
    shares_outstanding_value_quality, shares_outstanding_availability,
    float_shares_value_quality, float_shares_availability,
    source_kind, source_name, unavailable_reason, provenance, field_sources, updated_at
  )
  select
    p_event_id, r.symbol, r.security_key, r.exchange, r.security_type, r.snapshot_status,
    r.event_time, r.source_as_of, r.price, r.market_cap, r.shares_outstanding, r.float_shares,
    r.price_value_quality, r.price_availability,
    r.market_cap_value_quality, r.market_cap_availability,
    r.shares_outstanding_value_quality, r.shares_outstanding_availability,
    r.float_shares_value_quality, r.float_shares_availability,
    r.source_kind, r.source_name, r.unavailable_reason,
    coalesce(r.provenance, '{}'::jsonb), coalesce(r.field_sources, '{}'::jsonb), coalesce(r.updated_at, now())
  from jsonb_to_recordset(v_rows) as r(
    symbol text, security_key text, exchange text, security_type text, snapshot_status text,
    event_time timestamptz, source_as_of timestamptz,
    price numeric, market_cap numeric, shares_outstanding numeric, float_shares numeric,
    price_value_quality text, price_availability text,
    market_cap_value_quality text, market_cap_availability text,
    shares_outstanding_value_quality text, shares_outstanding_availability text,
    float_shares_value_quality text, float_shares_availability text,
    source_kind text, source_name text, unavailable_reason text,
    provenance jsonb, field_sources jsonb, updated_at timestamptz
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.replace_event_ownership_facts(
  p_event_id uuid,
  p_form4_rows jsonb default '[]'::jsonb,
  p_form144_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_form4_rows jsonb := coalesce(p_form4_rows, '[]'::jsonb);
  v_form144_rows jsonb := coalesce(p_form144_rows, '[]'::jsonb);
  v_form4_count integer;
  v_form144_count integer;
begin
  if jsonb_typeof(v_form4_rows) <> 'array' or jsonb_typeof(v_form144_rows) <> 'array' then
    raise exception 'ownership row arguments must be JSON arrays' using errcode = '22023';
  end if;

  delete from public.event_form4_transactions where event_id = p_event_id;
  delete from public.event_form144_proposed_sales where event_id = p_event_id;

  insert into public.event_form4_transactions (
    event_id, transaction_index, symbol, reporting_owner_names, reporting_owner_roles,
    officer_titles, is_officer, is_director, is_10_percent_owner, officer_title,
    is_10b5_1, transaction_kind, security_title, transaction_date,
    deemed_execution_date, transaction_code, acquired_disposed_code,
    shares, shares_quality, price_per_share, price_per_share_quality,
    transaction_value, transaction_value_quality, post_transaction_shares,
    shares_value_quality, shares_availability,
    price_per_share_value_quality, price_per_share_availability,
    transaction_value_value_quality, transaction_value_availability,
    post_transaction_shares_value_quality, post_transaction_shares_availability,
    direct_or_indirect_ownership, nature_of_ownership, fact_as_of, confidence,
    provenance, evidence, calculation_basis, updated_at
  )
  select
    p_event_id, r.transaction_index, r.symbol,
    coalesce(r.reporting_owner_names, '[]'::jsonb), coalesce(r.reporting_owner_roles, '[]'::jsonb),
    coalesce(r.officer_titles, '[]'::jsonb), r.is_officer, r.is_director,
    r.is_10_percent_owner, r.officer_title, r.is_10b5_1, r.transaction_kind,
    r.security_title, r.transaction_date, r.deemed_execution_date, r.transaction_code,
    r.acquired_disposed_code, r.shares, r.shares_quality,
    r.price_per_share, r.price_per_share_quality,
    r.transaction_value, r.transaction_value_quality,
    r.post_transaction_shares, r.shares_value_quality, r.shares_availability,
    r.price_per_share_value_quality, r.price_per_share_availability,
    r.transaction_value_value_quality, r.transaction_value_availability,
    r.post_transaction_shares_value_quality, r.post_transaction_shares_availability,
    r.direct_or_indirect_ownership, r.nature_of_ownership, r.fact_as_of, r.confidence,
    coalesce(r.provenance, '{}'::jsonb), coalesce(r.evidence, '[]'::jsonb),
    coalesce(r.calculation_basis, '{}'::jsonb), coalesce(r.updated_at, now())
  from jsonb_to_recordset(v_form4_rows) as r(
    transaction_index integer, symbol text, reporting_owner_names jsonb,
    reporting_owner_roles jsonb, officer_titles jsonb, is_officer boolean,
    is_director boolean, is_10_percent_owner boolean, officer_title text,
    is_10b5_1 boolean, transaction_kind text, security_title text,
    transaction_date date, deemed_execution_date date, transaction_code text,
    acquired_disposed_code text, shares numeric, shares_quality text,
    price_per_share numeric, price_per_share_quality text,
    transaction_value numeric, transaction_value_quality text,
    post_transaction_shares numeric,
    shares_value_quality text, shares_availability text,
    price_per_share_value_quality text, price_per_share_availability text,
    transaction_value_value_quality text, transaction_value_availability text,
    post_transaction_shares_value_quality text, post_transaction_shares_availability text,
    direct_or_indirect_ownership text, nature_of_ownership text, fact_as_of date,
    confidence numeric, provenance jsonb, evidence jsonb, calculation_basis jsonb,
    updated_at timestamptz
  );
  get diagnostics v_form4_count = row_count;

  insert into public.event_form144_proposed_sales (
    event_id, proposed_sale_index, symbol, seller_name, security_title, exchange,
    securities_to_be_sold, securities_to_be_sold_quality,
    aggregate_market_value, aggregate_market_value_quality, approximate_sale_date,
    shares_outstanding, shares_outstanding_quality,
    proposed_sale_percent, proposed_sale_percent_quality,
    securities_to_be_sold_value_quality, securities_to_be_sold_availability,
    aggregate_market_value_value_quality, aggregate_market_value_availability,
    shares_outstanding_value_quality, shares_outstanding_availability,
    proposed_sale_percent_value_quality, proposed_sale_percent_availability,
    fact_as_of, confidence, provenance, evidence, calculation_basis, updated_at
  )
  select
    p_event_id, r.proposed_sale_index, r.symbol, r.seller_name, r.security_title,
    r.exchange, r.securities_to_be_sold, r.securities_to_be_sold_quality,
    r.aggregate_market_value, r.aggregate_market_value_quality,
    r.approximate_sale_date, r.shares_outstanding, r.shares_outstanding_quality,
    r.proposed_sale_percent, r.proposed_sale_percent_quality,
    r.securities_to_be_sold_value_quality, r.securities_to_be_sold_availability,
    r.aggregate_market_value_value_quality, r.aggregate_market_value_availability,
    r.shares_outstanding_value_quality, r.shares_outstanding_availability,
    r.proposed_sale_percent_value_quality, r.proposed_sale_percent_availability,
    r.fact_as_of, r.confidence, coalesce(r.provenance, '{}'::jsonb),
    coalesce(r.evidence, '[]'::jsonb), coalesce(r.calculation_basis, '{}'::jsonb),
    coalesce(r.updated_at, now())
  from jsonb_to_recordset(v_form144_rows) as r(
    proposed_sale_index integer, symbol text, seller_name text, security_title text,
    exchange text, securities_to_be_sold numeric, securities_to_be_sold_quality text,
    aggregate_market_value numeric, aggregate_market_value_quality text,
    approximate_sale_date date, shares_outstanding numeric, shares_outstanding_quality text,
    proposed_sale_percent numeric, proposed_sale_percent_quality text,
    securities_to_be_sold_value_quality text, securities_to_be_sold_availability text,
    aggregate_market_value_value_quality text, aggregate_market_value_availability text,
    shares_outstanding_value_quality text, shares_outstanding_availability text,
    proposed_sale_percent_value_quality text, proposed_sale_percent_availability text,
    fact_as_of date, confidence numeric, provenance jsonb, evidence jsonb,
    calculation_basis jsonb, updated_at timestamptz
  );
  get diagnostics v_form144_count = row_count;

  return jsonb_build_object(
    'form4_transaction_count', v_form4_count,
    'form144_proposed_sale_count', v_form144_count
  );
end;
$$;

revoke all on function public.replace_event_market_snapshots(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_event_market_snapshots(uuid, jsonb) to service_role;
grant execute on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) to service_role;

comment on function public.replace_event_market_snapshots(uuid, jsonb) is
  'Atomically replaces one event market-snapshot domain. A successful empty array clears stale rows; any error rolls the deletion back.';
comment on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) is
  'Atomically replaces one event ownership domain. Successful known-empty arrays clear stale Form 4/Form 144 rows; any error rolls all changes back.';
