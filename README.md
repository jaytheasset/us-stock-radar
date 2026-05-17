# US Stock Radar

Next.js local app for reading the existing Supabase `events` table through
server-side API routes.

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

This workspace currently uses `http://localhost:3001` when port 3000 is already
occupied.

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
