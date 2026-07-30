import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath: string) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("calendar route reads normalized events through the server boundary", async () => {
  const page = await read("app/calendar/page.tsx");
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const route = await read("app/api/calendar/normalized/route.ts");
  const repository = await read("lib/calendar-v1/repository.ts");
  const normalized = await read("lib/calendar-v1/normalized.ts");
  const legacyRoute = await read("app/api/calendar/route.ts");
  const legacyQa = await read("scripts/qa-calendar-route.mjs");

  assert.match(page, /StockRadarAppShell/);
  assert.match(page, /activeNavigationItem="calendar"/);
  assert.match(page, /getCurrentViewerPlan\(\)/);
  assert.match(page, /viewerPlan=\{viewerPlan\}/);
  assert.match(page, /getNormalizedCalendarEvents/);
  assert.match(page, /getCalendarMarketDate/);
  assert.match(page, /initialEvents=\{initialEvents\}/);
  assert.match(workspace, /fetch\(`\/api\/calendar\/normalized\?/);
  assert.match(workspace, /new AbortController\(\)/);
  assert.match(workspace, /requestIdRef\.current/);
  assert.doesNotMatch(`${page}\n${workspace}`, /createCalendarMockEvents/);
  assert.match(route, /getNormalizedCalendarEvents/);
  assert.match(repository, /import "server-only"/);
  assert.match(repository, /supabaseSelect/);
  assert.match(normalized, /calendar_events/);
  assert.match(legacyRoute, /event_calendar_items/);
  assert.match(legacyQa, /\/api\/calendar/);
});

test("desktop preview selection and mobile sheet-open state are independent", async () => {
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");

  assert.match(workspace, /selectCalendarPreviewEvent\(/);
  assert.match(
    workspace,
    /const \[selectedEventId, setSelectedEventId\] = useState<string \| null>\(null\)/,
  );
  assert.match(workspace, /const \[sheetEventId,/);
  assert.match(
    workspace,
    /function openEvent[\s\S]*setSelectedEventId\(event\.id\)/,
  );
  assert.doesNotMatch(workspace, /nextSelectedEventId/);
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
  assert.match(detail, /label="Expected price range"/);
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
    /\.page \.viewControl > button,[\s\S]*\.page \.rangeControl > button,[\s\S]*\.page \.categoryControl > button\s*\{[\s\S]*font-size:\s*var\(--sr-font-size-md\);[\s\S]*font-weight:\s*var\(--sr-font-weight-semibold\);/,
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
  const detailPanelStyles = await read("components/ui/DetailPanelShell.module.css");

  assert.match(page, /getCurrentViewerPlan/);
  assert.match(workspace, /areAdsEnabledForPlan\(viewerPlan\)/);
  assert.match(workspace, /<CalendarMobileAdSlot enabledForViewer=\{adsEnabledForViewer\}/);
  assert.match(
    workspace,
    /<CalendarDesktopRail[\s\S]*activeEventId=\{selectedEventId\}[\s\S]*desktopPreviewEvent/,
  );
  assert.match(ads, /CalendarRailAd inventory="calendar-rail-top" position="top"[\s\S]*\{children\}[\s\S]*CalendarRailAd inventory="calendar-rail-bottom" position="bottom"/);
  assert.match(ads, /activeEventId:\s*string \| null/);
  assert.match(ads, /const railScrollProgressRef = useRef\(0\)/);
  assert.match(
    ads,
    /useEffect\(\(\) => \{[\s\S]*railScrollProgressRef\.current = 0;[\s\S]*!activeEventId[\s\S]*window\.matchMedia\("\(max-width: 1180px\)"\)\.matches[\s\S]*window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches[\s\S]*top:\s*0,[\s\S]*\[activeEventId\]/,
  );
  assert.match(
    ads,
    /const desktopRailQuery = window\.matchMedia\("\(min-width: 1181px\)"\);[\s\S]*let previousPageScrollY = window\.scrollY;[\s\S]*let pendingScrollDelta = 0;/,
  );
  assert.match(
    ads,
    /const scrollDelta = pendingScrollDelta;[\s\S]*window\.getComputedStyle\(rail\)\.top[\s\S]*rail\.getBoundingClientRect\(\)\.top > stickyTop \+ 1[\s\S]*rail\.scrollHeight - rail\.clientHeight[\s\S]*railScrollProgressRef\.current \+ scrollDelta[\s\S]*rail\.scrollTo\(/,
  );
  assert.match(
    ads,
    /window\.requestAnimationFrame\(syncRailToPageScroll\);[\s\S]*window\.removeEventListener\("scroll", handlePageScroll\);[\s\S]*window\.cancelAnimationFrame\(animationFrameId\)/,
  );
  assert.match(ads, /ref=\{railRef\}/);
  assert.match(ads, /className=\{styles\.detailAnchor\}>\{children\}/);
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
  assert.doesNotMatch(adStyles, /\.rail\[data-ads-enabled="false"\]/);
  assert.match(
    adStyles,
    /@media \(min-width: 1181px\)[\s\S]*\.rail\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*var\(--sr-space-4\);[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*hidden;[\s\S]*max-height:\s*calc\(100dvh - var\(--sr-space-8\)\);/,
  );
  assert.match(adStyles, /@media \(max-width: 1180px\)[\s\S]*\.rail\s*\{\s*display:\s*contents;/);
  assert.match(adStyles, /@media \(max-width: 1180px\)[\s\S]*\.desktopRailAd\s*\{\s*display:\s*none;/);
  assert.match(detailPanelStyles, /\.panel\s*\{[\s\S]*position:\s*relative;/);
  assert.doesNotMatch(
    calendarStyles,
    /\.workspace \.desktopDetailPanel\s*\{[^}]*(?:position:\s*sticky|overflow-y:\s*auto|max-height:)/,
  );
  assert.doesNotMatch(
    calendarStyles,
    /\.workspace\[data-rail-ads="true"\] \.desktopDetailPanel/,
  );
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
  assert.match(workspace, /getCalendarEventIdentity\(event\)\.primaryTicker/);
  assert.match(workspace, /\[ticker\]: !\(current\[ticker\]/);
  assert.doesNotMatch(workspace, /\[event\.id\]: !\(current\[event\.id\][\s\S]*isWatchlisted/);
  assert.match(workspace, /\[event\.id\]: !current\[event\.id\]/);
  assert.match(detail, /watchlistTickers\.has\(ticker\)/);
  assert.match(detail, /followedEvents\[event\.id\]/);

  assert.match(watchAction, /Track this ticker across Stock Radar\./);
  assert.match(watchAction, /disabled=\{!ticker\}/);
  assert.match(watchAction, /No ticker to watch/);
  assert.match(watchAction, /Watch Stock/);
  assert.match(detail, /Watching \$\{ticker\}/);
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

test("category and grouped Type filters share a contradiction-free desktop and mobile contract", async () => {
  const filters = await read("components/calendar-v1/CalendarFilters.tsx");
  const model = await read("lib/calendar-v1/model.ts");
  const selector = await read("lib/calendar-v1/dateUtils.ts");

  assert.match(filters, /ariaLabel="Event category"/);
  assert.match(filters, /className=\{styles\.categoryControl\}/);
  assert.match(filters, /label="Type"/);
  assert.match(filters, /All types/);
  assert.match(filters, /calendarEventTypeGroups\[group\]/);
  assert.match(filters, /calendarCategoryLabels\[group\]/);
  assert.match(filters, /label="Category"/);
  assert.match(filters, /<h3>Event type<\/h3>/);
  assert.match(filters, /updateCalendarCategoryFilter/);
  assert.match(
    filters,
    /Search events, agencies, industries, tickers/,
  );
  assert.match(model, /company:\s*COMPANY_EVENT_TYPES/);
  assert.match(model, /macro:\s*MACRO_EVENT_TYPES/);
  assert.match(model, /policy:\s*POLICY_EVENT_TYPES/);
  assert.match(selector, /eventTypeCategories\[filters\.eventType\] === category/);
});

test("Macro and Policy presentation uses identity helpers, ET/TNA, impact, and category detail renderers", async () => {
  const views = await read("components/calendar-v1/CalendarViews.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");
  const presentation = await read("lib/calendar-v1/presentation.ts");
  const styles = await read("components/calendar-v1/CalendarV1.module.css");

  assert.match(views, /getCalendarCompactIdentity\(event\)/);
  assert.match(views, /getCalendarEventIdentity\(event\)/);
  assert.match(views, /formatCalendarEventTime\(event\)/);
  assert.match(views, /impactLevelLabels\[event\.impactLevel\]/);
  assert.match(presentation, /event\.category === "company"/);
  assert.match(presentation, /event\.category === "macro"/);
  assert.match(presentation, /Time Not Announced/);
  assert.match(presentation, /`\$\{formatClockTime\(event\.eventTime\)\} ET`/);

  assert.match(detail, /event\.category === "company"/);
  assert.match(detail, /event\.category === "macro"/);
  assert.match(detail, /function MacroDetails/);
  assert.match(detail, /function renderPolicyDetails/);
  assert.match(detail, /Economic release metrics/);
  assert.match(detail, /Not released/);
  assert.doesNotMatch(detail, /Data provenance/);
  assert.doesNotMatch(detail, /sourceAgency/);
  assert.doesNotMatch(detail, /calendarProviderLabels/);
  assert.doesNotMatch(detail, /normalizeSafeCalendarSourceUrl/);
  assert.doesNotMatch(detail, /sourceUrl/);
  assert.doesNotMatch(detail, /titleCase\(event\.scheduleConfidence\)/);
  assert.doesNotMatch(detail, /sourceEventKey/);
  assert.doesNotMatch(detail, /value="Mock"/);
  assert.match(styles, /\.macroMetrics\s*\{/);
  assert.match(styles, /grid-template-columns:\s*minmax\(84px/);
});

test("Calendar event badge tones cover every Company, Macro, and Policy type without a new Badge API", async () => {
  const badge = await read("components/calendar-v1/CalendarEventTypeBadge.tsx");
  const sharedBadge = await read("components/ui/Badge.tsx");

  for (const eventType of [
    "cpi",
    "ppi",
    "pce",
    "employment-situation",
    "jolts",
    "gdp-advance",
    "retail-sales",
    "fomc-decision",
    "fomc-minutes",
    "fed-chair-testimony",
    "treasury-borrowing-estimate",
    "treasury-refunding",
    "treasury-auction-10y",
    "treasury-auction-30y",
    "sec-open-meeting",
    "sec-rule-milestone",
    "trade-policy-action",
    "fda-advisory-committee",
  ]) {
    assert.ok(badge.includes(`${JSON.stringify(eventType)}:`) || badge.includes(`${eventType}:`));
  }
  assert.match(badge, /satisfies Record<CalendarEventType, BadgeTone>/);
  assert.doesNotMatch(sharedBadge, /macro|policy|treasury|fomc/i);
});

test("primary ticker gates stock actions while Follow Event stays event-scoped for every category", async () => {
  const workspace = await read("components/calendar-v1/StockRadarCalendarV1.tsx");
  const detail = await read("components/calendar-v1/CalendarEventDetail.tsx");

  assert.match(workspace, /getCalendarEventIdentity\(event\)\.primaryTicker/);
  assert.match(workspace, /\[event\.id\]: !current\[event\.id\]/);
  assert.match(detail, /const ticker = identity\.primaryTicker/);
  assert.match(detail, /disabled=\{!ticker\}/);
  assert.match(detail, /\{ticker \? \(\s*<div className=\{styles\.detailLinks\}>/);
  assert.match(detail, /onFollowToggle/);
  assert.doesNotMatch(
    detail.slice(
      detail.indexOf("<strong>Event alert</strong>"),
      detail.indexOf("{ticker ? ("),
    ),
    /disabled=/,
  );
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
