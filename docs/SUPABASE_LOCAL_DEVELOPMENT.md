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

## Dedicated local ports

Stock Radar uses the 56320-56329 range so it can run alongside other local
Supabase projects without stopping them.

| Service | Local address |
| --- | --- |
| API | `http://127.0.0.1:56321` |
| Database | `127.0.0.1:56322` |
| Studio | `http://127.0.0.1:56323` |
| Mailpit | `http://127.0.0.1:56324` |

The remaining reserved ports are shadow database 56320, optional Mailpit SMTP
56325, optional Mailpit POP3 56326, disabled analytics 56327, disabled
analytics vector ingest 56328, and optional pooler 56329. The Edge Runtime
inspector uses 56330.
After startup, `npx supabase status` prints the active URLs and local
development credentials.

Local analytics is disabled because Supabase CLI configures Vector on Windows
to read Docker logs through `http://host.docker.internal:2375`, while Docker
Desktop does not expose that insecure daemon endpoint by default. Without it,
Vector exits cleanly and restarts forever. Schema, Auth, Realtime, Storage, and
application development do not need Logflare/Vector. Do not enable Docker
Desktop's unauthenticated TCP daemon merely to run local analytics.

## Local Auth callbacks

The local Auth redirect allowlist supports `/auth/callback` over HTTP for both
`localhost` and `127.0.0.1` on ports 3000 and 3110. The default `site_url` is
`http://127.0.0.1:3110`, matching the normal Stock Radar development port.

The local Google provider is disabled by default. To test Google OAuth locally,
enable `[auth.external.google]` separately and reference the client ID and
secret through environment variables such as
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`. Never hardcode or commit either
value. Register `http://127.0.0.1:56321/auth/v1/callback` as the local Supabase
Auth callback with Google.

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
order. The pgTAP smoke test then confirms PostgreSQL 17 and the canonical
baseline migration.

## Point the app at the local stack

Do not overwrite a hosted-development `.env.local`. Instead, start the app
from a fresh PowerShell session and put the local values in that process only:

```powershell
$localSupabase = npx supabase status -o json | ConvertFrom-Json
$env:SUPABASE_URL = $localSupabase.API_URL
$env:SUPABASE_PUBLISHABLE_KEY = $localSupabase.PUBLISHABLE_KEY
$env:SUPABASE_SECRET_KEY = $localSupabase.SECRET_KEY
# Optional staged fallback while migration validation is in progress:
$env:SUPABASE_ANON_KEY = $localSupabase.ANON_KEY
$env:SUPABASE_SERVICE_ROLE_KEY = $localSupabase.SERVICE_ROLE_KEY
$env:APP_BASE_URL = "http://127.0.0.1:3110"
npm run dev -- -p 3110
```

PowerShell environment variables take precedence over values loaded from
`.env.local`, and closing that shell clears the local override. Do not print,
save, or commit the key fields returned by `supabase status`.

## Test from a phone on the same Wi-Fi

LAN access is an explicit development-only mode for a trusted private Wi-Fi
network. Production continues to require HTTPS and ignores
`DEV_ALLOWED_ORIGINS`. Wildcards, public IPs, non-loopback hostnames, URL paths,
credentials, and non-RFC1918 IPv4 addresses are rejected.

1. In PowerShell, run `ipconfig` and choose the active adapter's private IPv4
   address (for example `192.168.50.25`). Do not use a VPN, public, or virtual
   adapter address.
2. From the repository root, apply it explicitly:

   ```powershell
   npm run dev:configure-lan -- --host 192.168.50.25
   ```

   The command changes only `APP_BASE_URL`, `SUPABASE_URL`, and
   `DEV_ALLOWED_ORIGINS` in the ignored `.env.local`. Existing keys and secrets
   are preserved and never printed. It refuses to overwrite a hosted or other
   non-local `SUPABASE_URL`. It also replaces the local Auth `site_url` and
   exact `/auth/callback` allowlist in `supabase/config.toml`; do not commit the
   generated personal IP.
3. Restart the Next.js dev server so it reloads `.env.local`, binding it to the
   LAN interface:

   ```powershell
   npm run dev -- -H 0.0.0.0 -p 3110
   ```

4. Supabase Auth reads `config.toml` only at stack startup. The owner of the
   shared local stack must deliberately stop/start it once for the new LAN
   callback to take effect. A feature worktree must never stop, start, or reset
   the shared stack. The configuration command does none of those actions.
5. Open `http://<LAN-IP>:3110` on the phone. The app origin and local Supabase
   API/Realtime origin (`http://<LAN-IP>:56321`) are exact development entries
   in the same allowlist. Password login, refresh, `/auth/callback`, Next dev
   assets/HMR, and Live Room Realtime therefore use the same host policy.

When the computer's LAN IP changes, rerun the configuration command with the
new address and repeat only the two required restarts above. The script never
kills a dev server or changes database rows. Windows Firewall may prompt once
for Node.js/Docker access; allow only the trusted Private network profile.

## Safety boundary

- Keep `.temp/`, `.branches/`, and local environment files untracked.
- Reference any future secret in `config.toml` with `env(NAME)`.
- Pass `--local` explicitly to database reset, lint, and test commands.
- Do not use `db reset --linked`, `db push`, or remote SQL while validating
  local development.
- The local stack has development credentials and no production hardening.
  Never expose its ports to a public network.

## Canonical baseline

At repository commit `c838b490`, the first tracked migration
(`20260723072626_add_user_alert_tickers.sql`) expects application objects such
as `public.user_profiles`, `public.watchlist_tickers`, `public.tickers`, and
`public.set_user_alert_updated_at()` to already exist. Later migrations also
expect the canonical `public.events` schema. An empty local database therefore
failed at the first foreign key with `relation "public.user_profiles" does not
exist`.

The hosted development database records all 31 old migration versions, but its
older prerequisite schema was created outside the repository history. Because
the project is pre-release, the active directory now contains one reviewed
schema-only snapshot:

```text
supabase/migrations/20260728113243_canonical_baseline.sql
```

It was produced from the hosted development database with Supabase CLI 2.110.0
using `db dump --db-url ... --schema public,private`. This captured schema only:
no rows, auth users, or secrets. The review explicitly covered RLS, grants,
functions (including `SECURITY DEFINER` search paths), triggers, extensions,
and auth/storage dependencies. The review-only `docs/db/schema_v1_draft.sql`
was not used.

The previous 31 files and their SHA-256 hashes remain under
`docs/db/migration-archive/pre-canonical-baseline/`. They are historical
evidence and source-test fixtures, not runnable migrations; applying them after
the snapshot would duplicate the same objects.

The hosted development project still has the old 31-version migration history.
Do not push this rewritten local history until the team separately approves a
hosted-development reconciliation plan. In particular, never use migration
repair, `db push`, or `db reset --linked` as part of local verification.

## References

- [Develop locally with CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Local development and database migrations](https://supabase.com/docs/guides/local-development/overview)
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction)
- [Supabase changelog](https://supabase.com/changelog)
