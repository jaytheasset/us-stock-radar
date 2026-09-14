import type { AnalysisCorrection, AnalysisCorrections, AnalysisReviewState, ReviewField, ReviewSource } from "./contract.ts";

/** A Human overlay is not an analyzer fact row or a replacement primary output. */
export type Form25AnalysisReviewRead = {
  status: "not_applicable" | "available" | "unavailable";
  reviewState?: AnalysisReviewState;
  rawItemId?: string;
  eventId?: string | null;
  baseVersion?: string;
  revision?: number;
  reason?: string;
  analysis?: Record<string, unknown> | null;
  corrections?: AnalysisCorrections;
  sourceEvidence?: Array<Pick<ReviewSource, "id" | "url" | "label"> & { text?: string }>;
  history?: Record<string, unknown>[];
  aiRunId?: string | null;
  humanDecisionId?: string | null;
  decisionTime?: string | null;
  baseAnalysisRequiresReview?: boolean;
};

const monitorFields: Record<string, ReviewField> = {
  "listing.suspension_date": "trading_suspension_date",
  "listing.removal_effective_date": "removal_effective_date",
  "listing.event_kind": "event_kind",
  "listing.event_outcome": "event_outcome",
  "listing.exchange": "exchange",
};

export function form25HumanMonitorField(
  review: Form25AnalysisReviewRead | undefined,
  conditionKey: string,
): AnalysisCorrection | null {
  const field = monitorFields[conditionKey];
  if (!review || review.status === "not_applicable" || review.reviewState === "ORIGINAL" || !conditionKey.startsWith("listing.")) return null;
  if (review.status !== "available" || review.reviewState !== "HUMAN_CORRECTED") {
    return { availability: "unavailable", value: null, sourceRef: "" };
  }
  if (!field) return review.baseAnalysisRequiresReview
    ? { availability: "unavailable", value: null, sourceRef: "" } : null;
  const correction = review.corrections?.[field];
  if (!correction) return review.baseAnalysisRequiresReview
    ? { availability: "unavailable", value: null, sourceRef: "" } : null;
  // The official effective reader validates the decision's version and source; consumers
  // still refuse an absent or detached field rather than supplying another field's value.
  if (!correction.sourceRef || !review.sourceEvidence?.some(source => source.id === correction.sourceRef)) {
    return { availability: "unavailable", value: null, sourceRef: correction.sourceRef || "" };
  }
  return correction;
}

export async function readForm25AnalysisReviewForConsumer(eventId: string): Promise<Form25AnalysisReviewRead> {
  try {
    return await (await import("./persistence.ts")).readEffectiveForm25AnalysisReview({ eventId });
  } catch {
    return { status: "unavailable", reviewState: "REVIEW", reason: "form25_analysis_review_read_failed" };
  }
}

export function form25AnalysisReviewNotice(review: Form25AnalysisReviewRead | null | undefined): string | null {
  if (!review || review.status === "not_applicable" || review.reviewState === "ORIGINAL") return null;
  if (review.status === "available" && review.reviewState === "HUMAN_CORRECTED") {
    return "Human-reviewed fields are shown separately. The AI analysis below is preserved and may differ from the reviewed facts.";
  }
  return "Analysis review pending: required facts are unavailable. The AI analysis below is preserved and is not a confirmed finding.";
}

export function form25AnalysisAllowsPrimaryAlert(review: Form25AnalysisReviewRead): boolean {
  // Never send an uncorrected AI narrative merely because one Human field was approved.
  return review.status === "not_applicable" || (review.status === "available" && review.reviewState === "ORIGINAL"
    && Boolean(review.analysis) && !review.history?.some(row => row.action === "retry_completed"));
}

/** Attach the review overlay; the original public AI article and identity remain unchanged. */
export function projectForm25AnalysisEvent(row: Record<string, unknown>, review: Form25AnalysisReviewRead) {
  if (review.status === "not_applicable") return row;
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  const publicReview: Form25AnalysisReviewRead = {
    status: review.status, reviewState: review.reviewState, reason: review.reason,
    revision: review.revision, corrections: review.corrections,
    decisionTime: review.decisionTime, baseAnalysisRequiresReview: review.baseAnalysisRequiresReview,
    sourceEvidence: review.sourceEvidence?.map(({ id, url, label }) => ({ id, url, label })),
  };
  return { ...row,
    metadata: { ...metadata,
      form25_analysis_review: publicReview },
  };
}
