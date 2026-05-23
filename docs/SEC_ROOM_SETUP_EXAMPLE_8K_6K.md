# SEC Room Setup Example: 8-K / 6-K

This is a concrete setup example for one parallel Codex room.

Room scope:

- `8-K / 6-K, 8-K/A / 6-K/A`

Handoff MD:

- `docs/SEC_8K_6K_ROOM.md`

Allowed work folder:

- `lib/sources/sec/forms/8k-6k/`

Approved event types:

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

Branch:

- `sec/8k-6k`

Worktree folder:

- `C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-8k-6k`

## 1. Create The Worktree

Run this from the main project folder.

```powershell
cd "C:\Users\PC\Documents\Codex\US-Stock Radar"
git status --short
```

Only continue if `git status --short` prints nothing.

```powershell
git worktree add "..\US-Stock-Radar-sec-8k-6k" -b sec/8k-6k
cd "..\US-Stock-Radar-sec-8k-6k"
git status --short
```

Open the new Codex room using this folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-8k-6k
```

Do not open this 8-K / 6-K room in the original folder:

```text
C:\Users\PC\Documents\Codex\US-Stock Radar
```

## 2. First Message To Paste Into The New Codex Room

Paste this as the first message.

```text
This room is for SEC 8-K / 6-K, 8-K/A / 6-K/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_8K_6K_ROOM.md
- lib/sources/sec/forms/8k-6k/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/8k-6k/.
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

## 3. Start-Work Approval Message

If the plan looks correct, paste this.

```text
Proceed.

Before editing, state the exact files you will change.
Only edit files inside lib/sources/sec/forms/8k-6k/.
Use fixture JSON only for tests.

If you find a need for common rules, market context, ingest wiring, or special
detail UI, do not implement it. Record it in the final handoff.

Other SEC form rooms are working in parallel. Touching common, DB, UI, ingest,
alerts, live FMP, or live DB from this room can create conflicts.
```

## 4. Reminder Message

Paste this if the room starts drifting.

```text
Reminder: this room only works inside lib/sources/sec/forms/8k-6k/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.
If something outside the folder is needed, do not implement it. Record it in
the final handoff.
```

## 5. Before Commit Check

Before the 8-K / 6-K room commits, paste this.

```text
Before committing, show git status and confirm that every changed file is
inside lib/sources/sec/forms/8k-6k/.

If handoff MD files, common, ingest, DB, app/UI, or alerts are changed, stop and
do not commit.
```

Expected clean commit scope:

```text
lib/sources/sec/forms/8k-6k/*
```

Unexpected files that should stop the commit:

```text
docs/*
lib/sources/sec/forms/common/*
lib/secIngest.ts
lib/secFilingAnalysisIngest.ts
docs/db/*
app/*
```

## 6. Final Handoff Expected From This Room

Ask the room to finish with this report.

```text
Final handoff:

- Scope: 8-K / 6-K, 8-K/A / 6-K/A
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

## 7. If The Worktree Already Exists

Do not create a second worktree with the same branch name.

Use the existing folder:

```powershell
cd "C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-8k-6k"
git status --short
```

If it has uncommitted files from an old attempt, inspect them before starting.
Do not delete or overwrite them blindly.
