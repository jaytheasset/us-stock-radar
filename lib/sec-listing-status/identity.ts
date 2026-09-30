import { readSecTickerResolutionByDecisionId, type SecTickerResolutionRepository,
  type SecTickerResolutionReadResult } from "../sec-ticker-resolution/persistence.ts";
import type { DelistingScope } from "../sec-delisting-state/state.ts";
import { exact, hash, unattached, type Attachment } from "./observation.ts";

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

export async function resolveListingAttachment(scope: DelistingScope | null, repository: SecTickerResolutionRepository): Promise<Attachment> {
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
  if (!matches.length) return unattached("no_exact_canonical_security_exchange");
  if (new Set(matches.map(m => m.securityIdentityId)).size !== 1) return unattached("multiple_security_identities", "conflict");
  return matches.sort((a, b) => a.decisionId!.localeCompare(b.decisionId!))[0];
}
