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
  assert.match(page, /getCurrentViewerPlan\(\)/);
  assert.match(page, /viewerPlan=\{viewerPlan\}/);
  assert.match(workspace, /createCalendarMockEvents/);
  assert.doesNotMatch(combined, /\/api\/calendar|supabase|FMP|fetch\(/i);
});

test("desktop preview selection and mobile sheet-open state are independent", async () => {
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");

  assert.match(workspace, /selectCalendarPreviewEvent\(/);
  assert.match(workspace, /const \[selectedEventId,/);
  assert.match(workspace, /const \[sheetEventId,/);
  assert.match(workspace, /window\.matchMedia\("\(max-width: 1180px\)"\)\.matches/);
  assert.match(workspace, /setSheetEventId\(event\.id\)/);
  assert.match(detail, /isOpen=\{Boolean\(sheetEvent\)\}/);
  assert.doesNotMatch(workspace, /addEventListener\("keydown"/);
  assert.doesNotMatch(detail, /className=\{styles\.detailClose\}/);
});

test("rows reserve their desktop action column and selected rows have a non-color cue", async () => {
  const styles = await read("components/calendar-v1/CalendarV1.module.css");

  assert.match(
    styles,
    /grid-template-columns:[^;]*minmax\(135px,[^;]*72px;/,
  );
  assert.match(styles, /\.eventActions\s*\{[\s\S]*?width:\s*72px;/);
  assert.match(
    styles,
    /@media \(min-width: 1181px\)[\s\S]*\.eventRow\[data-selected="true"\][\s\S]*box-shadow:/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*\.eventRow\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
  );
});

test("calendar event tones and labels are centralized through the shared Badge", async () => {
  const badge = await read(
    "components/calendar-v1/CalendarEventTypeBadge.tsx",
  );
  const badgeStyles = await read(
    "components/calendar-v1/CalendarEventTypeBadge.module.css",
  );
  const views = await read("components/calendar-v1/CalendarViews.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");

  assert.match(badge, /earnings:\s*"earnings"/);
  assert.match(badge, /dividend:\s*"neutral"/);
  assert.match(badge, /split:\s*"transaction"/);
  assert.match(badge, /ipo:\s*"product"/);
  assert.match(badge, /<Badge/);
  assert.match(badgeStyles, /var\(--sr-color-positive\)/);
  assert.match(badgeStyles, /color-mix\(/);
  assert.ok(
    [views, detail].every((source) =>
      source.includes("<CalendarEventTypeBadge"),
    ),
  );
});

test("count grammar and IPO price ranges use the shared presentation contract", async () => {
  const views = await read("components/calendar-v1/CalendarViews.tsx");
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");

  assert.match(views, /formatEventCount/);
  assert.match(workspace, /formatEventCount\(filteredEvents\.length\)/);
  assert.doesNotMatch(`${views}\n${workspace}`, /\$\{[^}]+\.length\} events/);
  assert.match(
    detail,
    /priceRangeLow\.toFixed\(2\)\} – \$\$\{event\.details\.priceRangeHigh/,
  );
});

test("Calendar owns mutually exclusive free-viewer ad placements", async () => {
  const page = await read("app/calendar/page.tsx");
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const ads = await read("components/calendar-v1/CalendarAdSlots.tsx");

  assert.match(page, /getCurrentViewerPlan/);
  assert.match(workspace, /areAdsEnabledForPlan\(viewerPlan\)/);
  assert.match(ads, /inventory="calendar-desktop-inline"/);
  assert.match(ads, /mediaQuery="\(min-width: 1181px\)"/);
  assert.match(ads, /placeholderSize="970 × 90"/);
  assert.match(ads, /inventory="calendar-mobile-inline"/);
  assert.match(ads, /mediaQuery="\(max-width: 1180px\)"/);
  assert.match(ads, /placeholderSize="320 × 50"/);
  assert.match(ads, /height=\{50\}/);
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
