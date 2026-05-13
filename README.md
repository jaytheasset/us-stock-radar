# US Stock Radar

Next.js local app for reading the existing Supabase `events` table through
server-side API routes.

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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
