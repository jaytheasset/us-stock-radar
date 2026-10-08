import { secVisibleText, type SecTickerResolutionEvaluation, type VerifiedSecResolutionSource } from "../../sec-ticker-resolution/canonical.ts";
import { candidateRevision, createCandidateEvidenceLink, checkCandidateEvidenceLink, type ManualKiwoomRow, type ComparisonStatus } from "./candidateLink.ts";
import { isUuid, type SavedReview } from "./review.ts";
import { isoDate, sha256, type KiwoomSnapshot } from "./source.ts";

type Values = ManualKiwoomRow["values"];
type Field = keyof Values;
const fields: Field[] = ["oldTicker", "newTicker", "effectiveDate"];
export type SecTextProof = { start: number; end: number; quote: string };
type SecReference = Omit<VerifiedSecResolutionSource, "rawContent">;
export type SecHumanJudgment = {
  version: "sec-human-change-v1";
  id: string; caseId: string; revision: number; previousJudgmentSha256: string | null; recordedAt: string;
  actor: { id: string; provenance: "test_metadata" | "caller_supplied_unverified" };
  status: "confirmed" | "unconfirmed" | "withdrawn"; reason: string;
  candidateRevisionSha256: string;
  source: SecReference;
  textBasis: "secVisibleText";
  values: Values;
  eventStatus: "occurred" | "proposed" | "unknown";
  security: { title: string; securityClass: string | null };
  proofs: Record<Field | "security" | "eventStatus", SecTextProof | null>;
  exchangeTransfer: null | {
    from: string; to: string; date: string | null;
    status: "occurred" | "proposed" | "unknown"; proof: SecTextProof | null;
  };
};
export type HumanExceptionInput = {
  evaluation: SecTickerResolutionEvaluation; secSource: VerifiedSecResolutionSource;
  judgment: SecHumanJudgment; review: SavedReview; row: ManualKiwoomRow;
};
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const r = value as Record<string, unknown>;
  return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${stable(r[k])}`).join(",")}}`;
}
export const humanJudgmentSha256 = (judgment: SecHumanJudgment) => sha256(stable(judgment));
const digest = (value: unknown) => sha256(stable(value));
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 4000;
function requireValid(ok: unknown): asserts ok { if (!ok) throw new Error("SEC_HUMAN_EXCEPTION_INVALID"); }
function exact(value: object, keys: string[]) { requireValid(Object.keys(value).sort().join() === [...keys].sort().join()); }
function sourceRef(source: VerifiedSecResolutionSource): SecReference {
  const { rawContent: _body, ...reference } = source;
  return reference;
}
function validate(input: HumanExceptionInput) {
  const c = candidateRevision(input.evaluation), h = input.judgment, s = input.secSource;
  exact(h, ["version", "id", "caseId", "revision", "previousJudgmentSha256", "recordedAt", "actor", "status", "reason", "candidateRevisionSha256", "source", "textBasis", "values", "eventStatus", "security", "proofs", "exchangeTransfer"]);
  requireValid(h.version === "sec-human-change-v1" && isUuid(h.id) && isUuid(h.caseId)
    && Number.isInteger(h.revision) && h.revision >= 1
    && (h.revision === 1 ? h.previousJudgmentSha256 === null : hash(h.previousJudgmentSha256))
    && ["confirmed", "unconfirmed", "withdrawn"].includes(h.status) && text(h.reason)
    && typeof h.recordedAt === "string" && Number.isFinite(Date.parse(h.recordedAt)));
  exact(h.actor, ["id", "provenance"]);
  requireValid(isUuid(h.actor.id) && ["test_metadata", "caller_supplied_unverified"].includes(h.actor.provenance));
  requireValid(h.candidateRevisionSha256 === c.revisionSha256 && h.textBasis === "secVisibleText");
  const payloadInput = (input.evaluation.decision.decision_payload as { input: Record<string, unknown> }).input;
  requireValid(s.issuerCik === c.issuerCik && s.accessionNumber === c.accession && s.sha256 === c.sourceSha256
    && sha256(s.rawContent) === s.sha256 && s.resultId === payloadInput.sourceResultId && s.rawSourceId === payloadInput.sourceRawId);
  const url = new URL(s.url);
  requireValid(url.protocol === "https:" && url.hostname === "www.sec.gov" && !url.search && !url.hash
    && !url.username && !url.password && !url.port
    && url.pathname === `/Archives/edgar/data/${Number(s.issuerCik)}/${s.accessionNumber.replaceAll("-", "")}/${s.documentName}`);
  requireValid(digest(h.source) === digest(sourceRef(s)));
  exact(h.values, fields);
  for (const key of ["oldTicker", "newTicker"] as const) requireValid(h.values[key] === null || (typeof h.values[key] === "string" && /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(h.values[key]!)));
  requireValid(h.values.effectiveDate === null || isoDate(h.values.effectiveDate));
  requireValid(["occurred", "proposed", "unknown"].includes(h.eventStatus));
  exact(h.security, ["title", "securityClass"]);
  requireValid(text(h.security.title) && (h.security.securityClass === null || text(h.security.securityClass)));
  exact(h.proofs, [...fields, "security", "eventStatus"]);
  const visible = secVisibleText(s.rawContent);
  const checkProof = (p: SecTextProof | null) => {
    if (p === null) return false;
    exact(p, ["start", "end", "quote"]);
    requireValid(Number.isInteger(p.start) && Number.isInteger(p.end) && p.start >= 0 && p.end > p.start
      && p.end <= visible.length && text(p.quote) && visible.slice(p.start, p.end) === p.quote);
    return true;
  };
  const evidence = Object.fromEntries(Object.entries(h.proofs).map(([key, p]) => [key, checkProof(p)])) as Record<Field | "security" | "eventStatus", boolean>;
  let exchangeEvidence = false;
  if (h.exchangeTransfer !== null) {
    const e = h.exchangeTransfer;
    exact(e, ["from", "to", "date", "status", "proof"]);
    requireValid(text(e.from) && text(e.to) && (e.date === null || isoDate(e.date)) && ["occurred", "proposed", "unknown"].includes(e.status));
    exchangeEvidence = checkProof(e.proof);
  }
  return { evidence, exchangeEvidence };
}

