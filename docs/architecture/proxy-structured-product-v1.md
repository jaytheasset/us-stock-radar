# Proxy Structured product v1 candidate

This candidate connects the frozen Proxy two-call analyzer to saved SEC raw data,
durable execution, validated history, Generic Monitor conditions and internal alerts.
It is not a production deployment or a completed merge acceptance.

Update: the outstanding candidate gates described below were subsequently closed
by the authorized [merge-gate verification](../operations/PROXY_STRUCTURED_MERGE_GATES.md).
That report supersedes the initial pending migration-history and unverified E2E/UI
status. It does not authorize a main merge or deployment.

## Source, execution and official read

- `lib/sec-proxy/source.ts` binds the exact SEC raw identity, original payload,
  parser version and discovery source package. The existing parser and source
  builder retain evidence IDs, text, coordinates and block boundaries. No Primary
  result participates in this analysis. Identity includes an automatic/explicit
  verification namespace; verification output cannot become automatic current FACT.
- `lib/secIngest.ts` schedules Proxy work after a new raw save and after existing
  raw reuse. Dry runs do not schedule it. A Proxy failure remains separate from
  successful raw persistence. `starter.ts` reserves the raw-bound execution and
  starts `workflows/proxy-structured.ts`; its static workflow import is required
  for the local Workflow build to register the step implementation.
- `runtime.ts` claims each provider stage atomically before dispatch. Request and
  response hashes, exact response bodies, usage and transport latency are retained.
  A completed checkpoint is replayed through the frozen routing and validators.
  No started stage is reclaimed. Unknown outcomes become terminal `uncertain`;
  stale started claims become uncertain after 180 seconds. Provider/validation
  failures have no provider retry, repair or fallback.
- Infrastructure steps allow three retries. A busy result waits 180 seconds and
  checks again. Scheduler leases may expire after 60 seconds; replacement workflows
  still cannot reissue a claimed provider stage. A final-storage outage can replay
  both checkpoints without calling the provider. A raw-read outage throws for
  infrastructure retry; a successfully read but changed binding becomes stale.
- `persistence.ts` exposes raw and accession reads; `proxyStructuredFacts.ts`
  exposes the event read. Readers require exact source/version binding and a
  successful execution, verify stored hashes, replay both frozen validators and
  compare Call2's validated value with stored canonical output. Missing, stale,
  failed and uncertain data are unavailable, with explicit reasons.
- The canonical payload is only `Call2.validation.value`. Call1 titles/claims,
  trace, transport and usage are separate fields, never merged into canonical FACT.

## Conditions and alerts

Only `proxy.has_proposal` and `proxy.has_capital_structure_proposal` are registered,
as boolean `eq` conditions over typed Call2 values. There is no conversion of prose
quantities/dates, approval inference or execution inference. A fourth preset and
two add-condition entries reuse the existing `/monitor` creation UI. `/alerts`
uses existing saved-monitor management; there is no separate Proxy admin page.

The worker evaluates only monitors containing a Proxy condition. Primary event
persistence also evaluates already-completed Proxy FACT, closing either ordering
of worker completion and event creation. Official automatic reads are used in
product paths; verification jobs skip the automatic alert step.

Monitor creation must precede filing acceptance, or filing-day midnight when only
a date is available. Unknown ordering is conservatively suppressed. Existing
Generic Monitor lineage and `(listing_monitor_id, alert_event_id)` dedupe apply.
The existing database contract requires storage category `listing_risk`; Proxy is
identified by its alert title and `source_label: Proxy Monitor`. No external
email/Telegram delivery was exercised.

## Local database additions

`20261005043414_sec_proxy_structured_product_v1.sql` adds two partial unique indexes,
three service-only invoker RPCs (`reserve_sec_proxy_structured`,
`sec_proxy_transition`, `finish_sec_proxy_structured`), a history-guard function
and two scoped triggers on existing `ai_runs`/`ai_outputs`. Completed checkpoints,
source bindings, terminal runs and outputs are protected from rewriting. Existing
families retain their existing contracts and permissions. Both tables already
have RLS enabled; anon/authenticated cannot execute the three RPCs.

Applied only to existing local Supabase `127.0.0.1:56322`, system identifier
`7678429483712069671`, using direct SQL. No migration-history entries were created
or repaired. The migration list consequently shows this file as locally pending
even though its objects exist. Integration must account for that state before
running a migration command; do not blindly rerun its CREATE statements or repair
history as part of this candidate. Remote database state was not changed/audited.
Local security advisors returned no issues at warning/error level.

Bounded persisted verification data: two raw filings, two source-only events, one
new monitor, seven Proxy executions (five succeeded, two uncertain), five outputs,
and zero retained internal alerts. Original historical filing dates and existing
account data were preserved. The monitor ID is
`0a496005-7d82-464d-8d21-3ed99198cdac`; raw/event IDs are in the evidence manifest.

## Verification evidence and limits

