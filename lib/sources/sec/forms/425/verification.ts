import { createHash } from "node:crypto";
import { normalizeCik } from "../../../../sec-structured-data/normalization.ts";
import { normalizeMainSubmissions } from "../../../../sec-structured-data/mainSubmissions.ts";
import type { SecStructuredSourceDocument } from "../../../../sec-structured-data/types.ts";

export type VerificationBlock = { block_id: string; text: string; heading?: string | null };
export type VerificationProof = { block_id: string; source_field: "text" | "heading"; quote: string };
export type IdentityClaim = { key: string; name: string | null; ticker: string | null; exchange: string | null };
/** Server-owned evidence, never fields accepted from the model response. No fetch or DB here. */
export type Sec425IdentityEvidence = {
  bindings: { claim: IdentityClaim; cik: string; blocksHash: string; evidence: VerificationProof[];
    indexRole?: { indexSha256: string; role: "filed_by" | "subject_company" } }[];
  submissions: { document: SecStructuredSourceDocument; contentHash: string; confirmedAt: string }[];
  index?: { sourceUrl: string; accession: string; indexSha256: string;
    roles: { role: "filed_by" | "subject_company"; cik: string; companyName: string; sourceText: string }[] };
};
export const sec425BlocksHash = (blocks: readonly VerificationBlock[]) => createHash("sha256")
  .update(JSON.stringify(blocks.map(b => [b.block_id, b.heading ?? null, b.text]))).digest("hex");
function exactProof(p: VerificationProof, blocks: readonly VerificationBlock[]) {
  const matches = blocks.filter(b => b.block_id === p?.block_id);
  const field = matches.length === 1 && (p.source_field === "text" || p.source_field === "heading") ? matches[0][p.source_field] : null;
  return typeof p?.quote === "string" && !!p.quote && typeof field === "string" && field.includes(p.quote) && field.indexOf(p.quote) === field.lastIndexOf(p.quote);
}

