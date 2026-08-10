import assert from "node:assert/strict";
import test from "node:test";
import {
  addDateOnlyDays,
  enumerateDateRange,
  filterCalendarEvents,
  formatCompactRangeLabel,
  formatEnglishDatePickerValue,
  getPresetDateRange,
  groupCalendarEventsByDate,
  normalizeDateRange,
  parseDateOnly,
  shiftDateRange,
  sortCalendarEventsByDateContext,
  updateCalendarCategoryFilter,
} from "./dateUtils.ts";
import {
  CALENDAR_MOCK_WATCHLIST_TICKERS,
  createCalendarMockEvents,
} from "./mockData.ts";
import {
  CALENDAR_CATEGORIES,
  COMPANY_EVENT_TYPES,
  DEFAULT_CALENDAR_FILTERS,
  MACRO_EVENT_TYPES,
  POLICY_EVENT_TYPES,
  POLICY_SUBCATEGORIES,
  calendarEventTypeGroups,
  eventTypeCategories,
  type CalendarEvent,
} from "./model.ts";
import {
  formatCalendarEventTime,
  formatStockCalendarEventDateTime,
  formatEventCount,
  getCalendarEventRouteHref,
  getCalendarEventIdentity,
  isCalendarEventWatchlistMatch,
  parseCalendarEventRouteSelection,
  selectCalendarPreviewEvent,
  selectStockCalendarEvents,
  selectUpcomingCalendarEvents,
} from "./presentation.ts";
import { resolveCalendarFlowState } from "./flowState.ts";

test("Calendar flow state distinguishes response, filter, loading, and unavailable states", () => {
  const baseInput = {
    activeFilterCount: 0,
    loadState: "ready" as const,
    range: { from: "2026-08-17", to: "2026-08-23" },
    sourceCount: 0,
    visibleCount: 0,
  };

  assert.equal(resolveCalendarFlowState(baseInput).status, "source-empty");
  assert.equal(
    resolveCalendarFlowState({
      ...baseInput,
      activeFilterCount: 1,
      sourceCount: 22,
    }).status,
    "filter-empty",
  );
  assert.equal(
    resolveCalendarFlowState({
      ...baseInput,
      sourceCount: 22,
      visibleCount: 22,
    }).status,
    "ready",
  );
  assert.equal(
    resolveCalendarFlowState({ ...baseInput, loadState: "loading" }).status,
    "loading",
  );
  assert.equal(
    resolveCalendarFlowState({ ...baseInput, loadState: "error" }).status,
    "unavailable",
  );
  assert.equal(
    resolveCalendarFlowState({ ...baseInput, sourceCount: 22 }).status,
    "unknown",
  );
  assert.equal(
    resolveCalendarFlowState({ ...baseInput, sourceCount: Number.NaN }).status,
    "unknown",
  );
});

test("date-only helpers parse in local calendar time and reject rollover dates", () => {
  const date = parseDateOnly("2026-07-29");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 6);
  assert.equal(date.getDate(), 29);
  assert.equal(addDateOnlyDays("2026-03-08", 1), "2026-03-09");
  assert.throws(() => parseDateOnly("2026-02-30"), /Invalid date-only/);
});

test("visible date picker values stay in a fixed English US format", () => {
  assert.equal(formatEnglishDatePickerValue("2026-07-30"), "July 30, 2026");
  assert.equal(formatEnglishDatePickerValue("2026-12-05"), "December 5, 2026");
  assert.throws(
    () => formatEnglishDatePickerValue("2026-13-05"),
    /Invalid date-only/,
  );
});

test("compact mobile range labels omit redundant same-year text", () => {
  assert.equal(
    formatCompactRangeLabel({ from: "2026-07-27", to: "2026-08-02" }),
    "Jul 27 – Aug 2",
  );
  assert.equal(
    formatCompactRangeLabel({ from: "2026-07-30", to: "2026-07-30" }),
    "Jul 30",
  );
  assert.equal(
    formatCompactRangeLabel({ from: "2026-12-29", to: "2027-01-04" }),
    "Dec 29, 2026 – Jan 4, 2027",
  );
});

