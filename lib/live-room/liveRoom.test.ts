import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { getDirectionalScoreTone } from "../directionalScore.ts";
import {
  createCompanyRoomKey,
  createEventReference,
  getCompanyEventsApiHref,
  getLiveRoomHref,
  resolveCompanyEventSnapshot,
  selectLatestCompanyEvent,
  sortCompanyEvents,
} from "./adapters.ts";
import {
  createMockCompanyUpdate,
  getMockCompanyEvents,
} from "./mockData.ts";
import {
  evaluateLiveRoomMessage,
  LIVE_ROOM_MESSAGE_MAX_LENGTH,
} from "./moderation.ts";
import {
  createLiveRoomGuestToken,
  hashLiveRoomGuestToken,
  isValidLiveRoomGuestToken,
  LIVE_ROOM_GUEST_COOKIE,
} from "./guestIdentity.ts";
import {
  createServerOwnedAuthorSnapshot,
  getDefaultLiveRoomDisplayName,
  getLiveRoomActorFilter,
  isLiveRoomMessageMine,
  LIVE_ROOM_GUEST_LAST_SEEN_INTERVAL_MS,
  LiveRoomPolicyError,
  normalizeLiveRoomProfileInput,
  normalizeLiveRoomReportReason,
  normalizeLiveRoomUuid,
  normalizeOptionalLiveRoomReplyMessageId,
  shouldRefreshLiveRoomGuestLastSeen,
  validateLiveRoomEventReference,
} from "./policy.ts";
import {
  createLiveRoomReplyBodyPreview,
  LIVE_ROOM_REPLY_PREVIEW_MAX_LENGTH,
} from "./replyPolicy.ts";
import {
  LIVE_ROOM_REPORT_REASONS,
  type CompanyEvent,
  type LiveRoomChatMessage,
} from "./types.ts";
import {
  isCurrentLiveRoomTimelineGeneration,
  removeLiveRoomTimelineItems,
  replaceLiveRoomTimeline,
} from "./timeline.ts";
import {
  getLiveRoomTimelineDistanceFromBottom,
  isLiveRoomTimelineNearBottom,
  preserveLiveRoomTimelinePrependPosition,
  shouldScrollLiveRoomTimelineToBottom,
} from "./timelineScroll.ts";
import { LiveRoomRealtimeClientRegistry } from "./realtimeClient.ts";

const events: CompanyEvent[] = [
  {
    detailHref: "/events/older",
    eventId: "older",
    kind: "news",
    occurredAt: "2026-07-26T10:00:00.000Z",
    score: 64,
    signal: "bullish",
    source: "Newswire",
    title: "Older event",
  },
  {
    detailHref: "/filings/latest",
    eventId: "latest",
    kind: "filing",
    occurredAt: "2026-07-27T10:00:00.000Z",
    score: 72,
    signal: "bearish",
    source: "SEC",
    title: "Latest filing",
  },
];

const projectRoot = process.cwd();
const archivedMigrationDirectory = path.join(
  projectRoot,
  "docs",
  "db",
  "migration-archive",
  "pre-canonical-baseline",
);
const archivedMigrationRelativeDirectory = path.join(
  "docs",
  "db",
  "migration-archive",
  "pre-canonical-baseline",
);

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("company rooms use issuer IDs when available and ticker fallback otherwise", () => {
  assert.deepEqual(
    createCompanyRoomKey({ issuerId: "issuer-42", ticker: "AAPL" }),
    { kind: "issuer_id", value: "issuer-42" },
  );
  assert.deepEqual(createCompanyRoomKey({ ticker: "AAPL" }), {
    kind: "ticker_fallback",
    value: "AAPL",
  });
  assert.equal(getLiveRoomHref(" aapl "), "/live/AAPL");
  assert.equal(getLiveRoomHref("market news"), null);
});

test("latest company event selection is deterministic and does not mutate input", () => {
  const originalIds = events.map((event) => event.eventId);
  assert.equal(selectLatestCompanyEvent(events)?.eventId, "latest");
  assert.deepEqual(
    sortCompanyEvents(events).map((event) => event.eventId),
    ["latest", "older"],
  );
  assert.deepEqual(
    events.map((event) => event.eventId),
    originalIds,
  );
});

test("company chat leads with one compact linked latest event without changing Community Room", () => {
  const companyClient = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const communityClient = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const stripIndex = companyClient.indexOf(
    "styles.latestChatEventStrip",
  );
  const timelineIndex = companyClient.indexOf("<ChatTimeline");

  assert.ok(stripIndex > -1);
  assert.ok(timelineIndex > stripIndex);
  assert.match(
    companyClient,
    /latestEvent\?\.detailHref[\s\S]+href=\{latestEvent\.detailHref\}/,
  );
  assert.match(
    companyClient,
    /eventSource === "loading"[\s\S]+styles\.latestChatEventLoading/,
  );
  assert.doesNotMatch(communityClient, /latestChatEventStrip/);
  assert.match(
    styles,
    /\.latestChatEventStrip,[\s\S]+\.latestChatEventLoading[\s\S]+min-height: 62px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]+\.latestChatEventStrip[\s\S]+min-height: 58px/,
  );
});

test("event references keep only compact structured identity", () => {
  assert.deepEqual(createEventReference(events[1]), {
    eventId: "latest",
    kind: "filing",
    title: "Latest filing",
  });
});

test("event API success is authoritative even when the ticker has no events", () => {
  const emptySnapshot = resolveCompanyEventSnapshot({
    apiEvents: [],
    fallbackEvents: events,
    requestSucceeded: true,
  });
  const populatedSnapshot = resolveCompanyEventSnapshot({
    apiEvents: [events[0]],
    fallbackEvents: [events[1]],
    requestSucceeded: true,
  });

  assert.deepEqual(emptySnapshot, { events: [], source: "api" });
  assert.deepEqual(populatedSnapshot, {
    events: [events[0]],
    source: "api",
  });
});

test("event API failure alone activates the deterministic Mock fallback", () => {
  const failedSnapshot = resolveCompanyEventSnapshot({
    apiEvents: [],
    fallbackEvents: events,
    requestSucceeded: false,
  });

  assert.equal(failedSnapshot.source, "mock-fallback");
  assert.deepEqual(
    failedSnapshot.events.map((event) => event.eventId),
    ["latest", "older"],
  );
});

test("company event request intentionally excludes archived events", () => {
  const href = getCompanyEventsApiHref("BRK.B");
  assert.equal(href, "/api/events?ticker=BRK.B&limit=30");
  assert.doesNotMatch(href, /include_archive/);
});

test("Live Room Mock scores follow the 0 to 100 directional score contract", () => {
  const mockEvents = [
    ...getMockCompanyEvents("AAPL"),
    createMockCompanyUpdate("AAPL", 1),
    createMockCompanyUpdate("AAPL", 2),
  ];

  assert.equal(
    mockEvents.every(
      (event) =>
        event.score !== null &&
        event.score >= 0 &&
        event.score <= 100,
    ),
    true,
  );
  assert.equal(getDirectionalScoreTone(36, "volatile"), "default");
  assert.equal(getDirectionalScoreTone(58, "bearish"), "default");
  assert.equal(getDirectionalScoreTone(72, "bearish"), "default");
});

test("a simulated company update is always newer than the current latest event", () => {
  const update = createMockCompanyUpdate(
    "AAPL",
    1,
    events[1].occurredAt,
  );

  assert.equal(selectLatestCompanyEvent([...events, update]), update);
});

