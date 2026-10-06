# Single-call transient contract v2: DXL only

Base: 04633a09b000cc69f389f0e1fb0e6ce15fcbcc5d, existing detached candidate.
Purpose of the sole authorized physical call: test whether five mandatory slots and explicit previous decisions retain the source-supported prior expiration missed by v1 while preserving other judgments. Target 0001193125-26-298540 only; model gemini-3.5-flash. Stop after this call and review, even on PASS. No retry, repair, fallback, second filing, source retrieval/expansion, product changes or integration.

## Contract and representation decision before call

Five required object|null slots plus required unresolved:string[]. The three historical slots require current, previous:value|null, current_evidence_refs and previous_evidence_refs. Null previous requires empty previous refs; nonnull previous requires nonempty refs. This correspondence and per-array uniqueness are **local structural refinements**, not provider JSON Schema claims. Current refs are nonempty in both provider and local schemas. Ref enum comes only from unchanged source inventory. Sharing a ref across current and previous is valid; duplication within either array is not.

Use basic nullable type arrays, required/properties/additionalProperties, enum, minItems. No conditional schema, nested union proliferation or unsupported uniqueItems dependency. Board previous enum explicitly includes null. This keeps the provider representation simple while making previous presence mandatory. Validators reject/report only; no semantic correction.

[Google GenerateContent structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en), inspected 2026-10-06: JSON Schema subset documents nullable type arrays, required object properties, additionalProperties, enum, minItems/maxItems; model table includes Gemini 3.5 Flash. Its newer example model names are not used. Repo precedent: lib/ai/secRequiredOutputSchema.ts uses nullable string/object type arrays; v1 union and terminal experiments succeeded with strict required properties, ref enums and true-only boolean enum. The NEW combined nullable v2 schema is not yet live-validated at this preflight stage; only the one authorized DXL response can establish its live acceptance.

Canonical projection: drop null slots; attach type; copy values exactly; omit previous only when null; union/dedupe model-selected current/previous refs; copy unresolved. Existing canonical validators remain unchanged. Projection has no source or expected-baseline parameter. Incorrect well-shaped values must stay incorrect and be reported by review.

## Freeze, costs and termination

Reuse byte-for-byte v1 source.json, provider-source.json, evidence-map.json, preserving all 18 units and ordering. Verify SHA256 against v1 frozen.json and exact Buffer equality. Freeze generic prompt/schema/full request, separate baseline, runner/test code hashes, sizes and unique run ID before any network call. Provider request builder never receives baseline; exact request reconstruction plus unchanged source text and non-source leakage checks gate execution. Source itself necessarily contains the expected dates/prices; that is source evidence, not baseline leakage.

Offline tests must pass all 17 user gates, including malformed/foreign/duplicate ref rejection, required previous, null projection, value preservation, map tampering and one-fetch retry protection. Freeze offline output/hash. Only then reserve started.json exclusively before one fetch; reuse of that run fails closed, including after timeout, HTTP error or invalid output. CLI accepts no case/model selector and no alternate run directory. HTTP error, malformed shape, provenance failure or semantic mismatch => classify and STOP. PASS => STOP also.

Pre-call frozen baseline is baseline.json. DXL PASS requires all five slot judgments, prior values, empty unresolved, directly supporting refs, schema/local/provenance/projection PASS and zero semantic repairs. Review each returned ref against original source. Keep v1 DXL MODEL_ERROR unchanged. A one-case PASS cannot establish general v2 reliability or causally isolate schema from prompt/stochastic effects.

## Verification commands

Run with node --no-warnings --experimental-strip-types:

- --test scripts/tender-union-v2-dxl/contract.test.mjs (offline only)
- scripts/tender-union-v2-dxl/run.mjs freeze
- scripts/tender-union-v2-dxl/run.mjs preflight
- scripts/tender-union-v2-dxl/run.mjs live --env-file <existing local credential file> (sole allowed call; never repeat)
- scripts/tender-union-v2-dxl/run.mjs verify (offline, safe after completion)

All artifacts exclusive-write. Credentials read in memory only, never copied or printed. Final local commit includes this directory only. No DB, persistence, Reader, Monitor, Matcher, Alert, UI, cron, merge, push or deploy.