Evidence root: `C:/Users/PC/.codex/visualizations/proxy-structured-product-20261005`.
Large source/response files and credentials are not committed.

| Check | Result |
| --- | --- |
| Saved Alternus / BigBear source | 103 / 2 discovery blocks match preserved text and coordinates; documentId now binds the real accession instead of earlier null provenance |
| Genuine local Workflow queue, saved-response replay | Both cases completed; 4 transport replays, 0 external provider requests; duplicate enqueue/processing did not reissue |
| Bounded fresh Workflow cases | Exactly 4 actual requests: Call1 `gemini-2.5-flash-lite`, Call2 `gemini-3.5-flash`, once per case; both validated, stored and read back |
| Matcher | Alternus capital proposal MATCH; BigBear NO_MATCH, for replay and fresh outputs |
| Actual historical alert consumer | Alternus suppressed by activation; BigBear condition not met; 0 alerts |
| Recovery with real DB and in-process processor | Parallel stage claims: 1 winner/1 busy; injected final-storage failure recovered from checkpoints; 1 output, 1 injected response replay, 0 external calls |
| Alert storage contract | Production writer via transaction-bound PostgreSQL adapter inserted one row and deduplicated the second call; transaction rolled back, 0 retained alerts |
| Final focused regressions | 228 tests: 226 passed, 2 baseline failures; includes 7 new product/ingest tests |
| S8, SC13 ingest and alerts UI regression subset | 74/74 passed |
| Earlier broader regression run | 256 tests: 254 passed, same 2 baseline failures |
| Whole TypeScript / whitespace | Passed |
| Workflow strict serialization validation | 6 workflow files scanned; no serde issues |

Fresh usage/latency from saved transport evidence:

| Case | Call1 tokens / ms | Call2 tokens / ms |
| --- | --- | --- |
| Alternus | 38,201 / 6,267 | 18,776 / 47,957 |
| BigBear | 2,212 / 2,616 | 5,331 / 5,643 |

Total fresh tokens: 64,520. ENDRA fresh calls were unnecessary and were not made.
The original automatic verification attempts were blocked inside the local replay
interceptor before external dispatch and remain uncertain. Successful replay,
fresh and checkpoint-recovery histories use explicit separate verification keys;
the fixture accessions therefore still have unavailable automatic FACT. No reset,
timestamp rewrite or result-seeking rerun was used to conceal this history.

The two baseline failures were independently reproduced at base `b1e80ca`:
`listingMonitorMatcher.test.ts` catches existing `Form4PurchaseMatchEvidence` in a
forbidden-word regex; the Create roundtrip in `monitorPresets.test.ts` expects a
row without existing `monitor_kind` and `form4_purchase_settings` fields. Neither
test was weakened. A separate old SC13 loader error was resolved with the
server-only test shim; that suite passes. The online SEC parser test is excluded
from offline verification.

Logged-in browser checks on candidate port 3115 covered `/monitor` (preset, Proxy
condition card, Yes/No editor, add-condition menu) and `/alerts` (saved monitor).
1440, 900 and 390px views were inspected without horizontal overflow, Next error
overlay or console errors. Unauthenticated `/api/monitors/listing` returned 401.
The existing user's session/account was not changed. Browser Create POST and the
logged-out UI journey remain unverified. A real eligible positive automatic
filing-to-alert flow is also unverified: the historical fixtures cannot prove it
without changing their dates. These are merge acceptance gaps, not passing E2E
claims. Synthetic unit tests cover positive activation/create/dedupe separately.

## Reproduction and handoff

Use this candidate directory explicitly:
`C:/Users/PC/.codex/worktrees/proxy-structured-product-v1/US-Stock Radar`.
Branch: `codex/proxy-structured-product-v1`; base/local main:
`b1e80ca68e2b702849286091b3b0a7de4a190101`.
On Windows, use the absolute file URL for the TypeScript loader in test workers:

```powershell
node --no-warnings --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/proxy-structured-product-v1/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --test --experimental-strip-types lib/sec-proxy/product.test.ts lib/sec-proxy/ingest.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

Verification scripts require the evidence directory and authorized local database.
Do not rerun fresh/seed/recovery modes as a generic test command. Fresh transport
claim files intentionally prevent duplicate calls. The alert-storage script is
rollback-only and does not validate activation. Earlier full logs and final test
logs are preserved under the evidence root.

Candidate server 3115 and its temporary browser tab were closed after verification;
port 3110 and other servers were not operated. The ignored dependency junction,
generated Workflow artifacts and local logs are not committed. No new environment
secrets were saved; existing Gemini credentials were read only into process memory
for the authorized four calls. No cron or external delivery configuration changed.

GitHub main was last observed as `9c13aee7ef41b38bac0637e53e579633745effda`;
Vercel production was last observed as `bf586ed559c7f4bea6a171790ab7b563cabc7161`
READY. Neither was freshly audited or synchronized here. Code equality across
local main/GitHub/deployment is not established. No main merge, push or deployment
was performed. Candidate commit and final clean status are reported separately.
