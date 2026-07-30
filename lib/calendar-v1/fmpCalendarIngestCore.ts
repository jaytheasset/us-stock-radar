import { randomUUID } from "node:crypto";
import { adaptFmpCalendarRow } from "./fmpCalendarAdapter.ts";
import { addDateOnlyDays, parseDateOnly } from "./dateUtils.ts";
import {
  FMP_CALENDAR_FETCH_CONCURRENCY,
  FMP_CALENDAR_READ_LIMIT,
  FMP_COMPANY_CALENDAR_EVENT_TYPES,
  type FmpCalendarFetchResult,
  type FmpCalendarIngestRequest,
  type FmpCalendarIngestResult,
  type FmpCalendarIngestStats,
  type FmpCalendarObservation,
  type FmpCalendarPersistResult,
  type FmpCompanyCalendarEventType,
  type FmpTickerUniverseEntry,
} from "./fmpCalendarTypes.ts";
import { MAX_CALENDAR_RANGE_DAYS } from "./normalized.ts";

export type FmpCalendarIngestDependencies = {
  fetchDay: (
    eventType: FmpCompanyCalendarEventType,
    date: string,
  ) => Promise<FmpCalendarFetchResult>;
  loadUniverse: () => Promise<Map<string, FmpTickerUniverseEntry>>;
  persistObservation: (
    observation: FmpCalendarObservation,
  ) => Promise<FmpCalendarPersistResult>;
  runId?: () => string;
};

export type FmpCalendarRequestParseResult =
  | { ok: true; request: FmpCalendarIngestRequest }
  | { ok: false; error: string };

export function parseFmpCalendarIngestRequest(
  method: "GET" | "POST",
  searchParams: Pick<URLSearchParams, "get">,
  body: unknown,
): FmpCalendarRequestParseResult {
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const from = readInputString(searchParams.get("from"), bodyRecord.from);
  const to = readInputString(searchParams.get("to"), bodyRecord.to);
  if (!from || !to) {
    return { ok: false, error: "from and to are required." };
  }
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

  const eventTypesResult = readEventTypes(
    searchParams.get("eventTypes"),
    bodyRecord.eventTypes,
  );
  if (!eventTypesResult.ok) return eventTypesResult;

  const mode = readInputString(searchParams.get("mode"), bodyRecord.mode);
  if (mode && mode !== "backfill") {
    return { ok: false, error: "Only backfill mode is available." };
  }

  const queryDryRun = readBoolean(searchParams.get("dryRun"));
  const bodyDryRun = readBoolean(bodyRecord.dryRun);
  if (queryDryRun === "invalid" || bodyDryRun === "invalid") {
    return { ok: false, error: "dryRun must be a boolean." };
  }
  const queryPersist = readBoolean(searchParams.get("persist"));
  const bodyPersist = readBoolean(bodyRecord.persist);
  if (queryPersist === "invalid" || bodyPersist === "invalid") {
    return { ok: false, error: "persist must be a boolean." };
  }

  const dryRun =
    queryDryRun ?? bodyDryRun ?? true;
  const persist = queryPersist ?? bodyPersist ?? false;
  if (method === "GET" && (!dryRun || persist)) {
    return { ok: false, error: "GET is dry-run only." };
  }
  if (persist === dryRun) {
    return {
      ok: false,
      error: "Persist requires dryRun=false and persist=true.",
    };
  }

  return {
    ok: true,
    request: {
      dryRun,
      eventTypes: eventTypesResult.eventTypes,
      from,
      mode: "backfill",
      persist,
      to,
    },
  };
}

