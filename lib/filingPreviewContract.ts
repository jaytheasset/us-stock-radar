import { resolveCapitalSnapshotPreview } from "./filingPreviewAdapters/sec8k6kCapitalFinancing.ts";

export type FilingPreviewFieldsInput = {
  displayPayload?: unknown;
  formType?: unknown;
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
  formType,
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
  const normalizedFormType = readText(formType)
    .toUpperCase()
    .replace(/\s+/g, "");
  const capitalSnapshotPreview = resolveCapitalSnapshotPreview({
    displayPayload,
    formType,
    primaryEventType: primaryEventType || "",
  });
  const isGovernanceEvent =
    display?.display_type === "governance_event" || governanceEvent;
  const isPeriodicAmendment =
    ["10-K/A", "20-F/A", "40-F/A"].includes(normalizedFormType) &&
    display?.display_type === "periodic_amendment";
  const isPeriodicReport =
    ["10-K", "10-Q", "20-F", "40-F"].includes(normalizedFormType) &&
    display?.display_type === "periodic_report";
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
  const amendmentKeyChanges = Array.isArray(displayData?.amended_items)
    ? displayData.amended_items.map(readText)
    : [];
  const periodicBusinessUpdates = Array.isArray(
    displayData?.key_business_updates,
  )
    ? displayData.key_business_updates
        .filter(isRecord)
        .map((update) => readText(update.title))
    : [];
  const usesPeriodicBusinessUpdates =
    isPeriodicReport &&
    readText(displayData?.event_type).toLowerCase() === "earnings" &&
    periodicBusinessUpdates.some(Boolean);
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
  const keyPointCandidates = capitalSnapshotPreview
    ? capitalSnapshotPreview.keyPoints
    : isPeriodicAmendment
      ? amendmentKeyChanges
      : usesPeriodicBusinessUpdates
        ? periodicBusinessUpdates
        : isSec8k6kEarningsEvent
          ? earningsBusinessUpdates
          : isGovernanceEvent
            ? governanceKeyChanges
            : evidence;
  const keyPoints = Array.from(
    new Set(keyPointCandidates.filter(Boolean)),
  ).slice(0, capitalSnapshotPreview ? 4 : 3);

  return {
    filingBrief:
      primarySummary ||
      firstEventSummary ||
      readText(quickTake) ||
      readText(summary) ||
      "",
    keyPoints,
    keyPointsLabel:
      capitalSnapshotPreview?.keyPointsLabel ||
      (isPeriodicAmendment
        ? "Key Changes"
        : usesPeriodicBusinessUpdates
          ? "Key Business Updates"
          : isSec8k6kEarningsEvent
            ? "Key Business Updates"
            : isGovernanceEvent
              ? "Key Changes"
              : "Key Points"),
    showKeyPoints:
      capitalSnapshotPreview
        ? capitalSnapshotPreview.showKeyPoints
        : isPeriodicAmendment ||
            isPeriodicReport ||
            isSec8k6kEarningsEvent ||
            isGovernanceEvent
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
