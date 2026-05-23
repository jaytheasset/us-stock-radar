# SEC Room Setup Template

Use this file when opening a new Codex room for parallel SEC filing work.

The goal is simple:

- Handoff MD files are shared rule documents. Do not commit them from an
  individual form room.
- Each form room edits only its own form folder.
- Common code, ingest wiring, DB changes, UI, alerts, live FMP, and live DB
  work are handled only in their dedicated rooms.
- For real parallel work, do not let multiple Codex rooms edit the same local
  folder at the same time.

## 1. Create A Separate Worktree

Use a separate git worktree for each parallel Codex room.

Start from the main project folder:

```powershell
cd "C:\Users\PC\Documents\Codex\US-Stock Radar"
git status --short
```

Only create new worktrees when `git status --short` is clean.

Examples:

```powershell
git worktree add "..\US-Stock-Radar-sec-8k-6k" -b sec/8k-6k
git worktree add "..\US-Stock-Radar-sec-s1-f1" -b sec/s1-f1
git worktree add "..\US-Stock-Radar-sec-424b" -b sec/424b
```

Open the new Codex room in the worktree folder, not in the original project
folder.

If multiple Codex rooms edit the same folder at the same time, dirty files can
mix together and one room can accidentally see or commit another room's work.

## 2. Room Map

| Scope | Handoff MD | Work Folder | Branch Example |
| --- | --- | --- | --- |
| `8-K / 6-K, 8-K/A / 6-K/A` | `docs/SEC_8K_6K_ROOM.md` | `lib/sources/sec/forms/8k-6k/` | `sec/8k-6k` |
| `10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A` | `docs/SEC_PERIODIC_REPORTS_ROOM.md` | `lib/sources/sec/forms/periodic-reports/` | `sec/periodic-reports` |
| `NT 10-K / NT 10-Q / NT 20-F` | `docs/SEC_NT_ROOM.md` | `lib/sources/sec/forms/nt/` | `sec/nt` |
| `S-1 / F-1, S-1/A / F-1/A` | `docs/SEC_S1_F1_ROOM.md` | `lib/sources/sec/forms/s1-f1/` | `sec/s1-f1` |
| `S-3 / F-3 / S-3ASR / F-3ASR, S-3/A / F-3/A` | `docs/SEC_S3_F3_ROOM.md` | `lib/sources/sec/forms/s3-f3/` | `sec/s3-f3` |
| `424B3 / 424B5` | `docs/SEC_424B_ROOM.md` | `lib/sources/sec/forms/424b/` | `sec/424b` |
| `S-8 / S-8/A` | `docs/SEC_S8_ROOM.md` | `lib/sources/sec/forms/s8/` | `sec/s8` |
| `EFFECT` | `docs/SEC_EFFECT_ROOM.md` | `lib/sources/sec/forms/effect/` | `sec/effect` |
| `Form 4 / 4/A, Form 144 / 144/A` | `docs/SEC_OWNERSHIP_ROOM.md` | `lib/sources/sec/forms/ownership/` | `sec/ownership` |
| `SC 13D / SC 13D/A, SC 13G / SC 13G/A` | `docs/SEC_SC13_ROOM.md` | `lib/sources/sec/forms/sc13/` | `sec/sc13` |
| `Proxy` | `docs/SEC_PROXY_ROOM.md` | `lib/sources/sec/forms/proxy/` | `sec/proxy` |
| `425` | `docs/SEC_425_ROOM.md` | `lib/sources/sec/forms/425/` | `sec/425` |
| `S-4 / F-4 / S-4/A / F-4/A` | `docs/SEC_S4_F4_ROOM.md` | `lib/sources/sec/forms/s4-f4/` | `sec/s4-f4` |
| `Tender / CB / 13E3` | `docs/SEC_TENDER_CB_13E3_ROOM.md` | `lib/sources/sec/forms/tender-cb-13e3/` | `sec/tender-cb-13e3` |
| `Form 25 / 25-NSE` | `docs/SEC_FORM25_ROOM.md` | `lib/sources/sec/forms/form25/` | `sec/form25` |
| `Other SEC Filing` | `docs/SEC_OTHER_ROOM.md` | `lib/sources/sec/forms/other/` | `sec/other` |
| SEC ingest / site connection | `docs/SEC_INGEST_INTEGRATION_ROOM.md` | integration files only after form output exists | `sec/ingest-integration` |
| SEC detail UI | `docs/SEC_EVENT_DETAIL_UI_ROOM.md` | app/UI files only after UI payload exists | `sec/event-detail-ui` |

