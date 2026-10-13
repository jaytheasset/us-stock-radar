# Schedule 13 all-reporters monitor

This stage makes all-reporters monitoring the default in `/monitor`. The user still explicitly chooses an issuer and exact security class/CUSIP set. Specific-person monitoring remains optional and limited to verified CIKs; existing specific-person settings, API responses and saved alerts retain their previous behavior.

## Evaluation contract

The existing canonical persistence trigger passes its exact accession and XML SHA-256 through the existing SC13 consumer. An all-reporters monitor evaluates only that canonical filing. Each reporter row must satisfy every condition using its own validated raw decimal values. CIK may be null. Reporter names are display evidence, never identity keys. There is no aggregation, cross-person condition mixing, inferred person identity, latest-owner assertion or ownership delta across filings.

Evidence contains `reporterScope: all`, `scope: single_stored_filing`, `meaning: reported_filing_value_not_realtime_ownership`, the exact accession, canonical zero-based reporter index, XML SHA-256, name, nullable CIK, security and immutable values/thresholds. A lineage root is explicitly null. The UI shows the original person name, CIK unavailable/verified, filing accession, a human-friendly reporter row number, matched FACTs and SEC source link. The hash remains in the evidence/API rather than a prominent user-facing paragraph.

Missing filing context, hash mismatch, invalid numbers or unresolved security blocks matching. Overlapping CUSIPs with contradictory security identities in stored history block both UI choices and direct Matcher evaluation. Identity/lineage uncertainty alone does not prevent evaluating a valid row's absolute facts in that exact filing. The original specific-person path continues to require its complete verified lineage and retains its root-based alert semantics.

## API and migration compatibility

The existing `/api/monitors/sc13` route accepts a new all-mode target:

```json
{"issuerCik":"0001907108","reportingPersonScope":"all","securityClass":"COMMON STOCK, PAR VALUE $0.0001 PER SHARE","cusips":["52886X107"]}
```

Security text is illustrative; callers must use the exact source-backed target returned by lookup. The existing specific target, which supplies `reportingPersonCik` and omits `reportingPersonScope`, is unchanged. All-mode requests must not supply a fabricated or null `reportingPersonCik` property.

Migration `20261013193021_sc13_all_reporters_monitor.sql` adds `sc13_monitors.reporter_scope` with default `specific`, allowing a null target CIK only for explicit `all` mode. It adds nullable `user_alert_deliveries.sc13_reporter_index` and a unique key on monitor, exact head accession and index. Existing specific alerts require a null index and retain their existing root/position/reporter unique key. New alert shape checks use explicit true/null handling. No existing column values are updated, no canonical rows are rewritten, and no tables, separate alert system, RLS permissions or external delivery channels are added.

The migration's additive default columns appear in old-row projections, but old field values and evidence remain unchanged. The candidate worker does not apply migrations; the integration reviewer applies the exact SQL only to the owned isolated database. That SQL test database has no migration ledger, and no synthetic ledger is created.

## Verification boundary

Focused tests use the retained actual Lexeo accession `0000947871-26-000801`, XML SHA-256 `698810d36b486ef2cf48240368f2ed6b5a10e9a9e521f41d2a001b1850245d8c`. Its CIK-null reporter rows retain their separate `4.1` and `1.0` percentages. A threshold of at least `1` matches two rows; at least `5` matches neither. Percent at least `4` combined with sole voting power at least `1` matches neither, since those facts belong to different people. Tests also cover equal names at distinct indices, replay deduplication, malformed values/conditions/source hashes, security ambiguity, exact source links, canonical immutability and old specific-target compatibility.

## Independent actual-source and browser acceptance

The integration reviewer verified frozen runtime commit `dafe3943a157f5daac289dbc408bcfc4a2b9bdd2`, with build `3N8c85X6WD3IKc0enOUMx`, in the owned isolated database and candidate server. Evidence is retained in the task's `sc13-all-reporters-bd797d8f` verification folder, including `ui-monitor.json`, `ui-alerts.json`, API/browser proofs, migration proof and database comparisons.

- Normal owner login used the default all-reporters mode, searched ticker LXEO, explicitly selected the class/CUSIP, confirmed percent at least `1`, and saved exactly once with HTTP 201.
- Normal `runSecRawIngest` evaluation of the retained actual Lexeo filing created two alerts and found zero existing alerts. Replay created zero and found both existing alerts. Reporter indices `0` and `1`, null CIKs and the exact canonical source hash remained distinct in their immutable evidence.
- The owner API returned both exact stored snapshots and original SEC source links. The other account saw zero alerts; anonymous access returned 401 and cross-origin creation returned 403. Invalid percentages, a null specific-person CIK and contradictory scope returned 422. All four old specific-target JSON shapes were unchanged.
- All-reporters creation and alert pages passed 1440×900, 900×900 and 390×900 checks without horizontal overflow or browser console errors. Lexeo remained unselectable in specific-person mode; AGCO's verified Dimensional CIK `0000354204` remained selectable.
- A normal ingestion replay for the existing AGCO specific-person monitor created zero alerts and found its existing alert. Its shared stock identity remained unchanged.
- All six existing canonical filings and their reporter rows, four specific monitors and seven old alerts were unchanged, excluding the migration's additive columns. Expected new data was one all-mode monitor and two alerts. Actual Lexeo submissions publication added 359 filing-metadata ledger rows and one issuer/name/ticker/raw-source observation each. Three normal ingestion source runs and their raw monitor-state updates did not alter canonical source rows.
- Candidate verification passed 78 focused tests, typecheck and production build. The reviewer independently passed 71 regression tests and the actual-source negative Matcher checks for aggregation, cross-person mixing, wrong security, wrong hash and missing context.

The migration was applied only as exact SQL to isolated port 59622; that SQL fixture has no migration ledger. The permanent main workspace, shared database and production were untouched. The candidate server was shut down after acceptance; the user's port 3110 server was not operated.

This is per-filing absolute-value monitoring, not person identity or ownership delta across filings. The natural-language compiler is unchanged. Cover persistence remained separately blocked in the scoped verification guard and was not repaired. No provider calls, main integration, push or deployment occurred. Earlier SC13 acceptance documents describe their respective historical stages; their all-reporters deferral is superseded by this contract.
