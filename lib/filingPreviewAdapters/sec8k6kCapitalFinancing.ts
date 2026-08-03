const capitalSnapshotModes = new Set([
  "atm_capacity",
  "capital_structure_action",
  "equity_issuance",
  "share_linked_financing",
]);

export type Sec8k6kCapitalFinancingPreview = {
  keyPoints: string[];
  keyPointsLabel: "Capital Snapshot";
  showKeyPoints: boolean;
};

export function resolveSec8k6kCapitalFinancingPreview({
  displayPayload,
  primaryEventType,
}: {
  displayPayload: unknown;
  primaryEventType: string;
}): Sec8k6kCapitalFinancingPreview | null {
  const display = isRecord(displayPayload) ? displayPayload : null;
  const data = isRecord(display?.data) ? display.data : null;
  const matchesCapitalSnapshot =
    readText(display?.display_type) === "capital_financing" &&
    readText(data?.display_version) === "sec_8k_6k_capital_financing_v1" &&
    primaryEventType === "dilution_risk" &&
    capitalSnapshotModes.has(readText(data?.capital_mode));

  if (!matchesCapitalSnapshot) return null;

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
