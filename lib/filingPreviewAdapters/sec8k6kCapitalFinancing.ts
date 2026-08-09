const capitalSnapshotModes = new Set([
  "atm_capacity",
  "capital_structure_action",
  "equity_issuance",
  "share_linked_financing",
]);

export type CapitalSnapshotPreview = {
  keyPoints: string[];
  keyPointsLabel: "Capital Snapshot";
  showKeyPoints: boolean;
};

export function resolveCapitalSnapshotPreview({
  displayPayload,
  formType,
  primaryEventType,
}: {
  displayPayload: unknown;
  formType: unknown;
  primaryEventType: string;
}): CapitalSnapshotPreview | null {
  const display = isRecord(displayPayload) ? displayPayload : null;
  const data = isRecord(display?.data) ? display.data : null;
  const displayType = readText(display?.display_type);
  const displayVersion =
    readText(display?.display_version) || readText(data?.display_version);
  const normalizedFormType = readText(formType).toUpperCase().replace(/\s+/g, "");
  const matchesSec8k6kCapitalSnapshot =
    displayType === "capital_financing" &&
    displayVersion === "sec_8k_6k_capital_financing_v1" &&
    primaryEventType === "dilution_risk" &&
    capitalSnapshotModes.has(readText(data?.capital_mode));
  const matchesS3OfferingCapitalSnapshot =
    (normalizedFormType === "S-3" || normalizedFormType === "S-3ASR") &&
    displayType === "offering_terms" &&
    Array.isArray(data?.snapshot_metrics);
  const matchesOfferingCapitalSnapshot =
    matchesS3OfferingCapitalSnapshot ||
    (normalizedFormType === "424B5" &&
      displayType === "offering_terms" &&
      ["", "1.0", "424b-display-payload-v1"].includes(displayVersion) &&
      Array.isArray(data?.snapshot_metrics));

  if (!matchesSec8k6kCapitalSnapshot && !matchesOfferingCapitalSnapshot) {
    return null;
  }

  const keyPoints = Array.from(
    new Set(
      (Array.isArray(data?.snapshot_metrics) ? data.snapshot_metrics : [])
        .filter(isRecord)
        .map((metric) => {
          const label = readText(metric.label);
          const value = readText(metric.value);
          return label && value ? `${label}: ${value}` : "";
        })
        .filter(Boolean),
    ),
  ).slice(0, 4);

  return {
    keyPoints,
    keyPointsLabel: "Capital Snapshot",
    showKeyPoints: keyPoints.length > 0,
  };
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
