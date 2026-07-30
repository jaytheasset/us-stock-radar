import { randomUUID } from "node:crypto";
import { parseDateOnly } from "./dateUtils.ts";
import { adaptFmpEconomicCalendarRows } from "./fmpEconomicCalendarAdapter.ts";
import {
  FMP_ECONOMIC_CALENDAR_EVENT_TYPES,
  FMP_ECONOMIC_CALENDAR_UNSUPPORTED_POLICY_TYPES,
  type FmpEconomicCalendarFetchResult,
  type FmpEconomicCalendarIngestRequest,
  type FmpEconomicCalendarIngestResult,
  type FmpEconomicCalendarObservation,
  type FmpEconomicCalendarPersistResult,
} from "./fmpEconomicCalendarTypes.ts";
import { MAX_CALENDAR_RANGE_DAYS } from "./normalized.ts";

export type FmpEconomicCalendarIngestDependencies = {
  fetchRange: (
    from: string,
    to: string,
  ) => Promise<FmpEconomicCalendarFetchResult>;
  persistObservation: (
    observation: FmpEconomicCalendarObservation,
  ) => Promise<FmpEconomicCalendarPersistResult>;
  runId?: () => string;
};

export type FmpEconomicCalendarRequestParseResult =
  | { ok: true; request: FmpEconomicCalendarIngestRequest }
  | { ok: false; error: string };

export function parseFmpEconomicCalendarIngestRequest(
  method: "GET" | "POST",
  searchParams: Pick<URLSearchParams, "get">,
  body: unknown,
): FmpEconomicCalendarRequestParseResult {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const from = readString(searchParams.get("from"), record.from);
  const to = readString(searchParams.get("to"), record.to);
  if (!from || !to) return { ok: false, error: "from and to are required." };
  try {
    parseDateOnly(from);
    parseDateOnly(to);
  } catch {
    return { ok: false, error: "from and to must be valid YYYY-MM-DD dates." };
  }
  if (from > to) return { ok: false, error: "from must not be later than to." };
  if (inclusiveDays(from, to) > MAX_CALENDAR_RANGE_DAYS) {
    return {
      ok: false,
      error: `Date ranges are limited to ${MAX_CALENDAR_RANGE_DAYS} days.`,
    };
  }

  const eventTypes = readEventTypes(
    searchParams.get("eventTypes"),
    record.eventTypes,
  );
  if (!eventTypes.ok) return eventTypes;

  const mode = readString(searchParams.get("mode"), record.mode);
  if (mode && mode !== "backfill") {
    return { ok: false, error: "Only backfill mode is available." };
  }

  const queryDryRun = readBoolean(searchParams.get("dryRun"));
  const bodyDryRun = readBoolean(record.dryRun);
  const queryPersist = readBoolean(searchParams.get("persist"));
  const bodyPersist = readBoolean(record.persist);
  if (
    queryDryRun === "invalid" ||
    bodyDryRun === "invalid" ||
    queryPersist === "invalid" ||
    bodyPersist === "invalid"
  ) {
    return { ok: false, error: "dryRun and persist must be booleans." };
  }
  const dryRun = queryDryRun ?? bodyDryRun ?? true;
  const persist = queryPersist ?? bodyPersist ?? false;
  if (method === "GET" && (!dryRun || persist)) {
    return { ok: false, error: "GET is dry-run only." };
  }
  if (method === "POST" && (dryRun || !persist)) {
    return {
      ok: false,
      error: "POST requires dryRun=false and persist=true.",
    };
  }

  return {
    ok: true,
    request: {
      dryRun,
      eventTypes: eventTypes.eventTypes,
      from,
      mode: "backfill",
      persist,
      to,
    },
  };
}

