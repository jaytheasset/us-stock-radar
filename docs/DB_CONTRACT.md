# DB Contract

This project is DB-first. Pages must read from the canonical data model instead
of creating page-specific tables.

## Hard Rules

- Do not create page-specific tables.
- Do not create duplicate domain tables with different names.
- Do not rename canonical entities without explicit approval.
- Do not add tables or columns just because a page needs a new display shape.
- Use `metadata` or `raw_payload` JSON for source-specific fields until the
  field is proven stable and promoted.
- Schema changes require explicit user approval before implementation.

## Canonical Tables

The initial schema should stay centered on these entities:

- `sources`
- `source_runs`
- `raw_items`
- `event_types`
- `events`
- `event_links`
- `event_analysis`
- `event_tickers`
- `market_snapshots`
- `market_quotes`
- `market_bars`
- `market_group_snapshots`
- `tickers`
- `market_sectors`
- `market_sub_categories`
- `fmp_industry_mappings`
- `theme_groups`
- `ticker_classifications`
- `ticker_theme_members`
- `event_theme_links`
- `theme_snapshots`
- `deliveries`
- `dedupe_keys`
- `notification_subscriptions`

## Source Groups And Dedupe

Every source and event must belong to one `source_group`:

- `news`
- `filings`
- `market`

Deduplication is scoped inside the same `source_group`.

Required rule:

- news duplicates can suppress other news duplicates.
- filing duplicates can suppress other filing duplicates.
- news must not suppress filings.
- filings must not suppress news.
- market duplicates can suppress other market duplicates.

Use `events.group_dedupe_key` for the in-group unique key:

- unique target: `events(source_group, group_dedupe_key)`

Use `events.cross_group_event_key` and `event_links` only to connect related
events across groups. They are linking tools, not alert suppression tools.

Example: if a reverse split first appears in SEC filings and then appears in a
news release, both rows stay in `events`. A filings-only subscriber can receive
the filing, and a news-only subscriber can receive the news.

## Entity Roles

`sources`  
Registered source catalog. Examples: `accesswire`, `fda`, `sec_edgar`,
`globe`, `prnewswire`, `ofac`, `doj`, `dea`, `whitehouse`.

`source_runs`  
One execution of a source job. Stores run status, counts, timestamps, errors,
and run metadata.

`raw_items`  
Raw article, filing, press release, market item, or source item before
investment-event normalization. Keep full parsed text in `body_text`, and keep
LLM-ready cleaned text in `analysis_text` when boilerplate or formatting needs
to be excluded from analysis without deleting the original text.

`events`  
Normalized investable events extracted from raw items. The UI should usually
read this table for event lists and detail pages.

`event_types`
Canonical event-type registry used by `events.event_type`, feed badges, alert
filters, and parser output. The current seed is 6-K/8-K heavy; new filing
families should add or update `event_types` before parser rollout.

Approved filing event types:

- `listing_risk`: Listing Risk
- `dilution_risk`: Dilution Risk
- `earnings`: Earnings
- `sales_performance`: Sales Performance
- `product_update`: Product Update
- `leadership_governance`: Leadership / Governance
- `insider_ownership`: Insider / Ownership
- `shareholder_vote`: Shareholder Vote
- `strategic_transaction`: Strategic Transaction
- `financial_risk`: Financial Risk
- `legal_risk`: Legal Risk
- `dividends`: Dividends
- `fda_clinical`: FDA / Clinical
- `other`: Other

Event scoring fields:

- `score`: integer from 0 to 100.
- `delivery_level`: `archive` when score is below 50, `feed` when score is 50
  to 74, and `alert` when score is 75 or higher.
- `impact`: `high`, `medium`, or `low`.
- `signal`: `bullish`, `bearish`, `volatile`, or `neutral`.
- `market_scope`: `company`, `sector`, `theme`, or `macro`.

Market scope rules:

- `company`: company-centered or transaction-centered event with a clear
  primary ticker. Related tickers can still exist for counterparties, merger
  targets, customers, peers, or affected names.
- `sector`: sector or industry-level news where no single company is the main
  subject.
- `theme`: investment-theme news such as AI data center, crypto, defense, GLP-1,
  or policy themes.
- `macro`: rates, Fed, CPI, jobs, dollar, oil, tariffs, geopolitical market
  shock, or other broad market variables.

Do not infer `market_scope` from ticker count alone. Multiple tickers can still
be `company` when the event has one primary issuer or transaction subject.

`source_group` and `market_scope` are different. A market-moving article is
still usually `source_group = news`; `market_scope` decides whether it is
company, sector, theme, or macro news.

Event copy fields:

- `title`: headline or normalized event title.
- `quick_take`: one-line takeaway shown directly under the title in feed lists.
- `summary`: longer summary for the event detail page.
- `reason`: scoring/explanation text for why the event matters.
- `source_url` and `published_at`: original source link and source timestamp for
  list/detail pages.