test("presets, custom normalization, enumeration, and shifting share one range contract", () => {
  assert.deepEqual(getPresetDateRange("this-week", "2026-07-29"), {
    from: "2026-07-27",
    to: "2026-08-02",
  });
  assert.deepEqual(getPresetDateRange("next-week", "2026-07-29"), {
    from: "2026-08-03",
    to: "2026-08-09",
  });
  assert.deepEqual(normalizeDateRange({ from: "2026-08-02", to: "2026-07-29" }), {
    from: "2026-07-29",
    to: "2026-08-02",
  });
  assert.equal(enumerateDateRange({ from: "2026-07-29", to: "2026-07-31" }).length, 3);
  assert.deepEqual(shiftDateRange({ from: "2026-07-29", to: "2026-07-31" }, 1), {
    from: "2026-08-01",
    to: "2026-08-03",
  });
});

test("the shared selector applies range, type, session, status, watchlist, and query together", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const result = filterCalendarEvents(
    events,
    { from: "2026-07-27", to: "2026-08-02" },
    {
      ...DEFAULT_CALENDAR_FILTERS,
      eventType: "earnings",
      watchlistOnly: true,
      marketSession: "amc",
      status: "completed",
      query: "apple",
    },
  );
  assert.deepEqual(result.map((event) => event.id), ["earn-aapl-beat"]);

  const tickerResult = filterCalendarEvents(
    events,
    { from: "2026-07-27", to: "2026-08-02" },
    { ...DEFAULT_CALENDAR_FILTERS, query: "msFT" },
  );
  assert.deepEqual(
    tickerResult.map((event) =>
      event.category === "company" ? event.ticker : null,
    ),
    ["MSFT"],
  );
});

test("grouping is date ordered, retains crowded dates, and does not invent missing values", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const filtered = filterCalendarEvents(
    events,
    { from: "2026-07-29", to: "2026-07-31" },
    DEFAULT_CALENDAR_FILTERS,
  );
  const groups = groupCalendarEventsByDate(filtered, "2026-07-29");
  assert.deepEqual(groups.map((group) => group.date), ["2026-07-29", "2026-07-30", "2026-07-31"]);
  assert.ok(groups[1].events.length >= 6);

  const missingDividend = events.find((event) => event.id === "div-jnj-missing");
  assert.equal(missingDividend?.eventType, "dividend");
  if (missingDividend?.eventType === "dividend") {
    assert.equal(missingDividend.details.recordDate, null);
    assert.equal(missingDividend.details.paymentDate, null);
  }

  const unknownIpo = events.find((event) => event.id === "ipo-unknown-ticker");
  assert.equal(
    unknownIpo?.category === "company" ? unknownIpo.ticker : undefined,
    null,
  );
  assert.equal(unknownIpo?.eventTime, null);
});

