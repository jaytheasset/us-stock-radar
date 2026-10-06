# Tender expiration v5 — Applied extension with Gemini 3.5 Flash

## Scope

Previous v4 attempted the same frozen Applied case with gemini-2.5-flash and received HTTP 404 before generation because that model was unavailable for the current API account. Preserve that run unchanged.

This run changes exactly one experiment variable: provider model.

- target: Applied Therapeutics / Cycle Group SC TO-T/A
- accession: 0001193125-26-026154
- model: gemini-3.5-flash
- one physical provider call maximum
- same v3 system prompt
- same v3 minimal FACT schema
- same short opaque ref projection and provenance boundary
- same already-prepared source fixture
- no source expansion
- no retry, repair, fallback, or second model

The user-set model ceiling is Gemini 3.5 Flash. Do not use Gemini 3.8 or any higher model.

Expected values for independent post-call source review, never sent to the model:
- current: 2026-01-28
- previous: 2026-01-27

Stop after this one filing regardless of PASS/FAIL.
