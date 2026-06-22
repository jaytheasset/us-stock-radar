import type { SecAlertCandidatePayload } from "@/lib/sources/sec/forms/common/runtimeStoreContract";

export type SecAlertQueueResult = {
  ok: true;
  queued: boolean;
  queueMode: "events.delivery_level";
  reason: string;
};

export function buildSecFilingAlertCandidate(eventRow: Record<string, unknown>, analysis: Record<string, unknown>) {
  if (stringValue(eventRow.delivery_level) !== "alert") return null;

  return {
    accessionNumber: stringValue(toRecord(eventRow.metadata)?.accession_number),
    eventType: stringValue(eventRow.event_type),
    score: numberValue(eventRow.score),
    signal: stringValue(eventRow.signal),
    reason: stringValue(eventRow.reason) || stringValue(analysis.score_reason),
    evidence: stringArray(analysis.key_evidence),
    metadata: {
      event_id: stringValue(eventRow.id),
      source_group: stringValue(eventRow.source_group),
      queue_mode: "events.delivery_level",
    },
  } satisfies SecAlertCandidatePayload;
}

export async function enqueueSecFilingAlertCandidate(
  candidate: SecAlertCandidatePayload | null,
): Promise<SecAlertQueueResult> {
  if (!candidate) {
    return {
      ok: true,
      queued: false,
      queueMode: "events.delivery_level",
      reason: "SEC filing score is below alert band.",
    };
  }

  return {
    ok: true,
    queued: true,
    queueMode: "events.delivery_level",
    reason: "Alert delivery scheduler consumes SEC filing events where delivery_level=alert.",
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
