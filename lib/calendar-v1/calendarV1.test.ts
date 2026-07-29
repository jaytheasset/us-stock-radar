import assert from "node:assert/strict";
import test from "node:test";
import {
  addDateOnlyDays,
  enumerateDateRange,
  filterCalendarEvents,
  getPresetDateRange,
  groupCalendarEventsByDate,
  normalizeDateRange,
  parseDateOnly,
  shiftDateRange,
} from "./dateUtils.ts";
import { createCalendarMockEvents } from "./mockData.ts";
import { DEFAULT_CALENDAR_FILTERS } from "./model.ts";

test("date-only helpers parse in local calendar time and reject rollover dates", () => {
  const date = parseDateOnly("2026-07-29");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 6);
  assert.equal(date.getDate(), 29);
  assert.equal(addDateOnlyDays("2026-03-08", 1), "2026-03-09");
  assert.throws(() => parseDateOnly("2026-02-30"), /Invalid date-only/);
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
  assert.deepEqual(tickerResult.map((event) => event.ticker), ["MSFT"]);
});

test("grouping is date ordered, retains crowded dates, and does not invent missing values", () => {
  const events = createCalendarMockEvents("2026-07-29");
  const filtered = filterCalendarEvents(
    events,
    { from: "2026-07-29", to: "2026-07-31" },
    DEFAULT_CALENDAR_FILTERS,
  );
  const groups = groupCalendarEventsByDate(filtered);
  assert.deepEqual(groups.map((group) => group.date), ["2026-07-29", "2026-07-30", "2026-07-31"]);
  assert.ok(groups[1].events.length >= 6);

  const missingDividend = events.find((event) => event.id === "div-jnj-missing");
  assert.equal(missingDividend?.eventType, "dividend");
  if (missingDividend?.eventType === "dividend") {
    assert.equal(missingDividend.details.recordDate, null);
    assert.equal(missingDividend.details.paymentDate, null);
  }

  const unknownIpo = events.find((event) => event.id === "ipo-unknown-ticker");
  assert.equal(unknownIpo?.ticker, null);
  assert.equal(unknownIpo?.eventTime, null);
});
