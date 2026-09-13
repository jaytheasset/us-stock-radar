-- Selection provenance only. Original subscriptions and sent event tickers are never rewritten.
alter table public.user_alert_deliveries
  add column ticker_match jsonb;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_ticker_match_shape_check check (
    ticker_match is null or coalesce((
      alert_lane = 'watchlist'
      and jsonb_typeof(ticker_match) = 'object'
      and ticker_match ->> 'version' = '1'
      and jsonb_typeof(ticker_match -> 'bindings') = 'array'
      and jsonb_array_length(ticker_match -> 'bindings') between 1 and 2000
    ), false)
  );

comment on column public.user_alert_deliveries.ticker_match is
  'First selection saved subscription UUID/ticker and event ticker; revalidate enabled original rows and effective SEC security projection after channel claim. Null preserves legacy and non-watchlist lanes.';
