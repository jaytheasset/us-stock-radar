# US Stock Radar

Next.js local app for reading the existing Supabase `events` table through
server-side API routes.

## Architecture and current implementation

- [Architecture Map](docs/architecture/map/README.md) — source Markdown diagrams and dated verification boundaries.
- [Offering / O/S / direct FACT Monitor](docs/operations/OFFERING_PLAN_MONITOR_DIRECT_FACTS.md) — current detailed Mermaid, persistence/readers, automatic internal Alerts, migrations and integration evidence.
- [Main handoff](docs/operations/ASTRA_6_MAIN_HANDOFF.md) — latest local integration and GitHub/deployment distinction.
- [Diagnostics index](docs/DIAGNOSTICS_INDEX.md) — family-specific investigation references.

## Local Run

```bash
npm install
npm run dev
```

For this repository's permanent main review workspace, use `npm run dev -- -p 3110`
and open `http://localhost:3110`. Candidate worktrees use a separate port >= 3111.
Check `AGENTS.md` before starting or restarting an existing server.

## Market Universe

FMP ticker universe and sector classifications can be refreshed with:

```bash
npm run sync:market-universe -- --limit=20000 --min-market-cap=50000000
```

The sync uses FMP `company-screener`, pulls NASDAQ/NYSE/AMEX/OTC/PNK listings by
default, writes `tickers`, and maps FMP industries into `ticker_classifications`.
Sector performance snapshots then use the largest constituents until each
industry group reaches about 85% market-cap coverage. The ticker universe keeps
companies above $50M market cap, but sector and industry performance snapshots
only use active constituents above $300M market cap.

Refresh sector and industry performance snapshots with:

```bash
npm run refresh:market-snapshots -- "--base-url=http://localhost:3001" "--ranges=1D,5D,1M,3M"
```

By default this refreshes `1D`, `5D`, `1M`, and `3M` through the local Next.js
API and writes `market_group_snapshots`.

## Env

- Local secrets live in `.env.local`.
- `SUPABASE_SERVICE_ROLE_KEY` stays server-side only.
- Browser code calls `/api/events`; it does not call Supabase directly.

## Project Rules

- Read `docs/DB_CONTRACT.md` before DB or page work.
- Read `docs/ARCHITECTURE.md` before source, parser, or LLM work.
- Read `docs/SOURCE_JOBS.md` before source job work.
- Read `docs/READOUTS.md` before adding admin/API registry surfaces.
- Do not create page-specific DB tables.
- Schema changes require explicit approval.

## Source Ingest Operations

Vercel Workflow scheduling, staged rollout, Render coexistence, and rollback are
documented in `docs/VERCEL_WORKFLOW_INGEST.md`.
