/** Browser-safe review DTO. Human decisions never replace automatic observations. */
export const DATE_REVIEW_FIELDS = ["notice_date", "suspension_effective_date"] as const;
export type DateReviewField = typeof DATE_REVIEW_FIELDS[number];
export const DATE_REVIEW_LABELS: Record<DateReviewField, string> = {
  notice_date: "Notice / receipt date", suspension_effective_date: "Suspension effective date",
};
export type ReviewedDate = { availability: "available" | "unknown"; value: string | null;
  sourceRef: string; sourceHash: string; quote: string };
export type ReviewedDates = Record<DateReviewField, ReviewedDate>;
export type ReviewDocument = { id: string; url: string; sha256: string; text: string };

export function validateReviewedDates(input: unknown, documents: ReviewDocument[]): ReviewedDates {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join() !== [...DATE_REVIEW_FIELDS].sort().join()) throw Error("Review both date roles explicitly.");
  const result = input as ReviewedDates;
  for (const key of DATE_REVIEW_FIELDS) {
    const date = result[key];
    if (!date || typeof date !== "object" || Array.isArray(date)
      || Object.keys(date).sort().join() !== "availability,quote,sourceHash,sourceRef,value"
      || !["available", "unknown"].includes(date.availability)) throw Error("Invalid reviewed date.");
    const doc = documents.find(d => d.id === date.sourceRef && d.sha256 === date.sourceHash);
    if (!doc || typeof date.quote !== "string" || date.quote.length < 20 || date.quote.length > 4000
      || !doc.text.includes(date.quote)) throw Error("Select a verbatim passage from the retained evidence.");
    if (date.availability === "unknown") {
      if (date.value !== null) throw Error("Unknown dates must be null.");
    } else {
      if (typeof date.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date.value)
        || !Number.isFinite(Date.parse(date.value)) || new Date(date.value).toISOString().slice(0, 10) !== date.value)
        throw Error("Use a real calendar date in YYYY-MM-DD format.");
    }
  }
  return result;
}
