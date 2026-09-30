import { readSecTickerResolutionByDecisionId, type SecTickerResolutionRepository,
  type SecTickerResolutionReadResult } from "../sec-ticker-resolution/persistence.ts";
import { validDate, type DelistingScope } from "../sec-delisting-state/state.ts";
import { exact, hash, unattached, type Attachment } from "./observation.ts";
import { readStoredStableIdentity } from "../sec-ticker-resolution/stableIdentity.ts";
import { readExactCover, coverObservations, selectedSourceHasNoConflictingRevision } from "../sec-ticker-resolution/persistence.ts";
import { selectExactStableCoverRow } from "../sec-ticker-resolution/canonical.ts";

/** Reuse an existing validated SEC security-continuity identity. No new identity
 * registry, CIK-only match, ticker-catalog fallback, or human override is created. */
export function attachmentFromResolution(value: SecTickerResolutionReadResult, scope: DelistingScope): Attachment {
  if (value.status !== "available" || value.evaluation.resolutionState !== "AUTO" || !value.identity)
    return unattached("validated_security_identity_unavailable");
  const identity = value.identity;
  if (identity.issuer_cik !== scope.issuerCik) return unattached("security_identity_scope_mismatch");
  const before = value.sourceObservations.before.filter(o => o.resultId === identity.before_result_id
    && o.observationKey === identity.before_observation_key);
  const after = value.sourceObservations.after.filter(o => o.resultId === identity.after_result_id
    && o.observationKey === identity.after_observation_key);
  if (before.length !== 1 || after.length !== 1 || [...before, ...after].some(o =>
    o.issuerCik !== scope.issuerCik || exact(o.securityTitle) !== exact(scope.securityTitle)
    || exact(o.exchange) !== exact(scope.exchange) || !o.acceptedAt || !Number.isFinite(Date.parse(o.acceptedAt))))
    return unattached("security_identity_scope_mismatch");
  return { status: "attached", securityIdentityId: String(identity.id), decisionId: String(value.decision.id),
    knownAt: [...before, ...after].map(o => o.acceptedAt!).sort().at(-1)!,
    proofHash: hash({ identity, evidence: value.evidence, decision: value.decision }),
    reason: "validated_exact_sec_security_exchange" };
}

export async function resolveListingAttachment(scope: DelistingScope | null, repository: SecTickerResolutionRepository,
  filingDate?: string): Promise<Attachment> {
  if (!scope) return unattached("filing_security_scope_unavailable");
  const response = await repository.select("sec_ticker_resolution_decisions", {
    select: "id", issuer_cik: `eq.${scope.issuerCik}`, order: "created_at.asc,id.asc", limit: "101",
  });
  if (!response.ok || !Array.isArray(response.data)) throw Error("listing_identity_read_failed");
  if (response.data.length > 100) return unattached("identity_scan_incomplete");
  const matches: Attachment[] = [];
  for (const row of response.data) {
    const read = await readSecTickerResolutionByDecisionId({ decisionId: row.id, repository });
    if (read.status === "unavailable") return unattached("identity_evidence_unavailable");
    const candidate = attachmentFromResolution(read, scope);
    if (candidate.status === "attached") matches.push(candidate);
  }
  if (!matches.length) return filingDate ? resolveStableAttachment(scope, repository, filingDate)
    : unattached("no_exact_canonical_security_exchange");
  if (new Set(matches.map(m => m.securityIdentityId)).size !== 1) return unattached("multiple_security_identities", "conflict");
  return matches.sort((a, b) => a.decisionId!.localeCompare(b.decisionId!))[0];
}

/** Attachment is scoped to this filing, not a current ticker projection. Later
 * cover changes cannot rewrite history; earlier changes cannot be bridged here. */