export function inspectSec425Identity(claim: IdentityClaim, blocks: readonly VerificationBlock[], context?: Sec425IdentityEvidence) {
  const base = { claim: structuredClone(claim), verifiedCik: null as string | null,
    verifiedTicker: null as string | null, verifiedExchange: null as string | null,
    mapping: null as null | { sourceUrl: string; contentHash: string; fetchedAt: string; confirmedAt: string },
    historicalTickerVerified: false as const, transactionRoleVerified: false as const };
  const fail = (reason: string, conflict = false) => ({ ...base, status: conflict ? "conflict" as const : "unresolved" as const, reason });
  if (!claim.name) return fail("party_name_missing");
  if (!context) return fail("official_party_cik_and_mapping_missing");
  try {
    const bindings = context.bindings.filter(b => b.claim.key === claim.key);
    if (bindings.length !== 1) return fail("exact_party_binding_missing_or_ambiguous");
    const binding = bindings[0], cik = normalizeCik(binding.cik);
    if ((["key", "name", "ticker", "exchange"] as const).some(key => binding.claim[key] !== claim[key]) || binding.blocksHash !== sec425BlocksHash(blocks)) return fail("party_binding_changed", true);
    // A free-form multi-company quote is NOT a name/CIK binding. Accept an exact
    // literal identity label or the existing SEC index's explicitly separated role.
    const literalBinding = binding.evidence.length > 0 && binding.evidence.every(p => exactProof(p, blocks)) &&
      binding.evidence.some(p => p.quote === `${claim.name} CIK ${cik}`);
    const index = context.index, role = binding.indexRole;
    const roleRows = index && role ? index.roles.filter(r => r.role === role.role && r.companyName === claim.name) : [];
    const indexBinding = index && role && /^\d{10}-\d{2}-\d{6}$/.test(index.accession) &&
      new URL(index.sourceUrl).origin === "https://www.sec.gov" && new URL(index.sourceUrl).pathname.startsWith("/Archives/edgar/data/") &&
      !new URL(index.sourceUrl).search && !new URL(index.sourceUrl).hash && new URL(index.sourceUrl).pathname.includes(`/${index.accession.replaceAll("-", "")}/`) &&
      /^[a-f0-9]{64}$/.test(index.indexSha256) && index.indexSha256 === role.indexSha256 &&
      roleRows.length === 1 && normalizeCik(roleRows[0].cik) === cik;
    if (!literalBinding && !indexBinding) return fail("party_cik_source_binding_missing");
    base.verifiedCik = cik;
    if (!claim.ticker) return fail("company_identified_ticker_not_claimed");
    const matching = context.submissions.filter(s => normalizeCik(s.document.cik) === cik);
    if (matching.length !== 1) return fail("official_submissions_missing_or_ambiguous");
    const snapshot = matching[0];
    const batch = normalizeMainSubmissions([snapshot.document], cik, snapshot.document.fetchedAt);
    const raw = batch.rawSources[0];
    if (raw.contentHash !== snapshot.contentHash || !Number.isFinite(Date.parse(snapshot.confirmedAt)) ||
        !Number.isFinite(Date.parse(raw.fetchedAt)) || Date.parse(snapshot.confirmedAt) < Date.parse(raw.fetchedAt)) return fail("official_snapshot_integrity_failed", true);
    const rows = batch.tickerObservations.filter(r => r.issuerCik === cik && r.ticker === claim.ticker);
    if (rows.length !== 1 || (claim.exchange !== null && claim.exchange !== rows[0].exchange)) return fail("official_mapping_disagrees_at_observation_time", true);
    return { ...base, status: "corroborated" as const, reason: "exact_cik_and_ticker_at_observation_time",
      verifiedCik: cik, verifiedTicker: claim.ticker, verifiedExchange: claim.exchange,
      mapping: { sourceUrl: raw.sourceUrl, contentHash: raw.contentHash, fetchedAt: raw.fetchedAt, confirmedAt: snapshot.confirmedAt } };
  } catch { return fail("official_evidence_invalid", true); }
}

/** Preserve the existing production parser's SEC catalog positive path, scoped to filing identity.
 * This reads repository-built package provenance, not the model's object or a new lookup. */
export function inspectSec425FilingTicker(claim: IdentityClaim, filing: Record<string, unknown>, blocks: readonly VerificationBlock[], context?: Sec425IdentityEvidence) {
  const checked = inspectSec425Identity(claim, blocks, context);
  if (context || checked.status === "corroborated") return checked;
  const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const provenance = record(filing.sec425_identity_provenance), resolution = record(provenance.tickerResolution), ticker = record(filing.primary_ticker), row = record(resolution.sec_catalog_row);
  try {
    const cik = normalizeCik(filing.cik), accession = String(filing.accession_number ?? ""), url = new URL(String(filing.filing_detail_url ?? ""));
    if (filing.form_type !== "425" || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || url.origin !== "https://www.sec.gov" ||
      !url.pathname.startsWith("/Archives/edgar/data/") || !url.pathname.includes(`/${accession.replaceAll("-", "")}/`) ||
      normalizeCik(url.pathname.split("/")[4]) !== cik || url.search || url.hash ||
      resolution.source !== "accession_cik_sec" || resolution.confidence !== "high" ||
      resolution.sec_catalog_source !== "https://www.sec.gov/files/company_tickers_exchange.json" || normalizeCik(row.cik) !== cik ||
      row.ticker !== ticker.ticker || row.exchange !== ticker.exchange || typeof row.name !== "string") return checked;
    if (row.name !== claim.name || claim.name !== filing.company_name || !claim.ticker || claim.ticker !== ticker.ticker ||
      (claim.exchange !== null && claim.exchange !== ticker.exchange)) return { ...checked, status: "conflict" as const, reason: "claim_disagrees_with_exact_sec_catalog_filing_row" };
    return { ...checked, status: "corroborated" as const, reason: "existing_sec_catalog_filing_identity_only",
      verifiedCik: cik, verifiedTicker: claim.ticker, verifiedExchange: claim.exchange,
      observedAt: typeof provenance.observedAt === "string" ? provenance.observedAt : null,
      catalogConfirmedAt: null, filingRoleProvenance: provenance.filingRoles ?? null };
  } catch { return checked; }
}

