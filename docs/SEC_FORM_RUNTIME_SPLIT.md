# SEC Form Runtime Split

This document is the operating split for SEC form modules after the form rooms
are connected to ingest.

## Runtime Flow

1. SEC cron reads the current filing list.
2. Common SEC ingest stores the filing list metadata and document inventory.
3. The normalized form type selects the matching form module.
4. The form module supplies its fetch plan: which attachments, XML files, fee
   tables, exhibits, or source documents matter for that form family.
5. The form worker requests the shared HTTP client to fetch those documents.
6. The form worker builds raw DB payloads and calls `rawStore.save(...)` before
   parsing. This preserves raw source even when parsing later fails.
7. The form parser receives the fetched package and extracts source-backed
   facts, warnings, evidence snippets, and raw coverage notes.
8. The form module returns either a deterministic persistable result or compact
   analysis input for the form-specific/global SEC analysis prompt.
9. The form worker builds event, analysis, ticker, calendar, display, and alert
   candidate payloads from parser/analysis output.
10. The form worker requests `eventStore.saveAll(...)` and
    `alertQueue.enqueue(...)`.
11. Common stores validate payloads, apply dedupe, run transaction-safe DB
    writes, derive delivery from score, and log failures/retries.
12. Common alert delivery handles user targeting, duplicate suppression, retries,
    channel delivery, and logs.
13. UI renders persisted data only. UI does not decide event meaning.

## Form Module Owns

- form-specific fetch priorities
- the decision that a fetched document should be saved as raw source
- raw DB row payload values such as accession number, source role, URL,
  filename, document type, status, and content
- parser logic
- deterministic archive/feed/alert candidate logic when safe
- router prompt when the room uses one
- analysis prompt or compact analysis input
- event, analysis, ticker, calendar, display, and alert-candidate payload values
- fixture tests and live dry-run examples
- warnings about missing raw materials

The form module may say:

- "Fetch EX-99 press releases first."
- "Preserve ownership XML."
- "Fetch fee tables for offering forms."
- "Fetch XBRL instance documents for periodic reports."
- "Warn if the reason exhibit was listed but not fetched."

## Common Ingest Owns

- SEC HTTP calls
- rate limit and retry
- raw item dedupe
- `rawStore.save(...)`
- `eventStore.saveAll(...)`
- `alertQueue.enqueue(...)`
- raw/event/calendar/ticker/alert dedupe
- result validation
- transaction-safe DB writes
- delivery level derivation from score
- failure logs and retry logs

Form workers may request saves through common stores. Form modules do not import
Supabase directly, do not implement their own DB schema/dedupe logic, and do not
send alerts directly.

## Store Contract

The core rule:

```text
Form modules own the values.
Common stores own the write mechanism.
```

Allowed:

```ts
await rawStore.save(rawPayloadFromFormWorker);
await eventStore.saveAll(eventPayloadFromFormWorker);
await alertQueue.enqueue(alertCandidateFromFormWorker);
```

Not allowed inside a form parser, prompt, or form worker:

```ts
await supabase.from("events").insert(...);
await supabase.from("raw_items").upsert(...);
sendTelegramAlert(...);
```

The shared type contract is:

- `lib/sources/sec/forms/common/runtimeStoreContract.ts`

The shared adapter contract is:

- `lib/sources/sec/forms/common/secFormAdapter.ts`

Integration should connect form rooms through the adapter registry/facade instead
of importing parser and prompt internals throughout the pipeline. This keeps the
boundary narrow while form rooms continue changing parser and prompt quality in
parallel.

The filing package should carry the selected adapter metadata under
`form_adapter`. Downstream analysis should prefer that adapter mode over
re-detecting form families from raw form strings.

## Alert Split

Form modules may output alert candidates:

```json
{
  "score": 82,
  "event_type": "listing_risk",
  "signal": "bearish",
  "score_reason": "Common equity delisting risk with stated exchange rule failure."
}
```

Common alert delivery decides:

- which users are eligible
- which channels are enabled
- whether the event was already sent
- retry timing
- queue delay
- delivery logs

This prevents duplicate alerts when many forms produce alert-level events at the
same time.

## Form Fetch Plans

Each form folder can contain:

- `fetchPlan.ts`

That file is data/config only. It describes what the shared SEC executor should
fetch for that form family. It must not perform network calls, write DB rows, or
send alerts.

The current runtime registry is:

- `lib/sources/sec/forms/fetchPlanRegistry.ts`

The current common contract is:

- `lib/sources/sec/forms/common/fetchPlan.ts`

## Parallel Room Rule

When testing parser and prompt internals in an individual form room, change only
that form's parser, prompt, fixtures, tests, and `fetchPlan.ts`.

Read `docs/SEC_LIVE_TEST_DIRECTION.md` before live testing.

When testing the real site flow from an individual form room, run:

```powershell
npm run sec:live-test
```

The bridge script copies only that form folder into the integration worktree,
then runs real raw ingest, analysis persistence, site routing, and alert
delivery through the integration runtime.

If a test shows that runtime fetch, DB mapping, queueing, alert delivery, or UI
needs to change, report it back to the integration thread. Do not patch shared
runtime files from the form room.

Do not mimic runtime fetch with a temporary script. The live bridge must use the
real integration runtime so parser tests and site behavior do not drift apart.
