export const SEC_DIAGNOSTIC_RECENT_SCAN_LIMIT = 120;
export const SEC_DIAGNOSTIC_RECENT_ROOM_LIMIT = 10;
export const SEC_DIAGNOSTIC_EXACT_ACCESSION_LIMIT = 20;

export type SecPersistedDiagnosticQuery = "recent" | "exact_event" | "exact_accession";

export type SecPersistedDiagnosticReadResult = {
  status: "ok" | "read_failed";
  query: SecPersistedDiagnosticQuery;
  rows: Array<Record<string, unknown>>;
};

type DiagnosticFilters = {
  eventId?: string | null;
  accessionNumber?: string | null;
};

type SelectResult = {
  ok: boolean;
  data?: unknown;
};

export type SecDiagnosticSelect = (
  table: string,
  search: Record<string, string>,
) => Promise<SelectResult>;

export async function readSecPersistedEventRows({
  filters,
  select,
}: {
  filters: DiagnosticFilters;
  select: SecDiagnosticSelect;
}): Promise<SecPersistedDiagnosticReadResult> {
  const eventId = stringValue(filters.eventId);
  const accessionNumber = stringValue(filters.accessionNumber);
  const query: SecPersistedDiagnosticQuery = eventId
    ? "exact_event"
    : accessionNumber
      ? "exact_accession"
      : "recent";
  const search = buildPersistedEventSearch(query, { eventId, accessionNumber });

  try {
    const result = await select("events", search);
    if (!result.ok || !Array.isArray(result.data)) {
      return { status: "read_failed", query, rows: [] };
    }
    return {
      status: "ok",
      query,
      rows: result.data.filter(isRecord),
    };
  } catch {
    return { status: "read_failed", query, rows: [] };
  }
}

export function limitSecPersistedRoomRows(
  rows: Array<Record<string, unknown>>,
  query: SecPersistedDiagnosticQuery,
) {
  return query === "recent" ? rows.slice(0, SEC_DIAGNOSTIC_RECENT_ROOM_LIMIT) : rows;
}

function buildPersistedEventSearch(
  query: SecPersistedDiagnosticQuery,
  identifiers: { eventId: string; accessionNumber: string },
): Record<string, string> {
  if (query === "exact_event") {
    return {
      select: "*",
      source_group: "eq.filings",
      id: `eq.${identifiers.eventId}`,
      limit: "1",
    };
  }
  if (query === "exact_accession") {
    return {
      select: "*",
      source_group: "eq.filings",
      "metadata->>accession_number": `eq.${identifiers.accessionNumber}`,
      order: "detected_at.desc",
      limit: String(SEC_DIAGNOSTIC_EXACT_ACCESSION_LIMIT),
    };
  }
  return {
    select: "*",
    source_group: "eq.filings",
    order: "detected_at.desc",
    limit: String(SEC_DIAGNOSTIC_RECENT_SCAN_LIMIT),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
