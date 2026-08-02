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
const alertsConfigSource = readFileSync(
  new URL("../../lib/alerts/alertsV2Config.ts", import.meta.url),
  "utf8",
);
const channelsRouteSource = readFileSync(
  new URL("../../app/api/alerts/channels/route.ts", import.meta.url),
  "utf8",
);
const telegramConnectRouteSource = readFileSync(
  new URL("../../app/api/alerts/channels/telegram/connect/route.ts", import.meta.url),
  "utf8",
);
const telegramWebhookRouteSource = readFileSync(
  new URL("../../app/api/telegram/webhook/route.ts", import.meta.url),
  "utf8",
);
const telegramConnectSource = readFileSync(
  new URL("../../lib/telegram/telegramConnect.ts", import.meta.url),
  "utf8",
);
const telegramConnectPolicySource = readFileSync(
  new URL("../../lib/telegram/telegramConnectPolicy.ts", import.meta.url),
  "utf8",
);
const telegramMigrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260731180557_telegram_destination_ownership.sql",
    import.meta.url,
  ),
  "utf8",
);
const calendarFollowsSource = readFileSync(
  new URL("../../lib/alerts/calendarFollows.ts", import.meta.url),
  "utf8",
);
const calendarFollowMigrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260731145536_calendar_follow_plan_limits.sql",
    import.meta.url,
  ),
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

