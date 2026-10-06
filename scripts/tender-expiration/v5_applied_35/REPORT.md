# Tender expiration v5 — Applied extension / Gemini 3.5 Flash

**Final result: PASS for this Applied extension case.**

## Scope

One filing only:

- Applied Therapeutics / Cycle Group
- SC TO-T/A
- accession `0001193125-26-026154`

Model ceiling was set by the user to Gemini 3.5 Flash. This run used exactly:

`gemini-3.5-flash`

No Gemini 3.8 or higher model was used.

Previous v4 is preserved as a separate frozen failed run. It attempted `gemini-2.5-flash` and received HTTP 404 before generation. v5 uses a new run identity and changes the provider model only.

## Pre-call source coverage

The already prepared source fixture contains 9 Evidence slices and no partial/unavailable documents for this case.

Direct SEC text includes:

- extension of Expiration Time to one minute following 11:59 p.m. Eastern time on January 28, 2026;
- explicit statement that the Offer was previously scheduled to expire on January 27, 2026;
- amendment replacing January 27 references with January 28.

No source expansion, new SEC fetch, Selector change, Parser semantic value, Primary analysis, or prior Gemini result was used as model evidence.

## Frozen architecture

Same v3 contract and provenance boundary:

- minimal FACT output: type/current/optional previous/evidence_refs
- opaque E refs only
- long tender IDs and technical provenance kept outside provider input
- dynamic Evidence ref enum
- local YYYY-MM-DD validation
- frozen ref → actual Evidence identity lookup
- no repair or semantic normalization

The v3 system prompt was reused byte-for-byte.

Frozen request SHA256:
`282bb90461029b9012521dededfaa05ed6fcaf6b2bbbd282b46bc5c0b271914f`

Frozen mapping SHA256:
`66db959cae43e968b63a688534614ac7c6d2c2577223dc62db191954e656dd0b`

The request body hash is identical to the previous v4 Applied attempt; only the model endpoint/run identity changed.

## Provider call

Physical provider calls: **1**

- model: `gemini-3.5-flash`
- response modelVersion: `gemini-3.5-flash`
- HTTP: 200
- finishReason: STOP
- latency: 3,035 ms
- prompt tokens: 3,271
- output tokens: 90
- total tokens: 3,361
- retry: 0
- repair: 0
- fallback: 0
- other model calls: 0
- other filing calls: 0

## Raw Structured output

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": "2026-01-28",
      "previous": "2026-01-27",
      "evidence_refs": ["E1", "E2", "E5", "E6"]
    }
  ],
  "unresolved": []
}
```

The raw output was not edited, filtered, or repaired.

## Technical gates

| Gate | Result |
| --- | --- |
| Provider/schema | PASS |
| Local strict validation | PASS |
| Provenance mapping | PASS |
| HTTP/finish | PASS |
| Same-accession Evidence identity | PASS |

All four selected refs resolve through the frozen mapping to actual Evidence in accession `0001193125-26-026154`.

## SEC semantic review

Expected from direct selected SEC source, established before the call but not sent to the provider:

- current = `2026-01-28`
- previous = `2026-01-27`

Observed:

- current = `2026-01-28` — PASS
- previous = `2026-01-27` — PASS
- unresolved = [] — PASS

Evidence-support review:

| Ref | Support |
| --- | --- |
| E1 | Direct support for current and previous |
| E2 | Direct support for current and previous |
| E5 | Direct amendment/replacement support for current and previous |
| E6 | Direct support for current and previous |

No selected ref is unreviewed, irrelevant, unsupported, conflicting, foreign, or fabricated.

The source wording uses “one minute following 11:59 p.m.”; the contract intentionally preserves the source-named calendar date rather than rolling it to the next calendar day. The model followed that rule.

## Verdict

**Applied extension case PASS.**

This verifies a second expiration behavior beyond the Rumble initial-offer case:

1. initial scheduled expiration without previous — Rumble;
2. explicit amendment extension with current + previous — Applied.

This is still not enough by itself to declare the entire Tender expiration FACT Practical PASS. The remaining planned cases exercise other failure modes such as unchanged amendment, many competing dates, already-expired/final-results context, conditional timing, partial source, and not-established/pre-commencement.

No next case was executed.

## Verification

- v5 offline runner tests: 8/8 PASS
- semantic evidence-support gate: PASS
- previous v1/v2/v3/v3_1/v4 files unchanged: PASS
- TypeScript check: PASS
- git diff check: PASS
- one live v5 provider call only

No DB, persistence, Reader, Matcher, Monitor, Alert, other FACT, Parser semantic change, Main merge, push, deploy, cron, or external send.