- `sector`, `industry_group`, `theme_group`, `sub_theme`: canonical analysis
  outputs when relevant. Do not hide these in `metadata` when the LLM produces
  them.

Do not use the old event names `impact_level`, `confidence`, or `direction` in
the new schema. Their replacements are `delivery_level`, `impact`, and
`signal`.

`event_links`  
Connections between event rows that describe the same underlying corporate
action or related follow-up. This prevents cross-group merging while still
letting the UI show related news, filings, and market items together.

`event_analysis`  
One detailed analysis record per event. Use this for detail-page sections that
are too long for the live feed: why it matters, bullish points, bearish points,
key evidence, and what to watch next. `events.quick_take` and `events.summary`
remain the canonical short and long summaries; do not duplicate them here.

`event_tickers`  
Ticker links for an event. Use `role` to distinguish primary, related, peer,
customer, supplier, counterparty, mentioned, sector constituent, and theme
constituent symbols. Detail pages use this for Related Tickers. List pages can
still rely on `events.ticker` and `events.market` for the main symbol.

`market_snapshots`  
Market context from FMP, Polygon, or other providers. Stores prices, market cap,
float, volume, and provider payloads.

`market_quotes` and `market_bars`
Short-lived caches for quote and OHLCV chart API calls. UI pages should prefer
these caches instead of calling FMP or Polygon directly for every render.

`market_group_snapshots`
Cached sector, industry-group, theme, and sub-theme performance. Industry-group
snapshots are built from the ticker universe by selecting the largest companies
until the basket reaches about 85% of that group's total market cap, with
minimum and maximum constituent limits. The ticker universe can include active
US-listed and OTC companies above $50M market cap, but performance snapshots
should use active constituents above $300M market cap so small OTC names do not
distort group moves. Store actual coverage, selected ticker count, minimum
market-cap threshold, and calculation trace in `raw_payload`.

`tickers`  
Ticker universe and raw provider profile fields. This is where FMP sector,
FMP industry, exchange, market cap, and instrument type live.

`market_sectors` and `market_sub_categories`  
Canonical sector tree. This is the default industry classification axis and is
not the same thing as a market theme.

`fmp_industry_mappings`  
Rule mapping from exact FMP industry strings into the canonical sector tree.
If a company is not cleanly mapped, leave it unclassified and let LLM or manual
review write `ticker_classifications`.

`theme_groups`  
Cross-sector investment themes such as AI, digital assets, healthcare momentum,
power and resources, defense, rates and banks, retail flows, and policy.

`ticker_classifications`  
Current sector/sub-category classification for a ticker. Keep `method` and
`manual_override` so rule output, LLM output, and admin decisions do not get
mixed together.

`ticker_theme_members`  
Ticker-to-theme membership. A ticker can belong to many themes.

`event_theme_links`  
Event-to-theme membership. This is separate from ticker membership because a
single event can be theme-moving even when the company normally belongs to a
different sector.

`theme_snapshots`  
Theme-level market context for Market-Moving News: change, volume score, event
count, alert count, and top symbols.

`deliveries`  
Delivery attempts and results for Telegram, Web Push, email, or future channels.
Use `channel` and `metadata` for channel-specific details.

`dedupe_keys`  
Cross-run dedupe tracking. This must include `source_group` and must not become
a global news-vs-filing suppression table.

`notification_subscriptions`  
Telegram chats, web push subscriptions, and future notification recipients.
Subscription filters live here, including selected `source_groups`,
`source_codes`, `event_types`, `delivery_levels`, `impacts`, `signals`, and
tickers.

## Page Mapping

Dashboard pages read from:

- `sources`
- `source_runs`
- `events`
- `deliveries`
- `market_snapshots`
- `market_quotes`
- `market_bars`
- `market_group_snapshots`
- `theme_snapshots`

Event list pages read from:

- `events`
- optional `market_snapshots`
- optional `market_quotes`
- optional `market_bars`
- optional `market_group_snapshots`
- optional `ticker_classifications`
- optional `ticker_theme_members`

Market-Moving News reads from:

- `events` where `source_group = news`
- `market_scope in ('sector', 'theme', 'macro')`
- optional `event_tickers`
- optional `event_theme_links`
- optional sector classification links
- optional `market_group_snapshots`

Event detail pages read from:

- `events`
- `event_analysis`
- `event_tickers`
- `event_links`
- `raw_items`
- `market_snapshots`
- `deliveries`

Source management pages read from:

- `sources`
- `source_runs`

Taxonomy management pages read from:

- `market_sectors`
- `market_sub_categories`
- `fmp_industry_mappings`
- `theme_groups`
- `tickers`
- `ticker_classifications`
- `ticker_theme_members`
- `event_theme_links`

Notification pages read from:

- `notification_subscriptions`
- `deliveries`

## New Work Rule

Before implementing any page or feature, first check this document. If the work
appears to need a new table or column, stop and propose the schema change
instead of editing the DB directly.
