# Tender expiration v3.1 offline evidence-support reassessment

**Result: PASS under the revised evidence-support review policy. No provider call was made.**

## What changed

The frozen v3 run at `58542f30d799d8b02e80a2b9c9c2cb9c564c9656` remains unchanged and remains recorded as FAIL under its original criterion that every selected ref be standalone direct expiration evidence.

This v3.1 step changes only the **review criterion** for future FACT acceptance:

- each emitted claim must have at least one manually reviewed direct Evidence ref;
- relevant, non-conflicting corroborating refs may also be selected;
- irrelevant, conflicting, or unreviewed selected refs fail;
- if `previous` is emitted, it independently requires at least one direct ref.

This is an experiment/audit review gate. It is **not** a production Validator that infers SEC meaning, and it does not repair or filter model output.

## Frozen Rumble v3 output

```json
{"facts":[{"type":"expiration","current":"2025-02-04","evidence_refs":["E1","E2","E4","E5","E8","E12"]}],"unresolved":[]}
```

Manual direct-source review:

| Ref | Review |
| --- | --- |
| E1 | Direct — explicitly states February 4 expiration |
| E2 | Direct — explicitly states February 4 expiration; also contains April 30 extension ceiling |
| E4 | Direct — cover table explicitly states expiration |
| E5 | Corroborating — withdrawal-rights passage tied to February 4 deadline |
| E8 | Corroborating — withdrawal-rights passage tied to Expiration Time / February 4 |
| E12 | Direct — explicit Expiration Time definition |

Therefore the frozen model output contains four direct refs and two relevant corroborating refs. It contains no unreviewed, irrelevant, conflicting, foreign, or fabricated refs.

## Verification

- Offline evidence-support tests: **8/8 PASS**
- Frozen Rumble v3 reassessment: **PASS**
- v3 files unchanged from `58542f30`: **PASS**
- Full TypeScript check: **PASS**
- `git diff --check`: **PASS**
- Provider calls in this step: **0**

The evaluator explicitly tests that current and previous may use different direct refs. This was fixed during review before finalizing v3.1.

## Decision

The short opaque Evidence-ref architecture remains valid.

Rumble establishes:

- expiration semantic value extraction: PASS;
- short-ref provider/schema/local validation: PASS;
- ref → original Evidence provenance mapping: PASS;
- revised semantic evidence-support policy: PASS.

This does **not** make expiration FACT Practical PASS. Only the initial-filing case has been validated under this contract.

## Next step

The next paid experiment, only after approval, is one filing:

Applied Therapeutics, SC TO-T/A, accession `0001193125-26-026154`.

Purpose: verify that the same minimal contract extracts the explicit extension relationship:

- `previous = 2026-01-27`
- `current = 2026-01-28`

and selects at least one direct source ref for each emitted claim.

Do not run any other expiration case, FACT type, DB, Reader, Matcher, Monitor, Alert, merge, push, or deploy as part of this v3.1 step.
