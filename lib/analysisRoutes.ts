export type AnalysisRouteSourceGroup = "news" | "filings";

type AnalysisRouteInput = {
  deliveryLevel?: unknown;
  id: string;
  metadata?: unknown;
  sourceGroup: AnalysisRouteSourceGroup;
};

const persistentEventIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getCanonicalAnalysisPath({
  deliveryLevel,
  id,
  metadata,
  sourceGroup,
}: AnalysisRouteInput) {
  const eventId = id.trim().toLowerCase();
  if (!persistentEventIdPattern.test(eventId)) return null;

  if (sourceGroup === "news") {
    return deliveryLevel === "archive"
      ? `/news/archive/${encodeURIComponent(eventId)}`
      : `/news/${encodeURIComponent(eventId)}`;
  }

  return shouldUseCompactFilingArchiveRoute(deliveryLevel, metadata)
    ? `/filings/archive/${encodeURIComponent(eventId)}`
    : `/filings/${encodeURIComponent(eventId)}`;
}

export function shouldUseCompactFilingArchiveRoute(
  deliveryLevel: unknown,
  metadata: unknown,
) {
  if (deliveryLevel !== "archive") return false;

  const record = asRecord(metadata);
  const archiveRoute = readString(record, "archive_route");
  if (archiveRoute === "common_filing_detail") return false;
  if (archiveRoute === "compact_archive") return true;

  const runtimeSource = readString(record, "analysis_runtime_source");
  if (runtimeSource === "llm") return false;
  if (runtimeSource === "parser_deterministic") return true;

  return !readString(record, "openai_response_id");
}

export function isPersistentAnalysisId(value: unknown) {
  return typeof value === "string" && persistentEventIdPattern.test(value.trim());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}
