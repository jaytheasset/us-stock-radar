-- A numeric observation may be present but not trustworthy enough for a
-- Monitor comparison. Preserve that observation as available + unknown;
-- future matchers must compare only available values whose quality is one of
-- exact, derived, or estimated. Truly absent values remain null + unavailable
-- + unknown. This migration only replaces corrective constraints and does not
-- rewrite existing rows.

alter table public.event_market_snapshots
  drop constraint event_market_snapshots_price_value_contract_check,
  drop constraint event_market_snapshots_market_cap_value_contract_check,
  drop constraint event_market_snapshots_shares_outstanding_value_contract_check,
  drop constraint event_market_snapshots_float_shares_value_contract_check;

alter table public.event_market_snapshots
  add constraint event_market_snapshots_price_value_contract_check
    check (
      (price_value_quality is null and price_availability is null)
      or (price_availability = 'available' and price is not null and price_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (price_availability = 'unavailable' and price is null and price_value_quality = 'unknown')
    ),
  add constraint event_market_snapshots_market_cap_value_contract_check
    check (
      (market_cap_value_quality is null and market_cap_availability is null)
      or (market_cap_availability = 'available' and market_cap is not null and market_cap_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (market_cap_availability = 'unavailable' and market_cap is null and market_cap_value_quality = 'unknown')
    ),
  add constraint event_market_snapshots_shares_outstanding_value_contract_check
    check (
      (shares_outstanding_value_quality is null and shares_outstanding_availability is null)
      or (shares_outstanding_availability = 'available' and shares_outstanding is not null and shares_outstanding_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (shares_outstanding_availability = 'unavailable' and shares_outstanding is null and shares_outstanding_value_quality = 'unknown')
    ),
  add constraint event_market_snapshots_float_shares_value_contract_check
    check (
      (float_shares_value_quality is null and float_shares_availability is null)
      or (float_shares_availability = 'available' and float_shares is not null and float_shares_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (float_shares_availability = 'unavailable' and float_shares is null and float_shares_value_quality = 'unknown')
    );

alter table public.event_form4_transactions
  drop constraint event_form4_shares_value_contract_check,
  drop constraint event_form4_price_value_contract_check,
  drop constraint event_form4_transaction_value_contract_check,
  drop constraint event_form4_post_shares_value_contract_check;

alter table public.event_form4_transactions
  add constraint event_form4_shares_value_contract_check
    check (
      (shares_value_quality is null and shares_availability is null)
      or (shares_availability = 'available' and shares is not null and shares_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (shares_availability = 'unavailable' and shares is null and shares_value_quality = 'unknown')
    ),
  add constraint event_form4_price_value_contract_check
    check (
      (price_per_share_value_quality is null and price_per_share_availability is null)
      or (price_per_share_availability = 'available' and price_per_share is not null and price_per_share_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (price_per_share_availability = 'unavailable' and price_per_share is null and price_per_share_value_quality = 'unknown')
    ),
  add constraint event_form4_transaction_value_contract_check
    check (
      (transaction_value_value_quality is null and transaction_value_availability is null)
      or (transaction_value_availability = 'available' and transaction_value is not null and transaction_value_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (transaction_value_availability = 'unavailable' and transaction_value is null and transaction_value_value_quality = 'unknown')
    ),
  add constraint event_form4_post_shares_value_contract_check
    check (
      (post_transaction_shares_value_quality is null and post_transaction_shares_availability is null)
      or (post_transaction_shares_availability = 'available' and post_transaction_shares is not null and post_transaction_shares_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (post_transaction_shares_availability = 'unavailable' and post_transaction_shares is null and post_transaction_shares_value_quality = 'unknown')
    );

alter table public.event_form144_proposed_sales
  drop constraint event_form144_shares_value_contract_check,
  drop constraint event_form144_value_value_contract_check,
  drop constraint event_form144_outstanding_value_contract_check,
  drop constraint event_form144_percent_value_contract_check;

alter table public.event_form144_proposed_sales
  add constraint event_form144_shares_value_contract_check
    check (
      (securities_to_be_sold_value_quality is null and securities_to_be_sold_availability is null)
      or (securities_to_be_sold_availability = 'available' and securities_to_be_sold is not null and securities_to_be_sold_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (securities_to_be_sold_availability = 'unavailable' and securities_to_be_sold is null and securities_to_be_sold_value_quality = 'unknown')
    ),
  add constraint event_form144_value_value_contract_check
    check (
      (aggregate_market_value_value_quality is null and aggregate_market_value_availability is null)
      or (aggregate_market_value_availability = 'available' and aggregate_market_value is not null and aggregate_market_value_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (aggregate_market_value_availability = 'unavailable' and aggregate_market_value is null and aggregate_market_value_value_quality = 'unknown')
    ),
  add constraint event_form144_outstanding_value_contract_check
    check (
      (shares_outstanding_value_quality is null and shares_outstanding_availability is null)
      or (shares_outstanding_availability = 'available' and shares_outstanding is not null and shares_outstanding_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (shares_outstanding_availability = 'unavailable' and shares_outstanding is null and shares_outstanding_value_quality = 'unknown')
    ),
  add constraint event_form144_percent_value_contract_check
    check (
      (proposed_sale_percent_value_quality is null and proposed_sale_percent_availability is null)
      or (proposed_sale_percent_availability = 'available' and proposed_sale_percent is not null and proposed_sale_percent_value_quality in ('exact', 'derived', 'estimated', 'unknown'))
      or (proposed_sale_percent_availability = 'unavailable' and proposed_sale_percent is null and proposed_sale_percent_value_quality = 'unknown')
    );

comment on table public.event_market_snapshots is
  'Optional event-time market observations. Available unknown-quality numbers are retained for evidence but are not eligible for future Monitor comparisons; absent values are unavailable unknown nulls.';
comment on table public.event_form4_transactions is
  'One row per parser-supplied Form 4 transaction. Available unknown-quality numbers are retained as evidence but are not comparison-eligible.';
comment on table public.event_form144_proposed_sales is
  'Typed Form 144 proposed-sale facts. Available unknown-quality numbers are retained as evidence but are not comparison-eligible.';