export async function runFmpCalendarIngestCore(
  request: FmpCalendarIngestRequest,
  dependencies: FmpCalendarIngestDependencies,
): Promise<FmpCalendarIngestResult> {
  const universe = await dependencies.loadUniverse();
  const stats = createStats(universe.size);
  const warnings = new Set<string>();
  const tasks = enumerateDates(request.from, request.to).flatMap((date) =>
    request.eventTypes.map((eventType) => ({ date, eventType })),
  );
  const fetchResults = await mapWithConcurrency(
    tasks,
    FMP_CALENDAR_FETCH_CONCURRENCY,
    async (task) => {
      try {
        return {
          ok: true as const,
          result: await dependencies.fetchDay(task.eventType, task.date),
        };
      } catch {
        return { ok: false as const, task };
      }
    },
  );

  const runId = (dependencies.runId ?? randomUUID)();
  const accepted: Array<{
    observation: FmpCalendarObservation;
    universeClass: "listed" | "ipo-candidate";
  }> = [];
  for (const fetched of fetchResults) {
    if (!fetched.ok) {
      stats.endpointErrors += 1;
      warnings.add(
        `fetch_failed:${fetched.task.eventType}:${fetched.task.date}`,
      );
      continue;
    }
    const endpointStats = stats.endpoints[fetched.result.eventType];
    endpointStats.fetched += fetched.result.rows.length;
    stats.fetched += fetched.result.rows.length;
    if (fetched.result.truncated) {
      endpointStats.truncated = true;
      stats.truncated = true;
      warnings.add(
        `daily_cap_reached:${fetched.result.eventType}:${fetched.result.date}`,
      );
    }
    for (const row of fetched.result.rows) {
      const outcome = adaptFmpCalendarRow(
        fetched.result.eventType,
        row,
        {
          fetchedAt: fetched.result.fetchedAt,
          requestDate: fetched.result.date,
          runId,
          universe,
        },
      );
      for (const warning of outcome.warnings) warnings.add(warning);
      if (outcome.kind === "accepted") {
        accepted.push(outcome);
      } else {
        endpointStats[outcome.kind] += 1;
        stats[outcome.kind] += 1;
        warnings.add(`${outcome.kind}:${outcome.reason}`);
      }
    }
  }

  const deduped = deduplicateObservations(accepted, stats, warnings);
  stats.accepted = deduped.length;
  for (const item of deduped) {
    const endpointStats = stats.endpoints[item.observation.eventType];
    endpointStats.accepted += 1;
    endpointStats[item.universeClass === "listed" ? "listed" : "ipoCandidates"] +=
      1;
    stats[item.universeClass === "listed" ? "listed" : "ipoCandidates"] += 1;
  }
  stats.readLimitRisk = stats.accepted > FMP_CALENDAR_READ_LIMIT;
  if (stats.readLimitRisk) {
    warnings.add(
      `read_limit_risk:${stats.accepted}>${FMP_CALENDAR_READ_LIMIT}`,
    );
  }

  const fetchFailed = stats.endpointErrors > 0;
  if (fetchFailed || stats.truncated || request.dryRun) {
    if (request.persist && (fetchFailed || stats.truncated)) {
      warnings.add("persist_blocked_incomplete_fetch");
    }
    return {
      dryRun: request.dryRun,
      eventTypes: request.eventTypes,
      from: request.from,
      mode: request.mode,
      ok: !fetchFailed && !stats.truncated,
      persist: request.persist,
      stage: fetchFailed
        ? "fetch-failed"
        : stats.truncated
          ? "truncated"
          : "dry-run",
      stats,
      to: request.to,
      warnings: Array.from(warnings).sort(),
    };
  }

  for (const item of deduped) {
    const persisted = await dependencies.persistObservation(item.observation);
    const endpointStats = stats.endpoints[item.observation.eventType];
    if (persisted.upserted) {
      stats.upserted += 1;
      endpointStats.upserted += 1;
    }
    if (persisted.unchanged) {
      stats.unchanged += 1;
      endpointStats.unchanged += 1;
    }
    if (persisted.historyCreated) {
      stats.history += 1;
      endpointStats.history += 1;
    }
  }

  return {
    dryRun: false,
    eventTypes: request.eventTypes,
    from: request.from,
    mode: request.mode,
    ok: true,
    persist: true,
    stage: "persisted",
    stats,
    to: request.to,
    warnings: Array.from(warnings).sort(),
  };
}

