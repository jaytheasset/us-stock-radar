# SEC EFFECT Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit either file from this room.

## Scope

This room covers only:

- `EFFECT`

Allowed working folder:

- `lib/sources/sec/forms/effect/`

## Work Flow

Build this form family in this order:

1. Parser
2. Router LLM prompt if needed
3. Analysis LLM prompt if needed
4. Fixture JSON tests

EFFECT can often finish deterministically because it usually means a related
registration filing became effective. If LLM is not needed, show that with a
fixture.

Every final result must use one of the approved 15 event types from
`docs/SEC_FORM_ROOM_RULES.md`.

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

## Testing

Use fixture JSON for parser and prompt unit tests.

For live site verification, run `npm run sec:live-test` from this form-room project. That bridge syncs only this form folder into the integration worktree, then runs real SEC ingest, DB persistence, site routing, and alert delivery through the integration runtime.

Fixture tests may include sample parent filing context, but they must not query
the live DB.

Do not use the live database directly from parser, prompt, or unit-test code. Live DB writes are allowed only through `npm run sec:live-test`, which delegates to the integration runtime.

## Required Output JSON

Fixtures and expected outputs must use this shape so the SEC ingest/integration
room can map the result later without guessing.

```json
{
  "parser_output": {
    "parserVersion": "string",
    "parserGroup": "effect",
    "formType": "EFFECT",
    "accessionNumber": "string | null",
    "isSupported": true,
    "summary": "string | null",
    "facts": {},
    "signals": [],
    "calendarItems": [],
    "warnings": [],
    "raw": {}
  },
  "analysis_output": {
    "source_group": "filings",
    "market_scope": "company | sector | theme | macro",
    "event_type": "one of the approved 15 event types",
    "event_title": "string",
    "primary_ticker": { "ticker": "string | null", "exchange": "string | null" },
    "tickers": [],
    "sector": "string | null",
    "industry_group": "string | null",
    "theme_group": "string | null",
    "sub_theme": "string | null",
    "score": 0,
    "score_reason": "string",
    "signal": "bullish | bearish | volatile | neutral",
    "quick_take": "string",
    "summary": "string",
    "why_it_matters": "string",
    "bullish_points": [],
    "bearish_points": [],
    "key_evidence": [],
    "what_to_watch_next": [],
    "related_tickers": [],
    "calendar_items": [],
    "confidence": "high | medium | low",
    "needs_human_review": false
  },
  "display_payload": {
    "display_type": "generic | offering_terms | candidate_special",
    "data": {
      "effective_filing_form": "string | null",
      "effective_registration_reference": "string | null",
      "effective_date": "YYYY-MM-DD | null",
      "original_filing_reference": "string | null"
    },
    "evidence": [],
    "notes": []
  },
  "fixture_expected": {
    "expected_delivery_level": "archive | feed | alert",
    "expected_impact": "low | medium | high",
    "market_context_needed": false,
    "market_context_reason": "string | null",
    "market_context_fields": [],
    "special_ui_needed": false,
    "special_ui_reason": "string | null",
    "integration_notes": []
  }
}
```

`delivery_level` is not a free-form model output. It is derived from `score`:
below 50 is `archive`, 50 to 74 is `feed`, and 75 or above is `alert`.

Use `display_payload` to show which registration filing became effective. The
integration room will later link this EFFECT filing to the original analyzed
registration filing. Do not query the live DB or build UI in this room.

## Do Not Do

Do not edit anything outside:

- `lib/sources/sec/forms/effect/`

Do not edit common, ingest, DB, app, UI, alert, live market-context, or global
prompt files outside this form room.

Do not manually wire this parser into runtime ingest, write direct DB code, call FMP live from parser tests, send alerts directly, build site UI, change the 15 event type list, add DB tables or columns, or modify this handoff document. The only approved live DB/site/alert path from this room is `npm run sec:live-test`.

If any of those changes seem necessary, stop and report the need in the final
handoff. This rule exists because other SEC form rooms may be working in
parallel; changing shared files from this room can create merge conflicts and
can overwrite another room's work.

## Required Reminders While Working

Before editing files, state the exact files that will be changed.

Before every commit, confirm:

- all changed files are inside `lib/sources/sec/forms/effect/`
- no shared ingest, DB, FMP, alert, app, or UI files were manually changed
- unit tests use fixture JSON; live site tests use `npm run sec:live-test`

## Final Handoff

When done, report changed files, fixture cases tested, parser/router/analysis
outputs, deterministic cases, parent filing assumptions, integration needs, and
special UI needs.

Do not manually wire this room into the live site. Use `npm run sec:live-test`
for live site verification through the integration runtime. EFFECT parent-link
issues should still be reported in the final handoff.