export type Sec425ActionContext = {
  disclosure_context: "current_announcement" | "prior_background" | "unclear";
  action_date_literal: string | null;
  action_evidence: VerificationProof[];
  context_evidence: VerificationProof[];
};
/** Contradiction guard, NOT a semantic classifier. Never reclassifies a raw decision or repairs a quote. */
export function inspectSec425Currentness(input: {
  decision: unknown; announcementType: unknown; evidence: unknown; actionContext?: Sec425ActionContext;
}, blocks: readonly VerificationBlock[]) {
  const result = (status: "not_applicable" | "unresolved" | "conflict" | "supported_claim", reasons: string[]) =>
    ({ status, reasons, semanticAccuracy: "unverified" as const, confirmedForConsumption: false as const });
  if (input.decision === "not_applicable") return result("not_applicable", []);
  if (input.decision !== "confirmed") return result("unresolved", ["announcement_not_confirmed"]);
  const context = input.actionContext;
  const evidence = context && Array.isArray(context.action_evidence) ? context.action_evidence : Array.isArray(input.evidence) ? input.evidence : [];
  // A quoted passage cannot discard its explicit historical lead-in. Scoped to the
  // cited paragraph, never an unrelated prior agreement elsewhere in the filing.
  if (input.announcementType === "definitive_agreement_signed" && evidence.some(p =>
    exactProof(p, blocks) && /^\s*As previously announced\b/i.test(p.quote)
  )) return result("conflict", ["historical_leadin_in_signing_evidence_requires_review"]);
  if (input.announcementType === "definitive_agreement_signed" && evidence.some(p => {
    if (!exactProof(p, blocks)) return false;
    const field = blocks.find(b => b.block_id === p.block_id)?.[p.source_field as "text" | "heading"];
    return typeof field === "string" && field.split(/\n\s*\n/).some(paragraph => paragraph.includes(p.quote) && /^\s*As previously announced\b/i.test(paragraph));
  })) return result("unresolved", ["historical_or_mixed_context_requires_action_disambiguation"]);
  if (!context) return result("unresolved", ["action_time_context_missing"]);
  if (context.disclosure_context === "prior_background") return result("conflict", ["prior_background_is_not_new_announcement"]);
  if (context.disclosure_context !== "current_announcement") return result("unresolved", ["disclosure_context_unclear"]);
  if (!Array.isArray(context.action_evidence) || !Array.isArray(context.context_evidence) ||
      !context.action_evidence.length || !context.context_evidence.length ||
      ![...context.action_evidence, ...context.context_evidence].every(p => exactProof(p, blocks))) return result("unresolved", ["action_or_context_evidence_missing_or_invalid"]);
  if (typeof context.action_date_literal !== "string" || !context.action_date_literal ||
      !context.action_evidence.some(p => p.quote.includes(context.action_date_literal!))) return result("unresolved", ["action_time_not_bound_to_action_evidence"]);
  return result("supported_claim", ["exact_bindings_do_not_establish_semantic_accuracy"]);
}

/** Filing roles remain observations; neither is an acquirer/target assignment. */
export function sec425FilingRoles(filing: Record<string, unknown>, facts: { filed_by: string | null; subject_company: string | null }) {
  const provenance = filing.sec425_identity_provenance as { filingRoles?: unknown } | undefined;
  return { archiveCik: filing.cik ?? null, filedBy: facts.filed_by, subjectCompany: facts.subject_company,
    indexRoles: provenance?.filingRoles ?? null,
    transactionRole: null, usage: "Filing roles and Archives CIK do not identify every transaction party; ticker claims require separate official corroboration." };
}

