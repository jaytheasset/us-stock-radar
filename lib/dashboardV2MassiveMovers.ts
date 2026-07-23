import {
  getNewYorkMarketSession,
} from "./dashboardV2ExtendedMovers.ts";
import type { DashboardV2Session } from "./dashboardV2Types";

export type DashboardV2ExtendedSession = Exclude<DashboardV2Session, "Regular">;

export type MassiveExtendedMoverCandidate = {
  asOfMilliseconds: number;
  changePercentage: number;
  priceValue: number;
  sessionDate: string;
  ticker: string;
  volumeValue?: number;
};

type MassiveAggregate = {
  av?: unknown;
  c?: unknown;
  t?: unknown;
  v?: unknown;
};

type MassiveSnapshotTicker = {
  day?: MassiveAggregate;
  min?: MassiveAggregate;
  prevDay?: MassiveAggregate;
  ticker?: unknown;
};

type MassiveDailyAggregate = {
  c?: unknown;
  T?: unknown;
  v?: unknown;
};

type MassiveDailyBaseline = {
  close: number;
  volume?: number;
};

export function buildMassiveExtendedCandidates({
  dailyPayload,
  session,
  snapshotPayload,
}: {
  dailyPayload?: unknown;
  session: DashboardV2ExtendedSession;
  snapshotPayload: unknown;
}) {
  const snapshotRows = readArray(snapshotPayload, "tickers");
  const dailyBaselines: Map<string, MassiveDailyBaseline> =
    session === "After"
      ? buildDailyBaselines(readArray(dailyPayload, "results"))
      : new Map();
  const candidates: MassiveExtendedMoverCandidate[] = [];

  for (const value of snapshotRows) {
    if (!value || typeof value !== "object") continue;
    const row = value as MassiveSnapshotTicker;
    const ticker = normalizeTicker(row.ticker);
    const priceValue = positiveNumber(row.min?.c);
    const classified = getNewYorkMarketSession(row.min?.t);
    if (!ticker || priceValue === null || !classified || classified.session !== session) continue;

    const baseline =
      session === "Pre"
        ? positiveNumber(row.prevDay?.c)
        : dailyBaselines.get(ticker)?.close ?? null;
    if (baseline === null) continue;

    const volumeValue =
      session === "Pre"
        ? firstNonNegativeNumber(row.min?.av, row.day?.v, row.min?.v)
        : calculateAfterHoursVolume(
            firstNonNegativeNumber(row.min?.av, row.day?.v),
            dailyBaselines.get(ticker)?.volume,
          );

    candidates.push({
      asOfMilliseconds: classified.epochMilliseconds,
      changePercentage: ((priceValue - baseline) / baseline) * 100,
      priceValue,
      sessionDate: classified.date,
      ticker,
      volumeValue: volumeValue ?? undefined,
    });
  }

  const marketDate = candidates.reduce(
    (latest, candidate) => candidate.sessionDate > latest ? candidate.sessionDate : latest,
    "",
  );
  const latestCandidates = candidates.filter((candidate) => candidate.sessionDate === marketDate);
  const asOfMilliseconds = latestCandidates.reduce(
    (latest, candidate) => Math.max(latest, candidate.asOfMilliseconds),
    0,
  );

  return {
    asOfMilliseconds,
    candidates: latestCandidates,
    marketDate,
    sourceCount: snapshotRows.length,
  };
}

function buildDailyBaselines(values: unknown[]) {
  const baselines = new Map<string, MassiveDailyBaseline>();
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const row = value as MassiveDailyAggregate;
    const ticker = normalizeTicker(row.T);
    const close = positiveNumber(row.c);
    if (!ticker || close === null) continue;
    baselines.set(ticker, {
      close,
      volume: nonNegativeNumber(row.v) ?? undefined,
    });
  }
  return baselines;
}

function calculateAfterHoursVolume(
  cumulativeVolume: number | null,
  regularVolume: number | undefined,
) {
  if (cumulativeVolume === null || regularVolume === undefined) return undefined;
  return Math.max(0, cumulativeVolume - regularVolume);
}

function readArray(value: unknown, key: string) {
  if (!value || typeof value !== "object") return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate : [];
}

function normalizeTicker(value: unknown) {
  const ticker = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) ? ticker : "";
}

function positiveNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function firstNonNegativeNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = nonNegativeNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
