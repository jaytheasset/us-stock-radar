# Stock Split Effective-Date Semantic Role Binding V1

## Scope and result

This candidate changes only the Corporate Action Stock Split calculation-date
contract. The calculation effective date is now the date on which outstanding
common shares change to the post-split basis. It does not change O/S arithmetic,
the Stock Split Normalizer, anchor reconciliation, provider settings, UI, or
scheduling.

The analyzer remains one Corporate Action Level 2 provider call. There is no
verifier, repair, evidence-only provider, regex semantic classifier, nearby-date
heuristic, exchange calendar, or clock-time inference.

## Confirmed COSM root cause

The cached production source for accession `0001477932-22-009368` contains
different dates with different semantic roles.

- The persisted V3 provider-selected calculation date was `2022-12-15`. Its
  exact evidence describes a Certificate/Articles amendment and name change
  becoming effective, not the outstanding shares changing basis. The retained
  identity is source ref `secblk_item_section_5nbtvu`, range `981..1259`, and
  SHA-256
  `5db8c60fe64cd6099506567a0b1c84b882fc860b92bd6c81fbbad74f40c07028`.
  Its date-only timing identity is range `1194..1258` with SHA-256
  `1831c06f8b5f96866c28cb407bd932c68a550eb7033d2f2a4dbb10fe4b9a4877`.
- The split-effective clause states a 1-for-25 reverse split effective at the
  opening of business on `2022-12-16`. The accepted V4 calculation-date
  identity is source ref `secblk_source_document_section_f2541j`, range
  `473..625`, and SHA-256
  `d4d7622caa9d5fa6ae69ae35a63996c27e553b1b9f0492b8c89821e89007d1c6`.
  Its `business_day_open` timing identity is range `552..625` with SHA-256
  `e7354a474e3b0a1ffaae0db5ba7d076e56bd96599a5ec9c3ef0d2039f6c3aecb`.
- The same source document also retains the board-approval clause for
  `2022-12-15`: range `702..883`, SHA-256
  `42d63b59918536271fff6047abd2d76688f0726fe21f57a42f2aee91b27fac6f`.

The Generic Monitor persistence path does not retain the raw Gemini response
body. It retains the validated canonical payload and execution metadata. The
V3 selection above therefore comes from the actual persisted validated
provider fields, while the raw response body itself is unavailable by design.
The old validator proved the evidence was exact, but it had no field that said
which event the date represented. That is why exact legal-amendment evidence
could be promoted as the calculation date.

## Minimal V4 contract

The current analyzer contract is
`corporate_action_stock_split_day_basis_evidence_v4`. An available
`effective_date` must include one LLM-selected `calculation_basis`:

- `split_effective`
- `shares_reclassified`
- `split_adjusted_trading`

The effective-date evidence must remain a contiguous exact source span and its
existing source ref/range/hash/exact-source identity remains authoritative.
The 800-character value remains only a display preview. Deterministic code
validates identity and enum shape; it does not infer the semantic role.

An approval, announcement, filing, certificate, amendment, or legal date is
ineligible unless the source explicitly binds that date to the outstanding
shares becoming combined, reclassified, or post-split. If multiple dates
cannot be assigned safely, `effective_date` is unavailable and calculation
activation is `INDETERMINATE`, so no confident execution materializes.

Existing V3 and V1 rows remain readable only when no V4 attempt exists. A
pending, failed, incomplete, or invalid current V4 result blocks older success;
it never falls back through the current-lineage safety boundary.

## Actual local acceptance

The one allowed COSM V4 production child call completed and persisted:

- reverse split `25 -> 1`
- effective date `2022-12-16`
- calculation basis `split_effective`
- source meaning `business_day_open`
- activation `ON_EFFECTIVE_DATE`
- timestamp `null`
- current V4 fact/result `1/1`
- active/inactive/conflict `1/0/0`
- `2022-12-15`: `NOT_APPLIED`
- `2022-12-16`: `APPLIED` exactly once
- duplicate replay provider calls `0`

The child execution ran from `13:59:45.734Z` to `13:59:50.143Z`, or `4,409 ms`.
It made one provider call; verifier, repair, and evidence-only second calls were
all zero. The legacy harness still counts all preserved V1+V3+V4 rows as `3/3`.
That already-known contract-aggregation harness gap is intentionally not
changed by this product candidate.

Read-only production-reader regressions made no provider calls:

- NVDA: V3 current row, forward `1 -> 10`, `2024-06-07`,
  `AFTER_MARKET_CLOSE`, active/conflict `1/0`; official reconciliation
  `2,460,000,000 -> 24,600,000,000 -> 24,530,000,000`, net `-70,000,000`,
  `-35/123%` (`-0.284552845528%`).
- BINI: V3 current row, reverse `25 -> 1`, `2023-05-04`,
  `ON_EFFECTIVE_DATE`, active/conflict `1/0`; official reconciliation start
  `1,747,209,236/25`, end `172,510,340`, net `2,565,549,264/25`, and
  `64,138,731,600/436,802,309%` (`146.836979288953%`).
- GWAV: existing V1 fallback row, reverse `300 -> 1`, `2022-02-28`, active and
  conflict-free.

## Database and verification

Migration
`20260826135027_stock_split_effective_date_semantic_role_binding_v1.sql`
extends only the existing definer persistence/reader functions. It adds no
table or column and changes no O/S arithmetic. It was applied only to local
Supabase after `20260823023000`; remote Supabase was not written. The official
Supabase changelog was checked before DB work and no relevant breaking change
was found.

Verification completed:

- focused Corporate Action, evidence, semantic-date, execution,
  materialization, normalizer, reconciliation, and issuer-total unit suites
- Corporate Action Monitor/Alert, SEC structured-data, and O/S collector suites
- historical replay migration and contract-aware gate suites
- Corporate Action pgTAP: `52` tests
- DB lint, TypeScript, strict workflow validation, and production build
- diff, conflict, secret, generated/large-file, and scope scans

No Full O/S Live Validation or Dilution/Potential Shares workflow was started.
