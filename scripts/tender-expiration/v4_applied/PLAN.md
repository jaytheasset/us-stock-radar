# Tender expiration v4 Applied extension canary

## Scope

One paid provider call only.

Target:
- Applied Therapeutics / Cycle Group tender offer
- SC TO-T/A
- accession `0001193125-26-026154`

Purpose: test the unchanged v3 minimal expiration contract on an explicit extension amendment.

Expected semantic source meaning for later independent review:
- current expiration: 2026-01-28
- previous expiration: 2026-01-27
- this filing explicitly announces an extension.

The expected values are not sent to Gemini.

## Fixed architecture

Reuse v3 exactly:
- same `gemini-2.5-flash`
- same system prompt
- same provider schema builder
- same short opaque Evidence refs
- same strict local validation
- same frozen ref → actual Evidence provenance lookup
- no wording/version/change/status fields
- no retry, repair, fallback, or second model

Source is the already frozen `extension` case in `scripts/tender-expiration/fixtures/inputs.json`. No new SEC fetch and no Selector expansion.

v1/v2/v3/v3_1 remain unchanged.

After the one call, stop. Do not run any other expiration case.