## 3. Approved Event Types

Every form room must use only these 15 event types:

- `listing_risk`
- `dilution_risk`
- `earnings`
- `sales_performance`
- `product_update`
- `leadership_governance`
- `insider_ownership`
- `shareholder_vote`
- `strategic_transaction`
- `financial_risk`
- `legal_risk`
- `dividends`
- `capital_return`
- `fda_clinical`
- `other`

Do not invent new event types in an individual form room.

## 4. First Message For A New Form Room

Paste this as the first message in the new Codex room. Replace the bracketed
parts.

```text
This room is for SEC [exact Scope].

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/[matching ROOM MD filename]
- [matching Work Folder]

These MD files are rule documents. Do not edit them.

Only work inside [matching Work Folder].
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

The target flow is parser > router LLM prompt > analysis LLM prompt >
fixture JSON tests.

If a case can finish deterministically without LLM, prove it with a fixture.

Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in
docs/SEC_FORM_ROOM_RULES.md.

Use only these 15 event types:

- listing_risk
- dilution_risk
- earnings
- sales_performance
- product_update
- leadership_governance
- insider_ownership
- shareholder_vote
- strategic_transaction
- financial_risk
- legal_risk
- dividends
- capital_return
- fda_clinical
- other

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## 5. Start-Work Approval Message

After reviewing the plan, paste this if the plan is acceptable.

```text
Proceed.

Before editing, state the exact files you will change.
Only edit files inside [matching Work Folder].
Use fixture JSON only for tests.

If you find a need for common rules, market context, ingest wiring, or special
detail UI, do not implement it. Record it in the final handoff.

Other SEC form rooms are working in parallel. Touching common, DB, UI, ingest,
alerts, live FMP, or live DB from this room can create conflicts.
```

## 6. Reminder Message

Paste this during long work if the room starts drifting.

```text
Reminder: this room only works inside [matching Work Folder].
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.
If something outside the folder is needed, do not implement it. Record it in
the final handoff.
```

## 7. Before Commit Check

Ask this before a form room commits.

```text
Before committing, show git status and confirm that every changed file is
inside [matching Work Folder].

If handoff MD files, common, ingest, DB, app/UI, or alerts are changed, stop and
do not commit.
```

If clean, the individual room commits only its own work on its own branch.

The handoff MD files are managed by the main coordination room. Individual form
rooms should not recommit or rewrite them.

## 8. Final Handoff Format

Each form room should finish with this report.

```text
Final handoff:

- Scope:
- Changed files:
- Parser/router/analysis created:
- Fixture tests:
- Score examples for archive/feed/alert:
- Market context needs:
- Notes for the ingest room:
- Notes for the detail UI room:
- Candidate common rules:
- Remaining risks:
```

## 9. First Message For The Ingest Room

Use this only after at least one form room has completed its output.

```text
This room is for SEC ingest / integration.

First read docs/SEC_FORM_ROOM_RULES.md and
docs/SEC_INGEST_INTEGRATION_ROOM.md.

Use only completed form-room final handoffs and Required Output JSON as input.
Do not change individual parser logic.

This room handles DB, ingest, market context, feed, filings page, archive, and
alert wiring.

First state which form room will be integrated and which files may change.
Do not edit files yet.
```

## 10. First Message For The Detail UI Room

Use this only after a real special `display_payload` exists.

```text
This room is for SEC event detail UI.

First read docs/SEC_FORM_ROOM_RULES.md and
docs/SEC_EVENT_DETAIL_UI_ROOM.md.

Use completed form-room display_payload output and the ingest room's storage
format as input.

Do not touch parser, router, analysis prompt, ingest, DB, or alerts.

First state which display_type or candidate_special will be rendered and which
files may change.
Do not edit files yet.
```
