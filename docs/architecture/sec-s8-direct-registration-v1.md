# S-8 direct registration history v1

Implemented on local main from `67e84cbdefd23d98d506580b3af2cde6ea6aeded`,
as explicitly requested. This is structured filing-history support, not an S-8
secondary Monitor, issuance ledger, or current dilution calculation.

## Product path

1. `lib/sources/sec/parser.ts` keeps the existing cleaned Primary inputs intact.
   For S-8, S-8/A and S-8 POS only, it additionally captures original fetched
   primary/attachment text in `raw_payload.s8_source`. Each document retains its
   SEC URL, type, description, original character count, truncation flag and
   SHA-256. Capture is bounded at 2 million characters per document.
2. `lib/secIngest.ts` invokes `persistS8Registration` after both new raw storage
   and existing-raw reuse. It reads the stored raw record, not caller-supplied
   analysis. Sidecar failure does not delete or discard raw evidence; the outcome
   is returned and retained in source-run metadata.
3. `lib/sec-s8/directFacts.ts` uses the existing S-8 parser as a candidate source,
   then independently checks direct fee facts against their exact original
   iXBRL nodes, context issuer, units and source document. Registration counts
   are decimal strings, avoiding integer precision loss.
4. `persist_sec_s8_registration` writes one immutable filing snapshot in
   `sec_s8_registration_filings`. The RPC checks the persisted raw identity and
   source bundle in the same transaction. Identical reruns return `replayed`;
   conflicting replacements fail instead of overwriting history.
5. `readS8Registration(accession)` verifies hashes and rebuilds all facts from
   the retained immutable source snapshot. A fabricated fact remains rejected
   even if someone recomputes its payload hash. Historical records do not depend
   on mutable fetch timestamps. `readS8RegistrationHistory(issuerCik)` reuses the
   same validating reader, exposes individual unavailable entries and explicitly
   marks its 100-filing limit rather than silently implying complete history.

## What is canonical, and what is not

- **Direct filing facts:** accession, issuer CIK, raw form type, filing/acceptance
  timestamps (not issuance dates), source-supported security title/class and
  per-context registered amount with original text, unit and exact evidence.
- **Plan information:** literal plan-name candidates only when the text can be
  located exactly; full source plan disclosures are also retained with offsets,
  document hashes and quotes. These disclosures are not interpreted as approval,
  current-plan status, allocation, grant or issuance events.
- **Registration references:** quoted file numbers remain unresolved references,
  not established parent links. S-8/A and S-8 POS retain amendment status. An
  additional registration can still be Form S-8; source disclosures preserve the
  distinction without inferring a delta or relabeling the form.
- A row's `direct` status means the disclosed fee-row amount is verified. It
  does **not** mean newly issued shares, new incremental supply, completion of
  sale or current shares outstanding. Never sum rows across filings as new
  registrations without resolving carryover/previous-registration scope.
- No total registered shares, inferred additional shares, dilution percentage,
  fee-derived live price, parent comparison, plan allocation or issuance date
  is promoted. Primary and its parser's heuristic fields remain unchanged.
- Exact canonical security attachment is intentionally unresolved. A literal
  security-class title is retained; issuer CIK/name alone does not establish a
  tradable security or current ticker.

## Intentionally limited extraction

Verified numeric registration rows currently require supported `ffd:` inline
XBRL, a unique matching issuer context, explicit shares unit, unscaled supported
dot-decimal serialization and an existing parser-confirmed class title.
Conflicting/repeated facts, ambiguous units, unsupported transformations,
continuations and truncated documents do not produce trusted numeric amounts.
HTML-only/plain-text fee tables are preserved as source but are not promoted by
this first direct-facts contract. Missing rows mean unavailable, never zero.
Source documents and plan disclosures remain available even in those cases.

There is no new linkage to Dilution Registry, Offering Monitor, generic
secondary Monitor, alerts or UI. Existing Registry instrument types were
reviewed but a plan registration is not an issued award or reserve balance.

## Real local validation

Normal `fetchSecEdgarRawItems` / `runSecRawIngest`, persistence and the official
reader were used, without Primary or model execution:

| Filing | Direct read-back | Safe exclusion |
|---|---|---|
| Firefly Neuroscience, S-8, `0001213900-26-059260`, 2026-05-20 | Common Stock: 556,343; 5 plan disclosures | No issuance/dilution inference |
| SentinelOne, S-8, `0001583708-25-000053`, 2025-03-26 | Class A: 16,278,955 and 3,255,791 in separate contexts; 14 plan disclosures | No aggregate or inferred plan-to-row mapping |
| Lottery.com, S-8 POS, `0001641172-25-017852`, 2025-07-03 | Amendment/source preserved; 2 plan disclosures; no verified registration rows | Existing parser's 500,000 heuristic is NOT promoted |

Each rerun returned `replayed`, left exactly one snapshot per accession and
produced identical official read-back. The three cases yielded no literal
plan-name entries under the narrow name verifier; the cited plan disclosures
carry the plan information without pretending the extractor resolved it.
S-8/A is covered by regression, not a separate live S-8/A case.
The existing cover-identity sidecar recorded `parse_failed`/zero observations
for these three S-8 covers and waited for an observation pair. This does not
invalidate the directly cited security-class text, but no canonical security
attachment or ticker-continuity success is claimed. That auxiliary parser was
not broadened in this task.

Evidence: `C:/Users/PC/.codex/visualizations/s8-direct-registration-20261001/`.
`runtime-report.json`, per-accession original/stored sources, ingest/rerun and
reader outputs preserve the actual results/hashes. Original SEC files stay
outside Git. The bounded runner is
`scripts/verify-s8-direct-registration-local.ts`; it pins the existing local
test DB target/system identifier and refuses an evidence path inside the repo.
It may add source-run/raw/S-8 records; it never calls Primary, Monitor or delivery.

## Migration, permissions and checks

Migration: `20261001101506_sec_s8_direct_registration_history.sql`.
Applied only to confirmed local main test DB `127.0.0.1:56322/postgres`, system
identifier `7678429483712069671`, through Supabase CLI `db push --db-url` after a
dry run identified this as the sole pending migration. No history repair.
RLS is enabled; anonymous/authenticated roles have no access. Server service-role
access is SELECT/INSERT only; no UPDATE/DELETE. The writer is SECURITY INVOKER,
with no new private-table or end-user permission grants.

Focused S-8/Primary-adapter/SEC-fetch regressions: 62 passed. Full TypeScript
check passed. Earlier attempts omitted the alias loader / used a relative
loader path; their module-resolution errors are preserved separately from the
successful absolute-loader run. No assertions were removed or weakened.

Next work, only if requested: broaden direct table-format support or resolve
source-supported registration/plan linkage. Do not add a Monitor or count
registration as actual dilution merely to consume this dataset.

## Handoff environment

- Permanent root: `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch `main`.
- Local base above; final implementation commit is recorded in Git history.
- GitHub main and deployed Vercel commit: not re-verified in this local-only
  task; no push/deployment or code-equality claim.
- Existing runtime, credentials, other filing families and previous evidence
  are preserved. Only local test DB schema and the three scoped S-8 ingests
  were added; no data deletion, model run, Monitor or external notification.