export async function runFmpEconomicCalendarIngestCore(
  request: FmpEconomicCalendarIngestRequest,
  dependencies: FmpEconomicCalendarIngestDependencies,
): Promise<FmpEconomicCalendarIngestResult> {
  const coverage = {
    supported: [...FMP_ECONOMIC_CALENDAR_EVENT_TYPES],
    unsupportedPolicy: FMP_ECONOMIC_CALENDAR_UNSUPPORTED_POLICY_TYPES,
  };
  const emptyStats = {
    accepted: 0,
    fetched: 0,
    history: 0,
    matchedRows: 0,
    rejected: 0,
    truncated: false,
    unchanged: 0,
    unsupported: 0,
    upserted: 0,
    usRows: 0,
  };

  let fetched: FmpEconomicCalendarFetchResult;
  try {
    fetched = await dependencies.fetchRange(request.from, request.to);
  } catch {
    return {
      coverage,
      dryRun: request.dryRun,
      eventTypes: request.eventTypes,
      from: request.from,
      mode: "backfill",
      ok: false,
      persist: request.persist,
      stage: "fetch-failed",
      stats: emptyStats,
      to: request.to,
      warnings: ["fetch_failed:economic-calendar"],
    };
  }

  const adapted = adaptFmpEconomicCalendarRows(fetched.rows, {
    eventTypes: new Set(request.eventTypes),
    fetchedAt: fetched.fetchedAt,
    requestFrom: request.from,
    requestTo: request.to,
    runId: (dependencies.runId ?? randomUUID)(),
  });
  const stats = {
    ...emptyStats,
    accepted: adapted.observations.length,
    fetched: fetched.rows.length,
    matchedRows: adapted.matchedRows,
    rejected: adapted.rejectedRows,
    truncated: fetched.truncated,
    unsupported: adapted.unsupportedRows,
    usRows: adapted.usRows,
  };
  const warnings = new Set(adapted.warnings);

  if (fetched.truncated || request.dryRun) {
    if (fetched.truncated && request.persist) {
      warnings.add("persist_blocked_incomplete_fetch");
    }
    return {
      coverage,
      dryRun: request.dryRun,
      eventTypes: request.eventTypes,
      from: request.from,
      mode: "backfill",
      ok: !fetched.truncated,
      persist: request.persist,
      stage: fetched.truncated ? "truncated" : "dry-run",
      stats,
      to: request.to,
      warnings: Array.from(warnings).sort(),
    };
  }

  for (const observation of adapted.observations) {
    const result = await dependencies.persistObservation(observation);
    if (result.upserted) stats.upserted += 1;
    if (result.unchanged) stats.unchanged += 1;
    if (result.historyCreated) stats.history += 1;
  }

  return {
    coverage,
    dryRun: false,
    eventTypes: request.eventTypes,
    from: request.from,
    mode: "backfill",
    ok: true,
    persist: true,
    stage: "persisted",
    stats,
    to: request.to,
    warnings: Array.from(warnings).sort(),
  };
}

function readEventTypes(
  queryValue: string | null,
  bodyValue: unknown,
):
  | {
      eventTypes: FmpEconomicCalendarIngestRequest["eventTypes"];
      ok: true;
    }
  | { error: string; ok: false } {
  const raw = queryValue
    ? queryValue.split(",")
    : Array.isArray(bodyValue)
      ? bodyValue
      : bodyValue === undefined
        ? [...FMP_ECONOMIC_CALENDAR_EVENT_TYPES]
        : [];
  if (!raw.length || raw.some((value) => typeof value !== "string")) {
    return { error: "eventTypes must be a non-empty string array.", ok: false };
  }
  const eventTypes = Array.from(
    new Set(raw.map((value) => String(value).trim())),
  );
  if (
    eventTypes.some(
      (value) =>
        !(FMP_ECONOMIC_CALENDAR_EVENT_TYPES as readonly string[]).includes(
          value,
        ),
    )
  ) {
    return { error: "eventTypes contains an unsupported value.", ok: false };
  }
  return {
    eventTypes:
      eventTypes as FmpEconomicCalendarIngestRequest["eventTypes"],
    ok: true,
  };
}

function readString(queryValue: string | null, bodyValue: unknown) {
  if (queryValue !== null) return queryValue.trim();
  return typeof bodyValue === "string" ? bodyValue.trim() : "";
}

function readBoolean(value: unknown): boolean | "invalid" | null {
  if (value === null || value === undefined) return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return "invalid";
}

function inclusiveDays(from: string, to: string) {
  return (
    Math.round(
      (parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) /
        86_400_000,
    ) + 1
  );
}