/** Pure separate assertion; never changes the automatic evaluation or its rejection rules.
 * Proof presence validates references only, not the truth of human-entered semantics. */
export function createHumanExceptionComparison(input: HumanExceptionInput) {
  const original = createCandidateEvidenceLink(input); // Original null/facts equality contract remains intact.
  const { evidence, exchangeEvidence } = validate(input);
  const h = input.judgment, row = input.row;
  const fieldComparison = Object.fromEntries(fields.map(key => {
    const a = h.values[key], b = row.values[key];
    const comparable = evidence[key] && a !== null && b !== null
      && (key !== "effectiveDate" || (evidence.eventStatus && h.eventStatus === "occurred" && row.dateBasis === "market_effective"));
    return [key, !comparable ? "unconfirmed" : a === b ? "match" : "conflict"];
  })) as Record<Field, ComparisonStatus>;
  const reasons: string[] = [];
  if (h.status !== "confirmed") reasons.push(`human_${h.status}`);
  if (input.review.draft.verdict === "withdrawn") reasons.push("kiwoom_review_withdrawn");
  if (!input.review.draft.usMarketRowReviewed || row.market !== "US" || row.cells.country !== "US") reasons.push("us_row_unconfirmed");
  if (row.rowCorrespondence !== "confirmed") reasons.push("row_correspondence_unconfirmed");
  if (row.event !== "symbol_change" || row.additionalChanges.length) reasons.push("kiwoom_scope_unconfirmed");
  if (!evidence.security || !evidence.eventStatus) reasons.push("sec_context_evidence_missing");
  if (h.exchangeTransfer && !exchangeEvidence) reasons.push("exchange_evidence_missing");
  if (h.eventStatus !== "occurred") reasons.push("sec_event_not_completed");
  if (h.security.securityClass !== null && row.securityClass !== null && h.security.securityClass !== row.securityClass) reasons.push("security_class_conflict");
  if (row.securityType !== null && original.candidate.securityType !== null && row.securityType !== original.candidate.securityType) reasons.push("security_type_conflict");
  const status: ComparisonStatus = Object.values(fieldComparison).includes("conflict") ? "conflict"
    : Object.values(fieldComparison).includes("unconfirmed") ? "unconfirmed" : "match";
  const content = {
    version: "kiwoom-human-exception-v1" as const,
    automatic: structuredClone(input.evaluation), originalLink: original,
    secHuman: structuredClone(h), humanJudgmentSha256: humanJudgmentSha256(h),
    differencesFromAutomatic: fields.filter(k => original.candidate.values[k] !== h.values[k]).map(field => ({ field, automatic: original.candidate.values[field], human: h.values[field] })),
    comparison: { inputs: "sec_human_values_vs_kiwoom_transcription" as const, fields: fieldComparison, status },
    humanStatus: h.status, eventStatus: h.eventStatus,
    assessment: { eligible: reasons.length === 0 && status === "match", reasons },
    proofReferences: { fields: evidence, exchange: exchangeEvidence },
    // No copying SEC identity/exchange into the Kiwoom observation.
    exchange: { secOnly: structuredClone(h.exchangeTransfer), kiwoom: null, compared: false as const },
    authority: "supporting_evidence_only" as const, tickerAuthority: "none" as const,
    authentication: "not_verified" as const, semanticAccuracy: "requires_human_review" as const,
  };
  return { ...content, comparisonSha256: digest(content) };
}
export type HumanExceptionComparison = ReturnType<typeof createHumanExceptionComparison>;

/** Checks caller-supplied current inputs; no implicit source lookup or freshness guarantee. */
export function checkHumanExceptionComparison(saved: HumanExceptionComparison, current: {
  evaluation: SecTickerResolutionEvaluation | null; secSource: VerifiedSecResolutionSource | null;
  judgment: SecHumanJudgment | null; review: SavedReview | null; row: ManualKiwoomRow | null; snapshot: KiwoomSnapshot | null;
}): { reusable: boolean; reasons: string[] } {
  try {
    const { comparisonSha256, ...content } = saved;
    requireValid(hash(comparisonSha256) && digest(content) === comparisonSha256);
    const { evaluation, secSource, judgment, review, row, snapshot } = current;
    if (!evaluation || !secSource || !judgment || !review || !row || !snapshot) return { reusable: false, reasons: ["current_inputs_unavailable"] };
    const prior = checkCandidateEvidenceLink(saved.originalLink, { evaluation, review, row, snapshot });
    const reasons = prior.reusable ? [] : [...prior.reasons];
    if (judgment.status === "withdrawn") reasons.push("human_withdrawn");
    if (humanJudgmentSha256(judgment) !== saved.humanJudgmentSha256) reasons.push("human_judgment_changed");
    if (sha256(secSource.rawContent) !== secSource.sha256 || digest(sourceRef(secSource)) !== digest(saved.secHuman.source)) reasons.push("sec_evidence_changed_or_invalid");
    if (reasons.length) return { reusable: false, reasons };
    const replay = createHumanExceptionComparison({ evaluation, secSource, judgment, review, row });
    requireValid(replay.comparisonSha256 === comparisonSha256);
    return { reusable: true, reasons: [] };
  } catch { return { reusable: false, reasons: ["comparison_or_current_input_invalid"] }; }
}