test("date-context sorting prioritizes remaining events today and in the future, but completed events in the past", () => {
  const template = createCalendarMockEvents("2026-07-29")[0];
  assert.ok(template);
  const makeEvent = (
    id: string,
    eventDate: string,
    status: CalendarEvent["status"],
    eventTime: string,
  ): CalendarEvent => ({
    ...template,
    id,
    eventDate,
    eventTime,
    status,
  });
  const events = [
    makeEvent("past-estimated", "2026-07-28", "estimated", "08:00"),
    makeEvent("past-confirmed", "2026-07-28", "confirmed", "10:00"),
    makeEvent("past-completed", "2026-07-28", "completed", "16:00"),
    makeEvent("today-cancelled", "2026-07-29", "cancelled", "07:00"),
    makeEvent("today-completed", "2026-07-29", "completed", "08:00"),
    makeEvent("today-estimated", "2026-07-29", "estimated", "09:00"),
    makeEvent("today-confirmed", "2026-07-29", "confirmed", "10:00"),
    makeEvent("today-postponed", "2026-07-29", "postponed", "06:00"),
    makeEvent("future-completed", "2026-07-30", "completed", "08:00"),
    makeEvent("future-estimated", "2026-07-30", "estimated", "09:00"),
    makeEvent("future-confirmed", "2026-07-30", "confirmed", "10:00"),
  ];

  const groups = groupCalendarEventsByDate(events, "2026-07-29");
  assert.deepEqual(groups.map((group) => group.date), [
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
  ]);
  assert.deepEqual(groups[0]?.events.map((event) => event.status), [
    "completed",
    "confirmed",
    "estimated",
  ]);
  assert.deepEqual(groups[1]?.events.map((event) => event.status), [
    "confirmed",
    "estimated",
    "completed",
    "postponed",
    "cancelled",
  ]);
  assert.deepEqual(groups[2]?.events.map((event) => event.status), [
    "confirmed",
    "estimated",
    "completed",
  ]);

  const sameStatus = sortCalendarEventsByDateContext(
    [
      makeEvent("late", "2026-07-29", "confirmed", "16:00"),
      makeEvent("early", "2026-07-29", "confirmed", "08:00"),
    ],
    "2026-07-29",
  );
  assert.deepEqual(sameStatus.map((event) => event.id), ["early", "late"]);
});

test("desktop preview defaults by view and preserves only valid selections", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const firstTodayEvent = selectCalendarPreviewEvent(
    events,
    "2026-07-29",
    "calendar",
    null,
  );
  assert.equal(firstTodayEvent?.id, "earn-nvda-confirmed");

  const nextDateEvents = events.filter(
    (event) => event.eventDate === "2026-07-30",
  );
  const userSelection = nextDateEvents.at(-1);
  assert.ok(userSelection);
  assert.equal(
    selectCalendarPreviewEvent(
      events,
      "2026-07-30",
      "calendar",
      userSelection.id,
    )?.id,
    userSelection.id,
  );
  assert.equal(
    selectCalendarPreviewEvent(
      events,
      "2026-07-29",
      "calendar",
      userSelection.id,
    )?.id,
    "earn-nvda-confirmed",
  );
  assert.equal(
    selectCalendarPreviewEvent(
      events,
      "2026-07-29",
      "list",
      userSelection.id,
    )?.id,
    userSelection.id,
  );
  assert.equal(
    selectCalendarPreviewEvent(events, "2099-01-01", "calendar", null)?.id,
    events[0]?.id,
  );
});

test("event count grammar is singular only for one", () => {
  assert.equal(formatEventCount(0), "0 events");
  assert.equal(formatEventCount(1), "1 event");
  assert.equal(formatEventCount(2), "2 events");
});

test("upcoming events are conditional, stable, selected-date exclusive, and capped", () => {
  const selectedDate = "2026-07-31";
  const source = createCalendarMockEvents("2026-07-29").slice(0, 8);
  const eventDates = [
    selectedDate,
    "2026-08-03",
    "2026-08-01",
    "2026-08-01",
    "2026-08-02",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
  ];
  const oneSelectedEvent = source.map((event, index) => ({
    ...event,
    eventDate: eventDates[index],
  }));
  const upcoming = selectUpcomingCalendarEvents(
    oneSelectedEvent,
    selectedDate,
  );

  assert.ok(upcoming);
  assert.deepEqual(
    upcoming.map((event) => event.id),
    [source[2].id, source[3].id, source[4].id, source[1].id, source[5].id],
  );
  assert.equal(upcoming.length, 5);
  assert.ok(upcoming.every((event) => event.eventDate !== selectedDate));

  for (const selectedCount of [0, 1, 2]) {
    const events = source.map((event, index) => ({
      ...event,
      eventDate:
        index < selectedCount
          ? selectedDate
          : `2026-08-${String(index + 1).padStart(2, "0")}`,
    }));
    assert.notEqual(
      selectUpcomingCalendarEvents(events, selectedDate),
      null,
      `${selectedCount} selected-date events`,
    );
  }

  const threeSelectedEvents = source.map((event, index) => ({
    ...event,
    eventDate: index < 3 ? selectedDate : "2026-08-01",
  }));
  assert.equal(
    selectUpcomingCalendarEvents(threeSelectedEvents, selectedDate),
    null,
  );

  const noLaterEvents = [
    { ...source[0], eventDate: selectedDate },
    { ...source[1], eventDate: "2026-07-30" },
  ];
  assert.deepEqual(
    selectUpcomingCalendarEvents(noLaterEvents, selectedDate),
    [],
  );
});