async function resolveStableAttachment(scope: DelistingScope, repository: SecTickerResolutionRepository,
  filingDate: string): Promise<Attachment> {
  const r = await repository.select("sec_ticker_security_identities", { select: "*",
    issuer_cik: `eq.${scope.issuerCik}`, order: "created_at.asc,id.asc", limit: "101" });
  if (!r.ok || !Array.isArray(r.data)) throw Error("stable_identity_read_failed");
  if (r.data.length > 100) return unattached("identity_scan_incomplete");
  const matches: Attachment[] = [];
  for (const identity of r.data) {
    if (exact(identity.before_security_title) !== exact(scope.securityTitle)
      || exact(identity.after_security_title) !== exact(scope.securityTitle)) continue;
    // Changed-symbol identities belong exclusively to the existing AUTO path.
    if (identity.identity_payload?.before?.tradingSymbol !== identity.identity_payload?.after?.tradingSymbol) continue;
    const read = await readStoredStableIdentity(identity, repository);
    if (read.status !== "available") return unattached(read.reason, read.status === "conflict" ? "conflict" : "unresolved");
    if (exact(read.after.exchange) !== exact(scope.exchange) || read.after.acceptedAt!.slice(0, 10) > filingDate) continue;
    const scan = await repository.select("sec_cover_observation_results", { select: "*",
      issuer_cik: `eq.${scope.issuerCik}`, order: "accepted_at.asc,id.asc", limit: "1001" });
    if (!scan.ok || !Array.isArray(scan.data) || scan.data.length > 1000) return unattached("identity_scan_incomplete");
    for (const result of scan.data) {
      // A preserved filing date can bound a cover scan without inventing an
      // acceptance timestamp. Identity endpoints still require acceptedAt.
      let day = String(result.accepted_at ?? result.filing_date_raw ?? "").slice(0,10);
      if (!day && result.raw_item_id) {
        const original = await repository.select("raw_items",{select:"*",id:`eq.${result.raw_item_id}`,limit:"2"});
        if (!original.ok || !Array.isArray(original.data)) throw Error("identity_source_date_read_failed");
        if (original.data.length === 1 && original.data[0].source_code === "sec_edgar"
          && original.data[0].source_unique_id === result.accession_number)
          day = String(original.data[0].published_at ?? "").slice(0,10);
      }
      if (!validDate(day)) return unattached("identity_observation_time_missing");
      if (day < read.before.acceptedAt!.slice(0,10) || day > filingDate) continue;
      const cover = await readExactCover(result.accession_number, result.source_sha256, repository);
      if (!cover.ok) return unattached("identity_evidence_unavailable");
      if (!await selectedSourceHasNoConflictingRevision(cover.value, repository))
        return unattached("identity_source_revision_conflict", "conflict");
      const rows = coverObservations(cover.value);
      // Form 25's separate scope reader is authoritative for that filing. An
      // HTML Form 25 without an XBRL cover is not a competing cover identity.
      if (!rows.length && /^(25|25-NSE)(\/A)?$/.test(String(result.form_type_raw))) continue;
      const candidates = rows.filter(o => exact(o.securityTitle) === exact(scope.securityTitle));
      const selected = candidates.length === 1 ? selectExactStableCoverRow(rows,candidates[0].observationKey) : [];
      if (selected.length !== 1 || selected.some(o => o.issuerCik !== scope.issuerCik
        || !["observed", "duplicate_equal"].includes(o.securityTitleStatus)
        || !["observed", "duplicate_equal"].includes(o.exchangeStatus)
        || !["observed", "duplicate_equal"].includes(o.tradingSymbolStatus)
        || exact(o.securityTitle) !== exact(scope.securityTitle) || exact(o.exchange) !== exact(scope.exchange)
        || o.tradingSymbol !== read.after.tradingSymbol || hash(o.dimensions) !== hash(read.after.dimensions)))
        return unattached("stable_identity_transition_or_ambiguity_requires_change_evidence", "conflict");
    }
    matches.push({ status: "attached", securityIdentityId: String(read.identity.id), decisionId: null,
      knownAt: read.after.acceptedAt, proofHash: hash(read.identity), reason: "validated_stable_sec_security_exchange" });
  }
  if (!matches.length) return unattached("no_exact_canonical_security_exchange");
  if (new Set(matches.map(m => m.securityIdentityId)).size !== 1) return unattached("multiple_security_identities", "conflict");
  return matches[0];
}
