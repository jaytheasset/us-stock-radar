# Watchlist ticker projection diagnostics

## Scope and storage contract

This adapter covers Watchlist search, addition, saved-row display and selection, Stock Detail membership, and deletion. Start with [ticker search and Stock Detail diagnostics](TICKER_SEARCH_STOCK_DETAIL_DIAGNOSTICS.md) for the existing SEC identity and source-filing reader.

`watchlist_tickers.ticker` and the returned `item.ticker` are the saved literal. Projection metadata supplies `currentTicker` and `historicalTickers`; it never updates the original row. For a verified VRAR → GGRP → BTLN component, a saved GGRP row displays BTLN and identifies its saved GGRP value. The original requested URL remains meaningful. Source filing links retain their original accession, ticker, date, and document bytes.

The adapter calls the existing issuer-bound public ticker projection reader. Only effective automatic or Human-approved relationships accepted by that reader participate. Security identity, evidence, effective dates, review/reconsideration, and current SEC catalog issuer checks remain in the existing reader. There is no CIK-only matching, new identity table, or duplicated decision engine. VEEA and VEEAW remain distinct securities.

The default `getWatchlistViewModel` and `GET /api/watchlist` stay literal. Only `GET /api/watchlist?projection=1&ticker=GGRP` opts into projection metadata. Calendar, Telegram, generic monitors, Alert ticker literals, and common button read semantics retain the existing contract. All Watchlist POST entry points use the same protected addition path.

## Read and refresh behavior

Saved rows are preserved one for one, including original UUIDs and timestamps. If GGRP and BTLN already exist for the same account, both remain visible with “Separate saved rows.” Exact saved-ticker selection wins over alias matching. In Stock Detail, multiple matching rows require choosing the original row before deletion.

Each request rereads the effective relationship. Memoization only reuses an already verified component within that request. A route reload, focus refresh, or Watchlist content-change notification initiates a new read. There is no persistent adapter alias cache.

Read outcomes must be distinguished:

| Outcome | Display and mutation meaning |
| --- | --- |
| `available` | Use verified current/historical metadata; saved literal remains intact. |
| `not_found` | Keep the literal without inventing a relationship. Addition still requires the active catalog check. |
| `projection_current_issuer_not_confirmed` | The derived current ticker could not be confirmed against the current catalog issuer. Display saved literals, clear projection metadata, pause adding, and show the current-listing message. |
| Other unavailable/read/request failure | Display saved literals, clear old projection metadata, pause adding, and show verification unavailable. This is not evidence that a relationship or saved row is absent. |

Rejecting only GGRP → BTLN can leave the upstream VRAR → GGRP edge effective. If GGRP is absent from the current SEC catalog, the existing issuer-bound reader refuses that partial component. The expected result is saved GGRP with `projection_current_issuer_not_confirmed`, not a verified current GGRP identity. Withdrawing that Human rejection restores the automatic BTLN projection on the next read. Do not describe this catalog rejection as a transport outage.

The existing saved-row read is limited to 500 rows. This adapter does not remove that display limit. In contrast, atomic addition queries all matching raw rows for that owner and counts all owner rows; it does not use the limited display model for duplicate or plan enforcement.

## Atomic addition and migration order

Apply `20260913113513_watchlist_projection_atomic_add.sql` before running this application version. Missing RPCs cause additions to fail closed. The migration adds two service-role-only, security-invoker functions with an empty search path; it does not create identity tables, change RLS, or rewrite existing rows.

The server first reads `watchlist_projection_snapshot`, then resolves through the existing issuer-bound reader, reads the effective plan, and checks the active catalog. The browser sends its expected current ticker; a changed selection returns `409 TICKER_PROJECTION_CHANGED` and requires another search.

`add_watchlist_ticker_verified` serializes additions with an owner-scoped transaction advisory lock. It verifies the snapshot, checks all raw saved aliases for that owner, counts all owner rows, and performs a final snapshot comparison in the same MVCC statement as the INSERT. Concurrent old/current ticker requests therefore cannot both create a row. The adapter never automatically merges or removes an existing pair. A duplicate returns `409 DUPLICATE_TICKER` with the saved ticker values. A stale snapshot is reread once; a second stale result returns 409 without inserting.

The snapshot hashes all identity, evidence, automatic-decision and Human-decision rows plus source/cover rows scoped to accessions referenced by saved decisions. Source hashes include the original `raw_content`, not only the stored SHA column. It detects changes; it does not infer relationships or calculate SEC analysis values. The functions acquire no source-table lock.

The guarantee is bounded by the final database statement snapshot. A Human decision committed before that snapshot causes reevaluation; one committed after it is observed on the next read. The external SEC catalog uses the existing catalog freshness contract and is not transactionally locked with Postgres. Direct out-of-band service-role inserts bypass the application addition protocol and can create a pair; those rows remain visible. Snapshot timing measured against isolated fixtures is not a production-scale benchmark.

Guest additions remain nonpersistent. Origin validation and owner-scoped authentication precede writes. Actual plan configuration currently allows unlimited Watchlist rows on every plan; a finite-limit database test is a synthetic guard check, not evidence that a real plan has that limit. The UI waits for a successful server response before adding a row.

## Deletion and verification checklist

Deletion targets `DELETE /api/watchlist/<saved-literal>` using both `user_id` and the original ticker. Projection never changes the DELETE key. With GGRP and BTLN saved together, removing GGRP must leave BTLN's UUID, literal and timestamps unchanged.

Verify `/watchlist`, `/watchlist?ticker=GGRP`, `/stocks/GGRP`, `/stocks/VRAR`, and `/stocks/BTLN` through normal guest/member entry. Inspect 1440px, 768px and 390px layouts, old-ticker autocomplete, successful add and reload, duplicate refusal, exact deletion, existing pairs, VEEA/VEEAW separation, and original SEC links. Perform Human reject/withdraw through the admin UI when claiming a UI workflow; distinguish helper-triggered mutations from actual UI evidence.

For failures, record HTTP status, projection reason, effective disposition, current catalog result, original saved rows and source-byte checks separately. Include network-failure and concurrent-add checks. An unavailable provider quote/chart in an isolated environment is not projection evidence and must not be replaced with invented data. Keep account credentials, captures, raw filings and DB connection material outside the repository.
