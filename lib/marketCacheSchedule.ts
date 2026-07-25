import type { PriceRange } from "./marketTypes.ts";
import { getUsEquityMarketDaySchedule } from "./usEquityMarketCalendar.ts";

export const MARKET_CACHE_CRON_INTERVAL_MINUTES = 5;
export const MARKET_CACHE_LONG_RANGE_INTERVAL_MINUTES = 15;
export const MARKET_CACHE_WORKFLOW_LOCK_TTL_SECONDS = 2 * 60 * 60;
export const MARKET_CACHE_COMPLETION_HOLD_SECONDS = 4 * 60;
export const MARKET_CACHE_THEME_BATCH_SIZE = 30;

export const MARKET_CACHE_ROTATING_RANGES = [
  "5D",
  "1M",
  "3M",
] as const satisfies readonly PriceRange[];

export type MarketCacheRotatingRange =
  (typeof MARKET_CACHE_ROTATING_RANGES)[number];

export type MarketCacheRefreshTarget = {
  range: MarketCacheRotatingRange;
  sector: string;
};

export type MarketCacheRefreshPlan = {
  marketDate: string;
  marketMinute: number;
  marketPhase: "regular" | "post_close" | "closed";
  oneDaySector: string | null;
  refreshMarketPulse: boolean;
  refreshOneDayThemes: boolean;
  rotatingTarget: MarketCacheRefreshTarget | null;
  slotId: string;
};

const newYorkPartsFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
  year: "numeric",
});

export function getMarketCacheRefreshPlan(
  date: Date,
  sectors: readonly string[],
): MarketCacheRefreshPlan {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("A valid refresh timestamp is required");
  }

  const parts = readNewYorkParts(date);
  const marketDate = `${parts.year}-${parts.month}-${parts.day}`;
  const marketMinute = parts.hour * 60 + parts.minute;
  const schedule = getUsEquityMarketDaySchedule(marketDate);
  const normalizedSectors = Array.from(
    new Set(sectors.map((sector) => sector.trim()).filter(Boolean)),
  );
  const inRegularSession =
    schedule.tradingDay &&
    marketMinute >= schedule.regularOpenMinute &&
    marketMinute < schedule.regularCloseMinute;
  const inPostCloseRefresh =
    schedule.tradingDay &&
    marketMinute >= schedule.regularCloseMinute &&
    marketMinute <
      schedule.regularCloseMinute + MARKET_CACHE_CRON_INTERVAL_MINUTES;
  const oneDayDue =
    normalizedSectors.length > 0 &&
    (inRegularSession || inPostCloseRefresh);
  const oneDaySlot = Math.floor(
    (marketMinute - schedule.regularOpenMinute) /
      MARKET_CACHE_CRON_INTERVAL_MINUTES,
  );
  const oneDaySector = oneDayDue
    ? normalizedSectors[positiveModulo(oneDaySlot, normalizedSectors.length)]
    : null;

  const longRangeDue =
    normalizedSectors.length > 0 &&
    inRegularSession &&
    marketMinute % MARKET_CACHE_LONG_RANGE_INTERVAL_MINUTES === 0;
  const refreshMarketPulse =
    inPostCloseRefresh ||
    (inRegularSession &&
      marketMinute % MARKET_CACHE_LONG_RANGE_INTERVAL_MINUTES === 0);
  const absoluteLongRangeSlot = Math.floor(
    timestamp / (MARKET_CACHE_LONG_RANGE_INTERVAL_MINUTES * 60_000),
  );
  const pairCount =
    normalizedSectors.length * MARKET_CACHE_ROTATING_RANGES.length;
  const pairIndex = pairCount
    ? positiveModulo(absoluteLongRangeSlot, pairCount)
    : 0;
  const rotatingTarget = longRangeDue
    ? {
        range:
          MARKET_CACHE_ROTATING_RANGES[
            Math.floor(pairIndex / normalizedSectors.length)
          ],
        sector: normalizedSectors[pairIndex % normalizedSectors.length],
      }
    : null;

  return {
    marketDate,
    marketMinute,
    marketPhase: inRegularSession
      ? "regular"
      : inPostCloseRefresh
        ? "post_close"
        : "closed",
    oneDaySector,
    refreshMarketPulse,
    refreshOneDayThemes: oneDayDue,
    rotatingTarget,
    slotId: `${marketDate}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}[America/New_York]`,
  };
}

export function splitMarketCacheThemeBatches(
  slugs: readonly string[],
  batchSize = MARKET_CACHE_THEME_BATCH_SIZE,
) {
  const uniqueSlugs = Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter(Boolean)),
  );
  const normalizedBatchSize = Math.max(1, Math.trunc(batchSize));
  const batches: string[][] = [];
  for (let index = 0; index < uniqueSlugs.length; index += normalizedBatchSize) {
    batches.push(uniqueSlugs.slice(index, index + normalizedBatchSize));
  }
  return batches;
}

function readNewYorkParts(date: Date) {
  const parts = Object.fromEntries(
    newYorkPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: parts.month,
    year: parts.year,
  };
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
