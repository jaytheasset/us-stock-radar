# Architecture

US Stock Radar separates data collection, processing, storage, and presentation.
The UI is not allowed to define the database model.

## Data Flow

```text
source job
-> fetch raw data
-> source parser
-> raw_items
-> event extractor / classifier
-> optional LLM enrichment
-> events
-> delivery policy
-> deliveries
-> UI reads normalized data
```

## Runtime Buckets

Render/API runtime:

- Server health and API wrappers
- Source job endpoints
- Supabase writes
- Telegram and Web Push delivery

NAS/local runtime:

- Source jobs that must run locally or through NAS scheduling
- FDA ingest bridge
- Accesswire ingest bridge when NAS-owned

External providers:

- Supabase
- SEC EDGAR
- FMP
- Polygon
- OpenAI
- Telegram
- Web Push provider endpoints

## Code Ownership

Recommended structure:

```text
src/
  sources/
    accesswire/
      fetch.ts
      parser.ts
      job.ts
    fda/
      fetch.ts
      parser.ts
      job.ts
    sec/
      fetch.ts
      parser.ts
      job.ts

  processing/
    extractEvents.ts
    classifyEvent.ts
    dedupe.ts
    deliveryPolicy.ts

  ai/
    llmClient.ts
    prompts/
    analyzePressRelease.ts
    analyzeDisclosure.ts

  db/
    sources.ts
    sourceRuns.ts
    rawItems.ts
    events.ts
    marketSnapshots.ts
    deliveries.ts

  app/
    api/
    pages/components
```

## Parser And LLM Placement

Parsers belong to the source-specific processing layer. They convert external
items into standard `raw_items`.

LLM logic belongs to the AI enrichment layer. It should enrich extracted events
and store structured output in `events.metadata` or `source_runs.metadata`.

LLM output should not be the first gate for Telegram/Web Push delivery. Start
with deterministic parser and policy behavior, then use LLM results as
enrichment until a specific source and event type is validated.

## Multi-Chat Rule

Every Codex chat working on this project must follow:

- Read `docs/DB_CONTRACT.md` before DB or page work.
- Do not create new DB tables for page convenience.
- Do not create alternate names for canonical entities.
- Do not change schema without explicit approval.
- Treat existing Supabase data as reference unless the user explicitly asks to
  migrate or mutate it.
