# SEC NT Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit either file from this room.

## Scope

This room covers only:

- `NT 10-K / NT 10-Q / NT 20-F`

Allowed working folder:

- `lib/sources/sec/forms/nt/`

## Work Flow

Build this form family in this order:

1. Parser
2. Router LLM prompt
3. Analysis LLM prompt
4. Fixture JSON tests

Some cases may finish deterministically in the parser or router when LLM is not
needed. If that happens, show it with a fixture.

Every final result must use one of the approved 15 event types from
`docs/SEC_FORM_ROOM_RULES.md`.

## Testing

Use fixture JSON only.

Fixture tests may include sample market context values, but they must not call
live FMP or any other live market-data API.

Do not use the live database for this room. Do not create a local DB for this
room. Use files only.

## Required Output JSON

Fixtures and expected outputs must use this shape so the SEC ingest/integration
room can map the result later without guessing.

```json
{
  "parser_output": {
    "parserVersion": "string",
    "parserGroup": "nt",
    "formType": "NT 10-K | NT 10-Q | NT 20-F",
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
    "data": {},
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

Use `display_payload.display_type = "candidate_special"` when the filing appears
to need a new detail UI that is not yet approved. Put the proposed display
fields in `display_payload.data` and explain the need in `fixture_expected` and
the final handoff. Do not build the UI in this room.

## Do Not Do

Do not edit anything outside:

- `lib/sources/sec/forms/nt/`

Do not edit common, ingest, DB, app, UI, alert, live market-context, or global
prompt files outside this form room.

Do not wire this parser into runtime ingest, write to live DB, call FMP live,
send alerts, build site UI, change the 15 event type list, add DB tables or
columns, or modify this handoff document.

If any of those changes seem necessary, stop and report the need in the final
handoff. This rule exists because other SEC form rooms may be working in
parallel; changing shared files from this room can create merge conflicts and
can overwrite another room's work.

## Required Reminders While Working

Before editing files, state the exact files that will be changed.

Before every commit, confirm:

- all changed files are inside `lib/sources/sec/forms/nt/`
- no live DB, FMP, ingest, alert, app, or UI files were changed
- tests use fixture JSON only

## Final Handoff

When done, report changed files, fixture cases tested, parser/router/analysis
outputs, deterministic cases, market context assumptions, integration needs, and
special UI needs.

Do not wire this room into the live site. The SEC ingest/integration room will
handle that later.
