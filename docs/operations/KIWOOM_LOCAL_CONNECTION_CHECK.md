# Kiwoom local connection attempt: target gate blocked

2026-10-08, existing detached eeb4; base
`9e5fabca49ecbf49ecddf3e82760fb7605592139`, initially clean.
This is a new environment investigation, not a repeat of isolated tests and not
a failure of the independently reviewed implementation.

## Confirmed by read-only inspection

- Candidate `.env.local` is absent. Main's existing environment file has a LAN
  REST/Auth origin on port 56321 and **two** SQL URL assignments: an earlier
  remote pooler and a later loopback 56322/postgres assignment. No remote SQL
  connection was attempted. Values were parsed in memory; credentials were not
  printed or copied. Environment files were not changed.
- The configured REST LAN address is **not among this machine's current interface
  addresses**. Two unauthenticated 5-second requests to its Auth health endpoint
  timed out. The loopback port 56321 Auth health endpoint returns HTTP 200.
  This does not identify what is at the old address or prove it is permanently
  unavailable. Device-specific addresses are retained only in the external receipt.
- No listener was found on port 3110 during the check. It was not started,
  restarted, stopped or reconfigured. A running main process's effective target
  therefore could not be verified from a live session.
- Existing Docker project `US-Stock_Radar` has gateway `983c6835d3f3`, REST
  `ced1473748cb`, Auth `36d49ff17d5f` and DB `372075c4e3ad` on
  `supabase_network_US-Stock_Radar` (network ID prefix `4d65d9a70e4a`).
- Read gateway configuration routes Auth and REST to those exact named
  containers; both containers' database URLs name `supabase_db_US-Stock_Radar`
  port 5432/database postgres. That DB publishes host port 56322; the gateway
  publishes 56321. This proves the local container topology, **not** that the
  configured old LAN endpoint resolves to this stack.
- Read-only `docker exec ... psql` reports PostgreSQL system identifier
  `7678429483712069671`, database `postgres`. Ledger has **132** entries, latest
  `20261006223000`; neither `20261008121000` nor `20261008121100` is applied.
- Existing admin role/audit, SEC ticker decision/evidence/security, raw-source
  and cover observation tables are present. No Kiwoom table was found in that
  local public-table listing. Detailed dependency signatures/permissions and
  REST/OpenAPI schema correspondence were not assessed after the target gate failed.

## Stopped as requested

The request explicitly requires stopping before migration/storage if the
configured REST/Auth and SQL environment cannot be established as the same local
development target. The currently configured REST endpoint remains unverified.
No credentials were sent to that address. The available loopback stack was not
silently substituted for it.

| Requested verification | Result |
| --- | --- |
| Local Docker routing and DB identity | Confirmed as above |
| Configured REST/Auth -> SQL identity | BLOCKED: configured address is not current local address and timed out |
| Two migrations/ledger updates | Not applied; both absent |
| Candidate server/browser/admin login | Not started/not attempted |
| API -> PostgREST -> DB feature flow | Unverified |
| Evidence review save/read-back | Unverified |
| Human append/replay/revision/withdrawal | Unverified |
| current/stale/withdrawn; actor/audit | Unverified in real environment |
| Permission/error cases | Unverified in real environment |
| Protected product table count/hash before/after | Not performed; no feature writes or migration occurred |
| DB writes by this task | 0; only catalog/ledger/identity SELECTs and unauthenticated health probes |
| Cleanup | No candidate server/tab/container started; inspection processes exited |
| Product code/environment/main/3110 | Unchanged |

**One safest next action:** explicitly designate the already identified loopback
Supabase stack as the candidate-only validation target (process environment only,
without changing main/environment files). Then separately verify its SQL/REST
schema correspondence before applying the two approved migrations. This step has
not been executed or treated as implicit permission to change main's stale URL.

## Reproduction and evidence

`scripts/verify-kiwoom-local-target.mjs` is read-only: inspect exact named Docker
containers, check DB destinations and gateway routing, check local interfaces,
and reproduce the configured-address mismatch using unauthenticated health
requests. On mismatch it writes a sanitized receipt and exits nonzero. It does
not read user rows, migrate, seed, authenticate, start/stop services or send keys.
If the address is local it reports topology only, not complete identity/E2E PASS.

```powershell
node scripts/verify-kiwoom-local-target.mjs '<existing main env path>' '<external receipt path>'
node --check scripts/verify-kiwoom-local-target.mjs
git diff --check
git diff --cached --check
```

Observed receipt is outside Git:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/local-connection/target-blocked.json`.
No secret values/tokens/cookies/passwords are recorded. This contains machine
addresses and is deliberately not committed. Product tests were not repeated;
syntax/diff checks apply only to the new diagnostic script and this document.

Only these two verification files are added. Prior commits, sources and results
are preserved. Local main ref remains
`d7347e4d2e75a5c412f69218003d2dfd407c79c5`; GitHub/Vercel/remote DB/cron unqueried.
No merge/push/deploy. Stop for independent GPT review with environment blocked,
not completed real connection verification.
