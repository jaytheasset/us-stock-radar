# Tender expiration v3.1 — offline evidence-support gate

## Scope

No provider call. Preserve v1/v2/v3 byte-for-byte. Re-evaluate the frozen Rumble v3 raw output under a narrower evidence-support acceptance rule.

The production contract remains unchanged in this step. This is an experiment-only semantic review gate, not a Validator that infers SEC meaning.

## Revised acceptance rule

For each emitted semantic claim:

- at least one selected Evidence ref must be manually reviewed as **direct** support;
- additional selected refs may be **corroborating** when they concern the same filing/fact and do not conflict;
- any selected ref reviewed as **irrelevant** or **conflicting** fails the claim;
- an unreviewed selected ref fails closed;
- if `previous` is emitted, it independently requires at least one direct supporting ref;
- ref existence/provenance remains the v3 technical gate and is not reimplemented here.

The raw model response is never edited, filtered, or repaired. The gate only evaluates it.

## Rumble frozen case

Input/output source: v3 run at commit `58542f30d799d8b02e80a2b9c9c2cb9c564c9656`.

Expected semantic value remains `current=2025-02-04`, no `previous`.

Manual source review classifies the refs selected by the model:

- E1, E2, E4, E12: direct expiration support.
- E5, E8: corroborating withdrawal-rights passages tied to the same February 4 expiration, but not standalone expiration definitions.

No new SEC fetch, source expansion, LLM call, DB work, Monitor work, merge, push, or deploy.
