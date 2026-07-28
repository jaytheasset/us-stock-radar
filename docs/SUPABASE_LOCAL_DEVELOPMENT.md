# Supabase local development

This repository pins Supabase CLI `2.110.0` and keeps local stack
configuration in `supabase/config.toml`. The configuration uses PostgreSQL 17,
does not contain credentials, and disables seeding until an intentional
`supabase/seed.sql` is added.

## Prerequisites

- Node.js 20 or newer
- Docker Desktop with the Linux engine running
- At least 7 GB of memory available to Docker

Install the locked dependencies before using the local stack:

```powershell
npm ci
npx supabase --version
```

The reported CLI version must be `2.110.0`.

## Local Auth callbacks

The local Auth redirect allowlist supports `/auth/callback` over HTTP for both
`localhost` and `127.0.0.1` on ports 3000 and 3110. The default `site_url`
remains `http://127.0.0.1:3000`.

The local Google provider is disabled by default. To test Google OAuth locally,
enable `[auth.external.google]` separately and reference the client ID and
secret through environment variables such as
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`. Never hardcode or commit either
value.

## Local-only verification

Run these commands from the repository root:

```powershell
npx supabase start
npx supabase db reset --local
npx supabase db lint --local --level error --fail-on error
npx supabase test db --local
```

Equivalent npm scripts are available as `supabase:start`,
`supabase:db:reset`, `supabase:db:lint`, and `supabase:test:db`.

`db reset --local` is the reproducibility gate: it rebuilds the local
Postgres database and applies every file in `supabase/migrations` in filename
order. The pgTAP smoke test then confirms PostgreSQL 17 and the latest
repository migration.

## Safety boundary

- Keep `.temp/`, `.branches/`, and local environment files untracked.
- Reference any future secret in `config.toml` with `env(NAME)`.
- Pass `--local` explicitly to database reset, lint, and test commands.
- Do not use `db reset --linked`, `db push`, or remote SQL while validating
  local development.
- The local stack has development credentials and no production hardening.
  Never expose its ports to a public network.

## Existing migration boundary

At the `a8b02999` baseline, the first tracked migration
(`20260723072626_add_user_alert_tickers.sql`) expects application objects such
as `public.user_profiles`, `public.watchlist_tickers`, `public.tickers`, and
`public.set_user_alert_updated_at()` to already exist. Later migrations also
expect the canonical `public.events` schema.

Those application prerequisites are not part of Supabase's default local
database. The files under `docs/db/` are design/history documents, and
`schema_v1_draft.sql` explicitly says it is review-only. Do not silently turn
them into a baseline or create placeholder objects. A clean
`db reset --local` is accepted only after an approved canonical baseline
migration precedes the existing migrations.