test("stock Calendar events prioritize upcoming dates and backfill recent dates", () => {
  const base = createCalendarMockEvents("2026-07-29").find(
    (event) => event.category === "company",
  );
  assert.ok(base?.category === "company");
  const eventId = "177f0498-ca27-4da2-a149-716e92748080";
  const events: CalendarEvent[] = [
    {
      ...base,
      eventDate: "2026-08-05",
      eventTime: null,
      id: eventId,
      ticker: "AMD",
    },
    {
      ...base,
      eventDate: "2026-08-04",
      eventTime: "16:05",
      id: "7c45b0bf-cd94-4b95-bf49-d00a17a4b039",
      ticker: "AMD",
    },
    {
      ...base,
      eventDate: "2026-08-03",
      id: "bf99a7a4-1a14-43eb-b1ca-3c80095324f0",
      ticker: "JPM",
    },
    {
      ...base,
      eventDate: "2026-07-31",
      eventTime: "09:30",
      id: "83ec7d0e-0000-4000-8000-000000000001",
      ticker: "AMD",
    },
    {
      ...base,
      eventDate: "2026-07-31",
      eventTime: "16:00",
      id: "83ec7d0e-0000-4000-8000-000000000002",
      ticker: "AMD",
    },
    {
      ...base,
      eventDate: "2026-07-30",
      eventTime: null,
      id: "83ec7d0e-0000-4000-8000-000000000003",
      ticker: "AMD",
    },
  ];
  const selected = selectStockCalendarEvents(
    events,
    "amd",
    "2026-08-01",
  );
  assert.deepEqual(
    selected.map((event) => [event.eventDate, event.eventTime]),
    [
      ["2026-08-04", "16:05"],
      ["2026-08-05", null],
      ["2026-07-31", "16:00"],
      ["2026-07-31", "09:30"],
      ["2026-07-30", null],
    ],
  );
  assert.ok(
    selected.every(
      (event) => event.category === "company" && event.ticker === "AMD",
    ),
  );
  assert.deepEqual(
    selectStockCalendarEvents(events, "AMD", "2026-08-01", 2).map(
      (event) => event.eventDate,
    ),
    ["2026-08-04", "2026-08-05"],
  );
  assert.equal(
    getCalendarEventRouteHref(selected[0]),
    "/calendar?date=2026-08-04&event=7c45b0bf-cd94-4b95-bf49-d00a17a4b039",
  );
  assert.deepEqual(
    parseCalendarEventRouteSelection(selected[0].id, selected[0].eventDate),
    { eventDate: "2026-08-04", eventId: selected[0].id },
  );
  assert.equal(parseCalendarEventRouteSelection("not-an-id", "2026-08-04"), null);
  assert.match(
    formatStockCalendarEventDateTime(selected[0]),
    /Tue, Aug 4 · 4:05 PM ET/,
  );
});

