export function sanitizeNasdaqCorporateActionAnalysis(
  analysis: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...analysis,
    quick_take: removeCusipAdministrativeText(readString(analysis.quick_take) || ""),
    summary: removeCusipAdministrativeText(readString(analysis.summary) || ""),
    why_it_matters: removeCusipAdministrativeText(readString(analysis.why_it_matters) || ""),
    score_reason: removeCusipAdministrativeText(readString(analysis.score_reason) || ""),
    bullish_points: removeCusipItems(analysis.bullish_points),
    bearish_points: removeCusipItems(analysis.bearish_points),
    key_evidence: removeCusipItems(analysis.key_evidence),
    what_to_watch_next: removeCusipItems(analysis.what_to_watch_next),
  };
}

function removeCusipItems(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value
    .map((item) => removeCusipAdministrativeText(String(item || "")))
    .filter((item) => item && !/\bCUSIP\b/i.test(item));
}

function removeCusipAdministrativeText(value: string) {
  const text = value.trim();
  if (!text || !/\bCUSIP\b/i.test(text)) return text;
  const withoutCusipSentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !/\bCUSIP\b/i.test(sentence))
    .join(" ")
    .trim();

  return (
    withoutCusipSentences ||
    text
      .replace(/\b[^.!?]*CUSIP[^.!?]*[.!?]?/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
