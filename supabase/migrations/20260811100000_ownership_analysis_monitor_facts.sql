-- Ownership typed facts are canonicalized by the completed Ownership Analysis
-- result. Parser objects remain analysis inputs only and are never a DB truth
-- fallback. This migration adds the separate economic direction and preserves
-- all Form 144 reporting-owner identities while retaining atomic event/domain
-- replacement semantics.

alter table public.event_form4_transactions
  add column economic_direction text,
  alter column transaction_kind drop not null,
  alter column confidence drop not null,
  drop constraint event_form4_transactions_value_quality_check;

alter table public.event_form4_transactions
  add constraint event_form4_transactions_economic_direction_check
    check (economic_direction in ('buy', 'sell', 'other', 'unknown')),
  add constraint event_form4_transactions_value_quality_check check (
    (transaction_value is null and transaction_value_quality is null)
    or (
      transaction_value is not null
      and transaction_value_quality in ('derived', 'unknown')
      and shares is not null
      and price_per_share is not null
    )
  );

alter table public.event_form144_proposed_sales
  add column reporting_owner_names jsonb not null default '[]'::jsonb,
  alter column confidence drop not null;

alter table public.event_form144_proposed_sales
  add constraint event_form144_reporting_owner_names_check
    check (jsonb_typeof(reporting_owner_names) = 'array');

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
    deemed_execution_date, transaction_code, acquired_disposed_code, economic_direction,
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
    r.acquired_disposed_code, r.economic_direction, r.shares, r.shares_quality,
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
    acquired_disposed_code text, economic_direction text,
    shares numeric, shares_quality text,
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
    event_id, proposed_sale_index, symbol, seller_name, reporting_owner_names,
    security_title, exchange, securities_to_be_sold, securities_to_be_sold_quality,
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
    p_event_id, r.proposed_sale_index, r.symbol, r.seller_name,
    coalesce(r.reporting_owner_names, '[]'::jsonb), r.security_title,
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
    proposed_sale_index integer, symbol text, seller_name text, reporting_owner_names jsonb,
    security_title text, exchange text, securities_to_be_sold numeric,
    securities_to_be_sold_quality text, aggregate_market_value numeric,
    aggregate_market_value_quality text, approximate_sale_date date,
    shares_outstanding numeric, shares_outstanding_quality text,
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

revoke all on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) to service_role;

comment on table public.event_form4_transactions is
  'One row per Ownership Analysis Form 4 transaction. Raw rows are not netted; derived transaction value is computed only in deterministic persistence.';
comment on table public.event_form144_proposed_sales is
  'One row per Ownership Analysis Form 144 proposed sale. Percent is derived only from explicit eligible numerator and denominator facts.';
comment on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) is
  'Atomically replaces one event Ownership Analysis fact domain. Successful known-empty arrays clear stale rows; any validation or insert error rolls all changes back.';