test("calendar category, event type, and policy subcategory contracts are closed and grouped", () => {
  assert.deepEqual(CALENDAR_CATEGORIES, ["company", "macro", "policy"]);
  assert.equal(COMPANY_EVENT_TYPES.length, 4);
  assert.equal(MACRO_EVENT_TYPES.length, 7);
  assert.equal(POLICY_EVENT_TYPES.length, 11);
  assert.deepEqual(POLICY_SUBCATEGORIES, [
    "monetary-policy",
    "treasury",
    "sec-regulation",
    "trade-policy",
    "industry-regulation",
  ]);
  assert.deepEqual(calendarEventTypeGroups.company, COMPANY_EVENT_TYPES);
  assert.deepEqual(calendarEventTypeGroups.macro, MACRO_EVENT_TYPES);
  assert.deepEqual(calendarEventTypeGroups.policy, POLICY_EVENT_TYPES);
  for (const eventType of MACRO_EVENT_TYPES) {
    assert.equal(eventTypeCategories[eventType], "macro");
  }
  for (const eventType of POLICY_EVENT_TYPES) {
    assert.equal(eventTypeCategories[eventType], "policy");
  }
});

test("all 18 Macro and Policy types have mock-only fixtures while Company fixtures stay intact", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const company = events.filter((event) => event.category === "company");
  const macro = events.filter((event) => event.category === "macro");
  const policy = events.filter((event) => event.category === "policy");

  assert.equal(company.length, 16);
  assert.deepEqual(
    new Set(macro.map((event) => event.eventType)),
    new Set(MACRO_EVENT_TYPES),
  );
  assert.deepEqual(
    new Set(policy.map((event) => event.eventType)),
    new Set(POLICY_EVENT_TYPES),
  );
  assert.ok(events.every((event) => event.provider === "mock"));
  assert.ok(events.every((event) => event.timezone === "America/New_York"));
  assert.ok(events.every((event) => event.sourceAgency && event.sourceName));

  const nvda = company.find((event) => event.id === "earn-nvda-confirmed");
  assert.equal(nvda?.eventType, "earnings");
  if (nvda?.eventType === "earnings") {
    assert.equal(nvda.ticker, "NVDA");
    assert.equal(nvda.details.epsEstimate, 1.12);
    assert.equal(nvda.details.revenueEstimate, 45_200_000_000);
  }
  assert.ok(company.some((event) => event.id === "ipo-unknown-ticker"));
});

test("category updates reset incompatible event types and the selector never creates contradictory states", () => {
  const companyCpi = {
    ...DEFAULT_CALENDAR_FILTERS,
    category: "company" as const,
    eventType: "earnings" as const,
  };
  assert.deepEqual(updateCalendarCategoryFilter(companyCpi, "macro"), {
    ...companyCpi,
    category: "macro",
    eventType: "all",
  });
  assert.equal(
    updateCalendarCategoryFilter(
      { ...DEFAULT_CALENDAR_FILTERS, eventType: "cpi" },
      "macro",
    ).eventType,
    "cpi",
  );

  const events = createCalendarMockEvents("2026-07-29");
  const result = filterCalendarEvents(
    events,
    { from: "2026-07-01", to: "2026-08-31" },
    { ...DEFAULT_CALENDAR_FILTERS, category: "macro", eventType: "cpi" },
  );
  assert.deepEqual(result.map((event) => event.id), ["macro-cpi-release"]);
});

test("search covers titles, agencies, industries, related tickers, and Company identity", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const range = { from: "2026-07-01", to: "2026-08-31" };
  const search = (query: string) =>
    filterCalendarEvents(events, range, {
      ...DEFAULT_CALENDAR_FILTERS,
      query,
    }).map((event) => event.id);

  assert.ok(search("Consumer Price Index").includes("macro-cpi-release"));
  assert.ok(search("Federal Reserve").includes("policy-fomc-decision"));
  assert.ok(search("semiconductor").includes("policy-trade-postponed"));
  assert.ok(search("MRNA").includes("policy-fda-advisory"));
  assert.ok(search("Microsoft Corporation").includes("earn-msft-estimated"));
});

