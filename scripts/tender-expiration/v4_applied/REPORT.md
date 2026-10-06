# Tender expiration v4 Applied extension canary

**Result: STOPPED BEFORE SEMANTIC TEST — provider/model unavailable.**

## Intended test

One Applied Therapeutics SC TO-T/A filing:

- accession: `0001193125-26-026154`
- same v3 minimal expiration contract
- same short opaque Evidence refs
- same provenance mapping
- same requested model: `gemini-2.5-flash`
- exactly one physical provider call

The source package was sufficient for the intended extension test. Multiple selected SEC passages explicitly state:

- current expiration: January 28, 2026
- previous expiration: January 27, 2026
- the current filing announces an extension

These expected values were not sent to Gemini.

## Pre-call verification

- Applied fixture coverage: complete for this test, no partial/unavailable documents
- Evidence count: 9
- v3 provider prompt reused byte-for-byte
- v3 provider schema/boundary reused
- dynamic refs: E1–E9
- offline tests: 8/8 PASS
- frozen request verification: PASS
- prior v1/v2/v3/v3_1 files unchanged before the call
- physical calls before live execution: 0

Frozen request SHA256:
`282bb90461029b9012521dededfaa05ed6fcaf6b2bbbd282b46bc5c0b271914f`

Frozen mapping SHA256:
`66db959cae43e968b63a688534614ac7c6d2c2577223dc62db191954e656dd0b`

## Single provider call

Physical calls: **1**

Response:
- HTTP: **404**
- latency: 543 ms
- modelVersion: none
- finishReason: none
- usage/tokens: none
- Structured output: empty
- schema/local validation: not meaningfully reached
- provenance lookup: not run

Provider error:

> This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.

The raw provider response is preserved in `run/provider-response.txt`.

## Classification

This is **not**:

- SOURCE_COVERAGE
- MODEL_ERROR
- SCHEMA_ERROR
- SOURCE_UNRESOLVED

The request never reached a model generation.

Classification for this run:

**PROVIDER_MODEL_UNAVAILABLE**

No semantic conclusion can be drawn about Applied expiration extraction.

## Stop condition

No retry, repair, fallback, second model, or second request was executed.

The one-call run is frozen as-is. The `started.json` marker remains and must not be deleted or reused.

The next stage, if approved, must be a **new run identity** and explicitly decide the model/API migration. It must not overwrite or reinterpret this failed run.

No other expiration filing, FACT type, DB, Reader, Matcher, Monitor, Alert, merge, push, deploy, cron, or external send was performed.
