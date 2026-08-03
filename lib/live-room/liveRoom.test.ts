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
import { createMockCompanyUpdate, getMockCompanyEvents } from "./mockData.ts";
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
  formatPublicChatName,
  getLiveRoomChatNameInitials,
  normalizeLiveRoomChatName,
  validateLiveRoomChatName,
} from "./chatIdentity.ts";
import {
  LIVE_ROOM_PROFILE_BIO_MAX_LENGTH,
  normalizeLiveRoomProfileBio,
} from "./profileBio.ts";
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
  countIncomingUnreadMessages,
  getUnreadMessageIdsThrough,
} from "./readPosition.ts";
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
  const companyClient = readSource("components/live-room/LiveRoomClient.tsx");
  const chatTimeline = readSource("components/live-room/ChatTimeline.tsx");
  const communityClient = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const styles = readSource("components/live-room/LiveRoom.module.css");
  const stripIndex = companyClient.indexOf("<LatestChatEventStrip");
  const timelineIndex = companyClient.indexOf("<ChatTimeline");

  assert.ok(stripIndex > -1);
  assert.ok(timelineIndex > stripIndex);
  assert.match(
    chatTimeline,
    /export function LatestChatEventStrip[\s\S]+if \(!event\.detailHref\)[\s\S]+<Link[\s\S]+className=\{styles\.latestChatEventStrip\}[\s\S]+href=\{event\.detailHref\}/,
  );
  assert.equal(
    chatTimeline.match(/className=\{styles\.latestChatEventStrip\}/g)?.length,
    1,
  );
  assert.match(
    companyClient,
    /eventSource === "loading"[\s\S]+styles\.latestChatEventLoading[\s\S]+latestEvent\?\.detailHref[\s\S]+<LatestChatEventStrip event=\{latestEvent\} \/>/,
  );
  assert.doesNotMatch(communityClient, /latestChatEventStrip/);
  assert.match(
    styles,
    /\.latestChatEventStrip,[\s\S]+\.latestChatEventLoading[\s\S]+min-height: 62px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]+\.latestChatEventStrip[\s\S]+min-height: 48px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]+\.latestChatEventStrip time,\s*\.latestChatEventStrip > svg\s*\{\s*display:\s*none;/,
  );
  assert.match(
    styles,
    /\.latestChatEventStrip time\s*\{[\s\S]*font-family:\s*var\(--sr-font-family-mono\);/,
  );
  assert.match(
    styles,
    /\.latestChatEventStrip > svg\s*\{\s*color:\s*var\(--sr-color-text-secondary\);/,
  );
  const narrowMobileStyles = styles.slice(
    styles.indexOf("@media (max-width: 360px)"),
    styles.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  assert.doesNotMatch(narrowMobileStyles, /latestChatEventStrip/);
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
      (event) => event.score !== null && event.score >= 0 && event.score <= 100,
    ),
    true,
  );
  assert.equal(getDirectionalScoreTone(36, "volatile"), "default");
  assert.equal(getDirectionalScoreTone(58, "bearish"), "default");
  assert.equal(getDirectionalScoreTone(72, "bearish"), "default");
});

test("a simulated company update is always newer than the current latest event", () => {
  const update = createMockCompanyUpdate("AAPL", 1, events[1].occurredAt);

  assert.equal(selectLatestCompanyEvent([...events, update]), update);
});

