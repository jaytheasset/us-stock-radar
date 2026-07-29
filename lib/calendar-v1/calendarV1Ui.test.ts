import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath: string) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("calendar route is a mock-only Stock Radar shell without legacy data calls", async () => {
  const page = await read("app/calendar/page.tsx");
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const combined = `${page}\n${workspace}`;

  assert.match(page, /StockRadarAppShell/);
  assert.match(page, /activeNavigationItem="calendar"/);
  assert.match(workspace, /createCalendarMockEvents/);
  assert.doesNotMatch(combined, /\/api\/calendar|supabase|FMP|fetch\(/i);
});

test("calendar UI reuses shared filters, segmented controls, detail panel, and bottom sheet", async () => {
  const filters = await read("components/calendar-v1/CalendarFilters.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");

  assert.match(filters, /SegmentedControl/);
  assert.match(filters, /FilterTrigger/);
  assert.match(filters, /FilterOption/);
  assert.match(filters, /BottomSheetShell/);
  assert.match(detail, /DetailPanelShell/);
  assert.match(detail, /BottomSheetShell/);
  assert.match(detail, /LiveRoomEntryButton/);
  assert.match(detail, /getStockRouteHref/);
});

test("event rows keep their full-row detail trigger separate from internal links", async () => {
  const views = await read("components/calendar-v1/CalendarViews.tsx");
  const rowStart = views.indexOf("function CalendarEventRow");
  const rowEnd = views.indexOf("function SelectedDateEmpty");
  const row = views.slice(rowStart, rowEnd);

  assert.match(row, /className=\{styles\.eventRowOpen\}/);
  assert.match(row, /className=\{styles\.eventActions\}/);
  assert.match(row, /type="button"\s*\/>/);
  assert.doesNotMatch(row, /<\/button>/);
});
