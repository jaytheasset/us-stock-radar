import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeAlertTickerSearchParam } from "../../lib/alerts/tickers/query.ts";

const componentSource = readFileSync(
  new URL("./StockRadarAlertsV2.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./StockRadarAlertsV2.module.css", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../app/alerts/page.tsx", import.meta.url),
  "utf8",
);
const settingsRouteSource = readFileSync(
  new URL("../../app/api/alerts/settings/route.ts", import.meta.url),
  "utf8",
);
const deliveredRouteSource = readFileSync(
  new URL("../../app/api/alerts/delivered/route.ts", import.meta.url),
  "utf8",
);
const followsRouteSource = readFileSync(
  new URL("../../app/api/calendar/follows/route.ts", import.meta.url),
  "utf8",
);
const calendarDeliverySource = readFileSync(
  new URL("../../lib/alerts/calendarDelivery.ts", import.meta.url),
  "utf8",
);
const supabaseAuthSource = readFileSync(
  new URL("../../lib/auth/supabaseAuth.ts", import.meta.url),
  "utf8",
);
const liveRoomClientSource = readFileSync(
  new URL("../live-room/LiveRoomClient.tsx", import.meta.url),
  "utf8",
);
const liveRoomHeaderSource = readFileSync(
  new URL("../live-room/CompanyRoomHeader.tsx", import.meta.url),
  "utf8",
);
const liveRoomInboxSource = readFileSync(
  new URL("../shell/LiveRoomUnreadMenu.tsx", import.meta.url),
  "utf8",
);
const tickerAutocompleteSource = readFileSync(
  new URL("../ui/TickerCompanyAutocomplete.tsx", import.meta.url),
  "utf8",
);
const reliabilityNoticeSource = readFileSync(
  new URL("../ui/AlertReliabilityNotice.tsx", import.meta.url),
  "utf8",
);

test("alerts uses the shared product shell and token-only visual contract", () => {
  assert.match(
    styles,
    /\.page \{[\s\S]*width: min\(100%, 1600px\);[\s\S]*margin: 0 auto;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-page-gutter-desktop\) var\(--sr-space-8\);[\s\S]*font-family: var\(--sr-font-family-sans\);/,
  );
  assert.match(
    styles,
    /\.pageShell \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 320px;[\s\S]*width: 100%;/,
  );
  assert.match(
    styles,
    /\.header h1 \{[\s\S]*font-size: var\(--sr-font-size-heading-sm\);/,
  );
  assert.match(
    styles,
    /\.notice,[\s\S]*\.card,[\s\S]*\.watchlistPanel \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*background: var\(--sr-color-surface-panel\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
  assert.doesNotMatch(styles, /--alerts-/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(styles, /rgba?\(/i);
});

test("alerts controls keep the shared search, focus, toggle, and locked-state hierarchy", () => {
  assert.match(componentSource, /TickerCompanyAutocomplete/);
  assert.match(tickerAutocompleteSource, /role="combobox"/);
  assert.match(tickerAutocompleteSource, /role="listbox"/);
  assert.match(tickerAutocompleteSource, /ArrowDown/);
  assert.match(
    styles,
    /\.toggle \{[\s\S]*width: 38px;[\s\S]*height: var\(--sr-size-badge\);[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);/,
  );
  assert.match(
    styles,
    /\.toggle\[data-state="on"\] \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*background: var\(--sr-color-accent-selected\);/,
  );
  assert.match(
    styles,
    /\.toggle:disabled \{[\s\S]*background: var\(--sr-color-state-disabled-surface\);[\s\S]*opacity: var\(--sr-opacity-disabled\);/,
  );
  assert.match(
    styles,
    /\.lockedBadge \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*color: var\(--sr-color-text-meta\);[\s\S]*background: var\(--sr-color-surface-control\);/,
  );
});

test("alerts preserves the plan-aware rail and mobile settings flow", () => {
  assert.match(
    styles,
    /\.railUpgrade \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-accent-border-premium\);[\s\S]*linear-gradient\(180deg, var\(--sr-color-accent-cta-top\), var\(--sr-color-accent-cta-bottom\)\)[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
  );
  assert.match(
    styles,
    /\.railUpgradeLink \{[\s\S]*color: var\(--sr-color-text-primary-action\);[\s\S]*background: var\(--sr-color-surface-primary-action\);/,
  );
  assert.match(
    componentSource,
    /className=\{styles\.mobileCoverageControl\}[\s\S]*id="alerts-v2-coverage-toggle"[\s\S]*className=\{styles\.mobileCoverageSummary\} htmlFor="alerts-v2-coverage-toggle"/,
  );
  assert.match(
    styles,
    /\.mobileCoverageControl:not\(:checked\) ~ \.settingList,[\s\S]*\.mobileCoverageControl:not\(:checked\) ~ \.upgradePanel,[\s\S]*\.mobileCoverageControl:not\(:checked\) ~ \.cardFooter \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.settingsSideColumn \.marketCapCard \{[\s\S]*order: 1;[\s\S]*\.settingsSideColumn \.deliveryCard \{[\s\S]*order: 2;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.filingTypeGrid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
  );
});

test("Alerts V2 reads and persists the authenticated runtime instead of a mock plan", () => {
  assert.doesNotMatch(componentSource, /getAlertsMockPlan|accountPlanId|setAccountPlanId/);
  assert.doesNotMatch(componentSource, /lib\/mock\/alertsV2Data/);
  assert.match(componentSource, /fetch\("\/api\/alerts\/settings"/);
  assert.match(componentSource, /fetch\("\/api\/alerts\/preferences"/);
  assert.match(componentSource, /fetch\("\/api\/alerts\/discovery-categories"/);
  assert.match(componentSource, /fetch\("\/api\/alerts\/channels"/);
  assert.match(componentSource, /areAdsEnabledForPlan\(plan\)/);
  assert.match(componentSource, /planLimits\.discoveryCategories/);
  assert.match(settingsRouteSource, /getAlertSettingsViewModel\(userId\)/);
});

test("in-app delivery is real, readable, and unimplemented external channels stay explicit", () => {
  assert.match(componentSource, /body: JSON\.stringify\(\{ action: "test" \}\)/);
  assert.match(componentSource, /body: JSON\.stringify\(\{ id: alert\.id, read: true \}\)/);
  assert.match(componentSource, /COMING LATER/);
  assert.match(deliveredRouteSource, /export async function POST/);
  assert.match(deliveredRouteSource, /export async function PATCH/);
  assert.match(deliveredRouteSource, /read_at:/);
  assert.match(followsRouteSource, /setUserCalendarFollow/);
  assert.match(calendarDeliverySource, /user_delivery_channels/);
  assert.match(calendarDeliverySource, /ticker: nullableString\(event\.ticker\)/);
  assert.match(componentSource, /Followed Calendar events/);
});

test("auth bootstrap preserves a saved Web delivery preference", () => {
  assert.match(
    supabaseAuthSource,
    /"user_delivery_channels"[\s\S]*enabled:\s*true[\s\S]*resolution=ignore-duplicates/,
  );
});

test("Live Room Follow tracks chat unread state and stays separate from paid Alerts", () => {
  assert.match(liveRoomHeaderSource, /RoomMembershipControl/);
  assert.doesNotMatch(liveRoomHeaderSource, /BookmarkCheck/);
  assert.doesNotMatch(liveRoomHeaderSource, /Bell(?:Off)?/);
  assert.match(liveRoomClientSource, /membershipJoined/);
  assert.match(liveRoomClientSource, /requestLiveRoomUnreadRefresh/);
  assert.doesNotMatch(liveRoomClientSource, /\/alerts\?ticker=/);
  assert.doesNotMatch(liveRoomClientSource, />\s*Turn on alerts\s*</);
  assert.doesNotMatch(
    liveRoomInboxSource,
    /\/api\/alerts|\/alerts\?ticker=|Turn on alerts|Telegram|email/i,
  );
  assert.match(liveRoomInboxSource, /Rooms/);
  assert.match(liveRoomInboxSource, /People/);
});

test("alerts ticker query prepares search selection without adding a ticker", () => {
  assert.equal(normalizeAlertTickerSearchParam(" brk.b "), "BRK.B");
  assert.equal(normalizeAlertTickerSearchParam(["msft", "aapl"]), "MSFT");
  assert.equal(normalizeAlertTickerSearchParam("not a ticker"), "");
  assert.equal(normalizeAlertTickerSearchParam("AAPL<script>"), "");

  assert.match(pageSource, /await searchParams/);
  assert.match(
    pageSource,
    /normalizeAlertTickerSearchParam\(params\.ticker\)/,
  );
  assert.match(
    pageSource,
    /<StockRadarAlertsV2 initialTicker=\{initialTicker\}/,
  );
  assert.match(componentSource, /autoSelectExact/);
  assert.match(componentSource, /selectedTicker=\{selectedTicker\?\.ticker\}/);
  assert.match(tickerAutocompleteSource, /\/api\/tickers\/search\?q=/);
  assert.match(
    componentSource,
    /onClick=\{\(\) => void addTicker\(\)\}/,
  );
  assert.doesNotMatch(
    componentSource,
    /autoSelectExact[\s\S]{0,300}(?:addTicker|method:\s*"POST")/,
  );
});

test("alerts settings show the shared reliability notice once", () => {
  assert.equal((componentSource.match(/<AlertReliabilityNotice \/>/g) || []).length, 1);
  assert.match(
    reliabilityNoticeSource,
    /Alerts may be delayed, changed, duplicated, or unavailable\. Do not rely on an alert as the sole basis for a trading decision\./,
  );
});

test("registered alert tickers link to stock overview without absorbing controls", () => {
  assert.match(componentSource, /getStockRouteHref\(ticker\.ticker\)/);
  assert.match(componentSource, /className=\{styles\.tickerSymbolLink\}[\s\S]*href=\{stockHref\}/);
  assert.match(componentSource, /className=\{styles\.tickerCompanyLink\}[\s\S]*href=\{stockHref\}/);
  assert.match(componentSource, /label=\{`Toggle alerts for \$\{ticker\.ticker\}`\}/);
  assert.match(componentSource, /onChange=\{\(\) => void toggleTicker/);
  assert.match(componentSource, /onClick=\{\(\) => void removeTicker/);
  assert.match(styles, /\.tickerSymbolLink:focus-visible,[\s\S]*\.tickerCompanyLink:focus-visible/);
});