/** Already collected official index + catalog evidence, no model fields or name-based lookup. */
export function sec425OfficialCompanies(filing: Record<string, unknown>) {
  const provenance = filing.sec425_identity_provenance as { officialCompanies?: unknown; filingRoles?: { roles?: { role: string; cik: string; companyName: string }[]; indexSha256?: string } } | undefined;
  const values = Array.isArray(provenance?.officialCompanies) ? provenance.officialCompanies : [];
  return values.map(value => {
    try {
      const row = value as { cik: string; filingRole: string; sourceCompanyName: string; indexUrl: string; indexSha256: string;
        catalogAvailable: boolean; catalogSource: string; catalogRows: { cik: string; ticker: string; exchange: string | null; name: string | null }[]; observedAt: string };
      const cik = normalizeCik(row.cik), url = new URL(row.indexUrl), accession = String(filing.accession_number ?? "");
      if (!["filed_by", "subject_company"].includes(row.filingRole) || !/^\d{10}-\d{2}-\d{6}$/.test(accession) ||
          typeof row.sourceCompanyName !== "string" || !row.sourceCompanyName.trim() || typeof row.catalogAvailable !== "boolean" || !Number.isFinite(Date.parse(row.observedAt)) ||
          url.origin !== "https://www.sec.gov" || !url.pathname.startsWith("/Archives/edgar/data/") || !url.pathname.includes(`/${accession.replaceAll("-", "")}/`) || url.search || url.hash ||
          row.indexSha256 !== provenance?.filingRoles?.indexSha256 || !/^[a-f0-9]{64}$/.test(row.indexSha256) ||
          provenance?.filingRoles?.roles?.filter(r => r.role === row.filingRole && normalizeCik(r.cik) === cik && r.companyName === row.sourceCompanyName).length !== 1 ||
          row.catalogSource !== "https://www.sec.gov/files/company_tickers_exchange.json" || !Array.isArray(row.catalogRows) ||
          !row.catalogRows.every(r => normalizeCik(r.cik) === cik && typeof r.ticker === "string" && !!r.ticker.trim() && (r.exchange === null || typeof r.exchange === "string") && (r.name === null || typeof r.name === "string"))) throw Error("invalid_official_company_reference");
      return { status: "identified" as const, cik, filingRole: row.filingRole, sourceCompanyName: row.sourceCompanyName,
        indexUrl: row.indexUrl, indexSha256: row.indexSha256, catalogSource: row.catalogSource,
        listings: row.catalogAvailable ? structuredClone(row.catalogRows) : [],
        tickerStatus: !row.catalogAvailable ? "unavailable" : row.catalogRows.length ? "observed_in_catalog" : "not_in_catalog",
        observedAt: row.observedAt, catalogConfirmedAt: null, transactionRole: null, historicalTickerVerified: false };
    } catch { return { status: "unavailable" as const, reason: "invalid_official_company_reference", transactionRole: null }; }
  });
}

export function sec425PromptIdentity<T extends { ticker: string | null; exchange: string | null; company_name: string | null; usage_rule: string }>(
  current: T, blocks: readonly VerificationBlock[], filing: Record<string, unknown>, context?: Sec425IdentityEvidence,
) {
  const verification = inspectSec425FilingTicker({ key: "primary", name: current.company_name, ticker: current.ticker, exchange: current.exchange }, filing, blocks, context);
  return { ...current, ticker: verification.verifiedTicker, exchange: verification.verifiedExchange,
    identity_claims: { ticker: current.ticker, exchange: current.exchange, company_name: current.company_name },
    identity_verification: verification, usage_rule: `${current.usage_rule} Archives CIK and company metadata are filing identity, not every transaction party. FILED BY/SUBJECT COMPANY do not establish acquirer/target. Do not treat unverified ticker claims as verified identities.` };
}
