import type { DashboardV2Session } from "./dashboardV2Types";

export const dashboardV2MoverModes = ["gainers", "losers", "volume"] as const;

export type DashboardV2MoverMode = (typeof dashboardV2MoverModes)[number];

export type NewYorkMarketSession = {
  date: string;
  epochMilliseconds: number;
  session: DashboardV2Session;
};

type ExtendedMoverRankable = {
  changePercentage: number;
  ticker: string;
  volumeValue?: number;
};

const newYorkTime = new Intl.DateTimeFormat("en-US", {
  calendar: "gregory",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  numberingSystem: "latn",
  second: "2-digit",
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
});

export function getNewYorkMarketSession(value: unknown): NewYorkMarketSession | null {
  const epochMilliseconds = parseTimestamp(value);
  if (epochMilliseconds === null) return null;

  const parts = Object.fromEntries(
    newYorkTime
      .formatToParts(new Date(epochMilliseconds))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return null;

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  if (![hour, minute, second].every(Number.isFinite)) return null;

  const time = hour * 60 * 60 + minute * 60 + second;
  let session: DashboardV2Session | null = null;
  if (time >= 4 * 60 * 60 && time < 9 * 60 * 60 + 30 * 60) {
    session = "Pre";
  } else if (time >= 9 * 60 * 60 + 30 * 60 && time < 16 * 60 * 60) {
    session = "Regular";
  } else if (time >= 16 * 60 * 60 && time < 20 * 60 * 60) {
    session = "After";
  }
  if (!session) return null;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    epochMilliseconds,
    session,
  };
}

export function rankExtendedMovers<T extends ExtendedMoverRankable>(
  rows: readonly T[],
  mode: DashboardV2MoverMode,
) {
  const eligible = rows.filter((row) => {
    if (!Number.isFinite(row.changePercentage)) return false;
    if (mode === "gainers") return row.changePercentage > 0;
    if (mode === "losers") return row.changePercentage < 0;
    return row.volumeValue !== undefined && Number.isFinite(row.volumeValue);
  });

  return [...eligible].sort((left, right) => {
    const difference =
      mode === "volume"
        ? (right.volumeValue || 0) - (left.volumeValue || 0)
        : mode === "gainers"
          ? right.changePercentage - left.changePercentage
          : left.changePercentage - right.changePercentage;
    return difference || left.ticker.localeCompare(right.ticker);
  });
}

function parseTimestamp(value: unknown) {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 10_000_000_000 ? value * 1_000 : value;
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return Math.abs(parsed) < 10_000_000_000 ? parsed * 1_000 : parsed;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