test("alerts mobile cards preserve readable type, full width, and narrow-screen wrapping", () => {
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.page \{[\s\S]*padding: var\(--sr-space-3\) var\(--sr-space-2\) var\(--sr-space-6\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.card \{[\s\S]*box-sizing: border-box;[\s\S]*padding: var\(--sr-space-3\);/,
  );
  assert.match(
    styles,
    /\.tickerCard \.cardHeader > span \{[\s\S]*font-size: 16px;[\s\S]*\.deliveryCard \.settingRow strong \{[\s\S]*font-size: 16px;/,
  );
  assert.match(
    styles,
    /\.recentRow p \{[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*white-space: normal;[\s\S]*overflow-wrap: anywhere;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\) \{[\s\S]*\.marketCapGrid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
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

test("in-app delivery is real, readable, and external channel entitlements stay explicit", () => {
  assert.match(componentSource, /body: JSON\.stringify\(\{ action: "test" \}\)/);
  assert.match(componentSource, /body: JSON\.stringify\(\{ id: alert\.id, read: true \}\)/);
  const deferredCopyPattern = new RegExp(
    [`Coming`, `later`].join(" ") + "|" + [`Coming`, `soon`].join(" "),
    "i",
  );
  assert.doesNotMatch(componentSource, deferredCopyPattern);
  assert.match(componentSource, /item\.lockedTier/);
  assert.match(componentSource, /disabled=\{locked \|\| !implemented \|\| settingsLoading \|\|/);
  assert.match(componentSource, /!channel\.canEnable && !deliveryState\[item\.id\]/);
  assert.match(alertsConfigSource, /id: "telegram"[\s\S]*lockedTier: "PRO"/);
  assert.match(alertsConfigSource, /id: "email"[\s\S]*lockedTier: "ADVANCED"/);
  assert.doesNotMatch(alertsConfigSource, /id: "webhook"|id: "api"/);
  assert.match(channelsRouteSource, /CHANNEL_NOT_IMPLEMENTED/);
  assert.doesNotMatch(channelsRouteSource, deferredCopyPattern);
  assert.match(deliveredRouteSource, /export async function POST/);
  assert.match(deliveredRouteSource, /export async function PATCH/);
  assert.match(deliveredRouteSource, /read_at:/);
  assert.match(followsRouteSource, /setUserCalendarFollow/);
  assert.match(calendarDeliverySource, /user_delivery_channels/);
  assert.match(calendarDeliverySource, /ticker: nullableString\(event\.ticker\)/);
  assert.match(componentSource, /Followed Calendar events/);
});

test("Telegram connect, pause, account change, and disconnect stay distinct and private", () => {
  assert.match(componentSource, /Connect Telegram/);
  assert.match(componentSource, /Change account/);
  assert.match(componentSource, /Disconnect/);
  assert.match(componentSource, /method: "DELETE"/);
  assert.match(componentSource, /updateDeliveryChannel\(\s*item\.id as AlertChannel/);
  assert.match(telegramConnectRouteSource, /export async function DELETE/);
  assert.match(telegramConnectRouteSource, /disconnectTelegramForUser\(userId\)/);
  assert.match(telegramConnectSource, /used_at: "is\.null"/);
  assert.match(telegramConnectSource, /enabled: currentRow \? currentRow\.enabled === true : true/);
  assert.match(telegramConnectSource, /Failed to revoke the previous Telegram connection link/);
  assert.match(telegramConnectSource, /channel: "eq\.telegram"/);
  assert.match(telegramConnectSource, /select: "user_id"/);
  assert.match(
    telegramConnectPolicySource,
    /This Telegram account is already connected to another Stock Radar account\./,
  );
  assert.match(telegramMigrationSource, /create unique index user_delivery_channels_telegram_destination_uidx/);
  assert.match(telegramMigrationSource, /where channel = 'telegram'/);
  assert.match(telegramMigrationSource, /nullif\(btrim\(destination\), ''\) is not null/);
  assert.match(telegramWebhookRouteSource, /export const runtime = "nodejs"/);
  assert.match(telegramWebhookRouteSource, /isPrivateTelegramChat/);
  assert.match(telegramWebhookRouteSource, /wasTelegramConnectTokenClaimed/);
  assert.match(telegramWebhookRouteSource, /getChannelLockState\(plan, "telegram"\)/);
  assert.match(telegramWebhookRouteSource, /secretsMatch\(headerSecret, secret\)/);
  assert.match(telegramWebhookRouteSource, /status: result\.status/);
  assert.doesNotMatch(componentSource, /destination|chatId|chat_id/);
});

test("Telegram connected state exposes a safe optional username and never a chat id", () => {
  assert.match(componentSource, /channel\?\.statusLabel \|\| "Loading\.\.\."/);
  assert.match(telegramConnectSource, /metadata: input\.metadata/);
  assert.doesNotMatch(telegramConnectRouteSource, /destination|chatId|chat_id/);
});

test("Market Discovery is distinct from all-category ticker monitoring", () => {
  assert.match(componentSource, /Market Discovery coverage/);
  assert.match(componentSource, /Each enabled ticker is monitored across all 17 event types\./);
  assert.match(componentSource, /requiresProDiscovery[\s\S]*PRO\+/);
  assert.match(componentSource, /Unlock 12 core Market Discovery categories with Pro/);
  assert.match(componentSource, /item\.requiredTier/);
  assert.doesNotMatch(componentSource, />Alert coverage</);
});

test("Calendar follows enforce effective-plan limits atomically on the server", () => {
  assert.match(followsRouteSource, /getEffectiveUserPlan\(userId\)/);
  assert.match(followsRouteSource, /plan:\s*planState\.effectivePlan/);
  assert.match(followsRouteSource, /\.\.\.error\.details/);
  assert.match(calendarFollowsSource, /calendarEventFollowLimit/);
  assert.match(calendarFollowsSource, /CALENDAR_FOLLOW_LIMIT_REACHED/);
  assert.match(calendarFollowsSource, /upgradeTarget:\s*upgradePlan \? "\/premium" : null/);
  assert.match(calendarFollowMigrationSource, /pg_advisory_xact_lock/);
  assert.match(calendarFollowMigrationSource, /event\.lifecycle_status not in \('released', 'completed', 'cancelled'\)/);
  assert.match(calendarFollowMigrationSource, /follow\.enabled/);
  assert.match(calendarFollowMigrationSource, /on conflict \(user_id, event_id\)/);
  assert.match(componentSource, /formatCalendarEventFollowUsage\(settings\.calendarEventFollowUsage\)/);
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

test("alerts settings omit the retired reliability disclaimer", () => {
  assert.doesNotMatch(componentSource, /AlertReliabilityNotice/);
  assert.doesNotMatch(componentSource, /Alerts may be delayed, changed, duplicated, or unavailable/);
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
