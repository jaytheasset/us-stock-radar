# Supabase API key migration

Stock Radar supports Supabase publishable and secret API keys while retaining
the legacy keys as a staged fallback.

## Environment contract and precedence

| Runtime boundary | Preferred | Legacy fallback |
| --- | --- | --- |
| Browser/public, Auth, and Realtime | `SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_ANON_KEY` |
| Privileged server, worker, and script | `SUPABASE_SECRET_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| Direct PostgreSQL | `SUPABASE_DB_URL` | unchanged |

The preferred variable wins whenever it is non-empty. If that value is a
recognizable wrong-role key, resolution fails closed and does not fall back.
A public slot rejects `sb_secret_` and legacy `service_role` keys. A privileged
slot rejects `sb_publishable_` and legacy `anon` keys.

Do not use a `NEXT_PUBLIC_` prefix for either server environment variable. The
Realtime configuration passes only the resolved publishable key from a server
component to the browser. Secret and service-role keys must never be included
in browser props, bundles, logs, URLs, or reports.

## Header contract

- Publishable and secret keys are sent in `apikey` only.
- A signed-in user's access JWT is sent in `Authorization: Bearer <user-jwt>`.
- Legacy JWT-based keys retain their bearer header only on the legacy fallback
  path, preserving current role behavior until fallback is retired.
- Auth requests without an access JWT, including sign-in, sign-up, OAuth code
  exchange, password recovery, and refresh, use the public API key and do not
  send a new API key as a bearer token.

## Covered integrations

- Auth sign-in, sign-up, OAuth exchange, refresh, password update, user lookup,
  and logout
- Admin Auth and server-side administrative reads
- REST reads/writes and RPC calls used by SEC, Alerts, workflows, and pages
- Realtime public subscriptions
- Storage avatar reads and privileged object writes
- Alert delivery and QA scripts, isolated SEC verification scripts, and local
  Listing Monitor verification paths

There are no project Edge Function sources under `supabase/functions` in this
repository. If Edge Functions are added, use the runtime's
`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` JSON dictionaries (or the
current Supabase server SDK), keep API keys in `apikey`, and authenticate user
JWTs separately. Do not treat `verify_jwt` accepting an API key as caller
authentication.

## Rollout

1. Add `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to each controlled
   runtime without removing the legacy variables.
2. Verify public, authenticated-user, privileged REST/RPC, Realtime, Storage,
   server/worker, and script paths in that runtime.
3. Audit external callers, CI secrets, Vercel environment variables, and any
   out-of-repository Edge Functions or webhooks.
4. Keep legacy keys enabled until all runtime audits pass. Disabling them is a
   separate production operation and is not part of this staged code change.

Never print key values while validating. Report only variable presence, selected
source name, key class, HTTP status, and pass/fail results.

Official references:

- <https://supabase.com/docs/guides/getting-started/api-keys>
- <https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys>
- <https://supabase.com/docs/guides/functions/auth-headers>
- <https://supabase.com/changelog.md>