test("Watchlist Only preserves Company meaning, excludes Macro, and includes only overlapping Policy tickers", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const range = { from: "2026-07-01", to: "2026-08-31" };
  const watchlist = new Set<string>(CALENDAR_MOCK_WATCHLIST_TICKERS);
  const macro = filterCalendarEvents(
    events,
    range,
    {
      ...DEFAULT_CALENDAR_FILTERS,
      category: "macro",
      watchlistOnly: true,
    },
    watchlist,
  );
  assert.deepEqual(macro, []);

  const policy = filterCalendarEvents(
    events,
    range,
    {
      ...DEFAULT_CALENDAR_FILTERS,
      category: "policy",
      watchlistOnly: true,
    },
    watchlist,
  );
  assert.ok(policy.some((event) => event.id === "policy-fda-advisory"));
  assert.ok(policy.some((event) => event.id === "policy-trade-postponed"));
  assert.ok(policy.every((event) => event.category === "policy"));
  assert.ok(
    policy.every((event) => isCalendarEventWatchlistMatch(event, watchlist)),
  );

  const noOverlap = filterCalendarEvents(
    events,
    range,
    {
      ...DEFAULT_CALENDAR_FILTERS,
      category: "policy",
      watchlistOnly: true,
    },
    new Set(["ZZZZ"]),
  );
  assert.deepEqual(noOverlap, []);
});

test("duplicate-prevention fixtures keep combined releases and related milestones explicit", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const byType = (eventType: string) =>
    events.filter((event) => event.eventType === eventType);

  assert.equal(byType("fomc-decision").length, 1);
  const fomc = byType("fomc-decision")[0];
  assert.equal(fomc?.category, "policy");
  if (fomc?.eventType === "fomc-decision") {
    assert.ok(fomc.details.decisionTime);
    assert.ok(fomc.details.pressConferenceTime);
    assert.equal(fomc.details.includesSep, true);
  }

  const cpi = byType("cpi")[0];
  assert.equal(cpi?.category, "macro");
  if (cpi?.category === "macro") assert.equal(cpi.details.metrics.length, 2);
  const employment = byType("employment-situation")[0];
  if (employment?.category === "macro") {
    assert.equal(employment.details.metrics.length, 3);
  }
  assert.equal(byType("sec-open-meeting").length, 1);
  const milestones = byType("sec-rule-milestone");
  assert.equal(milestones.length, 2);
  assert.ok(
    milestones.every(
      (event) =>
        event.category === "policy" &&
        event.eventType === "sec-rule-milestone",
    ),
  );
  assert.equal(
    milestones[0]?.eventType === "sec-rule-milestone"
      ? milestones[0].details.documentOrDocket
      : null,
    milestones[1]?.eventType === "sec-rule-milestone"
      ? milestones[1].details.documentOrDocket
      : null,
  );
  assert.notEqual(milestones[0]?.eventDate, milestones[1]?.eventDate);
  assert.equal(byType("treasury-auction-10y").length, 1);
  assert.equal(byType("treasury-auction-30y").length, 1);
});

test("lifecycle status, exact ET, TNA, and category identity remain distinct presentation concepts", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const trade = events.find((event) => event.id === "policy-trade-postponed");
  const auction = events.find((event) => event.id === "policy-treasury-auction-30y");
  const employment = events.find((event) => event.id === "macro-employment-situation");
  assert.equal(trade?.lifecycleStatus, "postponed");
  assert.equal(trade?.status, "postponed");
  assert.equal(auction?.lifecycleStatus, "cancelled");
  assert.equal(auction?.status, "cancelled");
  assert.match(
    formatCalendarEventTime(events.find((event) => event.id === "macro-cpi-release")!),
    /ET$/,
  );
  assert.equal(formatCalendarEventTime(employment!), "8:30 AM ET");
  const testimony = events.find((event) => event.id === "policy-fed-chair-testimony")!;
  assert.equal(formatCalendarEventTime(testimony), "Time Not Announced");
  assert.equal(getCalendarEventIdentity(testimony).primaryTicker, null);
  assert.equal(getCalendarEventIdentity(testimony).secondaryLabel, "Federal Reserve");
});
