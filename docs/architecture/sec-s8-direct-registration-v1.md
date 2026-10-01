# S-8 direct registration history v1

Implemented on local main from `67e84cbdefd23d98d506580b3af2cde6ea6aeded`,
as explicitly requested. This is structured filing-history support, not an S-8
secondary Monitor, issuance ledger, or current dilution calculation.

## Final product decision / freeze — 2026-10-01 KST

S-8 direct-registration v1 is frozen at
`2a7784efab3a7e8874ee054ca3743f7c0605c041`. Subsequent documentation does not
reopen the implementation. S-8 / S-8/A / S-8 POS remain a **separate canonical
registration-history dataset** for source-backed research and future AI
consumption; this does not claim a new public API or AI consumer is connected.

- Registered shares are not issued shares, sold shares, exercised awards,
  current plan reserve, or realized dilution. Parser estimates/heuristics are
  not canonical facts. Neither filing date nor a registration fee establishes
  an issuance date or dilution percentage.
- **Dilution Registry integration is intentionally deferred.** Its conversion,
  warrant, financing-capacity, option, award and reserve types have no existing
  contract meaning simply "shares registered in this S-8". `share_reserve` is
  not a registration balance; `registered_resale_shares` is not a generic plan
  registration field. Registry snapshots can distinguish potential quantities
  from actual issuance, but that does not establish S-8 compatibility.
- Registry's current stock reader is issuer-wide and its UI shows current
  instruments, remaining units and potential shares. Copying a registration
  amount there could misstate an outstanding balance. Registration withdrawal
  must not become award cancellation; an additional registration must not
  become an inferred incremental issuance or reserve increase.
- **S-8 secondary Monitor / alerts are intentionally deferred.** Registration
  alone has not established a reliable, user-actionable alert condition. No
  existing policy or Primary behavior is changed by this decision.
- Exact plan/security and parent/additional-registration relationships may
  remain unresolved. Preserve each filing, row and source independently.

The read-only Registry audit confirmed three stored S-8 filings with three
direct registration rows in total; all rows had `canonicalSecurityId: null`
and `planRelationships: "unresolved"`. Literal plan-name entries were empty;
the original plan disclosures remain preserved. These are dated local sample
observations, not a claim about complete SEC coverage. The real examples,
evidence location and validation limitations below remain the resume baseline.

Resume only for a concrete later product requirement: first establish exact
issuer/security class, plan/instrument and registration-scope links from SEC
evidence, including carryover/amendment relationships. A read-only evidence
link may then be considered; do not populate Registry quantity/status fields
from registration alone. Keep a registration-specific contract separate from
reserve/award/issuance semantics if a later capital-structure consumer needs it.
Do not create a duplicate registration dataset merely to fit Registry types.

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

Deferred work, only if explicitly requested: broaden direct table-format
support or resolve source-supported registration/plan linkage. These are not
prerequisites for closing v1. Do not add a Monitor or count registration as
actual dilution merely to consume this dataset.

## Next audit candidate: Proxy, not an implementation commitment

The historical [main roadmap](../operations/ASTRA_6_MAIN_HANDOFF.md#later-monitor-families)
lists Proxy before Merger and Tender. Its position alone is not the reason to
select it. The current code at the frozen S-8 commit provides a useful bounded
audit starting point:

- Collection already includes Proxy in `transaction_updates` through
  `lib/sources/sec/forms/common/forms.ts`. `fetchPlanRegistry.ts` registers
  `proxy/fetchPlan.ts`, including supplemental material; `formWorkerRegistry.ts`
  registers the Proxy parser/adapter. Forms include preliminary, definitive,
  supplemental and contested materials; use `SEC_PROXY_FORMS` for the exact set.
- `proxy/parser.ts` already represents document classes, meeting/record dates,
  proposals, sponsors, recommendations, plan/governance/transaction signals and
  source references. Extraction or a signal is not proof of approval/execution.
- `proxy/adapter.ts` is `analysis_only`; `proxy/analysisPrompt.ts` provides
  `sec_proxy_analysis`. Existing display validation/repair is in
  `lib/ai/secProxyAnalysisAdapter.ts`. Primary support is not secondary support.
- `genericMonitorChildWorkflowStarter.ts` does not admit Proxy sources;
  `genericMonitorChildExecution.ts` has no Proxy source/Primary authorization
  or dedicated Proxy analyzer contract. This confirms an automatic generic
  child gap, not the absence of every possible indirect consumer.
- Existing parser/analysis fixtures and `proxy/parser.real-sec.test.ts` cover
  real preliminary, supplemental and contested examples. They are inventory,
  not a new passing test or live secondary-E2E claim in this documentation task.

Proxy is therefore the next practical **read-only audit** candidate: there is
substantial reusable input/Primary infrastructure and a concrete automatic
secondary gap. The audit must decide whether narrow meeting/proposal lifecycle
facts merit a dedicated Monitor, or whether plan, capital-structure, corporate
action and merger facts should mainly feed their own structured domains.
Proposal, board recommendation, shareholder approval and completed execution
must remain distinct. Routine proxy publication is not automatically an alert.
Merger/Tender also have existing parsers/Primary code; no comparative benefit
or effort measurement establishes Proxy as an absolute priority. The historical
queue remains advisory. Do not reopen frozen Listing Status, NT, Ownership or
CUSIP/13F to implement this recommendation.

## Handoff environment

- Permanent root: `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch `main`.
- Local main product/freeze and documentation task-entry HEAD:
  `2a7784efab3a7e8874ee054ca3743f7c0605c041`. The later freeze/handoff commit is
  documentation-only and identifiable in Git history. Task entry was clean;
  only the requested architecture/handoff/index documentation is committed.
- GitHub main: cached `origin/main` is
  `9c13aee7ef41b38bac0637e53e579633745effda`, not fetched/reverified here.
  Deployed Vercel commit/status: unverified. No push/deployment approval,
  execution, or local/remote/deployed code-equality claim.
- Local migration application and prior tests are recorded above; remote DB
  state is unverified. This documentation task made no DB, account, environment,
  runtime, cron or external-service changes. No secrets are recorded here.
  Other task branches/worktrees and unmerged commits were not re-audited;
  do not assume they are absent. Existing servers/evidence are retained.
- This task checks documentation references, scope and `git diff --check` only;
  prior tests/typecheck/read-back evidence are reused, not rerun. No UI change
  or new browser/provider/product execution. The known unrelated Matcher
  static-test issue recorded in the NT handoff was not retested or relabeled
  as an S-8 failure. No S-8 integration blocker is claimed: Registry and Monitor
  connections are deliberate scope deferrals, not promised completed features.
- Existing runtime, credentials, other filing families and previous evidence
  are preserved. Only local test DB schema and the three scoped S-8 ingests
  were added; no data deletion, model run, Monitor or external notification.
