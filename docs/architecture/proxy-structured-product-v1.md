# Proxy Structured product v1 — local main integrated

Product baseline: local main merge `53e1f79098563a0ac6e761d900ada2fbf623c0ae`,
integrating the complete candidate `d9368157dcadd9a46c95b6f36af3d91664fb733e`
from base `b1e80ca68e2b702849286091b3b0a7de4a190101`, without conflicts.
Independent review and main regressions/readback/browser checks are complete.
This is local integration, **not push/deployment or external email/Telegram completion**.

The [candidate merge gates](../operations/PROXY_STRUCTURED_MERGE_GATES.md) and
[acceptance record](../operations/PROXY_STRUCTURED_PRODUCT_ACCEPTANCE.md) are
dated evidence, superseded for current merge status by this document and
[main handoff](../operations/ASTRA_6_MAIN_HANDOFF.md). Local completion is closed;
do not restart analyzer tuning, provider experiments or another E2E loop without
a new concrete requirement. Known minor omissions remain non-blocking notes.

## Shared source, separate analyses

SEC raw → Proxy Parser / discoveryBlocks branches to Primary and Structured.
They share the parser-selected discovery source contract, not analysis outputs.
`buildPrimarySourceBlocks` in `lib/sources/sec/forms/proxy/sourceInput.ts` preserves
discoveryBlocks order, original text, IDs, coordinates and block boundaries 1:1,
without a second filter/sort/merge. Existing Primary supporting material remains.
Structured does not supply Primary's answers; Primary prose/scoring does not
supply canonical FACT. Primary schema, analysis/scoring and repair are unchanged.

The existing [SEC Primary Markdown diagram](map/01-primary-analysis.md) is the
single flow-diagram source. Do not maintain another exported/remote diagram copy.

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

Local Supabase `127.0.0.1:56322`, system identifier `7678429483712069671`:
**migration `20261005043414` applied; object/history state aligned**. Initially
objects were applied by direct SQL without a history entry. The separately
authorized candidate gate subsequently compared every object/grant and recorded
only this applied history row, without rerunning CREATE statements. Main integration
independently confirmed four functions, two indexes, two triggers and RPC grants
against repository SQL. No history repair/reapplication occurred in the main
integration or this closeout. Remote DB remains unaudited/unchanged. Do not blindly
apply or repair this migration again. Initial local advisors reported no warning/error.

Initial candidate data (historical): two real raw filings/two source-only events,
monitor `0a496005-7d82-464d-8d21-3ed99198cdac`, seven Proxy executions/five outputs,
zero retained alerts. Later merge gates added one explicitly synthetic raw/event,
one new two-condition monitor, one automatic execution/output and two internal
alerts (one for each matching monitor). Main read-only verification found eight
runs (six succeeded/two uncertain), six outputs and the same two alerts. Historical
SEC dates/raw data stayed intact; no reset/delete/backfill occurred. Normal browser
session refresh changed auth-session storage, not credentials/permissions or plans;
see the candidate session audit. No byte-identical auth-row claim is made.

## Verification evidence and limits

Current local disposition: automatic filing → persistence → official reader →
Matcher → internal Alert **E2E PASS**, repeat enqueue/replay dedupe and idempotence
**PASS**. The positive automatic case is explicitly synthetic accession
`9999999999-26-000001` with exact saved-response transport, not a fresh model
analysis of an eligible real SEC filing. Actual Alternus/BigBear fresh calls are
separate evidence below. Main integration made **0 additional Gemini calls**,
created no alerts or facts, and reused the completed E2E rather than rerunning it.

Candidate browser Create returned 201; logged-out UI/API were verified. Main
independently confirmed `/monitor` and `/alerts`, both saved conditions, seven
monitors/two Monitor alerts, login/logout gates, 1440/900/390px views and no console
errors. Main regressions: 215/217 pass with the same two base failures; full
TypeScript and diff checks passed. Official reads and stored runs/outputs/alerts
were identical before/after integration. Evidence:
`C:/Users/PC/.codex/visualizations/proxy-product-main-integration-20261005`.

Initial candidate evidence root: `C:/Users/PC/.codex/visualizations/proxy-structured-product-20261005`.
Large source/response files and credentials are not committed.

The following table/usage records are the initial candidate's bounded verification,
not current pending gates. Later automatic positive/UI/migration evidence is in
`C:/Users/PC/.codex/visualizations/proxy-merge-gates-20261005`.

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

Initial browser evidence on candidate 3115 covered preset/editor/add-condition
and saved monitors at 1440/900/390px, plus unauthenticated API 401. At that time
Create, logged-out UI and positive automatic alerts were pending. The later
merge gates closed those gaps through a real browser submission and durable
synthetic/saved-response automatic case; main then independently smoke-checked
the merged UI/readers. A fresh eligible real-source positive alert and external
delivery remain untested; neither is implied by the completed local integration.

## Reproduction and handoff

Use the permanent main directory `C:/Users/PC/Documents/Codex/US-Stock Radar`.
Keep branch `main`; do not switch it. Completed candidate branch
`codex/proxy-structured-product-v1` / `d9368157…` is fully merged and its checkout
is approved for retirement after this documentation commit, subject to the final
clean/no-unique-work check. Keep Git history, existing Proxy chat and external
evidence archives. Cleanup result is recorded in the closeout evidence.
On Windows, use the absolute file URL for the TypeScript loader in test workers:

```powershell
node --no-warnings --experimental-loader 'file:///C:/Users/PC/Documents/Codex/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --test --experimental-strip-types lib/sec-proxy/product.test.ts lib/sec-proxy/ingest.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

Verification scripts require the evidence directory and authorized local database.
Do not rerun fresh/seed/recovery modes as a generic test command. Fresh transport
claim files intentionally prevent duplicate calls. The alert-storage script is
rollback-only and does not validate activation. Earlier full logs and final test
logs are preserved under the evidence root.

The candidate 3115 server was reopened for independent merge review only. Cleanup
stops only that candidate-owned server and removes its completed checkout; 3110
main and unrelated services/shared dependencies remain. The ignored dependency
junction, build/Workflow artifacts and logs are not product dependencies. Main
3110 was absent before integration and was started using the existing main/local
DB configuration; no env file edits. No new secrets, cron or external-delivery
configuration changes. Documentation closeout does not start/restart any server.

GitHub main was last observed as `9c13aee7ef41b38bac0637e53e579633745effda`;
Vercel production was last observed as `bf586ed559c7f4bea6a171790ab7b563cabc7161`
READY. Neither was freshly audited or synchronized here. Code equality across
local main/GitHub/deployment is not established. **Local main merge is complete**
at `53e1f790…`; this documentation-only closeout follows that merge. Push/deploy
were not performed. Current GitHub/Vercel/remote DB were not queried during
closeout. Final documentation commit and cleanup/clean status are reported separately.
