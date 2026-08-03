import type { DashboardV2Session } from "./dashboardV2Types";
import {
  classifyUsEquityMarketMinute,
  getUsEquityMarketDaySchedule,
} from "./usEquityMarketCalendar.ts";

export type DashboardMoverPhase = "active" | "finalizing" | "closed";

export type DashboardMoverLifecycle = {
  expectedFinalProviderMinute: number | null;
  marketDate: string;
  phase: DashboardMoverPhase;
  refreshAfterSeconds: number | null;
  refreshAllowed: boolean;
};

const preOpenMinute = 4 * 60;
// Starter snapshots are delayed by roughly 15 minutes. Start slightly early
// and finalize only after the provider timestamp reaches the last session bar.
const extendedFinalizationPollStartMinutes = 13;
const extendedFinalizationMinutes = 20;
const regularFinalizationDelayMinutes = 3;
const regularFinalizationMinutes = 10;

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  calendar: "gregory",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  numberingSystem: "latn",
  timeZone: "America/New_York",
  year: "numeric",
});

export function getDashboardMoverLifecycle(
  session: DashboardV2Session,
  value: number | Date = Date.now(),
): DashboardMoverLifecycle {
  const clock = getNewYorkClock(value);
  const schedule = getUsEquityMarketDaySchedule(clock.date);
  if (!schedule.tradingDay) return closedLifecycle(clock.date);

  const windows = {
    Pre: {
      activeEnd: schedule.regularOpenMinute,
      activeStart: preOpenMinute,
      finalizationEnd: schedule.regularOpenMinute + extendedFinalizationMinutes,
      finalizationStart: schedule.regularOpenMinute,
      finalProviderMinute: schedule.regularOpenMinute - 1,
    },
    Regular: {
      activeEnd: schedule.regularCloseMinute,
      activeStart: schedule.regularOpenMinute,
      finalizationEnd: schedule.regularCloseMinute + regularFinalizationMinutes,
      finalizationStart: schedule.regularCloseMinute,
      finalProviderMinute: null,
    },
    After: {
      activeEnd: schedule.afterCloseMinute,
      activeStart: schedule.regularCloseMinute,
      finalizationEnd: schedule.afterCloseMinute + extendedFinalizationMinutes,
      finalizationStart: schedule.afterCloseMinute,
      finalProviderMinute: schedule.afterCloseMinute - 1,
    },
  } satisfies Record<
    DashboardV2Session,
    {
      activeEnd: number;
      activeStart: number;
      finalizationEnd: number;
      finalizationStart: number;
      finalProviderMinute: number | null;
    }
  >;
  const window = windows[session];

  if (clock.minute >= window.activeStart && clock.minute < window.activeEnd) {
    return {
      expectedFinalProviderMinute: window.finalProviderMinute,
      marketDate: clock.date,
      phase: "active",
      refreshAfterSeconds: 3 * 60,
      refreshAllowed: true,
    };
  }

  if (
    clock.minute >= window.finalizationStart &&
    clock.minute < window.finalizationEnd
  ) {
    return {
      expectedFinalProviderMinute: window.finalProviderMinute,
      marketDate: clock.date,
      phase: "finalizing",
      refreshAfterSeconds: 60,
      refreshAllowed: true,
    };
  }

  return closedLifecycle(clock.date);
}

export function getPreferredDashboardSession(
  value: number | Date | string = Date.now(),
): DashboardV2Session {
  const clock = getNewYorkClock(value);
  return classifyUsEquityMarketMinute(clock.date, clock.minute) || "Regular";
}

export function shouldFinalizeDashboardMoverSnapshot({
  asOf,
  fetchedAt,
  lifecycle,
  session,
}: {
  asOf: string | null;
  fetchedAt: string;
  lifecycle: DashboardMoverLifecycle;
  session: DashboardV2Session;
}) {
  if (lifecycle.phase !== "finalizing") return false;

  if (session === "Regular") {
    const fetchedClock = getNewYorkClock(fetchedAt);
    const schedule = getUsEquityMarketDaySchedule(lifecycle.marketDate);
    return (
      fetchedClock.date === lifecycle.marketDate &&
      fetchedClock.minute >=
        schedule.regularCloseMinute + regularFinalizationDelayMinutes
    );
  }

  if (lifecycle.expectedFinalProviderMinute === null || !asOf) return false;
  const providerClock = getNewYorkClock(asOf);
  return (
    providerClock.date === lifecycle.marketDate &&
    providerClock.minute >= lifecycle.expectedFinalProviderMinute
  );
}

export function isDashboardMoverFinalizationEligible(
  session: DashboardV2Session,
  lifecycle: DashboardMoverLifecycle,
  value: number | Date | string = Date.now(),
) {
  if (lifecycle.phase !== "finalizing") return false;
  const clock = getNewYorkClock(value);
  if (clock.date !== lifecycle.marketDate) return false;
  const schedule = getUsEquityMarketDaySchedule(lifecycle.marketDate);
  const eligibleMinute =
    session === "Pre"
      ? schedule.regularOpenMinute + extendedFinalizationPollStartMinutes
      : session === "Regular"
        ? schedule.regularCloseMinute + regularFinalizationDelayMinutes
        : schedule.afterCloseMinute + extendedFinalizationPollStartMinutes;
  return clock.minute >= eligibleMinute;
}

function getNewYorkClock(value: number | Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = Object.fromEntries(
    newYorkClock
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function closedLifecycle(marketDate: string): DashboardMoverLifecycle {
  return {
    expectedFinalProviderMinute: null,
    marketDate,
    phase: "closed",
    refreshAfterSeconds: null,
    refreshAllowed: false,
  };
}
