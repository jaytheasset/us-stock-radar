# News and Filings local QA seed

`supabase/seed.sql` contains the deterministic fixture set
`news_filings_local_qa_v1`. It is strictly local, synthetic QA data. Every
fixture uses the disabled `local-news-qa` or `local-filings-qa` source, has a
null `source_url`, and is marked `synthetic` and `not_provider_observation`.
The rows must never be presented as reporting from a publisher or as an SEC
observation.

The News fixture preserves the IDs used by saved-link and analysis-page QA,
covers all 17 public event types and all eight market theme groups, and includes
feed, alert, and archive score boundaries. The Filings fixture similarly covers
multiple form types and feed, alert, and archive views. Archive rows remain
available to stock-detail and `/news/archive/[id]` or
`/filings/archive/[id]` pages but are excluded from the normal landing feeds.

## Theme data flow

The News rows provide the taxonomy inputs (`theme_group` and `sub_theme`) used
to build `search_news_v2.theme_activity`. FMP does not invent those News theme
inputs. `/api/market/theme-performance` only enriches an already-present raw
theme with quote and market-performance data. If News has no theme activity,
the performance route correctly has nothing to enrich and skips the FMP quote
request.

## Destructive reset warning

The seed is replayed only by a local Supabase database reset. A reset destroys
the current local database contents before migrations and seed data are
reapplied. Preserve any local rows you need before running it.

Never add `--linked`, a remote `--db-url`, or remote project credentials to a
reset or seed command. This fixture is not approved for any linked, preview, or
production database. This repository change does not apply the seed to the
currently running local database; application is a separate, explicitly
destructive local operation.
