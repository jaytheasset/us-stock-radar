export type Level2SecAcceptanceTimestamp = {
  acceptedAt: string | null;
  acceptedAtSource: "sec_raw_payload_acceptance" | "unavailable";
  acceptedAtProvenance: Record<string, unknown>;
};

export function resolveLevel2SecAcceptanceTimestamp(input: {
  rawAcceptedAt: unknown;
  publishedAt: unknown;
  filedDate: unknown;
  accessionNumber: string;
  rawItemId: string;
}): Level2SecAcceptanceTimestamp {
  const acceptedAt = normalizeTimestamp(stringValue(input.rawAcceptedAt)) || null;
  if (acceptedAt) {
    return {
      acceptedAt,
      acceptedAtSource: "sec_raw_payload_acceptance",
      acceptedAtProvenance: {
        source: "raw_items.raw_payload.accepted_at",
        accessionNumber: input.accessionNumber,
        rawItemId: input.rawItemId,
      },
    };
  }
  return {
    acceptedAt: null,
    acceptedAtSource: "unavailable",
    acceptedAtProvenance: {
      source: "unavailable",
      reason: "SEC_ACCEPTANCE_TIMESTAMP_UNAVAILABLE",
      rejectedFallbacks: {
        publishedAt: stringValue(input.publishedAt) || null,
        filedDate: stringValue(input.filedDate) || null,
      },
    },
  };
}

function normalizeTimestamp(value: string) {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.valueOf())) return "";
  return parsed.toISOString();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
