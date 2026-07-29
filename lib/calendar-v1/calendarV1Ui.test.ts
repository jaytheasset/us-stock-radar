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

test("Calendar typography, day alignment, and conditional upcoming panel use local contracts", async () => {
  const views = await read("components/calendar-v1/CalendarViews.tsx");
  const styles = await read("components/calendar-v1/CalendarV1.module.css");
  const presentation = await read("lib/calendar-v1/presentation.ts");
  const calendarView = views.slice(
    views.indexOf("export function CalendarView"),
    views.indexOf("export function ListView"),
  );
  const upcomingRow = views.slice(
    views.indexOf("function UpcomingEventRow"),
    views.indexOf("function SelectedDateEmpty"),
  );

  assert.match(
    styles,
    /\.pageHeader h1\s*\{[\s\S]*font-size:\s*var\(--sr-font-size-xl\);[\s\S]*font-weight:\s*var\(--sr-font-weight-heavy\);/,
  );
  assert.match(
    styles,
    /\.page \.viewControl > button,[\s\S]*\.page \.rangeControl > button,[\s\S]*\.page \.eventTypeControl > button\s*\{[\s\S]*font-size:\s*var\(--sr-font-size-md\);[\s\S]*font-weight:\s*var\(--sr-font-weight-semibold\);/,
  );
  assert.match(
    styles,
    /\.calendarDay\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*stretch;[\s\S]*flex-direction:\s*column;[\s\S]*justify-content:\s*flex-start;/,
  );

  assert.match(presentation, /selectedDateEventCount >= 3/);
  assert.match(presentation, /event\.eventDate > selectedDate/);
  assert.match(presentation, /stableIndex/);
  assert.match(presentation, /\.slice\(0, Math\.max\(0, limit\)\)/);
  assert.match(calendarView, /selectUpcomingCalendarEvents\(events, selectedDate\)/);
  assert.match(calendarView, /\{upcomingEvents \? \(/);
  assert.match(
    calendarView,
    /window\.matchMedia\("\(max-width: 1180px\)"\)[\s\S]*onSelectedDateChange\(event\.eventDate\);[\s\S]*onOpenEvent\(event, opener\);/,
  );
  assert.match(views, /No later events in this range\./);
  assert.match(upcomingRow, /className=\{styles\.upcomingRowOpen\}/);
  assert.match(upcomingRow, /<CalendarEventTypeBadge/);
  assert.doesNotMatch(upcomingRow, /<Link|<a\b/);
});

test("Calendar owns free-viewer rail and mobile ad placements", async () => {
  const page = await read("app/calendar/page.tsx");
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const ads = await read("components/calendar-v1/CalendarAdSlots.tsx");
  const adStyles = await read("components/calendar-v1/CalendarAdSlots.module.css");
  const calendarStyles = await read("components/calendar-v1/CalendarV1.module.css");

  assert.match(page, /getCurrentViewerPlan/);
  assert.match(workspace, /areAdsEnabledForPlan\(viewerPlan\)/);
  assert.match(workspace, /<CalendarMobileAdSlot enabledForViewer=\{adsEnabledForViewer\}/);
  assert.match(workspace, /<CalendarDesktopRail[\s\S]*desktopPreviewEvent/);
  assert.match(ads, /CalendarRailAd inventory="calendar-rail-top" position="top"[\s\S]*\{children\}[\s\S]*CalendarRailAd inventory="calendar-rail-bottom" position="bottom"/);
  assert.match(ads, /inventory=\{inventory\}/);
  assert.match(ads, /mediaQuery="\(min-width: 1181px\)"/);
  assert.match(ads, /format="responsive"/);
  assert.match(ads, /height=\{250\}/);
  assert.match(ads, /width=\{336\}/);
  assert.match(ads, /inventory="calendar-mobile-inline"/);
  assert.match(ads, /mediaQuery="\(max-width: 1180px\)"/);
  assert.match(ads, /placeholderSize="320 × 50"/);
  assert.match(ads, /height=\{50\}/);
  assert.doesNotMatch(
    ads,
    new RegExp(["calendar", "desktop", "inline"].join("-")),
  );
  assert.match(adStyles, /\.rail\[data-ads-enabled="false"\]\s*\{\s*display:\s*contents;/);
  assert.match(adStyles, /@media \(max-width: 1180px\)[\s\S]*\.desktopRailAd\s*\{\s*display:\s*none;/);
  assert.match(calendarStyles, /\.workspace\[data-rail-ads="true"\] \.desktopDetailPanel[\s\S]*position:\s*static;/);
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

test("stock watching is ticker-scoped while event following remains event-scoped", async () => {
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");
  const styles = await read("components/calendar-v1/CalendarV1.module.css");
  const watchActionStart = detail.indexOf("<strong>Stock watchlist</strong>");
  const followActionStart = detail.indexOf("<strong>Event alert</strong>");
  const watchAction = detail.slice(watchActionStart, followActionStart);
  const followAction = detail.slice(followActionStart, detail.indexOf("detailLinks"));

  assert.match(workspace, /watchlistOverrides\[event\.ticker\]/);
  assert.match(workspace, /const ticker = event\.ticker/);
  assert.match(workspace, /\[ticker\]: !\(current\[ticker\]/);
  assert.doesNotMatch(workspace, /\[event\.id\]: !\(current\[event\.id\][\s\S]*isWatchlisted/);
  assert.match(workspace, /\[event\.id\]: !current\[event\.id\]/);
  assert.match(detail, /watchlistOverrides\[desktopEvent\.ticker\]/);
  assert.match(detail, /followedEvents\[desktopEvent\.id\]/);

  assert.match(watchAction, /Track this ticker across Stock Radar\./);
  assert.match(watchAction, /disabled=\{!event\.ticker\}/);
  assert.match(watchAction, /No ticker to watch/);
  assert.match(watchAction, /Watch Stock/);
  assert.match(detail, /Watching \$\{event\.ticker\}/);
  assert.doesNotMatch(followAction, /disabled=/);
  assert.match(followAction, /Follow this event&apos;s schedule and reminders\./);
  assert.match(followAction, /Follow Event/);
  assert.match(followAction, /Event Followed/);
  assert.match(detail, /Preview only\./);
  assert.match(detail, /Alert delivery is not\s+connected yet\./);
  assert.match(
    styles,
    /\.detailAction\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(128px, auto\);/,
  );
  assert.match(styles, /\.detailAction button:disabled/);
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
