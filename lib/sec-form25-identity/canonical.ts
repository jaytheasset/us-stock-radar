import { createHash } from "node:crypto";
import { parseSecForm25Filing, type SecForm25ParseInput } from "../sources/sec/forms/form25/parser.ts";
import { classifySecurity } from "../sec-ticker-resolution/canonical.ts";

export const FORM25_IDENTITY_VERSION = "sec_form25_subject_identity_v1";
export const SEC_TICKER_CATALOG = "https://www.sec.gov/files/company_tickers_exchange.json";
export type IdentityCandidate = { ticker: string; exchange: string | null; cik: string; source: string; accession?: string; security?: string; context?: string; sourceSha256?: string };
export type Form25IdentityEvidence = {
  version: string; accession: string | null; subjectCik: string | null; issuerName: string | null;
  filedByCik: string | null; security: string | null; exchange: string | null; sourceUrl: string | null;
  sourceSha256: string; subjectEvidence: unknown; mode: "current_catalog" | "historical_replay";
  status: "AUTO" | "REVIEW" | "UNRESOLVED"; reason: string; candidates: IdentityCandidate[];
};
export function isForm25IdentityRaw(raw: Record<string, unknown>) {
  const payload = record(raw.raw_payload); const metadata = record(raw.metadata);
  return /^(?:FORM\s+)?25(?:-NSE)?(?:\/A)?$/i.test(String(payload.form_type || metadata.form_type || "").trim());
}
export function rawIdentityInput(raw: Record<string, unknown>): SecForm25ParseInput {
  return { rawItemId: text(raw.id), sourceUniqueId: text(raw.source_unique_id), sourceUrl: text(raw.source_url),
    title: text(raw.title), publishedAt: text(raw.published_at), bodyText: text(raw.body_text), analysisText: text(raw.analysis_text),
    rawPayload: raw.raw_payload, metadata: raw.metadata };
}
export function form25SourceSha(raw: Record<string, unknown>) {
  return sha(form25SourceSnapshot(raw));
}
export function form25SourceSnapshot(raw: Record<string, unknown>) {
  const payload = record(raw.raw_payload);
  const metadata = record(raw.metadata);
  const identityMetadata = Object.fromEntries(["company_name","accession_number","cik","form_type","ticker","exchange","form25_exchange","listing_exchange","removal_exchange"].map(key=>[key,metadata[key]??null]));
  return { source: raw.source_url??null, accession: raw.source_unique_id??null, body: raw.body_text??null, analysis: raw.analysis_text??null,
    form: payload.form_type??null, html: payload.primary_document_html??null, attachments: payload.attachment_texts??null,
    payload, title: raw.title??null, published: raw.published_at??null, identityMetadata };
}
export function buildForm25IdentityEvidence(raw: Record<string, unknown>, catalog: { rows: IdentityCandidate[]; available: boolean }, mode: Form25IdentityEvidence["mode"] = "current_catalog"): Form25IdentityEvidence {
  const parsed = parseSecForm25Filing(rawIdentityInput(raw)); const facts = parsed.facts;
  const subjectCik = cik(facts.subject_company_cik?.value);
  const payload = record(raw.raw_payload); const indexCik = cik(payload.form25_index_subject_cik);
  const conflict = Number(payload.form25_index_subject_cik_count || 0) > 1 || Boolean(indexCik && subjectCik && indexCik !== subjectCik);
  const candidates = Array.from(new Map(catalog.rows.filter(row => subjectCik && cik(row.cik) === subjectCik && /^[A-Z][A-Z0-9.-]{0,9}$/.test(row.ticker))
    .map(row => [`${row.ticker}|${row.exchange}`, { ...row, cik: subjectCik! }])).values()).sort((a,b)=>stable(a).localeCompare(stable(b)));
  const securitySupported = Boolean(facts.removed_security?.value && classifySecurity(facts.removed_security.value));
  // Generic exchange is populated by today's SEC catalog, not by the historical removal notice.
  const sourceExchange = facts.exchange && !["raw_payload.exchange","metadata.exchange"].includes(facts.exchange.source)
    ? facts.exchange.value : null;
  const status = conflict ? "REVIEW" : !subjectCik || !catalog.available || candidates.length === 0 ? "UNRESOLVED" : candidates.length === 1 && mode === "current_catalog" && securitySupported ? "AUTO" : "REVIEW";
  return { version: FORM25_IDENTITY_VERSION, accession: parsed.accessionNumber, subjectCik,
    issuerName: facts.issuer_name?.value || null, filedByCik: cik(facts.filed_by_cik?.value),
    security: facts.removed_security?.value || null, exchange: sourceExchange,
    sourceUrl: facts.source_url, sourceSha256: form25SourceSha(raw), subjectEvidence: facts.subject_company_cik,
    mode, status, reason: conflict ? "subject_cik_conflict" : !subjectCik ? "subject_cik_unavailable" : !catalog.available ? "sec_catalog_unavailable" : !candidates.length ? "subject_not_in_sec_catalog" : !securitySupported ? "security_identity_unavailable" : mode === "historical_replay" ? "historical_evidence_requires_review" : candidates.length > 1 ? "multiple_security_candidates" : "unique_subject_cik_sec_catalog", candidates };
}
export function sha(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
export function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
export function cik(value: unknown): string | null { const v = String(value ?? "").trim(); return /^\d{1,10}$/.test(v) && Number(v) > 0 ? v.padStart(10, "0") : null; }
