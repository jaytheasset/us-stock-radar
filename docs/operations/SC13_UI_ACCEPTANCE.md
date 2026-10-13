# Schedule 13 monitor UI acceptance

Verified on 2026-10-14 in the isolated candidate workspace, based on `fd287c4bf34b0c63e3c2ed40d52a344b6595dc7f`. Runtime implementation commit: `8414f49606dcc3a67f7addb9af0ca8ce23496d05`.

## Scope

- `/monitor` offers a guided Schedule 13 builder alongside the existing builders. A stored ticker lookup or explicit SEC filing accession lookup supplies choices. The user must select and confirm the exact issuer, reporting person, security class and CUSIP.
- All six existing SC13 numeric conditions use decimal strings and apply to one reporting person/security. Changing a lookup or condition clears the prior confirmation. Saving uses the existing authenticated SC13 API.
- `/alerts` includes SC13 saved conditions and internal alerts in existing Custom alerts management. Immutable match values, thresholds, root/head/source accessions and reporting identity remain visible. Company names come from validated canonical filing metadata.
- SEC links require a validated canonical source with matching issuer, reporting person, class, CUSIP and exact accession directory. Missing source metadata does not replace or recalculate saved match evidence.
- The parser, canonical FACT storage, Matcher, activation/deduplication, natural-language compiler, other monitor families and legacy generic fallback are unchanged.

## Offline verification

- `npm run typecheck`: passed.
- `npm run build`: passed on final runtime source; build ID `9mUoq5GmwLFeABVSYRrGv`.
- 49 focused tests passed across SC13 consumer/automatic-trigger/display, ownership projection, and existing alerts/Form 4/monitor UI regression suites.
- Independent integration review ran 77 tests across 11 files successfully with the repository's existing TypeScript resolvers. An initial invocation without the required resolver had two module-loading failures; no product change was needed.
- Display tests cover exact decimals, malformed/cross-identity evidence, missing/ambiguous targets, unsafe or wrong-accession links, unavailable canonical reads, and source identity checks.

## Independent browser and isolated database verification

The integration reviewer performed these checks against candidate port 3152 and the isolated database. No production database was used.

- A normal owner login opened `/monitor`, looked up stored accession `0000947871-26-000814`, explicitly selected the reporting person/security, confirmed percent at least `17` and aggregate shares at least `12000000`, and saved successfully with HTTP 201.
- The existing ingestion path replayed the retained real SEC collection payload. It generated one new internal alert. The next replay generated zero new alerts and found the two existing alerts, including the previous backend acceptance alert.
- The new alert showed exact stored values `17.2%` and `12175159.00`, the actual SEC source URL and matching source SHA evidence. Existing canonical rows and prior alerts remained unchanged.
- Another existing account saw zero SC13 conditions and alerts with no owner data leakage. Anonymous `/monitor` controls were disabled and `/alerts` exposed no private data. API checks returned the expected 401, cross-origin 403 and invalid-input 422/400 responses.
- At 1440×900, 900×900 and 390×900, the affected pages had no horizontal overflow and no console warnings or errors.
- Of 172 public tables, 168 were unchanged. Expected changes were one SC13 monitor, one internal alert, two source runs and one raw-item row hash; that row's complete `raw_payload` remained identical. Temporary test guards blocked user-bootstrap writes while allowing normal authentication sessions.

## Remaining limits

- This was replay of a retained actual collector payload, not a fresh SEC collector run or a model/provider call.
- The positive browser journey used the accession lookup. A real positive ticker lookup was not established in this run. Actual Schedule 13G and amendment browser journeys were not exercised.
- The UI states latest reported values in complete stored history, not real-time ownership or SEC-global completeness. Alert reads retain the existing latest-100 SC13 limit.
- No natural-language SC13 compiler extension, monitor edit/delete API, financial-monitor work, or cover-sidecar repair was added. Cover persistence remains a separate test-guard issue.
- Production deployment, remote database/environment/cron state and paid external services were not tested or changed. Local main integration and production verification remain separate gates.

## Integration handoff state

The permanent main workspace stays on `main`; this candidate remains detached. Last supplied local main was `167dc47fc87c62f3140fd7264a91f9dea6f8d98b`. GitHub main was historically observed at `aef4d35221c9744c3a3f47518c492212f678e582`, and Vercel at `bf586ed559c7f4bea6a171790ab7b563cabc7161` (READY). Remote observations were not refreshed, and three-way code equality is unverified. No push or deployment occurred.

The integration workspace's pre-existing `next-env.d.ts` change was not touched. Supplied local main migration state was `20261013155644` with 145 ledger entries; isolated stage-1 objects were present without a migration ledger. No migration or environment-file change was made by this candidate task.
