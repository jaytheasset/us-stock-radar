export type FilingPreviewFieldsInput = {
  keyEvidence?: unknown;
  materialEvents?: unknown;
  quickTake?: unknown;
  summary?: unknown;
};

export function resolveFilingPreviewFields({
  keyEvidence,
  materialEvents,
  quickTake,
  summary,
}: FilingPreviewFieldsInput) {
  const events = Array.isArray(materialEvents)
    ? materialEvents.filter(isRecord)
    : [];
  const primarySummary = events
    .filter((event) => readText(event.role).toLowerCase() === "primary")
    .map((event) => readText(event.event_summary))
    .find(Boolean);
  const firstEventSummary = events
    .map((event) => readText(event.event_summary))
    .find(Boolean);

  return {
    filingBrief:
      primarySummary ||
      firstEventSummary ||
      readText(quickTake) ||
      readText(summary) ||
      "",
    keyPoints: Array.from(
      new Set(
        (Array.isArray(keyEvidence) ? keyEvidence : [])
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).slice(0, 3),
  };
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
