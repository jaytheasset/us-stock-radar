# Tender expiration v6b — Nano/Stratasys unchanged amendment / Gemini 3.5 Flash

**Final result: PASS.**

## Target

- Nano Dimension / Stratasys
- SC TO-T/A
- accession `0001213900-23-055698`
- model `gemini-3.5-flash`
- exactly one physical provider call

This is the corrected fresh run after v6 preflight failed offline because of stale copied test regex. v6 made zero provider calls and remains preserved separately.

## What this case tests

The amendment explicitly states that the offer Expiration Date **has not changed** and is still 5:00 p.m. New York time on July 24, 2023.

The same selected source also contains a separate Israeli-law additional four-calendar-day tender period until July 28, 2023. That later date is a distractor and is not the offer Expiration Date.

The minimal v3 contract has no change/unchanged field. Therefore the correct shape for this amendment is current only, with no fabricated previous value.

## Raw Structured output

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": "2023-07-24",
      "evidence_refs": ["E2", "E5", "E6", "E7", "E10"]
    }
  ],
  "unresolved": []
}
```

Raw output was not edited or repaired.

## Provider result

- HTTP 200
- finishReason STOP
- modelVersion `gemini-3.5-flash`
- physical calls: **1**
- latency: 2,085 ms
- prompt tokens: 3,609
- output tokens: 92
- total tokens: 3,701
- retry / repair / fallback / other model: 0

## Technical gates

| Gate | Result |
| --- | --- |
| Provider/schema | PASS |
| Local strict validation | PASS |
| Provenance mapping | PASS |
| Same-accession identity | PASS |

## SEC semantic review

- current = `2023-07-24` — PASS
- previous field absent — PASS
- `2023-07-28` not selected as current — PASS
- unresolved = [] — PASS

Selected refs:

- E2 — direct July 24 tender deadline; also contains the separate July 28 additional period
- E5 — cover explicitly states offer expiration July 24
- E6 — explicitly says expiration has not changed and is still July 24
- E7 — explicitly says expiration has not changed and is still July 24
- E10 — explicitly repeats unchanged July 24 expiration and tender deadline

Evidence-support gate:
- direct support for current: 5 refs
- unsupported: 0
- conflicting: 0
- unreviewed: 0

## Verdict

**Nano/Stratasys unchanged-amendment case PASS.**

Validated expiration behaviors so far:

1. initial scheduled expiration with no previous — Rumble
2. explicit extension with current + previous — Applied Therapeutics
3. amendment with explicitly unchanged expiration plus a competing later date — Nano/Stratasys

The overall expiration FACT is **not yet declared Practical PASS**. Other planned failure modes remain untested.

No additional filing was called.
