import { resolveSec8k6kCapitalFinancingPreview } from "./filingPreviewAdapters/sec8k6kCapitalFinancing.ts";

export type FilingPreviewFieldsInput = {
  displayPayload?: unknown;
  governanceEvent?: boolean;
  keyEvidence?: unknown;
  materialEvents?: unknown;
  quickTake?: unknown;
  summary?: unknown;
};

export type FilingPreviewFields = {
  filingBrief: string;
  keyPoints: string[];
  keyPointsLabel:
    | "Capital Snapshot"
    | "Key Business Updates"
    | "Key Changes"
    | "Key Points";
  showKeyPoints: boolean;
};

export function resolveFilingPreviewFields({
  displayPayload,
  governanceEvent = false,
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
  const primaryEventType = events
    .filter((event) => readText(event.role).toLowerCase() === "primary")
    .map((event) => readText(event.event_type).toLowerCase())
    .find(Boolean);
  const display = isRecord(displayPayload) ? displayPayload : null;
  const displayData = isRecord(display?.data) ? display.data : null;
  const capitalFinancingPreview = resolveSec8k6kCapitalFinancingPreview({
    displayPayload,
    primaryEventType: primaryEventType || "",
  });
  const isGovernanceEvent =
    display?.display_type === "governance_event" || governanceEvent;
  const isSec8k6kEarningsEvent =
    display?.display_type === "operating_event" &&
    readText(displayData?.display_version) === "sec_8k_6k_operating_event_v1" &&
    readText(displayData?.operating_mode) === "earnings" &&
    primaryEventType === "earnings";
  const governanceKeyChanges = Array.isArray(displayData?.key_changes)
    ? displayData.key_changes
        .filter(isRecord)
        .map((change) => readText(change.title))
    : [];
  const earningsBusinessUpdates = Array.isArray(displayData?.business_catalysts)
    ? displayData.business_catalysts
        .filter(isRecord)
        .map((update) => readText(update.title))
    : [];
  const evidence = Array.isArray(keyEvidence)
    ? keyEvidence
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
    : [];
  const keyPointCandidates = capitalFinancingPreview
    ? capitalFinancingPreview.keyPoints
    : isSec8k6kEarningsEvent
      ? earningsBusinessUpdates
      : isGovernanceEvent
        ? governanceKeyChanges
        : evidence;
  const keyPoints = Array.from(
    new Set(keyPointCandidates.filter(Boolean)),
  ).slice(0, capitalFinancingPreview ? 4 : 3);

  return {
    filingBrief:
      primarySummary ||
      firstEventSummary ||
      readText(quickTake) ||
      readText(summary) ||
      "",
    keyPoints,
    keyPointsLabel:
      capitalFinancingPreview?.keyPointsLabel ||
      (isSec8k6kEarningsEvent
        ? "Key Business Updates"
        : isGovernanceEvent
          ? "Key Changes"
          : "Key Points"),
    showKeyPoints:
      capitalFinancingPreview
        ? capitalFinancingPreview.showKeyPoints
        : isSec8k6kEarningsEvent || isGovernanceEvent
          ? keyPoints.length > 0
          : true,
  };
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
