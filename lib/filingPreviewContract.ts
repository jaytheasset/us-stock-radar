export type FilingPreviewFieldsInput = {
  displayPayload?: unknown;
  keyEvidence?: unknown;
  materialEvents?: unknown;
  quickTake?: unknown;
  summary?: unknown;
};

export type FilingPreviewFields = {
  filingBrief: string;
  keyPoints: string[];
  keyPointsLabel: "Key Changes" | "Key Points";
  showKeyPoints: boolean;
};

export function resolveFilingPreviewFields({
  displayPayload,
  keyEvidence,
  materialEvents,
  quickTake,
  summary,
}: FilingPreviewFieldsInput): FilingPreviewFields {
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
  const display = isRecord(displayPayload) ? displayPayload : null;
  const displayData = isRecord(display?.data) ? display.data : null;
  const isGovernanceEvent = display?.display_type === "governance_event";
  const governanceKeyChanges = Array.isArray(displayData?.key_changes)
    ? displayData.key_changes
        .filter(isRecord)
        .map((change) => readText(change.title))
    : [];
  const evidence = Array.isArray(keyEvidence)
    ? keyEvidence
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
    : [];
  const keyPoints = Array.from(
    new Set((isGovernanceEvent ? governanceKeyChanges : evidence).filter(Boolean)),
  ).slice(0, 3);

  return {
    filingBrief:
      primarySummary ||
      firstEventSummary ||
      readText(quickTake) ||
      readText(summary) ||
      "",
    keyPoints,
    keyPointsLabel: isGovernanceEvent ? "Key Changes" : "Key Points",
    showKeyPoints: !isGovernanceEvent || keyPoints.length > 0,
  };
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
