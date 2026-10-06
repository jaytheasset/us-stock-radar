# Tender expiration v6 — Nano/Stratasys unchanged amendment / Gemini 3.5 Flash

## Scope

One filing only:
- Nano Dimension / Stratasys
- SC TO-T/A
- accession 0001213900-23-055698
- model gemini-3.5-flash
- exactly one physical provider call maximum

Reuse the v3 system prompt, schema, opaque Evidence refs, local validator, and provenance boundary unchanged.

## Intended semantic test

The amendment explicitly says the offer Expiration Date **has not changed** and is still 5:00 p.m. New York time on July 24, 2023, unless further extended or earlier terminated.

The selected source also contains a separate Israeli-law additional four-calendar-day tender period until July 28, 2023. That is a distractor and must not become the current expiration.

Expected for independent post-call review only; do not send these expected values to Gemini:
- current = 2023-07-24
- previous field absent
- unresolved = []
- no use of 2023-07-28 as current

Because the schema intentionally has no change/unchanged field, the model should not emit one. The source statement that expiration was unchanged is represented by current only; do not fabricate previous=current.

No source expansion, retry, repair, fallback, second model, or second filing.