test("Live Room uses the shared wide shell and no selected product navigation", () => {
  const clientSource = readSource("components/live-room/LiveRoomClient.tsx");
  const headerSource = readSource("components/live-room/CompanyRoomHeader.tsx");
  const styleSource = readSource("components/live-room/LiveRoom.module.css");

  assert.equal(styleSource.startsWith("\uFEFF"), false);
  assert.match(
    styleSource,
    /\.page\s*\{[\s\S]*--live-room-mobile-tabs-height:\s*60px/,
  );
  assert.match(clientSource, /activeNavigationItem=\{null\}/);
  assert.match(
    headerSource,
    /<h1 className=\{styles\.desktopRoomTitle\}>[\s\S]*\{identity\.ticker\} Live Room[\s\S]*<\/h1>/,
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
  assert.doesNotMatch(clientSource, /dockOnMobile/);
  assert.match(clientSource, /onMobileSectionChange=\{handleMobileSectionChange\}/);
  assert.match(styleSource, /height:\s*var\(--live-room-workspace-height\)/);
  assert.doesNotMatch(
    clientSource,
    /InMemoryLiveRoomMessageRepository|BrowserLiveRoomFollowRepository|Mock states/,
  );
});

test("company Live Room replaces mobile dock tabs with an accessible composer Room menu", () => {
  const client = readSource("components/live-room/LiveRoomClient.tsx");
  const composer = readSource("components/live-room/MessageComposer.tsx");
  const picker = readSource(
    "components/brokerage/BrokerageEvidencePicker.tsx",
  );
  const bottomSheet = readSource("components/ui/BottomSheetShell.tsx");
  const styles = readSource("components/live-room/LiveRoom.module.css");
  const community = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );

  assert.match(
    client,
    /<RoomTabs[\s\S]*active=\{activeTab\}[\s\S]*visibility="desktop"/,
  );
  assert.doesNotMatch(client, /dockOnMobile|dockInMobileSheet/);
  assert.doesNotMatch(client, /mobileLiveRoomTabs|mobilePostsOpenerRef/);
  assert.match(client, /data-room-kind="company"/);
  assert.match(
    client,
    /mobileRoomMenuOpenerRef=\{mobileRoomMenuOpenerRef\}[\s\S]*onMobileSectionChange=\{handleMobileSectionChange\}/,
  );
  assert.match(
    client,
    /const handleMobileSectionChange = useCallback\([\s\S]*\(tab: MobileLiveRoomSection\) => \{[\s\S]*setActiveTab\("chat"\);[\s\S]*setMobileSheet\(tab === "chat" \? null : tab\)/,
  );
  assert.match(
    client,
    /<BottomSheetShell[\s\S]*id=\{\`live-room-\$\{mobileSheet\}-sheet\`\}[\s\S]*openerRef=\{mobileRoomMenuOpenerRef\}[\s\S]*viewport="mobile"/,
  );

  for (const section of ["Chat", "Posts", "Events", "Members", "Rooms"]) {
    assert.match(composer, new RegExp(`label: "${section}"`));
  }
  assert.equal(
    (composer.match(/label: "(?:Chat|Posts|Events|Members|Rooms)"/g) ?? [])
      .length,
    5,
  );
  assert.match(composer, /aria-label="Open Room menu"/);
  assert.match(composer, /<Menu aria-hidden="true"/);
  assert.match(composer, /aria-label="Room menu"/);
  assert.match(composer, /aria-current=\{item\.value === "chat" \? "page"/);
  assert.match(composer, /placement="room-menu"/);
  assert.match(composer, /add verified trading evidence/);
  assert.match(
    picker,
    /placement\?: "composer" \| "default" \| "room-menu"/,
  );
  assert.match(picker, /"Verified trade \/ position"/);
  assert.match(picker, /placement === "room-menu" \? "region" : "dialog"/);
  assert.match(bottomSheet, /event\.key === "Escape"/);
  assert.match(bottomSheet, /restoreFocus\(opener\)/);
  assert.match(bottomSheet, /overlayLabel/);

  assert.match(
    styles,
    /\.page\[data-room-kind="company"\]\s*\{[\s\S]*--live-room-mobile-tabs-height:\s*0px;[\s\S]*display:\s*flex;[\s\S]*height:\s*calc\(100dvh - var\(--sr-size-header\)\)/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.chatPanel\s*\{[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto;[\s\S]*border:\s*0;[\s\S]*border-radius:\s*0;/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.composer\s*\{[\s\S]*position:\s*relative;[\s\S]*bottom:\s*auto;[\s\S]*env\(safe-area-inset-bottom\)/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.roomMenuButton\s*\{[\s\S]*width:\s*44px;[\s\S]*min-height:\s*44px;/,
  );
  assert.match(
    styles,
    /\.latestChatEventStrip\s*\{[\s\S]*min-height:\s*48px;[\s\S]*border-width:\s*0 0 var\(--sr-border-width\);[\s\S]*border-radius:\s*0;/,
  );
  assert.match(
    community,
    /<RoomTabs[\s\S]*dockOnMobile[\s\S]*items=\{communityMobileTabs\}/,
  );
});

test("Live Room message bubbles use the shared financial-chat color and radius contract", () => {
  const tokens = readSource("app/stock-radar-tokens.css");
  const timeline = readSource("components/live-room/ChatTimeline.tsx");
  const styles = readSource("components/live-room/LiveRoom.module.css");
  const planBadgeStyles = readSource(
    "components/ui/MemberPlanBadge.module.css",
  );
  const darkTokens = tokens.slice(0, tokens.indexOf('[data-sr-theme="light"]'));
  const lightTokens = tokens.slice(tokens.indexOf('[data-sr-theme="light"]'));

  assert.match(darkTokens, /--sr-color-chat-timeline-background:\s*#08111a/i);
  assert.match(
    darkTokens,
    /--sr-color-chat-bubble-other-background:\s*#131f2b/i,
  );
  assert.match(darkTokens, /--sr-color-chat-bubble-other-border:\s*#2a3a4a/i);
  assert.match(
    darkTokens,
    /--sr-color-chat-bubble-mine-background:\s*#2b171a/i,
  );
  assert.match(darkTokens, /--sr-color-chat-bubble-mine-border:\s*#8c4a32/i);
  assert.match(tokens, /--sr-radius-chat-message:\s*6px/);
  assert.match(tokens, /--sr-radius-chat-control:\s*4px/);

  for (const [token, value] of [
    ["timeline-background", "#f7f9fb"],
    ["bubble-other-background", "#ffffff"],
    ["bubble-mine-background", "#fff1e6"],
    ["bubble-mine-border", "#f6cba8"],
  ]) {
    assert.match(
      lightTokens,
      new RegExp(`--sr-color-chat-${token}:\\s*${value}`, "i"),
    );
  }

  assert.match(timeline, /mine \? styles\.myMessage : styles\.otherMessage/);
  assert.match(
    styles,
    /\.timeline\s*\{[\s\S]*?background:\s*var\(--sr-color-chat-timeline-background\)/,
  );
  assert.match(
    styles,
    /\.otherMessage article,\s*\.myMessage article\s*\{[\s\S]*?max-width:\s*min\(720px, calc\(100% - 46px\)\)[\s\S]*?min-width:\s*0[\s\S]*?border-radius:\s*var\(--sr-radius-chat-message\)/,
  );
  assert.match(
    styles,
    /\.otherMessage article\s*\{[^}]*var\(--sr-color-chat-bubble-other-border\);[^}]*background:\s*var\(--sr-color-chat-bubble-other-background\)/,
  );
  assert.match(
    styles,
    /\.myMessage article\s*\{[^}]*var\(--sr-color-chat-bubble-mine-border\);[^}]*background:\s*var\(--sr-color-chat-bubble-mine-background\)/,
  );
  assert.match(
    planBadgeStyles,
    /\.badge\s*\{[\s\S]*?border-radius:\s*var\(--sr-radius-chat-control\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.otherMessage header > (?:span|small)|\.myMessage header > (?:span|small)/,
  );
  assert.match(
    styles,
    /\.messageEngagementControl\s*\{[\s\S]*?border-radius:\s*var\(--sr-radius-chat-control\)/,
  );
  assert.match(
    styles,
    /\.sendButton\s*\{[\s\S]*?border-radius:\s*var\(--sr-radius-chat-control\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.otherMessage article\s*\{[^}]*border-top-left-radius|\.myMessage article\s*\{[^}]*border-top-right-radius/,
  );
  const systemUpdateRule =
    styles.match(/\.systemUpdate\s*\{([^}]*)\}/)?.[1] ?? "";
  const postPreviewRule =
    styles.match(/\.postPreview\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(
    `${systemUpdateRule}\n${postPreviewRule}`,
    /--sr-color-chat-bubble|--sr-radius-chat-message/,
  );
});

test("registered chat author avatar and name open the safe public profile", () => {
  const timeline = readSource("components/live-room/ChatTimeline.tsx");
  const styles = readSource("components/live-room/LiveRoom.module.css");
  const company = readSource("components/live-room/LiveRoomClient.tsx");
  const community = readSource("components/live-room/CommunityRoomClient.tsx");

  assert.match(company, /<ChatTimeline/);
  assert.match(community, /<ChatTimeline/);
  assert.match(
    timeline,
    /!item\.author\.isGuest && item\.author\.publicProfileId[\s\S]*encodeURIComponent\(\s*item\.author\.publicProfileId/,
  );
  assert.equal(timeline.match(/href=\{publicProfileHref\}/g)?.length, 2);
  assert.match(
    timeline,
    /aria-label=\{`View \$\{formatPublicChatName\(item\.author\.displayName\)\}'s public profile`\}[\s\S]*messageAvatarLink/,
  );
  assert.match(
    timeline,
    /className=\{styles\.messageAuthorLink\}[\s\S]*formatPublicChatName\(item\.author\.displayName\)/,
  );
  assert.match(
    timeline,
    /publicProfileHref \? \([\s\S]*<Link[\s\S]*: \([\s\S]*className=\{styles\.messageAvatar\}/,
  );
  assert.match(
    timeline,
    /publicProfileHref \? \([\s\S]*className=\{styles\.messageAuthorLink\}[\s\S]*: \([\s\S]*<strong>\{formatPublicChatName\(item\.author\.displayName\)\}<\/strong>/,
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
  const clientSource = readSource("components/live-room/LiveRoomClient.tsx");

  assert.equal(shouldScrollLiveRoomTimelineToBottom("initial", false), true);
  assert.equal(shouldScrollLiveRoomTimelineToBottom("own-send", false), true);
  assert.equal(shouldScrollLiveRoomTimelineToBottom("incoming", true), true);
  assert.equal(shouldScrollLiveRoomTimelineToBottom("incoming", false), false);
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
  assert.equal(shouldScrollLiveRoomTimelineToBottom("incoming", true), true);
  assert.equal(shouldScrollLiveRoomTimelineToBottom("incoming", false), false);
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

test("read position counts only ordinary non-self messages through the visible cursor", () => {
  const message = (
    id: string,
    createdAt: string,
    isMine: boolean,
  ): LiveRoomChatMessage => ({
    author: {
      avatarUrl: null,
      displayName: isMine ? "Me" : "Member",
      emoji: isMine ? "M" : "R",
      isGuest: false,
      plan: "free",
    },
    body: id,
    createdAt,
    eventReference: null,
    id,
    isLiked: false,
    isMine,
    kind: "message",
    likeCount: 0,
    replyCount: 0,
    replyPreview: null,
  });
  const timeline = [
    message("context", "2026-07-29T10:00:00.000Z", false),
    message("first-unread", "2026-07-29T10:01:00.000Z", false),
    {
      author: {
        avatarUrl: null,
        displayName: "Writer",
        emoji: "W",
        publicProfileId: "profile",
      },
      bodyPreview: "A post preview",
      canLike: true,
      commentCount: 0,
      createdAt: "2026-07-29T10:01:30.000Z",
      direction: null,
      id: "post-preview",
      isLiked: false,
      kind: "post_preview" as const,
      likeCount: 0,
      listedTickers: [],
      room: {
        href: "/live/BBLG",
        kind: "company" as const,
        label: "BBLG",
        ticker: "BBLG",
      },
      signalLabels: [],
      title: "Preview",
    },
    message("mine", "2026-07-29T10:02:00.000Z", true),
    message("visible-unread", "2026-07-29T10:03:00.000Z", false),
    message("offscreen-unread", "2026-07-29T10:04:00.000Z", false),
  ];

  assert.deepEqual(
    getUnreadMessageIdsThrough(timeline, "first-unread", "visible-unread"),
    ["first-unread", "visible-unread"],
  );
  assert.equal(countIncomingUnreadMessages(timeline), 4);
  assert.equal(
    countIncomingUnreadMessages([
      timeline[2],
      message("own-incoming", "2026-07-29T10:05:00.000Z", true),
    ]),
    0,
  );
});

test("Live Room loads one cancellable quote and uses plan-aware fixed ads", () => {
  const pageSource = readSource("app/live/[ticker]/page.tsx");
  const clientSource = readSource("components/live-room/LiveRoomClient.tsx");
  const headerSource = readSource("components/live-room/CompanyRoomHeader.tsx");
  const adSource = readSource("components/live-room/LiveRoomAdSlots.tsx");
  const styleSource = readSource("components/live-room/LiveRoom.module.css");

  assert.match(
    pageSource,
    /await Promise\.all\(\[[\s\S]*getCurrentViewerPlan\(\)[\s\S]*getLiveRoomAvailability\(\{ ticker \}\)/,
  );
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
    /className=\{styles\.page\}[\s\S]*data-ad-enabled=\{adsEnabledForViewer \? "true" : "false"\}/,
  );
  assert.match(
    styleSource,
    /--live-room-workspace-height:\s*max\(560px,\s*calc\(100dvh - 240px\)\)/,
  );
  assert.match(
    styleSource,
    /\.page\[data-ad-enabled="true"\]\s*\{[\s\S]*--live-room-workspace-height:\s*max\(520px,\s*calc\(100dvh - 350px\)\)/,
  );
  assert.doesNotMatch(
    styleSource,
    /--live-room-workspace-height:[^\n]*(?:680px|620px)/,
  );
  assert.match(
    styleSource,
    /\.page\[data-ad-enabled="false"\] \.desktopRail\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);[\s\S]*gap:\s*0/,
  );
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

test("mobile company header is a stable two-row company-first summary", () => {
  const header = readSource("components/live-room/CompanyRoomHeader.tsx");
  const styles = readSource("components/live-room/LiveRoom.module.css");

  assert.match(
    header,
    /className=\{styles\.desktopRoomTitle\}[\s\S]*\{identity\.ticker\} Live Room/,
  );
  assert.match(
    header,
    /className=\{styles\.mobileRoomTitle\}[\s\S]*\{identity\.companyName\}/,
  );
  assert.match(
    header,
    /className=\{styles\.mobileTicker\}>\{identity\.ticker\}/,
  );
  assert.match(
    header,
    /mobileRoomCounts[\s\S]*formatMemberCount\(roomCounts\.memberCount\)[\s\S]*roomCounts\.onlineCount\} online/,
  );
  assert.equal(
    header.match(/formatMemberCount\(roomCounts\.memberCount\)/g)?.length,
    2,
  );
  assert.match(
    header,
    /function formatMemberCount\(memberCount: number\)[\s\S]*memberCount === 1 \? "member" : "members"/,
  );
  assert.doesNotMatch(header, /participantCount\} participants/);
  assert.match(header, /<RoomMembershipControl[\s\S]*<LiveRoomInviteMenu/);
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.roomHeader\s*\{[\s\S]*min-height:\s*68px;[\s\S]*grid-template-rows:\s*minmax\(20px, auto\) 44px;/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.desktopRoomTitle,[\s\S]*\.mobileExchange,[\s\S]*\.roomCompanyName\s*\{[\s\S]*display:\s*none !important;/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.mobileRoomTitle\s*\{[\s\S]*display:\s*block !important;[\s\S]*font-family:\s*var\(--sr-font-family-sans\);/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.mobileTicker\s*\{[\s\S]*font-family:\s*var\(--sr-font-family-mono\);/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.marketSummary\s*\{[\s\S]*grid-row:\s*1;/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.roomActions\s*\{[\s\S]*grid-row:\s*2;/,
  );
  assert.match(
    styles,
    /\.roomActions \.historyTrigger\s*\{[\s\S]*display:\s*none !important;/,
  );
});

test("public Live Room entry preserves the guest cookie actor contract without invite tokens", () => {
  const page = readSource("app/live/[ticker]/page.tsx");
  const messagesRoute = readSource(
    "app/api/live-room/[ticker]/messages/route.ts",
  );
  const serverActor = readSource("lib/live-room/serverActor.ts");
  const migrations = readdirSync(archivedMigrationDirectory)
    .map((name) =>
      readFileSync(path.join(archivedMigrationDirectory, name), "utf8"),
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

test("Live Room Invite keeps its header label and delegates sharing to the shared sheet", () => {
  const client = readSource("components/live-room/LiveRoomClient.tsx");
  const header = readSource("components/live-room/CompanyRoomHeader.tsx");

  assert.doesNotMatch(client, /inviteState|shareLiveRoomInvite/);
  assert.match(
    header,
    /<LiveRoomInviteMenu[\s\S]*ariaLabel="Invite people to this company room"[\s\S]*kind: "company"/,
  );
  assert.doesNotMatch(header, /"Copied"|"Shared"|"Share failed"/);
});

test("block removal, unblock replacement, and stale polling cannot hide restored messages", () => {
  const memberMessage: LiveRoomChatMessage = {
    author: {
      avatarUrl: null,
      displayName: "Member",
      emoji: "M",
      isGuest: false,
      plan: "free",
    },
    body: "Member message",
    createdAt: "2026-07-28T01:00:00.000Z",
    eventReference: null,
    id: "member-message",
    isLiked: false,
    kind: "message",
    likeCount: 0,
    replyCount: 0,
    replyPreview: null,
  };
  const guestMessage: LiveRoomChatMessage = {
    author: {
      avatarUrl: null,
      displayName: "Guest",
      emoji: "G",
      isGuest: true,
      plan: "free",
    },
    body: "Guest message",
    createdAt: "2026-07-28T01:01:00.000Z",
    eventReference: null,
    id: "guest-message",
    isLiked: false,
    kind: "message",
    likeCount: 0,
    replyCount: 0,
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
  let restoredTimeline = replaceLiveRoomTimeline([memberMessage, guestMessage]);
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

test("unblock closes stale updates and initial member identity and room membership stay unresolved until loaded", () => {
  const client = readSource("components/live-room/LiveRoomClient.tsx");
  const header = readSource("components/live-room/CompanyRoomHeader.tsx");
  const membership = readSource(
    "components/live-room/RoomMembershipControl.tsx",
  );
  const composer = readSource("components/live-room/MessageComposer.tsx");

  assert.match(client, /useState<LiveRoomProfile \| null>\(null\)/);
  assert.match(client, /useState<boolean \| null>\(null\)/);
  assert.doesNotMatch(client, /defaultProfile/);
  assert.match(
    client,
    /updatesSubscriptionRef\.current\?\.close\(\)[\s\S]+timelineGenerationRef\.current = refreshGeneration[\s\S]+replaceLiveRoomTimeline\(page\.items\)/,
  );
  assert.match(client, /profile === null[\s\S]+timelineState === "error"/);
  assert.match(header, /joined=\{membershipJoined\}/);
  assert.match(membership, /joined === null && !isGuest/);
  assert.match(membership, /aria-label="Loading room membership"/);
  assert.match(membership, /disabled[\s\S]+Loading/);
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
  const blockedWord = evaluateLiveRoomMessage("This is a guaranteed return", {
    history: [],
    now,
  });
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
  assert.equal(blockedWord.allowed ? null : blockedWord.reason, "blocked_word");
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
    avatarUrl: null,
    bio: null,
    displayName: "Server profile",
    emoji: "🧭",
    isGuest: true,
    plan: "free" as const,
  };

  assert.deepEqual(createServerOwnedAuthorSnapshot({ actor: guest, profile }), {
    actorKind: "guest",
    memberUserId: null,
    guestSessionId: guest.guestSessionId,
    displayName: "Server profile",
    emoji: "🧭",
    plan: "free",
  });
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
    shouldRefreshLiveRoomGuestLastSeen("2026-07-27T10:00:01.000Z", now),
    false,
  );
  assert.equal(
    shouldRefreshLiveRoomGuestLastSeen("2026-07-27T10:00:00.000Z", now),
    true,
  );
  assert.equal(shouldRefreshLiveRoomGuestLastSeen("invalid", now), true);
});

test("member default display names never derive from email addresses", () => {
  assert.equal(
    getDefaultLiveRoomDisplayName({
      kind: "member",
      userId: "22222222-2222-4222-8222-222222222222",
      email: "private.local-part@example.com",
    }),
    "",
  );
  assert.equal(
    getDefaultLiveRoomDisplayName({
      kind: "guest",
      guestSessionId: "11111111-1111-4111-8111-111111111111",
    }),
    "Guest",
  );
});

test("chat names normalize ASCII whitespace and reject Unicode, invalid starts, and reserved identities", () => {
  assert.equal(
    normalizeLiveRoomChatName("  Moon   to moon  "),
    "Moon to moon",
  );
  assert.deepEqual(validateLiveRoomChatName("  Moon   to moon  "), {
    ok: true,
    value: "Moon to moon",
  });
  for (const invalid of [
    "문라이트",
    "Ångström",
    "1Trader",
    "_Trader",
    "A!",
    "A@example.com",
    "A",
    "A".repeat(25),
  ]) {
    assert.equal(validateLiveRoomChatName(invalid).ok, false, invalid);
  }
  for (const reserved of [
    "Member",
    "mEmBeR",
    "Stock Radar",
    "stock-radar",
    "ADMIN",
  ]) {
    const result = validateLiveRoomChatName(reserved);
    assert.equal(result.ok, false, reserved);
    if (!result.ok) assert.equal(result.code, "reserved");
  }
});

test("chat-name initials follow name changes without exposing legacy Member", () => {
  assert.equal(getLiveRoomChatNameInitials("MarketHawk"), "MA");
  assert.equal(getLiveRoomChatNameInitials("Moon to moon"), "MO");
  assert.equal(getLiveRoomChatNameInitials("A-1"), "A1");
  assert.equal(getLiveRoomChatNameInitials("A"), "A");
  assert.equal(getLiveRoomChatNameInitials("Member"), "?");
  assert.equal(getLiveRoomChatNameInitials(""), "?");
  assert.equal(formatPublicChatName("Member"), "Name unavailable");
  assert.equal(formatPublicChatName("한글 Name"), "Name unavailable");
  assert.equal(formatPublicChatName("Guest"), "Guest");
  assert.equal(formatPublicChatName("  Alpha   One "), "Alpha One");
});

test("profile policy stores a normalized chat name and optional plain-text bio", () => {
  assert.deepEqual(
    normalizeLiveRoomProfileInput({
      bio: "  Long-term investor.\r\n  Focused on filings.  ",
      displayName: "  Radar   Fox  ",
    }),
    {
      bio: "Long-term investor.\nFocused on filings.",
      displayName: "Radar Fox",
    },
  );
  assert.equal(normalizeLiveRoomProfileBio("   "), null);
  assert.equal(
    normalizeLiveRoomProfileBio("one\ntwo\nthree\nfour"),
    "one\ntwo\nthree\nfour",
  );
  assert.equal(
    normalizeLiveRoomProfileBio("a".repeat(LIVE_ROOM_PROFILE_BIO_MAX_LENGTH)),
    "a".repeat(LIVE_ROOM_PROFILE_BIO_MAX_LENGTH),
  );
  assert.throws(() =>
    normalizeLiveRoomProfileBio(
      "a".repeat(LIVE_ROOM_PROFILE_BIO_MAX_LENGTH + 1),
    ),
  );
  assert.throws(() =>
    normalizeLiveRoomProfileBio("one\ntwo\nthree\nfour\nfive"),
  );
  assert.throws(() => normalizeLiveRoomProfileBio("<strong>HTML</strong>"));
  assert.throws(() => normalizeLiveRoomProfileBio("control\tcharacter"));
  assert.throws(
    () =>
      normalizeLiveRoomProfileInput({
        displayName: "한글 Name",
      }),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_INVALID_CHAT_NAME",
  );
  assert.throws(
    () =>
      normalizeLiveRoomProfileInput({
        displayName: "Member",
      }),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_RESERVED_CHAT_NAME",
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
  const repositorySource = readSource("lib/live-room/serverRepository.ts");
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
  assert.match(migration, /add column reply_to_message_id uuid/i);
  assert.match(migration, /unique\s*\(room_id,\s*id\)/i);
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
  const composer = readSource("components/live-room/MessageComposer.tsx");
  const client = readSource("components/live-room/LiveRoomClient.tsx");

  assert.match(
    repository,
    /supabaseSelect\("live_room_member_profiles",\s*\{[\s\S]*?select: "user_id,public_profile_id,avatar_path"[\s\S]*?user_id: `in\.\(\$\{memberUserIds\.join\(","\)\}\)`/,
  );
  assert.match(
    repository,
    /publicProfileId:[\s\S]*?publicProfileMap\.get\(memberUserId\)\?\.publicProfileId/,
  );
  assert.match(
    repository,
    /function getLiveRoomReplyPreviewMap[\s\S]*?id: `in\.\(\$\{replyMessageIds\.join\(","\)\}\)`[\s\S]*?visibility_status: "eq\.visible"/,
  );
  assert.match(
    repository,
    /const blockedActorIds = knownBlockedActorIds[\s\S]*?getLiveRoomReplyPreviewMap\(rows, blockedActorIds\)[\s\S]*?blocked\.has\(readString\(row\.actor_id\)\)/,
  );
  assert.ok((repository.match(/reply_to_message_id/g) || []).length >= 6);
  assert.match(
    timeline,
    /removedIds\.has\(item\.replyPreview\.messageId\)[\s\S]*?replyPreview: null/,
  );
  assert.match(
    chat,
    /`\$\{item\.replyCount\} replies\. Reply to \$\{formatPublicChatName\(item\.author\.displayName\)\}`/,
  );
  assert.doesNotMatch(chat, /className=\{styles\.messageReplyButton\}/);
  assert.match(chat, /className=\{styles\.messageReplyPreview\}/);
  assert.match(
    composer,
    /Replying to\{" "\}[\s\S]*formatPublicChatName\(replyPreview\.authorDisplayName\)/,
  );
  assert.match(composer, /aria-label="Cancel reply"/);
  assert.match(
    composer,
    /`Reply to \$\{formatPublicChatName\([\s\S]*replyPreview\.authorDisplayName/,
  );
  assert.match(client, /replyToMessageId: replyingTo\?\.id \|\| null/);
  assert.match(
    client,
    /setBody\(""\);[\s\S]*?setReference\(null\);[\s\S]*?setReplyingTo\(null\)/,
  );
});

test("Live Room migration is server-only, RLS-enabled, and atomically moderates writes", () => {
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
    name.endsWith("_live_room_realtime_foundation.sql"),
  );
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
  assert.match(migration, /from public, anon, authenticated/i);
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
    name.endsWith("_live_room_foundation_hardening.sql"),
  );
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
    name.endsWith("_live_room_realtime_moderation.sql"),
  );
  assert.ok(migrationName);
  assert.ok(
    migrationName > "20260727102419_live_room_foundation_hardening.sql",
  );
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const transport = readSource("lib/live-room/apiRepository.ts");
  const realtimeClient = readSource("lib/live-room/realtimeClient.ts");
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
        status: "CHANNEL_ERROR" | "CLOSED" | "SUBSCRIBED" | "TIMED_OUT",
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

  await Promise.all([msft.close(), secondKey.close(), secondProject.close()]);
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
      removedTopics.push((channel as unknown as { topic: string }).topic);
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
    name.endsWith("_live_room_realtime_moderation.sql"),
  );
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
    name.endsWith("_fix_live_room_block_moderation.sql"),
  );
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
  const blocksRoute = readSource("app/api/live-room/[ticker]/blocks/route.ts");
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
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
  const readRoute = readSource("app/api/live-room/[ticker]/read/route.ts");
  const client = readSource("components/live-room/LiveRoomClient.tsx");

  assert.match(unreadFunction, /message\.visibility_status = 'visible'/i);
  assert.match(unreadFunction, /message\.created_at > follow\.last_read_at/i);
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
  assert.doesNotMatch(client, /\.markRead\(latestMessageId\)/);
  assert.doesNotMatch(client, /getLatestChatMessageId\(messages\)/);
  const readHook = readSource(
    "components/live-room/useLiveRoomReadPosition.ts",
  );
  assert.match(
    readHook,
    /getLatestVisibleLiveRoomMessageId[\s\S]*repository\.markRead\(latestVisibleMessageId\)/,
  );
  assert.match(readHook, /LIVE_ROOM_MARK_READ_THROTTLE_MS = 800/);
});

test("member follows are service-only and message IDs resolve targets without UUID exposure or N+1 reads", () => {
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
    name.endsWith("_live_room_chat_follows_and_member_follows.sql"),
  );
  assert.ok(migrationName);
  const migration = readSource(
    path.join(archivedMigrationRelativeDirectory, migrationName),
  );
  const route = readSource("app/api/live-room/[ticker]/member-follow/route.ts");
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
  assert.match(timeline, /memberFollowed \? "Following" : "Follow member"/);
});

test("member activity cursors exclude history, hidden messages, self, and blocked authors in one bounded RPC", () => {
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
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
  assert.match(activityFunction, /message\.created_at > follow\.last_read_at/i);
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
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
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
  assert.deepEqual([...new Set(qualifiedCatalogCalls)].sort(), [
    "count",
    "jsonb_agg",
    "jsonb_build_object",
    "left",
    "regexp_replace",
  ]);
});

test("member activity read and message anchors validate room ownership before advancing an exact follower cursor", () => {
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
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
  assert.match(timeline, /id=\{`live-room-message-\$\{item\.id\}`\}/);
});

test("member activity API stays service-only, privacy-safe, and avoids per-author summary queries", () => {
  const migrationName = readdirSync(archivedMigrationDirectory).find((name) =>
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
  assert.match(repository, /supabaseRpc\("get_live_room_activity_summary"/);
  assert.doesNotMatch(
    browserTypes,
    /followerUserId|followedUserId|memberUserId|authUserId|email/,
  );
  assert.doesNotMatch(
    inbox,
    /followerUserId|followedUserId|memberUserId|authUserId|email/,
  );
  assert.match(
    inbox,
    /message=\$\{encodeURIComponent\(activity\.messageId\)\}/,
  );
});

test("global Live Room inbox uses low-frequency visible polling plus focus refresh and stays distinct from Alerts", () => {
  const inbox = readSource("components/shell/LiveRoomUnreadMenu.tsx");
  const header = readSource("components/shell/StockRadarProductHeader.tsx");
  const alerts = readSource("components/shell/AlertNotificationsMenu.tsx");
  const repository = readSource("lib/live-room/apiRepository.ts");
  const unreadRoute = readSource("app/api/live-room/unread/route.ts");

  assert.match(repository, /LIVE_ROOM_UNREAD_POLL_INTERVAL_MS = 60_000/);
  assert.match(inbox, /document\.visibilityState === "visible"/);
  assert.match(inbox, /window\.addEventListener\("focus"/);
  assert.match(inbox, /LIVE_ROOM_UNREAD_REFRESH_EVENT/);
  assert.match(inbox, /MessageCircle/);
  assert.doesNotMatch(inbox, /MessageSquareText/);
  assert.match(inbox, />\s*Notifications\s*/);
  assert.match(inbox, />\s*My Rooms\s*/);
  assert.match(inbox, />\s*Following\s*/);
  assert.match(inbox, /Sign in to follow members/);
  assert.match(inbox, /No new activity from people you follow/);
  assert.match(inbox, /Unfollow member/);
  assert.match(inbox, /No new updates/);
  assert.match(inbox, /total === 1 \? "update" : "updates"/);
  assert.match(inbox, /Rooms you join or follow will appear here/);
  assert.match(inbox, /aria-label="Community inbox"/);
  assert.match(
    inbox,
    /Replies, comments, and new posts from rooms or people you follow will appear here/,
  );
  assert.match(
    header,
    /<LiveRoomUnreadMenu \/>[\s\S]+<AlertNotificationsMenu loginHref=\{loginHref\} \/>/,
  );
  assert.match(alerts, /aria-label=\{[\s\S]*`Alerts, \$\{unreadCount\} unread`/);
  assert.match(alerts, /<Bell aria-hidden="true"/);
  assert.match(unreadRoute, /if \(!hasExistingIdentity\)[\s\S]+emptySummary/);
});

test("administrator room states keep public history readable while blocking every create path", () => {
  const migration = readSource(
    "supabase/migrations/20260730110605_admin_room_controls_v3.sql",
  );
  const companyPage = readSource("app/live/[ticker]/page.tsx");
  const communityPage = readSource("app/live/community/[slug]/page.tsx");
  const companyClient = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const communityClient = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const communityRepository = readSource(
    "lib/live-room/communityServerRepository.ts",
  );

  assert.match(
    migration,
    /admin_status text not null default 'active'/,
  );
  for (const table of [
    "live_room_messages",
    "live_room_posts",
    "live_room_post_comments",
    "live_room_memberships",
  ]) {
    assert.match(
      migration,
      new RegExp(`${table}_enforce_room_writable`, "i"),
    );
  }
  assert.match(migration, /LIVE_ROOM_LOCKED/);
  assert.match(migration, /LIVE_ROOM_ARCHIVED/);
  assert.match(
    migration,
    /assert_live_room_writable[\s\S]+pg_advisory_xact_lock[\s\S]+hashtextextended\(p_room_id::text,\s*0\)/,
  );
  assert.match(companyPage, /getLiveRoomAvailability/);
  assert.match(communityPage, /getLiveRoomAvailability/);
  assert.match(companyClient, /roomAvailabilityNotice/);
  assert.match(communityClient, /roomAvailabilityNotice/);
  assert.match(companyClient, /writeDisabled=\{roomReadOnly\}/);
  assert.match(communityClient, /writeDisabled=\{roomReadOnly\}/);
  assert.match(
    communityRepository,
    /filterArchivedCommunityRoomRows/,
  );
});

test("member chat identity is service-owned, unique, and required by every public write path", () => {
  const migration = readSource(
    "supabase/migrations/20260730175310_live_room_chat_name_identity.sql",
  );
  const serverRepository = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const postRepository = readSource(
    "lib/live-room/postServerRepository.ts",
  );

  assert.match(
    migration,
    /create unique index live_room_member_profiles_chat_name_unique_idx[\s\S]+pg_catalog\.lower\(display_name\)[\s\S]+where display_name is not null/i,
  );
  assert.match(
    migration,
    /function public\.set_live_room_member_chat_name\(uuid, text\)[\s\S]+security invoker[\s\S]+set search_path = ''/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.set_live_room_member_chat_name\(uuid, text\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.set_live_room_member_chat_name\(uuid, text\)[\s\S]+to service_role/i,
  );
  assert.match(migration, /LIVE_ROOM_CHAT_NAME_TAKEN/);
  assert.match(migration, /LIVE_ROOM_CHAT_NAME_REQUIRED/g);
  assert.match(migration, /live_room_messages_require_chat_name/);
  assert.match(migration, /live_room_posts_require_chat_name/);
  assert.match(migration, /live_room_post_comments_require_chat_name/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(
    serverRepository,
    /supabaseRpc\("set_live_room_member_profile"[\s\S]+p_member_user_id: actor\.userId/,
  );
  assert.match(serverRepository, /LIVE_ROOM_CHAT_NAME_TAKEN[\s\S]+409/);
  assert.match(serverRepository, /LIVE_ROOM_CHAT_NAME_REQUIRED[\s\S]+409/);
  assert.match(postRepository, /assertLiveRoomMemberChatName/g);
  assert.match(postRepository, /LIVE_ROOM_CHAT_NAME_REQUIRED[\s\S]+409/);
});

test("optional member bio stays service-owned and limited to profile detail", () => {
  const migration = readSource(
    "supabase/migrations/20260731031022_live_room_member_profile_bio.sql",
  );
  const serverRepository = readSource("lib/live-room/serverRepository.ts");
  const postRepository = readSource(
    "lib/live-room/postServerRepository.ts",
  );
  const setup = readSource("components/live-room/ChatNameSetup.tsx");
  const publicProfile = readSource(
    "components/live-room/PublicMemberProfileClient.tsx",
  );
  const liveRoomCss = readSource("components/live-room/LiveRoom.module.css");
  const types = readSource("lib/live-room/types.ts");

  assert.match(
    migration,
    /alter table public\.live_room_member_profiles[\s\S]+add column bio text/i,
  );
  assert.match(
    migration,
    /function public\.set_live_room_member_profile\([\s\S]+security invoker[\s\S]+set search_path = ''/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.set_live_room_member_profile\(uuid, text, text\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.set_live_room_member_profile\(uuid, text, text\)[\s\S]+to service_role/i,
  );
  assert.match(
    migration,
    /set_live_room_member_chat_name\([\s\S]+p_member_user_id[\s\S]+p_display_name/i,
  );
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(
    serverRepository,
    /actor\.kind === "member"[\s\S]+display_name,emoji,bio/,
  );
  assert.match(serverRepository, /bio:\s*actor\.kind === "member"/);
  assert.match(
    postRepository,
    /user_id,public_profile_id,display_name,emoji,bio,avatar_path/,
  );
  assert.match(setup, /About \(optional\)/);
  assert.match(setup, /LIVE_ROOM_PROFILE_BIO_MAX_LENGTH/);
  assert.match(setup, /normalizeLiveRoomProfileBio\(bio\)/);
  assert.match(publicProfile, /member\.bio \? \(/);
  assert.match(publicProfile, />About</);
  assert.match(publicProfile, /Edit profile/);
  assert.match(publicProfile, /actions\?\.isSelf && ownProfile/);
  assert.doesNotMatch(
    types.match(
      /export type LiveRoomMemberSummary = \{[\s\S]*?\n\};/,
    )?.[0] ?? "",
    /\bbio\b/,
  );
  const publicMemberContract =
    types.match(
      /export type LiveRoomPublicMember = \{[\s\S]*?\n\};/,
    )?.[0] ?? "";
  assert.match(publicMemberContract, /bio: string \| null/);
  assert.match(publicMemberContract, /avatarUrl: string \| null/);
  assert.doesNotMatch(publicMemberContract, /\buserId\b|\bemail\b/);
  assert.match(types, /LiveRoomMessageAuthor = Omit<LiveRoomProfile, "bio">/);
  assert.match(
    liveRoomCss,
    /@media \(max-width: 760px\)[\s\S]+\.profileButton \{[\s\S]+width: 42px;[\s\S]+height: 42px;[\s\S]+border: 0;[\s\S]+padding: 0;[\s\S]+background: transparent;/,
  );
});

test("first public writing preserves drafts while shared chat identity works on desktop and mobile", () => {
  const setup = readSource("components/live-room/ChatNameSetup.tsx");
  const composer = readSource("components/live-room/MessageComposer.tsx");
  const chatTimeline = readSource("components/live-room/ChatTimeline.tsx");
  const posts = readSource("components/live-room/PostsPanel.tsx");
  const comments = readSource("components/live-room/PostComments.tsx");
  const avatar = readSource("components/ui/MemberAvatar.tsx");
  const directMessage = readSource(
    "components/direct-messages/DirectMessageClient.tsx",
  );
  const requestModal = readSource(
    "components/direct-messages/DirectMessageRequestModal.tsx",
  );

  assert.match(setup, /\.showModal\(\)/);
  assert.match(setup, /dialog\?\.open[\s\S]*dialog\.close\(\)/);
  assert.match(setup, /openerRef\.current\?\.focus\(\)/);
  assert.match(setup, /<dialog/);
  assert.match(setup, /<BottomSheetShell/);
  assert.match(setup, /validateLiveRoomChatName\(displayName\)/);
  assert.doesNotMatch(setup, /emoji/i);
  assert.match(composer, /onFocus=\{\(\) => \{[\s\S]+requiresChatName/);
  assert.match(composer, /resumeSendRef\.current = true/);
  assert.match(composer, /window\.setTimeout\(\(\) => onSend\(saved\), 0\)/);
  assert.match(posts, /resumeCreateRef\.current = true/);
  assert.match(posts, /handleCreate\(true\)/);
  assert.match(comments, /resumeCommentRef\.current = true/);
  assert.match(comments, /createComment\(true\)/);
  assert.match(avatar, /getLiveRoomChatNameInitials\(displayName\)/);
  assert.doesNotMatch(chatTimeline, /replyPreview\.authorEmoji/);
  assert.match(
    chatTimeline,
    /<MemberAvatar[\s\S]*displayName=\{item\.replyPreview\.authorDisplayName\}[\s\S]*size="small"/,
  );
  assert.match(avatar, /imageUrl/);
  assert.doesNotMatch(directMessage, /peer\.emoji/);
  assert.doesNotMatch(requestModal, /target\.emoji/);
});

test("member profile photos are server-processed, service-owned, and shared safely", () => {
  const migration = readSource(
    "supabase/migrations/20260731033018_live_room_member_profile_avatars.sql",
  );
  const avatarRoute = readSource(
    "app/api/live-room/profile/avatar/route.ts",
  );
  const avatarProcessor = readSource(
    "lib/live-room/profileAvatarImage.ts",
  );
  const avatarStorage = readSource(
    "lib/live-room/profileAvatar.ts",
  );
  const avatar = readSource("components/ui/MemberAvatar.tsx");
  const setup = readSource("components/live-room/ChatNameSetup.tsx");
  const setupStyles = readSource(
    "components/live-room/ChatNameSetup.module.css",
  );
  const repository = readSource("lib/live-room/serverRepository.ts");
  const apiRepository = readSource("lib/live-room/apiRepository.ts");
  const types = readSource("lib/live-room/types.ts");

  assert.match(
    migration,
    /add column avatar_path text[\s\S]+live_room_member_profiles_avatar_path_check/i,
  );
  assert.match(
    migration,
    /insert into storage\.buckets[\s\S]+live-room-member-avatars[\s\S]+true[\s\S]+1048576[\s\S]+image\/webp/i,
  );
  assert.match(
    migration,
    /function public\.set_live_room_member_avatar_path\([\s\S]+security invoker[\s\S]+set search_path = ''/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.set_live_room_member_avatar_path\(uuid, text\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.set_live_room_member_avatar_path\(uuid, text\)[\s\S]+to service_role/i,
  );
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(avatarRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(avatarRoute, /resolveLiveRoomActor\(request\)/);
  assert.doesNotMatch(avatarRoute, /userId|avatar_path|publicProfileId/);
  assert.match(
    avatarProcessor,
    /image\/jpeg[\s\S]+image\/png[\s\S]+image\/webp/,
  );
  assert.match(avatarProcessor, /5 \* 1024 \* 1024/);
  assert.match(avatarProcessor, /\.metadata\(\)/);
  assert.match(
    avatarProcessor,
    /\.resize\(LIVE_ROOM_AVATAR_OUTPUT_SIZE, LIVE_ROOM_AVATAR_OUTPUT_SIZE/,
  );
  assert.match(avatarProcessor, /\.webp\(/);
  assert.doesNotMatch(avatarProcessor, /\.withMetadata\(/);
  assert.match(
    avatarStorage,
    /randomUUID\(\)[\s\S]+\.webp[\s\S]+upsert: false/,
  );
  assert.match(
    repository,
    /uploadLiveRoomAvatarObject\(nextPath, processed\)[\s\S]+set_live_room_member_avatar_path[\s\S]+removeLiveRoomAvatarObject\(current\.avatarPath\)/,
  );
  assert.match(
    repository,
    /if \(!result\.ok\) \{[\s\S]+removeLiveRoomAvatarObject\(nextPath\)/,
  );
  assert.match(apiRepository, /body: form/);
  assert.match(apiRepository, /!isFormData/);
  assert.match(setup, /Upload photo/);
  assert.match(setup, /"Replace"/);
  assert.match(setup, />\s*Remove\s*</);
  assert.match(setup, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(
    setupStyles,
    /\.photoControls\s*\{[\s\S]*?position: relative/,
  );
  assert.match(avatar, /onError=\{\(\) => setFailedImageUrl\(imageUrl\)\}/);
  assert.match(avatar, /alt=\{`\$\{label\} avatar`\}/);
  assert.match(avatar, /getLiveRoomChatNameInitials\(displayName\)/);
  assert.doesNotMatch(types, /\bavatarPath\b|\bavatar_path\b/);
});

test("all public member surfaces use the shared initial avatar contract", () => {
  for (const file of [
    "components/live-room/ChatTimeline.tsx",
    "components/live-room/LiveRoomDesktopSidePanel.tsx",
    "components/live-room/MessageComposer.tsx",
    "components/live-room/PostComments.tsx",
    "components/live-room/PostDetailClient.tsx",
    "components/live-room/PostsPanel.tsx",
    "components/live-room/PublicMemberProfileClient.tsx",
    "components/community/CommunityHubClient.tsx",
    "components/direct-messages/DirectMessageClient.tsx",
    "components/direct-messages/DirectMessageRequestModal.tsx",
  ]) {
    assert.match(readSource(file), /MemberAvatar/, file);
    assert.match(readSource(file), /imageUrl/, file);
  }
  const avatarStyles = readSource("components/ui/MemberAvatar.module.css");
  assert.match(
    avatarStyles,
    /background:\s*var\(--sr-color-surface-control\)/,
  );
  assert.doesNotMatch(avatarStyles, /#[0-9a-f]{3,8}|gradient/i);
  assert.match(
    avatarStyles,
    /font-size:\s*var\(--sr-font-size-xs\)[\s\S]*letter-spacing:\s*var\(--sr-letter-spacing-default\)/,
  );
  assert.match(
    avatarStyles,
    /\[data-avatar-size="large"\][\s\S]*font-size:\s*var\(--sr-font-size-md\)/,
  );
});

test("Live Room disclosure appears exactly once at the shared composer boundary", () => {
  const disclosure = readSource(
    "components/live-room/LiveRoomDisclosureNotice.tsx",
  );
  const disclosureStyles = readSource(
    "components/live-room/LiveRoomDisclosureNotice.module.css",
  );
  const composer = readSource("components/live-room/MessageComposer.tsx");
  const posts = readSource("components/live-room/PostsPanel.tsx");
  const postDetail = readSource(
    "components/live-room/PostDetailClient.tsx",
  );
  const proofCard = readSource(
    "components/brokerage/BrokerageProofCard.tsx",
  );
  const companyRoom = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const communityRoom = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const roomStyles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const terms = readSource("app/terms/page.tsx");

  assert.match(
    disclosure,
    /User posts and verified trades are not endorsed by Stock Radar and are not investment advice\. Verify independently\./,
  );
  assert.match(
    disclosure,
    /href="\/terms#live-room-community-disclosures"/,
  );
  assert.equal(
    (composer.match(/<LiveRoomDisclosureNotice /g) ?? []).length,
    1,
  );
  assert.match(
    composer,
    /<LiveRoomDisclosureNotice hideOnMobile=\{Boolean\(onMobileSectionChange\)\} \/>/,
  );
  assert.match(disclosure, /data-mobile-hidden=\{hideOnMobile \|\| undefined\}/);
  for (const source of [posts, postDetail, companyRoom, communityRoom]) {
    assert.doesNotMatch(source, /LiveRoomDisclosureNotice|showDisclosure/);
    assert.doesNotMatch(source, /live-room-community-disclosures/);
  }
  assert.doesNotMatch(
    proofCard,
    /Verified means selected broker-linked data matched|About verified|proofInfo|BottomSheetShell/,
  );
  assert.match(
    roomStyles,
    /--live-room-mobile-composer-disclosure-height: 34px/,
  );
  assert.match(
    roomStyles,
    /\.page\[data-room-kind="company"\][\s\S]*--live-room-mobile-composer-disclosure-height: 0px/,
  );
  assert.match(
    disclosureStyles,
    /font-size: var\(--sr-font-size-xs\)/,
  );
  assert.match(
    disclosureStyles,
    /color: var\(--sr-color-text-secondary\)/,
  );
  assert.match(
    disclosureStyles,
    /@media \(max-width: 760px\)[\s\S]*\.notice\[data-mobile-hidden="true"\][\s\S]*display: none[\s\S]*min-height: 34px/,
  );
  assert.doesNotMatch(disclosureStyles, /posts-sheet|post-detail/);
  assert.doesNotMatch(disclosureStyles, /#[0-9a-f]{3,8}\b/i);
  assert.match(terms, /id: "live-room-community-disclosures"/);
  assert.match(terms, /not endorsed by Stock Radar, verified for investment merit/);
  assert.match(terms, /selected broker-linked facts matched/);
  assert.match(terms, /omitted accounts, profitability, future/);
  assert.match(terms, /accept the risks of trading/);
  assert.match(terms, /survive termination—including/);
  assert.match(terms, /conduct—will survive/);
});
