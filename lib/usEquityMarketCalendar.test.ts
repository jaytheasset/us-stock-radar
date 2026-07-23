import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyUsEquityMarketMinute,
  getUsEquityMarketDaySchedule,
} from "./usEquityMarketCalendar.ts";

test("recognizes the 2026 NYSE full-day holidays", () => {
  const holidays = [
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-04-03",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
  ];

  for (const date of holidays) {
    assert.equal(getUsEquityMarketDaySchedule(date).tradingDay, false, date);
  }
});

test("uses the normal 9:30 to 16:00 regular session", () => {
  const schedule = getUsEquityMarketDaySchedule("2026-07-23");
  assert.equal(schedule.tradingDay, true);
  assert.equal(schedule.earlyClose, false);
  assert.equal(schedule.regularOpenMinute, 570);
  assert.equal(schedule.regularCloseMinute, 960);
});

test("uses 13:00 regular and 17:00 after-hours closes on scheduled early-close days", () => {
  const schedule = getUsEquityMarketDaySchedule("2026-11-27");
  assert.equal(schedule.tradingDay, true);
  assert.equal(schedule.earlyClose, true);
  assert.equal(schedule.regularCloseMinute, 780);
  assert.equal(schedule.afterCloseMinute, 1020);

  assert.equal(classifyUsEquityMarketMinute("2026-11-27", 12 * 60 + 59), "Regular");
  assert.equal(classifyUsEquityMarketMinute("2026-11-27", 13 * 60), "After");
  assert.equal(classifyUsEquityMarketMinute("2026-11-27", 17 * 60), null);
});

test("does not classify weekends or exchange holidays as market sessions", () => {
  assert.equal(classifyUsEquityMarketMinute("2026-07-25", 11 * 60), null);
  assert.equal(classifyUsEquityMarketMinute("2026-12-25", 11 * 60), null);
});

test("recognizes July 3 early close when July 4 falls Tuesday through Friday", () => {
  const schedule = getUsEquityMarketDaySchedule("2028-07-03");
  assert.equal(schedule.tradingDay, true);
  assert.equal(schedule.earlyClose, true);
});