function deduplicateObservations(
  accepted: Array<{
    observation: FmpCalendarObservation;
    universeClass: "listed" | "ipo-candidate";
  }>,
  stats: FmpCalendarIngestStats,
  warnings: Set<string>,
) {
  const groups = new Map<string, typeof accepted>();
  for (const item of accepted) {
    const group = groups.get(item.observation.canonicalIdentityKey) ?? [];
    group.push(item);
    groups.set(item.observation.canonicalIdentityKey, group);
  }

  const result: typeof accepted = [];
  for (const [identity, group] of groups) {
    const fingerprints = new Set(
      group.map((item) => item.observation.observationFingerprint),
    );
    if (fingerprints.size > 1) {
      stats.quarantined += group.length;
      for (const item of group) {
        stats.endpoints[item.observation.eventType].quarantined += 1;
      }
      warnings.add(`quarantined:identity_collision:${identity}`);
      continue;
    }
    result.push(group[0]);
    const duplicateCount = group.length - 1;
    if (duplicateCount > 0) {
      stats.deduplicated += duplicateCount;
      stats.endpoints[group[0].observation.eventType].deduplicated +=
        duplicateCount;
    }
  }
  return result.sort(
    (left, right) =>
      left.observation.eventDate.localeCompare(right.observation.eventDate) ||
      left.observation.eventType.localeCompare(right.observation.eventType) ||
      left.observation.canonicalIdentityKey.localeCompare(
        right.observation.canonicalIdentityKey,
      ),
  );
}

function createStats(universeSize: number): FmpCalendarIngestStats {
  const endpoint = () => ({
    accepted: 0,
    deduplicated: 0,
    fetched: 0,
    filtered: 0,
    history: 0,
    ipoCandidates: 0,
    listed: 0,
    quarantined: 0,
    rejected: 0,
    truncated: false,
    unchanged: 0,
    upserted: 0,
  });
  return {
    accepted: 0,
    deduplicated: 0,
    endpointErrors: 0,
    endpoints: {
      dividend: endpoint(),
      earnings: endpoint(),
      ipo: endpoint(),
      split: endpoint(),
    },
    fetched: 0,
    filtered: 0,
    history: 0,
    ipoCandidates: 0,
    listed: 0,
    quarantined: 0,
    readLimitRisk: false,
    rejected: 0,
    truncated: false,
    unchanged: 0,
    universeSize,
    upserted: 0,
  };
}

function readEventTypes(
  queryValue: string | null,
  bodyValue: unknown,
):
  | { ok: true; eventTypes: FmpCompanyCalendarEventType[] }
  | { ok: false; error: string } {
  const raw = queryValue
    ? queryValue.split(",")
    : Array.isArray(bodyValue)
      ? bodyValue
      : bodyValue === undefined
        ? [...FMP_COMPANY_CALENDAR_EVENT_TYPES]
        : [];
  if (!raw.length || raw.some((value) => typeof value !== "string")) {
    return { ok: false, error: "eventTypes must be a non-empty string array." };
  }
  const eventTypes = Array.from(
    new Set(raw.map((value) => String(value).trim())),
  );
  if (
    eventTypes.some(
      (value) =>
        !(FMP_COMPANY_CALENDAR_EVENT_TYPES as readonly string[]).includes(
          value,
        ),
    )
  ) {
    return { ok: false, error: "eventTypes contains an unsupported value." };
  }
  return {
    ok: true,
    eventTypes: eventTypes as FmpCompanyCalendarEventType[],
  };
}

function readInputString(queryValue: string | null, bodyValue: unknown) {
  if (queryValue !== null) return queryValue.trim();
  return typeof bodyValue === "string" ? bodyValue.trim() : "";
}

function readBoolean(value: unknown): boolean | "invalid" | null {
  if (value === null || value === undefined) return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return "invalid";
}

function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  for (let current = from; current <= to; current = addDateOnlyDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function inclusiveDays(from: string, to: string) {
  return enumerateDates(from, to).length;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
