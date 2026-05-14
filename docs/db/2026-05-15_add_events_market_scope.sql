-- Add market-scope classification for news events.
--
-- source_group remains the source bucket:
--   news, filings, market
--
-- market_scope classifies the investable scope of the event:
--   company = clear primary issuer or transaction subject
--   sector  = sector or industry-level news with no single primary company
--   theme   = theme-level news
--   macro   = rates, CPI, Fed, employment, dollar, oil, tariffs, geopolitical market shock
--
-- Do not infer market_scope from ticker count alone. A merger, contract, lawsuit,
-- or strategic transaction can mention multiple tickers and still be company.

do $$
begin
  create type event_market_scope as enum ('company', 'sector', 'theme', 'macro');
exception
  when duplicate_object then null;
end $$;

alter table events
  add column if not exists market_scope event_market_scope;

update events
set market_scope = 'company'
where market_scope is null;

alter table events
  alter column market_scope set default 'company',
  alter column market_scope set not null;

create index if not exists events_market_scope_score_idx
  on events(market_scope, score desc, detected_at desc);

create index if not exists events_news_market_scope_idx
  on events(source_group, market_scope, detected_at desc)
  where source_group = 'news';

comment on type event_market_scope is 'Event investable scope: company, sector, theme, or macro.';
comment on column events.market_scope is 'Canonical event scope. Use company for clear primary issuer or transaction subject; do not infer scope from ticker count alone.';
