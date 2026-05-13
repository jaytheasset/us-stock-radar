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
- `events`
- `event_links`
- `market_snapshots`
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
investment-event normalization.

`events`  
Normalized investable events extracted from raw items. The UI should usually
read this table for event lists and detail pages.

Event scoring fields:

- `score`: integer from 0 to 100.
- `delivery_level`: `archive` when score is below 50, `feed` when score is 50
  to 74, and `alert` when score is 75 or higher.
- `impact`: `high`, `medium`, or `low`.
- `signal`: `bullish`, `bearish`, `volatile`, or `neutral`.

Event copy fields:

- `title`: headline or normalized event title.
- `quick_take`: one-line takeaway shown directly under the title in feed lists.
- `summary`: longer summary for the event detail page.
- `reason`: scoring/explanation text for why the event matters.

Do not use the old event names `impact_level`, `confidence`, or `direction` in
the new schema. Their replacements are `delivery_level`, `impact`, and
`signal`.

`event_links`  
Connections between event rows that describe the same underlying corporate
action or related follow-up. This prevents cross-group merging while still
letting the UI show related news, filings, and market items together.

`market_snapshots`  
Market context from FMP, Polygon, or other providers. Stores prices, market cap,
float, volume, and provider payloads.

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
- `theme_snapshots`

Event list pages read from:

- `events`
- optional `market_snapshots`
- optional `ticker_classifications`
- optional `ticker_theme_members`

Event detail pages read from:

- `events`
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
