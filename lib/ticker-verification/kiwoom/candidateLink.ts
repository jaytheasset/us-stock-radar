import type { SecTickerResolutionEvaluation } from "../../sec-ticker-resolution/canonical.ts";
import { SEC_TICKER_RESOLUTION_VERSION } from "../../sec-ticker-resolution/canonical.ts";
import { isUuid, readSavedReview, type SavedReview } from "./review.ts";
import { isoDate, record, sha256, validateSnapshot, type KiwoomSnapshot } from "./source.ts";

// Pure, opt-in comparison. No repositories, source fetching, approval or ticker writes.
export type ComparisonStatus = "match" | "conflict" | "unconfirmed";
type Values = { oldTicker: string | null; newTicker: string | null; effectiveDate: string | null };
export type CandidateRevision = {
  decisionId: string; decisionSha256: string; revisionSha256: string;
  issuerCik: string; accession: string; sourceSha256: string;
  resolutionState: SecTickerResolutionEvaluation["resolutionState"];
  values: Values; effectivePrecision: string | null;
  securityType: string | null; securityClass: string | null;
};
export type ManualKiwoomRow = {
  method: "manual_transcription";
  candidateRevisionSha256: string;
  reviewId: string; caseId: string; reviewRevision: number;
  noticeId: string; sourceHash: string; imageSha256: string; locator: string;
  // Literal cells and human interpretation are retained separately. No OCR or inference.
  cells: { country: string; event: string; symbol: string; securityName: string; details: string; date: string };
  market: "US" | "non_US" | "unknown";
  event: "symbol_change" | "other" | "unknown";
  additionalChanges: string[];
  values: Values;
  dateBasis: "market_effective" | "broker_account" | "unknown";
  securityType: string | null; securityClass: string | null;
  // Human confirms only correspondence of the selected row, NOT security continuity.
  rowCorrespondence: "confirmed" | "different" | "unconfirmed";
  correspondenceReason: string;
};
type Comparison = { status: ComparisonStatus; reasons: string[]; fields: Record<keyof Values, ComparisonStatus> };
export type CandidateEvidenceLink = {
  version: "kiwoom-candidate-link-v1";
  candidate: CandidateRevision;
  observed: ManualKiwoomRow;
  review: { id: string; caseId: string; revision: number; contentSha256: string };
  comparison: Comparison;
  authority: "supporting_evidence_only"; tickerAuthority: "none";
  scope: "candidate_field_comparison_not_security_identity";
  linkSha256: string;
};

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(k => `${JSON.stringify(k)}:${stable(row[k])}`).join(",")}}`;
}
const digest = (value: unknown) => sha256(stable(value));
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error("KIWOOM_CANDIDATE_LINK_INVALID");
}
function keys(value: object, expected: string[]) {
  requireValid(Object.keys(value).sort().join() === [...expected].sort().join());
}
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 2000; }
function validateValues(value: Values) {
  keys(value, ["oldTicker", "newTicker", "effectiveDate"]);
  for (const v of [value.oldTicker, value.newTicker]) requireValid(v === null || (typeof v === "string" && /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(v)));
  requireValid(value.effectiveDate === null || isoDate(value.effectiveDate));
}

/** Input must come from the existing evaluated/replay-validated SEC candidate path.
 * This adapter checks internal consistency; it does not authenticate SEC source bytes. */
export function candidateRevision(evaluation: SecTickerResolutionEvaluation): CandidateRevision {
  const d = evaluation.decision, p = record(d.decision_payload), r = record(p.relationship), source = record(p.input);
  requireValid(isUuid(d.id) && hash(d.decision_sha256) && digest(p) === d.decision_sha256);
  requireValid(d.method_version === SEC_TICKER_RESOLUTION_VERSION && p.storageVersion === SEC_TICKER_RESOLUTION_VERSION
    && p.resolutionType === "same_security_ticker_change" && d.resolution_type === p.resolutionType
    && d.resolution_state === p.resolutionState && evaluation.resolutionState === p.resolutionState
    && ["AUTO", "REVIEW", "UNRESOLVED"].includes(evaluation.resolutionState));
  requireValid(text(p.issuerCik) && d.issuer_cik === p.issuerCik && text(source.evidenceAccessionNumber)
    && d.evidence_accession_number === source.evidenceAccessionNumber && hash(source.sourceSha256));
  const s = evaluation.summary;
  for (const k of ["oldTicker", "newTicker", "effectiveDate", "effectivePrecision"] as const) requireValid(s[k] === r[k]);
  if (evaluation.identity) requireValid(s.securityType === evaluation.identity.security_type && s.securityClass === evaluation.identity.security_class);
  const values = { oldTicker: s.oldTicker, newTicker: s.newTicker, effectiveDate: s.effectiveDate };
  validateValues(values);
  return { decisionId: d.id, decisionSha256: d.decision_sha256, revisionSha256: digest(evaluation),
    issuerCik: p.issuerCik, accession: source.evidenceAccessionNumber, sourceSha256: source.sourceSha256,
    resolutionState: evaluation.resolutionState, values, effectivePrecision: s.effectivePrecision,
    securityType: s.securityType, securityClass: s.securityClass };
}

function validatedReview(review: SavedReview) {
  // Reuse the existing stored-review validation without importing its DB service.
  return readSavedReview({ id: review.id, case_id: review.caseId, revision: review.revision,
    actor_user_id: review.actorUserId, request_id: review.requestId, request_hash: review.requestHash,
    created_at: review.createdAt, source_hash: review.snapshot.sourceHash,
    verdict: review.draft.verdict, ticker_authority: review.tickerAuthority, draft: review.draft, snapshot: review.snapshot });
}
function reviewRef(review: SavedReview): CandidateEvidenceLink["review"] {
  const { snapshot, ...metadata } = validatedReview(review);
  return { id: review.id, caseId: review.caseId, revision: review.revision,
    contentSha256: digest({ ...metadata, sourceHash: snapshot.sourceHash }) };
}
function validateRow(row: ManualKiwoomRow, candidate: CandidateRevision, review: SavedReview) {
  requireValid(review.draft.facts.kind === "symbol_change");
  for (const k of ["oldTicker", "newTicker", "effectiveDate"] as const) requireValid(review.draft.facts[k] === candidate.values[k]);
  validateRowBinding(row, candidate, review);
}
function validateRowBinding(row: ManualKiwoomRow, candidate: CandidateRevision, review: SavedReview) {
  keys(row, ["method", "candidateRevisionSha256", "reviewId", "caseId", "reviewRevision", "noticeId", "sourceHash", "imageSha256", "locator",
    "cells", "market", "event", "additionalChanges", "values", "dateBasis", "securityType", "securityClass", "rowCorrespondence", "correspondenceReason"]);
  requireValid(row.method === "manual_transcription" && row.candidateRevisionSha256 === candidate.revisionSha256
    && row.reviewId === review.id && row.caseId === review.caseId && row.reviewRevision === review.revision
    && row.noticeId === review.snapshot.id && row.sourceHash === review.snapshot.sourceHash
    && hash(row.imageSha256) && row.imageSha256 === review.draft.proof.imageSha256
    && row.locator === review.draft.proof.locator && text(row.locator));
  keys(row.cells, ["country", "event", "symbol", "securityName", "details", "date"]);
  requireValid(Object.values(row.cells).every(text));
  requireValid(["US", "non_US", "unknown"].includes(row.market) && ["symbol_change", "other", "unknown"].includes(row.event)
    && ["market_effective", "broker_account", "unknown"].includes(row.dateBasis)
    && ["confirmed", "different", "unconfirmed"].includes(row.rowCorrespondence) && text(row.correspondenceReason)
    && Array.isArray(row.additionalChanges) && row.additionalChanges.every(text));
  for (const v of [row.securityType, row.securityClass]) requireValid(v === null || text(v));
  validateValues(row.values);
}
function compare(candidate: CandidateRevision, row: ManualKiwoomRow, review: SavedReview): Comparison {
  const fields = Object.fromEntries((Object.keys(candidate.values) as (keyof Values)[]).map(k =>
    [k, candidate.values[k] === null || row.values[k] === null ? "unconfirmed" : candidate.values[k] === row.values[k] ? "match" : "conflict"])) as Comparison["fields"];
  const reasons: string[] = [];
  if (review.draft.verdict === "withdrawn") reasons.push("review_withdrawn");
  if (review.draft.verdict === "unclear" || !review.draft.usMarketRowReviewed) reasons.push("review_unconfirmed");
  if (row.market !== "US" || row.cells.country !== "US") reasons.push("not_confirmed_us_row");
  if (row.rowCorrespondence !== "confirmed") reasons.push("security_row_not_confirmed");
  if (row.event !== "symbol_change" || row.additionalChanges.length) reasons.push("unsupported_or_compound_event");
  if (row.dateBasis !== "market_effective") { reasons.push("not_market_effective_date"); fields.effectiveDate = "unconfirmed"; }
  if (!["date", "market_open"].includes(candidate.effectivePrecision ?? "")) reasons.push("candidate_date_precision_unconfirmed");
  // Unconfirmed scope never becomes an apparent contradiction of an unrelated candidate.
  if (reasons.length) return { status: "unconfirmed", reasons, fields };
  for (const k of ["securityType", "securityClass"] as const) {
    if (candidate[k] !== null && row[k] !== null && candidate[k] !== row[k]) reasons.push(`${k}_conflict`);
  }
  for (const k of Object.keys(fields) as (keyof Values)[]) if (fields[k] !== "match") reasons.push(`${k}_${fields[k]}`);
  return { status: reasons.some(r => r.endsWith("_conflict")) ? "conflict" : reasons.length ? "unconfirmed" : "match", reasons, fields };
}

export function createCandidateEvidenceLink(input: {
  evaluation: SecTickerResolutionEvaluation; review: SavedReview; row: ManualKiwoomRow;
}): CandidateEvidenceLink {
  const candidate = candidateRevision(input.evaluation), review = validatedReview(input.review);
  validateRow(input.row, candidate, review);
  return buildLink(candidate, input.row, review);
}

/** Human comparisons bind independent broker facts to their reviewed row, not to
 * automatic values. The automatic candidate and its comparison remain unchanged. */
export function createHumanCandidateEvidenceLink(input: Parameters<typeof createCandidateEvidenceLink>[0]): CandidateEvidenceLink {
  const candidate = candidateRevision(input.evaluation), review = validatedReview(input.review);
  validateRowBinding(input.row, candidate, review);
  requireValid(review.draft.facts.kind === "symbol_change" && input.row.dateBasis !== "broker_account");
  for (const k of ["oldTicker", "newTicker", "effectiveDate"] as const) requireValid(review.draft.facts[k] === input.row.values[k]);
  return buildLink(candidate, input.row, review);
}

function buildLink(candidate: CandidateRevision, row: ManualKiwoomRow, review: SavedReview): CandidateEvidenceLink {
  const content = { version: "kiwoom-candidate-link-v1" as const, candidate, observed: structuredClone(row), review: reviewRef(review),
    comparison: compare(candidate, row, review), authority: "supporting_evidence_only" as const,
    tickerAuthority: "none" as const, scope: "candidate_field_comparison_not_security_identity" as const };
  return { ...content, linkSha256: digest(content) };
}

/** Caller supplies CURRENT validated inputs explicitly. Null/read failure is not freshness.
 * No historical link is reusable merely because its saved comparison was a match. */
export function checkCandidateEvidenceLink(link: CandidateEvidenceLink, current: {
  evaluation: SecTickerResolutionEvaluation | null; snapshot: KiwoomSnapshot | null; review: SavedReview | null; row: ManualKiwoomRow | null;
}): { reusable: boolean; status: ComparisonStatus; reasons: string[] } {
  return checkLink(link, current, createCandidateEvidenceLink);
}

export function checkHumanCandidateEvidenceLink(link: CandidateEvidenceLink, current: Parameters<typeof checkCandidateEvidenceLink>[1]) {
  return checkLink(link, current, createHumanCandidateEvidenceLink);
}

function checkLink(link: CandidateEvidenceLink, current: Parameters<typeof checkCandidateEvidenceLink>[1],
  build: typeof createCandidateEvidenceLink): ReturnType<typeof checkCandidateEvidenceLink> {
  try {
    const { linkSha256, ...content } = link;
    requireValid(hash(linkSha256) && digest(content) === linkSha256);
    if (!current.evaluation || !current.snapshot || !current.review || !current.row) return { reusable: false, status: "unconfirmed", reasons: ["current_inputs_unavailable"] };
    const reasons: string[] = [];
    if (digest(current.row) !== digest(link.observed)) reasons.push("transcription_changed");
    if (digest(candidateRevision(current.evaluation)) !== digest(link.candidate)) reasons.push("candidate_revision_changed");
    if (!validateSnapshot(current.snapshot)) reasons.push("current_source_invalid");
    else if (current.snapshot.id !== link.observed.noticeId || current.snapshot.sourceHash !== link.observed.sourceHash) reasons.push("source_changed");
    const review = validatedReview(current.review);
    if (digest(reviewRef(review)) !== digest(link.review)) reasons.push("review_revision_changed");
    if (review.draft.verdict === "withdrawn") reasons.push("review_withdrawn");
    if (reasons.length) return { reusable: false, status: "unconfirmed", reasons };
    // Replay the comparison, not just its stored status or checksum.
    const replay = build({ evaluation: current.evaluation, review, row: link.observed });
    requireValid(replay.linkSha256 === link.linkSha256);
    return { reusable: true, status: replay.comparison.status, reasons: replay.comparison.reasons };
  } catch { return { reusable: false, status: "unconfirmed", reasons: ["link_or_current_input_invalid"] }; }
}