test("Live Room uses the shared wide shell and no selected product navigation", () => {
  const clientSource = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const headerSource = readSource(
    "components/live-room/CompanyRoomHeader.tsx",
  );
  const styleSource = readSource(
    "components/live-room/LiveRoom.module.css",
  );

  assert.equal(styleSource.startsWith("\uFEFF"), false);
  assert.match(
    styleSource,
    /\.page\s*\{[\s\S]*--live-room-mobile-tabs-height:\s*60px/,
  );
  assert.match(clientSource, /activeNavigationItem=\{null\}/);
  assert.match(
    headerSource,
    /<h1>\{identity\.ticker\} Live Room<\/h1>/,
  );
  assert.match(
    headerSource,
    /className=\{styles\.roomCompanyName\}[\s\S]*\{identity\.companyName\}/,
  );
  assert.doesNotMatch(headerSource, /Company Live Room|Company room/);
  assert.match(
    styleSource,
    /width:\s*calc\(100%\s*-\s*\(2\s*\*\s*var\(--sr-page-gutter-desktop\)\)\)/,
  );
  assert.match(styleSource, /max-width:\s*1600px/);
  assert.match(
    styleSource,
    /padding:\s*var\(--sr-space-4\)\s+0\s+var\(--sr-space-8\)/,
  );
  assert.match(
    styleSource,
    /padding:\s*var\(--sr-space-2\)\s+var\(--sr-page-gutter-mobile\)/,
  );
  assert.doesNotMatch(clientSource, /Company discussion/);
  assert.doesNotMatch(clientSource, /\{ticker\} Live Room<\/h2>/);
  assert.match(clientSource, /dockOnMobile/);
  assert.match(
    styleSource,
    /height:\s*var\(--live-room-workspace-height\)/,
  );
  assert.doesNotMatch(
    clientSource,
    /InMemoryLiveRoomMessageRepository|BrowserLiveRoomFollowRepository|Mock states/,
  );
});

test("Live Room keeps Chat above the composer and bottom nav while secondary mobile tabs use one sheet", () => {
  const clientSource = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const bottomSheetSource = readSource(
    "components/ui/BottomSheetShell.tsx",
  );
  const bottomSheetStyles = readSource(
    "components/ui/BottomSheetShell.module.css",
  );
  const communitySource = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const tabsSource = readSource("components/live-room/RoomTabs.tsx");
  const timelineSource = readSource(
    "components/live-room/ChatTimeline.tsx",
  );
  const headerSource = readSource(
    "components/live-room/CompanyRoomHeader.tsx",
  );
  const composerSource = readSource(
    "components/live-room/MessageComposer.tsx",
  );
  const liveRoomStyles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const postStyles = readSource("components/live-room/Posts.module.css");

  const desktopTabs =
    clientSource.match(
      /<RoomTabs\s+active=\{activeTab\}[\s\S]*?visibility="desktop"\s*\/>/,
    )?.[0] ?? "";
  const mobileTabs =
    clientSource.match(
      /<RoomTabs\s+active=\{mobileSheet \?\? "chat"\}[\s\S]*?visibility="mobile"\s*\/>/,
    )?.[0] ?? "";

  assert.match(desktopTabs, /label: "Chat"/);
  assert.match(desktopTabs, /label: "Posts"/);
  assert.match(desktopTabs, /label: "Events"/);
  assert.doesNotMatch(desktopTabs, /label: "Members"/);
  assert.match(mobileTabs, /label: "Members"/);
  assert.match(mobileTabs, /controlsId: "live-room-posts-sheet"/);
  assert.match(mobileTabs, /controlsId: "live-room-events-sheet"/);
  assert.match(mobileTabs, /controlsId: "live-room-members-sheet"/);
  assert.match(mobileTabs, /idPrefix="live-room-mobile"/);
  assert.match(mobileTabs, /dockOnMobile/);
  assert.match(mobileTabs, /onItemElementChange=\{handleMobileTabElementChange\}/);
  assert.match(tabsSource, /dockOnMobile\?: boolean/);
  assert.match(tabsSource, /styles\.mobileDock/);
  assert.match(tabsSource, /styles\.desktopOnlyTabs/);
  assert.match(tabsSource, /styles\.mobileOnlyTabs/);
  assert.match(
    tabsSource,
    /nextIndex = \(index \+ 1\) % items\.length/,
  );
  assert.match(
    tabsSource,
    /nextIndex = items\.length - 1/,
  );
  assert.doesNotMatch(tabsSource, /mobileOnly\?: boolean/);
  assert.match(
    tabsSource,
    /"--live-room-mobile-tab-count": items\.length/,
  );
  assert.match(postStyles, /\.tabs\.mobileDock\s*\{[\s\S]*position:\s*fixed/);
  assert.match(
    postStyles,
    /\.tabs\.mobileDock\s*\{[\s\S]*grid-template-columns:\s*repeat\(var\(--live-room-mobile-tab-count, 3\), minmax\(0, 1fr\)\)/,
  );
  assert.match(
    postStyles,
    /\.tabs\.mobileOnlyTabs\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(
    postStyles,
    /@media \(max-width: 760px\)[\s\S]*\.tabs\.desktopOnlyTabs\s*\{[\s\S]*display:\s*none[\s\S]*\.tabs\.mobileOnlyTabs\s*\{[\s\S]*display:\s*grid/,
  );
  assert.doesNotMatch(postStyles, /\.mobileOnlyTab\s*\{/);
  assert.match(
    postStyles,
    /\.tabs\.mobileDock\s*\{[\s\S]*bottom:\s*0/,
  );
  assert.match(
    postStyles,
    /\.tabs\.mobileDock\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*height:\s*calc\([\s\S]*var\(--live-room-mobile-tabs-height\)[\s\S]*env\(safe-area-inset-bottom\)/,
  );
  assert.match(
    clientSource,
    /useState<CompanyLiveRoomTab>\("chat"\)/,
  );
  assert.match(
    clientSource,
    /useState<MobileLiveRoomSheet \| null>\(null\)/,
  );
  assert.match(
    clientSource,
    /import \{ BottomSheetShell \} from "@\/components\/ui\/BottomSheetShell"/,
  );
  assert.match(
    clientSource,
    /<BottomSheetShell[\s\S]*id=\{`live-room-\$\{mobileSheet\}-sheet`\}[\s\S]*layout="full-scroll"[\s\S]*viewport="mobile"/,
  );
  assert.match(
    clientSource,
    /mobileSheet === "posts"[\s\S]*<PostsPanel[\s\S]*mobileSheet === "events"[\s\S]*<EventHistoryPanel[\s\S]*mobileSheet === "members"[\s\S]*<LiveRoomMemberList/,
  );
  assert.match(
    clientSource,
    /onDismiss=\{\(\) => \{[\s\S]*setMobileSheet\(null\);[\s\S]*setActiveTab\("chat"\)/,
  );
  assert.match(
    clientSource,
    /onChange=\{\(tab\) => \{[\s\S]*setActiveTab\("chat"\);[\s\S]*tab === "chat"[\s\S]*setMobileSheet\(null\)/,
  );
  assert.match(clientSource, /mobilePostsOpenerRef/);
  assert.match(clientSource, /mobileEventsOpenerRef/);
  assert.match(clientSource, /mobileMembersOpenerRef/);
  assert.match(
    clientSource,
    /tab === "events"[\s\S]*mobileEventsOpenerRef\.current = element[\s\S]*tab === "members"[\s\S]*mobileMembersOpenerRef\.current = element[\s\S]*tab === "posts"[\s\S]*mobilePostsOpenerRef\.current = element/,
  );
  assert.match(
    tabsSource,
    /onItemElementChange\?\.\(item\.value, element\)/,
  );
  assert.match(bottomSheetSource, /event\.key === "Escape"/);
  assert.match(bottomSheetSource, /role="dialog"/);
  assert.match(bottomSheetSource, /restoreFocus\(opener\)/);
  assert.match(
    bottomSheetSource,
    /const anotherModalIsOpen = document\.querySelector\('\[role="dialog"\]\[aria-modal="true"\]'\);[\s\S]*if \(!anotherModalIsOpen\) \{[\s\S]*restoreFocus\(opener\)/,
  );
  assert.match(
    bottomSheetSource,
    /document\.body\.style\.overflow = "hidden"/,
  );
  assert.match(
    bottomSheetStyles,
    /\.fullScrollRoot\s*\{[\s\S]*z-index:\s*var\(--sr-z-sheet-full-scroll\)/,
  );
  assert.doesNotMatch(
    clientSource,
    /mobileMembersOpen\b|data-mobile-members-open|styles\.membersPanel/,
  );
  assert.doesNotMatch(
    liveRoomStyles,
    /data-mobile-members-open|\.membersPanel/,
  );
  assert.doesNotMatch(communitySource, /BottomSheetShell|mobileSheet/);
  assert.match(
    clientSource,
    /mobileSheet === "members"[\s\S]*onMessageMember=\{handleMobileMessageMember\}[\s\S]*<\/BottomSheetShell>[\s\S]*\{messageRequestTarget \? \([\s\S]*<DirectMessageRequestModal/,
  );
  assert.match(
    liveRoomStyles,
    /\.desktopTabPanel\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(
    liveRoomStyles,
    /\.roomLayout\[data-desktop-hidden="true"\]\s*\{[\s\S]*display:\s*block/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*\.page\s*\{[\s\S]*height:\s*calc\(100dvh - var\(--sr-size-header\)\)[\s\S]*env\(safe-area-inset-bottom\)/,
  );
  assert.match(
    liveRoomStyles,
    /\.page:has\(\.roomLayout:not\(\[hidden\]\) \.composer:focus-within\)\s*\{[\s\S]*--live-room-mobile-composer-control-height:\s*89px/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*\.composer\s*\{[\s\S]{0,300}position:\s*fixed[\s\S]{0,300}bottom:\s*calc\([\s\S]*var\(--live-room-mobile-tabs-height\)[\s\S]*env\(safe-area-inset-bottom\)/,
  );
  assert.match(
    liveRoomStyles,
    /\.messageField textarea\s*\{[\s\S]*height:\s*42px;[\s\S]*max-height:\s*74px/,
  );
  assert.match(
    liveRoomStyles,
    /\.messageField textarea:focus\s*\{[\s\S]*height:\s*74px/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*\.otherMessage article,[\s\S]*\.myMessage article\s*\{[\s\S]*max-width:\s*85%/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.timelineList\s*\{\s*gap:\s*var\(--sr-space-1-5\);\s*\}/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.otherMessage,\s*\.myMessage\s*\{\s*gap:\s*var\(--sr-space-1-5\);\s*\}/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.messageAvatar\s*\{\s*width:\s*30px;\s*height:\s*30px;\s*\}/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.otherMessage article,\s*\.myMessage article\s*\{[\s\S]*?padding:\s*var\(--sr-space-1-5\) var\(--sr-space-2\);/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.otherMessage article > header,\s*\.myMessage article > header\s*\{\s*gap:\s*var\(--sr-space-1\);\s*\}/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.messageReplyButton,\s*\.messageActionsTrigger\s*\{\s*width:\s*24px;\s*height:\s*24px;\s*\}/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.otherMessage article > p,\s*\.myMessage article > p\s*\{\s*margin-top:\s*var\(--sr-space-0-5\);\s*line-height:\s*1\.45;\s*\}/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.messageReplyPreview\s*\{\s*gap:\s*var\(--sr-space-0-5\);\s*margin-top:\s*var\(--sr-space-1-5\);\s*padding:\s*var\(--sr-space-1\) var\(--sr-space-1-5\);\s*\}/,
  );
  assert.match(composerSource, /rows=\{1\}/);
  assert.doesNotMatch(
    composerSource,
    /Server moderation is enforced when you send\./,
  );
  assert.match(
    timelineSource,
    /!item\.author\.isGuest[\s\S]*getPlanDisplayName\(item\.author\.plan\)/,
  );
  assert.doesNotMatch(timelineSource, /<small>Guest<\/small>/);
  assert.match(
    headerSource,
    /identity\.companyName\.trim\(\)\.toUpperCase\(\)\s*!==\s*identity\.ticker/,
  );
  assert.doesNotMatch(headerSource, /Market data|Latest available quote/);
  assert.doesNotMatch(clientSource, /Realtime updates · 45-second polling fallback/);
  assert.doesNotMatch(clientSource, /styles\.chatToolbar/);
  assert.doesNotMatch(clientSource, /aria-label="Blocked Live Room authors"/);
  assert.doesNotMatch(clientSource, /aria-label="Hidden Live Room messages"/);
  assert.match(
    liveRoomStyles,
    /\.roomActions \.followingButton\s*\{[\s\S]*color:\s*var\(--sr-color-warning\)/,
  );
  assert.match(
    liveRoomStyles,
    /\.roomActions button\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent/,
  );
  assert.match(
    liveRoomStyles,
    /\.roomActions \.followingButton svg\s*\{[\s\S]*fill:\s*currentColor/,
  );
  assert.match(
    liveRoomStyles,
    /\.otherMessage article\s*\{[^}]*border:\s*var\(--sr-border-width\) solid var\(--sr-color-accent-subtle\);[^}]*background:\s*var\(--sr-color-accent-subtle\)/,
  );
  assert.doesNotMatch(
    liveRoomStyles,
    /\.otherMessage article\s*\{[^}]*(?:var\(--sr-color-border-section\)|var\(--sr-color-surface-elevated\))/,
  );
  assert.match(
    liveRoomStyles,
    /\.myMessage article\s*\{[^}]*background:\s*var\(--sr-color-accent-selected\)/,
  );
});

test("registered chat author avatar and name open the safe public profile", () => {
  const timeline = readSource("components/live-room/ChatTimeline.tsx");
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const company = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const community = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );

  assert.match(company, /<ChatTimeline/);
  assert.match(community, /<ChatTimeline/);
  assert.match(
    timeline,
    /!item\.author\.isGuest && item\.author\.publicProfileId[\s\S]*encodeURIComponent\(\s*item\.author\.publicProfileId/,
  );
  assert.equal(
    timeline.match(/href=\{publicProfileHref\}/g)?.length,
    2,
  );
  assert.match(
    timeline,
    /aria-label=\{`View \$\{item\.author\.displayName\}'s public profile`\}[\s\S]*messageAvatarLink/,
  );
  assert.match(
    timeline,
    /className=\{styles\.messageAuthorLink\}[\s\S]*\{item\.author\.displayName\}/,
  );
  assert.match(
    timeline,
    /publicProfileHref \? \([\s\S]*<Link[\s\S]*: \([\s\S]*className=\{styles\.messageAvatar\}/,
  );
  assert.match(
    timeline,
    /publicProfileHref \? \([\s\S]*className=\{styles\.messageAuthorLink\}[\s\S]*: \([\s\S]*<strong>\{item\.author\.displayName\}<\/strong>/,
  );
  assert.doesNotMatch(timeline, /item\.author\.(?:userId|email)/);

  assert.match(
    timeline,
    /className=\{styles\.postPreviewAuthor\}[\s\S]*item\.author\.publicProfileId/,
  );
  const replyStart = timeline.indexOf("{item.replyPreview ? (");
  const replyEnd = timeline.indexOf("<p>{item.body}</p>", replyStart);
  assert.ok(replyStart >= 0 && replyEnd > replyStart);
  const replyMarkup = timeline.slice(replyStart, replyEnd);
  assert.match(replyMarkup, /className=\{styles\.messageReplyPreview\}/);
  assert.doesNotMatch(replyMarkup, /<Link/);

  assert.match(
    styles,
    /\.messageAvatarLink:hover,[\s\S]*\.messageAvatarLink:focus-visible[\s\S]*var\(--sr-color-accent-border\)/,
  );
  assert.match(
    styles,
    /\.messageAvatarLink:focus-visible,[\s\S]*\.messageAuthorLink:focus-visible[\s\S]*var\(--sr-focus-ring-color\)/,
  );
});

test("Live Room timeline starts latest, sticks selectively, and preserves older prepends", () => {
  const clientSource = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );

  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("initial", false),
    true,
  );
  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("own-send", false),
    true,
  );
  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("incoming", true),
    true,
  );
  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("incoming", false),
    false,
  );
  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("older-prepend", true),
    false,
  );
  assert.equal(isLiveRoomTimelineNearBottom(80), true);
  assert.equal(isLiveRoomTimelineNearBottom(81), false);

  const longIncomingPostCommitDistance = 180;
  assert.equal(
    isLiveRoomTimelineNearBottom(longIncomingPostCommitDistance),
    false,
  );
  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("incoming", true),
    true,
  );
  assert.equal(
    shouldScrollLiveRoomTimelineToBottom("incoming", false),
    false,
  );
  assert.equal(
    getLiveRoomTimelineDistanceFromBottom({
      clientHeight: 500,
      scrollHeight: 1_200,
      scrollTop: 700,
    }),
    0,
  );
  assert.equal(
    preserveLiveRoomTimelinePrependPosition({
      nextScrollHeight: 1_600,
      previousScrollHeight: 1_200,
      previousScrollTop: 120,
    }),
    520,
  );
  assert.match(clientSource, /ref=\{timelineElementRef\}/);
  assert.match(clientSource, /onScroll=\{handleTimelineScroll\}/);
  assert.match(
    clientSource,
    /shouldScrollLiveRoomTimelineToBottom\(\s*reason,\s*timelineSticksToBottomRef\.current,\s*\)/,
  );
  assert.match(
    clientSource,
    /forceOwnTimelineScrollRef\.current = true;[\s\S]*scheduleTimelineScroll/,
  );
  assert.match(
    clientSource,
    /pendingOlderScrollRef\.current = timelineElement[\s\S]*previousScrollHeight:[\s\S]*previousScrollTop:/,
  );
});

test("Live Room loads one cancellable quote and uses plan-aware fixed ads", () => {
  const pageSource = readSource("app/live/[ticker]/page.tsx");
  const clientSource = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const headerSource = readSource(
    "components/live-room/CompanyRoomHeader.tsx",
  );
  const adSource = readSource(
    "components/live-room/LiveRoomAdSlots.tsx",
  );
  const styleSource = readSource(
    "components/live-room/LiveRoom.module.css",
  );

  assert.match(pageSource, /await getCurrentViewerPlan\(\)/);
  assert.match(pageSource, /viewerPlan=\{viewerPlan\}/);
  assert.match(
    clientSource,
    /\/api\/market\/fmp\/quote\?symbol=\$\{encodeURIComponent\(ticker\)\}/,
  );
  assert.match(clientSource, /mapStockOverviewQuote\(quotePayload\)/);
  assert.match(
    clientSource,
    /const controller = new AbortController\(\)[\s\S]*controller\.signal\.aborted[\s\S]*return \(\) => controller\.abort\(\)/,
  );
  assert.doesNotMatch(clientSource, /quote[\s\S]{0,120}setInterval/);
  assert.doesNotMatch(headerSource, /Market data/);
  assert.doesNotMatch(headerSource, /Latest available quote/);
  assert.match(headerSource, /formatQuotePrice\(quote\.price\)/);
  assert.match(headerSource, /formatQuotePercent\(quote\.changePercent\)/);
  assert.match(clientSource, /areAdsEnabledForPlan\(viewerPlan\)/);
  assert.match(
    clientSource,
    /className=\{styles\.roomHeaderRow\}[\s\S]*data-ad-enabled=\{adsEnabledForViewer \? "true" : undefined\}[\s\S]*<CompanyRoomHeader[\s\S]*<LiveRoomHeaderAdSlot/,
  );
  assert.match(clientSource, /<LiveRoomMobileInlineAdSlot/);
  assert.match(clientSource, /<LiveRoomRailAdSlot/);
  assert.match(adSource, /inventory="live-room-header-728x90"/);
  assert.match(
    adSource,
    /format="fixed"[\s\S]*height=\{90\}[\s\S]*mediaQuery="\(min-width: 1480px\)"[\s\S]*placeholderSize="728 × 90"[\s\S]*showRemoveAdsLink=\{false\}[\s\S]*width=\{728\}/,
  );
  assert.match(
    styleSource,
    /\.desktopHeaderAd\s*\{\s*display:\s*none;[\s\S]*@media \(min-width: 1480px\)[\s\S]*\.roomHeaderRow\[data-ad-enabled="true"\]\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 728px;[\s\S]*gap:\s*var\(--sr-space-4\)/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 1480px\)[\s\S]*\.roomHeaderRow\[data-ad-enabled="true"\] \.roomHeader\s*\{[\s\S]*gap:\s*var\(--sr-space-4\)/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 1480px\)[\s\S]*\.roomHeaderRow\[data-ad-enabled="true"\] \.marketSummary\s*\{[\s\S]*min-width:\s*130px;[\s\S]*padding-left:\s*var\(--sr-space-4\)/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 1480px\)[\s\S]*\.roomHeaderRow\[data-ad-enabled="true"\] \.roomActions\s*\{[\s\S]*gap:\s*var\(--sr-space-1\)/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 1480px\)[\s\S]*\.desktopHeaderAd\s*\{[\s\S]*display:\s*flex;[\s\S]*width:\s*728px;[\s\S]*justify-content:\s*center/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.marketSummaryValues strong\s*\{\s*font-size:\s*var\(--sr-font-size-xl\);[\s\S]*\.marketSummaryValues b\s*\{\s*font-size:\s*var\(--sr-font-size-md\);/,
  );
  assert.match(
    styleSource,
    /\.desktopRail\s*\{[\s\S]*height:\s*var\(--live-room-workspace-height\);[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto/,
  );
  assert.match(
    styleSource,
    /\.desktopSidePanel\s*\{[\s\S]*min-height:\s*0;[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden/,
  );
  assert.match(
    styleSource,
    /\.desktopRailAd\s*\{[\s\S]*padding-bottom:\s*var\(--sr-space-4\)/,
  );
  assert.match(adSource, /if \(!enabledForViewer\) return null/);
  assert.match(adSource, /inventory="live-room-rail-300x250"/);
  assert.match(
    adSource,
    /format="fixed"[\s\S]*height=\{250\}[\s\S]*placeholderSize="300 × 250"[\s\S]*width=\{300\}/,
  );
  assert.match(adSource, /inventory="live-room-mobile-inline"/);
  assert.match(
    adSource,
    /format="fixed"[\s\S]*height=\{50\}[\s\S]*mobileHeight=\{50\}[\s\S]*mobileWidth=\{320\}[\s\S]*placeholderSize="320 × 50"[\s\S]*showRemoveAdsLink=\{false\}[\s\S]*width=\{320\}/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.composer\s*\{[\s\S]{0,300}position:\s*fixed/,
  );
  assert.doesNotMatch(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.timeline\s*\{[\s\S]{0,150}132px/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileInlineAd\s*\{[\s\S]*display:\s*block/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 1180px\)[\s\S]*\.desktopRail,[\s\S]*\.desktopSidePanel\s*\{[\s\S]*display:\s*none/,
  );
});

test("public Live Room entry preserves the guest cookie actor contract without invite tokens", () => {
  const page = readSource("app/live/[ticker]/page.tsx");
  const messagesRoute = readSource(
    "app/api/live-room/[ticker]/messages/route.ts",
  );
  const serverActor = readSource("lib/live-room/serverActor.ts");
  const migrations = readdirSync(
    archivedMigrationDirectory,
  )
    .map((name) =>
      readFileSync(
        path.join(archivedMigrationDirectory, name),
        "utf8",
      ),
    )
    .join("\n");

  assert.match(page, /<LiveRoomClient/);
  assert.doesNotMatch(page, /\/(?:auth|login|sign-in)/i);
  assert.match(
    messagesRoute,
    /resolution = await resolveLiveRoomActor\(request\)/,
  );
  assert.match(serverActor, /actor: \{ kind: "guest", guestSessionId \}/);
  assert.match(
    serverActor,
    /response\.cookies\.set\(\s*LIVE_ROOM_GUEST_COOKIE/,
  );
  assert.doesNotMatch(
    migrations,
    /\blive_room_invites?\b|\binvite_token\b|\binvite_expires_at\b/i,
  );
});

test("Live Room Invite keeps short result states and never copies the current message URL", () => {
  const client = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const header = readSource(
    "components/live-room/CompanyRoomHeader.tsx",
  );

  assert.match(client, /shareLiveRoomInvite\(\{ identity \}\)/);
  assert.match(client, /setInviteState\("idle"\)[\s\S]+2_000/);
  assert.doesNotMatch(client, /window\.location\.href/);
  assert.match(header, /"Copied"[\s\S]+"Shared"[\s\S]+"Share failed"/);
});

test("block removal, unblock replacement, and stale polling cannot hide restored messages", () => {
  const memberMessage: LiveRoomChatMessage = {
    author: {
      displayName: "Member",
      emoji: "M",
      isGuest: false,
      plan: "free",
    },
    body: "Member message",
    createdAt: "2026-07-28T01:00:00.000Z",
    eventReference: null,
    id: "member-message",
    kind: "message",
    replyPreview: null,
  };
  const guestMessage: LiveRoomChatMessage = {
    author: {
      displayName: "Guest",
      emoji: "G",
      isGuest: true,
      plan: "free",
    },
    body: "Guest message",
    createdAt: "2026-07-28T01:01:00.000Z",
    eventReference: null,
    id: "guest-message",
    kind: "message",
    replyPreview: null,
  };

  const blockedTimeline = removeLiveRoomTimelineItems(
    [memberMessage, guestMessage],
    new Set([guestMessage.id]),
  );
  assert.deepEqual(
    blockedTimeline.map((message) => message.id),
    [memberMessage.id],
  );

  const stalePollingGeneration = 4;
  const unblockGeneration = stalePollingGeneration + 1;
  let restoredTimeline = replaceLiveRoomTimeline([
    memberMessage,
    guestMessage,
  ]);
  if (
    isCurrentLiveRoomTimelineGeneration(
      unblockGeneration,
      stalePollingGeneration,
    )
  ) {
    restoredTimeline = removeLiveRoomTimelineItems(
      restoredTimeline,
      new Set([guestMessage.id]),
    );
  }

  assert.deepEqual(
    restoredTimeline.map((message) => message.id),
    [memberMessage.id, guestMessage.id],
  );
});

test("unblock closes stale updates and initial member identity stays unresolved until loaded", () => {
  const client = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const header = readSource(
    "components/live-room/CompanyRoomHeader.tsx",
  );
  const composer = readSource(
    "components/live-room/MessageComposer.tsx",
  );

  assert.match(
    client,
    /useState<LiveRoomProfile \| null>\(null\)/,
  );
  assert.match(client, /useState<boolean \| null>\(null\)/);
  assert.doesNotMatch(client, /defaultProfile/);
  assert.match(
    client,
    /updatesSubscriptionRef\.current\?\.close\(\)[\s\S]+timelineGenerationRef\.current = refreshGeneration[\s\S]+replaceLiveRoomTimeline\(page\.items\)/,
  );
  assert.match(
    client,
    /profile === null[\s\S]+timelineState === "error"/,
  );
  assert.match(header, /disabled=\{followed === null\}/);
  assert.match(header, /followed === null[\s\S]+"Loading…"/);
  assert.match(composer, /profile: LiveRoomProfile \| null/);
  assert.match(composer, /"Loading Live Room identity"/);
  assert.match(composer, /<small>Checking session<\/small>/);
});

test("moderation accepts a normal message and trims outer whitespace", () => {
  assert.deepEqual(
    evaluateLiveRoomMessage("  Useful context  ", {
      history: [],
      now: "2026-07-27T10:00:00.000Z",
    }),
    { allowed: true, normalizedBody: "Useful context" },
  );
});

test("moderation explains every required client-side block result", () => {
  const now = "2026-07-27T10:00:20.000Z";
  const empty = evaluateLiveRoomMessage("   ", { history: [], now });
  const tooLong = evaluateLiveRoomMessage(
    "x".repeat(LIVE_ROOM_MESSAGE_MAX_LENGTH + 1),
    { history: [], now },
  );
  const duplicate = evaluateLiveRoomMessage("same view", {
    history: [{ body: "Same   view", createdAt: "2026-07-27T10:00:00.000Z" }],
    now,
  });
  const blockedWord = evaluateLiveRoomMessage(
    "This is a guaranteed return",
    { history: [], now },
  );
  const tooManyLinks = evaluateLiveRoomMessage(
    "https://a.test https://b.test https://c.test",
    { history: [], now },
  );
  const rateLimit = evaluateLiveRoomMessage("fourth message", {
    history: [
      { body: "one", createdAt: "2026-07-27T10:00:01.000Z" },
      { body: "two", createdAt: "2026-07-27T10:00:05.000Z" },
      { body: "three", createdAt: "2026-07-27T10:00:10.000Z" },
    ],
    now,
  });

  assert.equal(empty.allowed ? null : empty.reason, "empty");
  assert.equal(tooLong.allowed ? null : tooLong.reason, "max_length");
  assert.equal(duplicate.allowed ? null : duplicate.reason, "duplicate");
  assert.equal(
    blockedWord.allowed ? null : blockedWord.reason,
    "blocked_word",
  );
  assert.equal(
    tooManyLinks.allowed ? null : tooManyLinks.reason,
    "excessive_links",
  );
  assert.equal(rateLimit.allowed ? null : rateLimit.reason, "rate_limit");
});

test("guest identity uses an unguessable HttpOnly-cookie token shape and stores only its hash", () => {
  const token = createLiveRoomGuestToken();
  const secondToken = createLiveRoomGuestToken();
  const hash = hashLiveRoomGuestToken(token);

  assert.equal(LIVE_ROOM_GUEST_COOKIE, "sr_live_room_guest");
  assert.equal(isValidLiveRoomGuestToken(token), true);
  assert.notEqual(token, secondToken);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashLiveRoomGuestToken(token), hash);
  assert.equal(isValidLiveRoomGuestToken("chosen-by-a-client"), false);
});

test("server-owned actor identity prevents guest and member impersonation", () => {
  const guest = {
    kind: "guest" as const,
    guestSessionId: "11111111-1111-4111-8111-111111111111",
  };
  const member = {
    kind: "member" as const,
    userId: "22222222-2222-4222-8222-222222222222",
    email: "member@example.com",
  };
  const profile = {
    displayName: "Server profile",
    emoji: "🧭",
    isGuest: true,
    plan: "free" as const,
  };

  assert.deepEqual(
    createServerOwnedAuthorSnapshot({ actor: guest, profile }),
    {
      actorKind: "guest",
      memberUserId: null,
      guestSessionId: guest.guestSessionId,
      displayName: "Server profile",
      emoji: "🧭",
      plan: "free",
    },
  );
  assert.equal(
    isLiveRoomMessageMine(
      {
        author_kind: "guest",
        guest_session_id: "33333333-3333-4333-8333-333333333333",
      },
      guest,
    ),
    false,
  );
  assert.equal(
    isLiveRoomMessageMine(
      {
        author_kind: "member",
        member_user_id: member.userId,
      },
      member,
    ),
    true,
  );
});

test("actor filters use each table's discriminator column", () => {
  const guest = {
    kind: "guest" as const,
    guestSessionId: "33333333-3333-4333-8333-333333333333",
  };

  assert.deepEqual(getLiveRoomActorFilter(guest), {
    actor_kind: "eq.guest",
    guest_session_id: `eq.${guest.guestSessionId}`,
  });
  assert.deepEqual(getLiveRoomActorFilter(guest, "author_kind"), {
    author_kind: "eq.guest",
    guest_session_id: `eq.${guest.guestSessionId}`,
  });
});

test("guest last-seen writes are throttled to one update per five minutes", () => {
  const now = new Date("2026-07-27T10:05:00.000Z");

  assert.equal(LIVE_ROOM_GUEST_LAST_SEEN_INTERVAL_MS, 300_000);
  assert.equal(
    shouldRefreshLiveRoomGuestLastSeen(
      "2026-07-27T10:00:01.000Z",
      now,
    ),
    false,
  );
  assert.equal(
    shouldRefreshLiveRoomGuestLastSeen(
      "2026-07-27T10:00:00.000Z",
      now,
    ),
    true,
  );
  assert.equal(
    shouldRefreshLiveRoomGuestLastSeen("invalid", now),
    true,
  );
});

test("member default display names never derive from email addresses", () => {
  assert.equal(
    getDefaultLiveRoomDisplayName({
      kind: "member",
      userId: "22222222-2222-4222-8222-222222222222",
      email: "private.local-part@example.com",
    }),
    "Member",
  );
  assert.equal(
    getDefaultLiveRoomDisplayName({
      kind: "guest",
      guestSessionId: "11111111-1111-4111-8111-111111111111",
    }),
    "Guest",
  );
});

test("profile policy rejects arbitrary emoji and control-character names", () => {
  assert.deepEqual(
    normalizeLiveRoomProfileInput({
      displayName: "  RadarFox  ",
      emoji: "🦊",
    }),
    { displayName: "RadarFox", emoji: "🦊" },
  );
  assert.throws(
    () =>
      normalizeLiveRoomProfileInput({
        displayName: "Imposter",
        emoji: "💳",
      }),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_INVALID_EMOJI",
  );
  assert.throws(
    () =>
      normalizeLiveRoomProfileInput({
        displayName: "bad\u0000name",
        emoji: "👋",
      }),
    LiveRoomPolicyError,
  );
});

test("event mentions must belong to the room and cannot reference archive events", () => {
  const valid = {
    deliveryLevel: "feed",
    eventId: "33333333-3333-4333-8333-333333333333",
    eventTicker: "AAPL",
    kind: "news" as const,
    roomTicker: "AAPL",
    title: "Company update",
  };
  assert.deepEqual(validateLiveRoomEventReference(valid), {
    eventId: valid.eventId,
    kind: "news",
    title: "Company update",
  });
  assert.throws(
    () =>
      validateLiveRoomEventReference({
        ...valid,
        eventTicker: "MSFT",
      }),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_INVALID_EVENT_REFERENCE",
  );
  assert.throws(
    () =>
      validateLiveRoomEventReference({
        ...valid,
        deliveryLevel: "archive",
      }),
    LiveRoomPolicyError,
  );
});

test("Live Room API accepts only message content, event ID, and a closed reply target from the browser", () => {
  const routeSource = readSource(
    "app/api/live-room/[ticker]/messages/route.ts",
  );
  const repositorySource = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const actorSource = readSource("lib/live-room/serverActor.ts");
  const clientSource = readSource("lib/live-room/apiRepository.ts");

  assert.match(routeSource, /body\?: unknown/);
  assert.match(routeSource, /eventId\?: unknown/);
  assert.match(routeSource, /replyToMessageId\?: unknown/);
  assert.match(
    routeSource,
    /normalizeOptionalLiveRoomReplyMessageId\(\s*input\?\.replyToMessageId/,
  );
  assert.match(routeSource, /assertSameOriginAuthRequest\(request\)/);
  assert.doesNotMatch(routeSource, /input\?\.author|input\?\.plan/);
  assert.match(repositorySource, /getEffectiveUserPlan\(actor\.userId\)/);
  assert.match(repositorySource, /createServerOwnedAuthorSnapshot/);
  assert.match(repositorySource, /getDefaultLiveRoomDisplayName/);
  assert.doesNotMatch(repositorySource, /\.split\(["']@/);
  assert.match(actorSource, /request\.cookies\.get\(LIVE_ROOM_GUEST_COOKIE\)/);
  assert.match(actorSource, /select: "id,last_seen_at"/);
  assert.match(actorSource, /shouldRefreshLiveRoomGuestLastSeen/);
  assert.match(actorSource, /httpOnly:\s*true/);
  assert.doesNotMatch(actorSource, /request\.json/);
  assert.doesNotMatch(clientSource, /SUPABASE_(?:SERVICE_ROLE|ANON)_KEY/);
  assert.match(clientSource, /transport interface|LiveRoomUpdateTransport/i);
});

test("reply previews are compact and optional reply IDs validate closed", () => {
  assert.equal(
    createLiveRoomReplyBodyPreview("  First line\n\tsecond   line  "),
    "First line second line",
  );
  const long = "x".repeat(LIVE_ROOM_REPLY_PREVIEW_MAX_LENGTH + 40);
  const preview = createLiveRoomReplyBodyPreview(long);
  assert.equal(preview.length, LIVE_ROOM_REPLY_PREVIEW_MAX_LENGTH);
  assert.ok(preview.endsWith("…"));

  assert.equal(normalizeOptionalLiveRoomReplyMessageId(undefined), null);
  assert.equal(normalizeOptionalLiveRoomReplyMessageId(null), null);
  assert.equal(
    normalizeOptionalLiveRoomReplyMessageId(
      "123e4567-e89b-42d3-a456-426614174000",
    ),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assert.throws(
    () => normalizeOptionalLiveRoomReplyMessageId("not-a-uuid"),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_INVALID_REPLY_TARGET",
  );
});

test("message replies are same-room, visible, indexed, invoker-only, and service-only", () => {
  const migration = readSource(
    "supabase/migrations/20260728194310_live_room_message_replies.sql",
  );
  assert.match(
    migration,
    /add column reply_to_message_id uuid/i,
  );
  assert.match(
    migration,
    /unique\s*\(room_id,\s*id\)/i,
  );
  assert.match(
    migration,
    /foreign key\s*\(room_id,\s*reply_to_message_id\)[\s\S]*?references public\.live_room_messages\s*\(room_id,\s*id\)[\s\S]*?on delete restrict/i,
  );
  assert.match(
    migration,
    /create index live_room_messages_room_reply_idx[\s\S]*?\(room_id,\s*reply_to_message_id\)/i,
  );
  assert.match(
    migration,
    /drop function if exists public\.insert_live_room_message\(\s*uuid,\s*text,\s*uuid,\s*uuid,\s*text,\s*text,\s*text,\s*text,\s*uuid\s*\)/i,
  );
  assert.match(migration, /p_reply_to_message_id uuid default null/i);
  assert.match(
    migration,
    /target\.id = p_reply_to_message_id[\s\S]*?target\.room_id = p_room_id[\s\S]*?target\.visibility_status = 'visible'/i,
  );
  assert.match(migration, /LIVE_ROOM_INVALID_REPLY_TARGET/);
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.match(
    migration,
    /revoke all on function public\.insert_live_room_message\([\s\S]*?\) from public/i,
  );
  assert.match(
    migration,
    /grant all on function public\.insert_live_room_message\([\s\S]*?\) to service_role/i,
  );
});

test("message reads bulk-enrich opaque profiles and safe reply previews without N+1", () => {
  const repository = readSource("lib/live-room/serverRepository.ts");
  const timeline = readSource("lib/live-room/timeline.ts");
  const chat = readSource("components/live-room/ChatTimeline.tsx");
  const composer = readSource(
    "components/live-room/MessageComposer.tsx",
  );
  const client = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );

  assert.match(
    repository,
    /supabaseSelect\("live_room_member_profiles",\s*\{[\s\S]*?select: "user_id,public_profile_id"[\s\S]*?user_id: `in\.\(\$\{memberUserIds\.join\(","\)\}\)`/,
  );
  assert.match(
    repository,
    /publicProfileId:[\s\S]*?publicProfileIdMap\.get\(memberUserId\)/,
  );
  assert.match(
    repository,
    /function getLiveRoomReplyPreviewMap[\s\S]*?id: `in\.\(\$\{replyMessageIds\.join\(","\)\}\)`[\s\S]*?visibility_status: "eq\.visible"/,
  );
  assert.match(
    repository,
    /getBlockedActorIds\(actor\)[\s\S]*?blocked\.has\(readString\(row\.actor_id\)\)/,
  );
  assert.ok(
    (repository.match(/reply_to_message_id/g) || []).length >= 6,
  );
  assert.match(
    timeline,
    /removedIds\.has\(item\.replyPreview\.messageId\)[\s\S]*?replyPreview: null/,
  );
  assert.match(chat, /aria-label=\{`Reply to \$\{item\.author\.displayName\}`\}/);
  assert.match(chat, /className=\{styles\.messageReplyPreview\}/);
  assert.match(composer, /Replying to \{replyPreview\.authorDisplayName\}/);
  assert.match(composer, /aria-label="Cancel reply"/);
  assert.match(composer, /`Reply to \$\{replyPreview\.authorDisplayName\}…`/);
  assert.match(client, /replyToMessageId: replyingTo\?\.id \|\| null/);
  assert.match(
    client,
    /setBody\(""\);[\s\S]*?setReference\(null\);[\s\S]*?setReplyingTo\(null\)/,
  );
});

test("Live Room migration is server-only, RLS-enabled, and atomically moderates writes", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) => name.endsWith("_live_room_realtime_foundation.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const tables = [
    "live_room_rooms",
    "live_room_guest_sessions",
    "live_room_member_profiles",
    "live_room_guest_profiles",
    "live_room_messages",
    "live_room_follows",
  ];

  tables.forEach((table) => {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
  });
  assert.match(
    migration,
    /from public, anon, authenticated/i,
  );
  assert.match(migration, /to service_role/i);
  assert.match(
    migration,
    /referenced_event_id uuid\s+references public\.events\(id\) on delete set null/i,
  );
  assert.match(
    migration,
    /function public\.insert_live_room_message[\s\S]+security invoker/i,
  );
  assert.doesNotMatch(
    migration,
    /function public\.insert_live_room_message[\s\S]{0,300}security definer/i,
  );
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /LIVE_ROOM_DUPLICATE/);
  assert.match(migration, /LIVE_ROOM_RATE_LIMIT/);
  assert.match(migration, /LIVE_ROOM_INVALID_EVENT_REFERENCE/);
  assert.match(migration, /token_hash text not null unique/i);
  assert.doesNotMatch(migration, /all sequences in schema public/i);
});

test("Live Room hardening migration is encoding-safe and covers actor foreign keys", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) => name.endsWith("_live_room_foundation_hardening.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );

  assert.match(migration, /chr\(128075\)/);
  assert.match(migration, /live_room_messages_member_user_idx/i);
  assert.match(migration, /live_room_messages_guest_session_idx/i);
  assert.match(migration, /live_room_follows_member_user_idx/i);
  assert.match(migration, /live_room_follows_guest_session_idx/i);
});

test("report reasons and message IDs are closed allowlists", () => {
  assert.deepEqual(LIVE_ROOM_REPORT_REASONS, [
    "spam",
    "harassment",
    "misinformation",
    "other",
  ]);
  LIVE_ROOM_REPORT_REASONS.forEach((reason) => {
    assert.equal(normalizeLiveRoomReportReason(reason), reason);
  });
  assert.throws(
    () => normalizeLiveRoomReportReason("financial_advice"),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_INVALID_REPORT_REASON",
  );
  assert.equal(
    normalizeLiveRoomUuid("11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111",
  );
  assert.throws(() => normalizeLiveRoomUuid("message-from-client"));
});

test("Realtime uses public metadata-only Broadcast with a change cursor and low-frequency fallback", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) => name.endsWith("_live_room_realtime_moderation.sql"));
  assert.ok(migrationName);
  assert.ok(
    migrationName > "20260727102419_live_room_foundation_hardening.sql",
  );
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const transport = readSource("lib/live-room/apiRepository.ts");
  const realtimeClient = readSource(
    "lib/live-room/realtimeClient.ts",
  );
  const page = readSource("app/live/[ticker]/page.tsx");
  const broadcastFunction =
    migration.match(
      /function private\.broadcast_live_room_message_change\(\)[\s\S]+?revoke all privileges/i,
    )?.[0] || "";

  assert.match(broadcastFunction, /security definer/i);
  assert.match(broadcastFunction, /set search_path = ''/i);
  assert.match(broadcastFunction, /realtime\.send\(/i);
  assert.match(broadcastFunction, /'roomId'[\s\S]+'messageId'[\s\S]+'action'/i);
  assert.match(broadcastFunction, /'live-room:' \|\| v_ticker[\s\S]+false/i);
  assert.doesNotMatch(
    broadcastFunction,
    /author_display_name|member_user_id|guest_session_id|actor_id|'body'/i,
  );
  assert.match(
    migration,
    /function private\.broadcast_live_room_message_change\(\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(transport, /LIVE_ROOM_FALLBACK_POLL_INTERVAL_MS = 45_000/);
  assert.match(realtimeClient, /config: \{ private: false \}/);
  assert.match(realtimeClient, /persistSession: false/);
  assert.match(realtimeClient, /autoRefreshToken: false/);
  assert.match(realtimeClient, /detectSessionInUrl: false/);
  assert.match(transport, /mode:\s*"changes"/);
  assert.match(transport, /afterChange/);
  assert.match(transport, /status === "SUBSCRIBED"/);
  assert.match(page, /getLiveRoomRealtimeConfig\(\)/);
  assert.doesNotMatch(transport, /SERVICE_ROLE|service_role/);
  assert.doesNotMatch(realtimeClient, /SERVICE_ROLE|service_role/);
});

test("Realtime reuses clients by config and closes only the released room channel", async () => {
  type FakeChannel = {
    on: (
      type: "broadcast",
      filter: { event: string },
      callback: () => void,
    ) => FakeChannel;
    subscribe: (
      callback: (
        status:
          | "CHANNEL_ERROR"
          | "CLOSED"
          | "SUBSCRIBED"
          | "TIMED_OUT",
      ) => void,
    ) => FakeChannel;
    topic: string;
  };
  const createdConfigs: string[] = [];
  const clients: Array<{
    channels: FakeChannel[];
    removed: FakeChannel[];
  }> = [];
  const registry = new LiveRoomRealtimeClientRegistry((config) => {
    createdConfigs.push(`${config.url}|${config.publishableKey}`);
    const client = {
      channels: [] as FakeChannel[],
      removed: [] as FakeChannel[],
    };
    clients.push(client);
    return {
      channel(topic) {
        const channel: FakeChannel = {
          on() {
            return channel;
          },
          subscribe() {
            return channel;
          },
          topic,
        };
        client.channels.push(channel);
        return channel;
      },
      removeChannel(channel) {
        client.removed.push(channel as FakeChannel);
      },
    };
  });
  const sharedConfig = {
    publishableKey: "publishable-a",
    url: "https://project-a.supabase.co",
  };

  const aapl = await registry.subscribe({
    config: sharedConfig,
    onSignal() {},
    onStatus() {},
    topic: "live-room:AAPL",
  });
  const msft = await registry.subscribe({
    config: sharedConfig,
    onSignal() {},
    onStatus() {},
    topic: "live-room:MSFT",
  });
  assert.equal(createdConfigs.length, 1);
  const secondKey = await registry.subscribe({
    config: {
      publishableKey: "publishable-b",
      url: "https://project-a.supabase.co",
    },
    onSignal() {},
    onStatus() {},
    topic: "live-room:AAPL",
  });
  const secondProject = await registry.subscribe({
    config: {
      publishableKey: "publishable-a",
      url: "https://project-b.supabase.co",
    },
    onSignal() {},
    onStatus() {},
    topic: "live-room:AAPL",
  });

  assert.equal(createdConfigs.length, 3);
  assert.deepEqual(
    clients[0]?.channels.map((channel) => channel.topic),
    ["live-room:AAPL", "live-room:MSFT"],
  );
  await aapl.close();
  await aapl.close();
  assert.deepEqual(
    clients[0]?.removed.map((channel) => channel.topic),
    ["live-room:AAPL"],
  );
  assert.deepEqual(
    clients[0]?.channels
      .filter((channel) => !clients[0]?.removed.includes(channel))
      .map((channel) => channel.topic),
    ["live-room:MSFT"],
  );

  await Promise.all([
    msft.close(),
    secondKey.close(),
    secondProject.close(),
  ]);
});

test("Realtime shares one room channel until its final subscription closes", async () => {
  const removedTopics: string[] = [];
  let channelCount = 0;
  const registry = new LiveRoomRealtimeClientRegistry(() => ({
    channel(topic) {
      channelCount += 1;
      const channel = {
        on() {
          return channel;
        },
        subscribe() {
          return channel;
        },
        topic,
      };
      return channel;
    },
    removeChannel(channel) {
      removedTopics.push(
        (channel as unknown as { topic: string }).topic,
      );
    },
  }));
  const config = {
    publishableKey: "publishable",
    url: "https://project.supabase.co",
  };
  const first = await registry.subscribe({
    config,
    onSignal() {},
    onStatus() {},
    topic: "live-room:AAPL",
  });
  const second = await registry.subscribe({
    config,
    onSignal() {},
    onStatus() {},
    topic: "live-room:AAPL",
  });

  assert.equal(channelCount, 1);
  await first.close();
  assert.deepEqual(removedTopics, []);
  await second.close();
  assert.deepEqual(removedTopics, ["live-room:AAPL"]);
});

test("reports, blocks, and moderator tables stay service-only and RLS default-deny", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) => name.endsWith("_live_room_realtime_moderation.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const tables = [
    "live_room_message_reports",
    "live_room_actor_blocks",
    "live_room_moderators",
    "live_room_moderation_actions",
  ];
  tables.forEach((table) => {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
  });
  assert.match(
    migration,
    /reason in \('spam', 'harassment', 'misinformation', 'other'\)/i,
  );
  assert.match(
    migration,
    /unique \(message_id, reporter_kind, reporter_actor_id\)/i,
  );
  assert.match(migration, /reporter_actor_id uuid not null/i);
  assert.match(migration, /LIVE_ROOM_INVALID_REPORTER/);
  assert.match(
    migration,
    /reporter_guest_session_id uuid[\s\S]{0,120}on delete set null/i,
  );
  assert.match(migration, /LIVE_ROOM_CANNOT_BLOCK_SELF/);
  assert.match(
    migration,
    /create table if not exists public\.live_room_moderators/i,
  );
  assert.match(migration, /role in \('moderator', 'admin'\)/i);
  assert.match(migration, /to service_role/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.doesNotMatch(
    migration,
    /auth\.jwt\(\)[\s\S]{0,120}(?:user_metadata|raw_user_meta_data)/i,
  );
});

test("Live Room block and moderation RPC correction uses SQL COALESCE and preserves service-only grants", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) => name.endsWith("_fix_live_room_block_moderation.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );

  assert.match(
    migration,
    /function public\.block_live_room_message_author[\s\S]+security invoker[\s\S]+set search_path = ''/i,
  );
  assert.match(
    migration,
    /function public\.moderate_live_room_message[\s\S]+security invoker[\s\S]+set search_path = ''/i,
  );
  assert.doesNotMatch(migration, /pg_catalog\.coalesce/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /to service_role/i);
});

test("message APIs resolve moderation targets server-side and never return actor IDs", () => {
  const reportsRoute = readSource(
    "app/api/live-room/[ticker]/reports/route.ts",
  );
  const blocksRoute = readSource(
    "app/api/live-room/[ticker]/blocks/route.ts",
  );
  const moderationRoute = readSource(
    "app/api/live-room/[ticker]/moderation/route.ts",
  );
  const repository = readSource("lib/live-room/serverRepository.ts");
  const timeline = readSource("components/live-room/ChatTimeline.tsx");

  assert.match(reportsRoute, /messageId\?: unknown/);
  assert.match(reportsRoute, /reason\?: unknown/);
  assert.match(reportsRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(blocksRoute, /messageId\?: unknown/);
  assert.doesNotMatch(blocksRoute, /memberUserId|guestSessionId|actorId/);
  assert.match(moderationRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(repository, /visibility_status:\s*"eq\.visible"/);
  assert.match(repository, /isLiveRoomModerator\(actor\)/);
  assert.match(timeline, /canBlock=\{!mine && Boolean\(onBlock\)\}/);
  assert.match(timeline, />\s*Report\s*</);
  assert.match(timeline, />\s*Block author\s*</);
  assert.match(timeline, />\s*Hide\s*</);
});

test("chat follow migration resets legacy scope and stores an exact read baseline", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_chat_follows_and_member_follows.sql"),
  );
  assert.ok(migrationName);
  assert.ok(
    migrationName > "20260727121025_fix_live_room_block_moderation.sql",
  );
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const setFollowFunction =
    migration.match(
      /function public\.set_live_room_chat_follow\([\s\S]+?\$\$;/i,
    )?.[0] || "";

  assert.match(
    migration,
    /update public\.live_room_follows[\s\S]+notification_scope = 'new_chat_messages'/i,
  );
  assert.match(
    migration,
    /check \(notification_scope = 'new_chat_messages'\)/i,
  );
  assert.doesNotMatch(migration, /company_updates_only/);
  assert.match(migration, /last_read_at timestamptz not null default now\(\)/i);
  assert.match(
    migration,
    /last_read_message_id uuid[\s\S]{0,100}references public\.live_room_messages\(id\)/i,
  );
  assert.match(
    setFollowFunction,
    /visibility_status = 'visible'[\s\S]+order by message\.created_at desc, message\.id desc[\s\S]+limit 1/i,
  );
  assert.match(
    setFollowFunction,
    /last_read_at[\s\S]+coalesce\(v_latest_message_at, now\(\)\)[\s\S]+last_read_message_id/i,
  );
  assert.match(setFollowFunction, /security invoker/i);
  assert.match(setFollowFunction, /set search_path = ''/i);
});

test("unread and mark-read DB contracts exclude self messages and only advance displayed rooms", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_chat_follows_and_member_follows.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const unreadFunction =
    migration.match(
      /function public\.get_live_room_unread_summary\([\s\S]+?\$\$;/i,
    )?.[0] || "";
  const markReadFunction =
    migration.match(
      /function public\.mark_live_room_follow_read\([\s\S]+?\$\$;/i,
    )?.[0] || "";
  const readRoute = readSource(
    "app/api/live-room/[ticker]/read/route.ts",
  );
  const client = readSource("components/live-room/LiveRoomClient.tsx");

  assert.match(unreadFunction, /message\.visibility_status = 'visible'/i);
  assert.match(
    unreadFunction,
    /message\.created_at > follow\.last_read_at/i,
  );
  assert.match(
    unreadFunction,
    /message\.author_kind is distinct from follow\.actor_kind\s*or message\.actor_id is distinct from follow\.actor_id/i,
  );
  assert.match(
    unreadFunction,
    /follow\.notification_scope = 'new_chat_messages'/i,
  );
  assert.match(
    markReadFunction,
    /message\.id = p_message_id[\s\S]+message\.room_id = p_room_id[\s\S]+message\.visibility_status = 'visible'/i,
  );
  assert.match(
    markReadFunction,
    /last_read_at = greatest\(follow\.last_read_at, v_read_at\)/i,
  );
  assert.match(markReadFunction, /follow\.followed = true/i);
  assert.match(readRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(readRoute, /input\?\.messageId \?\? null/);
  assert.match(client, /\.markRead\(latestMessageId\)/);
  assert.match(client, /getLatestChatMessageId\(messages\)/);
  assert.match(client, /800/);
});

test("member follows are service-only and message IDs resolve targets without UUID exposure or N+1 reads", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_chat_follows_and_member_follows.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const route = readSource(
    "app/api/live-room/[ticker]/member-follow/route.ts",
  );
  const repository = readSource("lib/live-room/serverRepository.ts");
  const browserTypes = readSource("lib/live-room/types.ts");
  const timeline = readSource("components/live-room/ChatTimeline.tsx");

  assert.match(
    migration,
    /create table if not exists public\.live_room_member_follows/i,
  );
  assert.match(
    migration,
    /primary key \(follower_user_id, followed_user_id\)/i,
  );
  assert.match(migration, /check \(follower_user_id <> followed_user_id\)/i);
  assert.match(
    migration,
    /alter table public\.live_room_member_follows enable row level security/i,
  );
  assert.match(
    migration,
    /on table public\.live_room_member_follows\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /on table public\.live_room_member_follows\s+to service_role/i,
  );
  assert.match(route, /messageId\?: unknown/);
  assert.match(route, /assertSameOriginAuthRequest\(request\)/);
  assert.doesNotMatch(route, /memberUserId|followedUserId|authUserId/);
  assert.match(repository, /actor\.kind !== "member"/);
  assert.match(repository, /LIVE_ROOM_CANNOT_FOLLOW_SELF/);
  assert.match(
    repository,
    /const targetUserIds =[\s\S]+supabaseSelect\("live_room_member_follows"[\s\S]+followed_user_id: `in\.\(\$\{targetUserIds\.join\(","\)\}\)`/,
  );
  assert.doesNotMatch(browserTypes, /memberUserId|followedUserId|authUserId/);
  assert.match(
    timeline,
    /memberFollowed \? "Following" : "Follow member"/,
  );
});

test("member activity cursors exclude history, hidden messages, self, and blocked authors in one bounded RPC", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_member_activity.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const setFollowFunction =
    migration.match(
      /function public\.set_live_room_member_follow\([\s\S]+?\$\$;/i,
    )?.[0] || "";
  const activityFunction =
    migration.match(
      /function public\.get_live_room_activity_summary\([\s\S]+?\$\$;/i,
    )?.[0] || "";

  assert.match(
    migration,
    /alter table public\.live_room_member_follows[\s\S]+last_read_at timestamptz not null default now\(\)[\s\S]+last_read_message_id uuid/i,
  );
  assert.match(
    setFollowFunction,
    /message\.visibility_status = 'visible'[\s\S]+order by message\.created_at desc, message\.id desc[\s\S]+limit 1/i,
  );
  assert.match(
    setFollowFunction,
    /coalesce\(v_latest_message_at, now\(\)\)[\s\S]+v_latest_message_id/i,
  );
  assert.match(
    setFollowFunction,
    /v_followed_user_id = p_follower_user_id[\s\S]+LIVE_ROOM_CANNOT_FOLLOW_SELF/i,
  );
  assert.match(activityFunction, /message\.visibility_status = 'visible'/i);
  assert.match(
    activityFunction,
    /message\.created_at > follow\.last_read_at/i,
  );
  assert.match(
    activityFunction,
    /live_room_actor_blocks[\s\S]+block\.blocked_member_user_id = follow\.followed_user_id/i,
  );
  assert.match(
    activityFunction,
    /greatest\([\s\S]+least\([\s\S]+p_people_limit[\s\S]+50/i,
  );
  assert.match(
    activityFunction,
    /distinct_unread_messages[\s\S]+union[\s\S]+people_unread_messages/i,
  );
  assert.match(
    migration,
    /live_room_messages_member_activity_idx[\s\S]+where author_kind = 'member'[\s\S]+visibility_status = 'visible'/i,
  );
});

test("member activity migration only schema-qualifies real pg_catalog functions", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_member_activity.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const qualifiedCatalogCalls = [
    ...migration.matchAll(/\bpg_catalog\.([a-z_][a-z0-9_]*)\s*\(/gi),
  ].map((match) => match[1].toLowerCase());

  assert.doesNotMatch(
    migration,
    /\bpg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
  assert.deepEqual(
    [...new Set(qualifiedCatalogCalls)].sort(),
    [
      "count",
      "jsonb_agg",
      "jsonb_build_object",
      "left",
      "regexp_replace",
    ],
  );
});

test("member activity read and message anchors validate room ownership before advancing an exact follower cursor", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_member_activity.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const readFunction =
    migration.match(
      /function public\.mark_live_room_member_activity_read\([\s\S]+?\$\$;/i,
    )?.[0] || "";
  const anchorRoute = readSource(
    "app/api/live-room/[ticker]/messages/[messageId]/route.ts",
  );
  const readRoute = readSource(
    "app/api/live-room/[ticker]/member-activity/read/route.ts",
  );
  const client = readSource("components/live-room/LiveRoomClient.tsx");
  const timeline = readSource("components/live-room/ChatTimeline.tsx");

  assert.match(
    readFunction,
    /message\.id = p_message_id[\s\S]+message\.room_id = p_room_id[\s\S]+message\.visibility_status = 'visible'/i,
  );
  assert.match(
    readFunction,
    /follow\.follower_user_id = p_follower_user_id[\s\S]+follow\.followed_user_id = v_followed_user_id/i,
  );
  assert.match(readRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(readRoute, /markLiveRoomMemberActivityRead/);
  assert.match(anchorRoute, /getLiveRoomMessageAnchor/);
  assert.match(client, /readMessageAnchor\(activityMessageId\)/);
  assert.match(client, /IntersectionObserver/);
  assert.match(client, /markMemberActivityRead\(highlightedMessageId\)/);
  assert.match(
    timeline,
    /id=\{`live-room-message-\$\{item\.id\}`\}/,
  );
});

test("member activity API stays service-only, privacy-safe, and avoids per-author summary queries", () => {
  const migrationName = readdirSync(
    archivedMigrationDirectory,
  ).find((name) =>
    name.endsWith("_live_room_member_activity.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const repository = readSource("lib/live-room/serverRepository.ts");
  const browserTypes = readSource("lib/live-room/types.ts");
  const inbox = readSource("components/shell/LiveRoomUnreadMenu.tsx");

  assert.match(
    migration,
    /on function public\.get_live_room_activity_summary\([\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /on function public\.get_live_room_activity_summary\([\s\S]+to service_role/i,
  );
  assert.match(
    migration,
    /on table public\.live_room_member_follows\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete\s+on table public\.live_room_member_follows\s+to service_role/i,
  );
  assert.match(migration, /security invoker/gi);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/gi);
  assert.match(
    repository,
    /supabaseRpc\("get_live_room_activity_summary"/,
  );
  assert.doesNotMatch(
    browserTypes,
    /followerUserId|followedUserId|memberUserId|authUserId|email/,
  );
  assert.doesNotMatch(
    inbox,
    /followerUserId|followedUserId|memberUserId|authUserId|email/,
  );
  assert.match(inbox, /message=\$\{encodeURIComponent\(activity\.messageId\)\}/);
});

test("global Live Room inbox uses low-frequency visible polling plus focus refresh and stays distinct from Alerts", () => {
  const inbox = readSource("components/shell/LiveRoomUnreadMenu.tsx");
  const header = readSource(
    "components/shell/StockRadarProductHeader.tsx",
  );
  const repository = readSource("lib/live-room/apiRepository.ts");
  const unreadRoute = readSource("app/api/live-room/unread/route.ts");

  assert.match(repository, /LIVE_ROOM_UNREAD_POLL_INTERVAL_MS = 60_000/);
  assert.match(inbox, /document\.visibilityState === "visible"/);
  assert.match(inbox, /window\.addEventListener\("focus"/);
  assert.match(inbox, /LIVE_ROOM_UNREAD_REFRESH_EVENT/);
  assert.match(inbox, /MessageSquareText/);
  assert.match(inbox, /Rooms/);
  assert.match(inbox, /People/);
  assert.match(inbox, /Sign in to follow members/);
  assert.match(inbox, /No new chats from people you follow/);
  assert.match(inbox, /Unfollow member/);
  assert.match(inbox, /All caught up/);
  assert.match(inbox, /Follow a company Live Room/);
  assert.match(header, /<LiveRoomUnreadMenu \/>[\s\S]+aria-label="Alerts"/);
  assert.match(header, /<Bell aria-hidden="true"/);
  assert.match(
    unreadRoute,
    /if \(!hasExistingIdentity\)[\s\S]+emptySummary/,
  );
});
