import { LISTING_EVENT_KINDS, LISTING_EVENT_OUTCOMES, LISTING_DATE_STATUSES } from "../monitor/listingRiskFacts.ts";

export const REVIEW_FIELDS = ["trading_suspension_date", "removal_effective_date", "event_kind", "event_outcome", "exchange", "security_title"] as const;
export type ReviewField = typeof REVIEW_FIELDS[number];
export const REVIEW_FIELD_LABELS: Record<ReviewField, string> = {
  trading_suspension_date: "Trading suspension date", removal_effective_date: "Removal effective date",
  event_kind: "Event kind", event_outcome: "Event outcome", exchange: "Exchange stated in filing",
  security_title: "Security title stated in filing",
};
export type AnalysisCorrection = {
  value: string | null;
  availability: "available" | "unavailable";
  dateStatus?: typeof LISTING_DATE_STATUSES[number];
  sourceRef: string;
};
export type AnalysisCorrections = Partial<Record<ReviewField, AnalysisCorrection>>;
export type AnalysisReviewState = "ORIGINAL" | "REVIEW" | "HUMAN_CORRECTED" | "UNAVAILABLE" | "AWAITING_FILING";
export type ReviewSource = { id: string; url: string | null; text: string; label: string };
export function validateCorrections(value: unknown, sources: ReviewSource[]): AnalysisCorrections {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Choose typed analysis fields.");
  const corrections: AnalysisCorrections = {};
  for (const [key, input] of Object.entries(value)) {
    if (!REVIEW_FIELDS.includes(key as ReviewField) || !input || typeof input !== "object") throw Error("Unsupported analysis field.");
    const field = input as AnalysisCorrection;
    if (!["available", "unavailable"].includes(field.availability) || !sources.some(source => source.id === field.sourceRef)) throw Error("A retained source reference is required.");
    if(field.availability === "available" && !sources.some(source => source.id === field.sourceRef && source.text.trim())) throw Error("The referenced source text is unavailable.");
    if (field.availability === "unavailable") {
      if (field.value !== null) throw Error("Unavailable fields must have null values.");
    } else if (key.endsWith("_date")) {
      if (typeof field.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(field.value) || new Date(field.value + "T00:00:00Z").toISOString().slice(0,10) !== field.value) throw Error("Use a valid calendar date.");
      if (!LISTING_DATE_STATUSES.includes(field.dateStatus!)) throw Error("Choose the source-supported date status.");
    } else if (key === "exchange" || key === "security_title") {
      if (typeof field.value !== "string" || field.value.trim().length < 2 || field.value.length > 300 || /[<>\r\n]/.test(field.value)) throw Error("Use the security or exchange wording from the retained source (2–300 characters).");
      const source = sources.find(entry => entry.id === field.sourceRef)!;
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
      if (!normalize(source.text).includes(normalize(field.value))) throw Error("The stated security or exchange must appear in the selected retained source.");
    } else if (!(key === "event_kind" ? LISTING_EVENT_KINDS : LISTING_EVENT_OUTCOMES).includes(field.value as never)) throw Error("Unsupported classification value.");
    corrections[key as ReviewField] = { value: field.value, availability: field.availability, sourceRef: field.sourceRef,
      ...(key.endsWith("_date") ? { dateStatus: field.availability === "unavailable" ? "unknown" : field.dateStatus } : {}) };
  }
  if (!Object.keys(corrections).length) throw Error("Select at least one field to correct.");
  return corrections;
}
export function unavailableCorrections(sourceRef: string): AnalysisCorrections {
  return Object.fromEntries(REVIEW_FIELDS.map(field => [field, { value: null, availability: "unavailable", sourceRef,
    ...(field.endsWith("_date") ? { dateStatus: "unknown" } : {}) }])) as AnalysisCorrections;
}
