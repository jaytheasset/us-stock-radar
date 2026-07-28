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
  shouldRefreshLiveRoomGuestLastSeen,
  validateLiveRoomEventReference,
} from "./policy.ts";
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

  assert.match(clientSource, /activeNavigationItem=\{null\}/);
  assert.match(
    headerSource,
    /<small>\{identity\.exchange\} · Company room<\/small>/,
  );
  assert.doesNotMatch(
    headerSource,
    /Company room · \{identity\.ticker\}/,
  );
  assert.match(styleSource, /width:\s*min\(100%,\s*1600px\)/);
  assert.match(
    styleSource,
    /padding:\s*var\(--sr-space-4\)\s+var\(--sr-page-gutter-desktop\)/,
  );
  assert.match(
    styleSource,
    /padding:\s*var\(--sr-space-3\)\s+var\(--sr-page-gutter-mobile\)/,
  );
  assert.doesNotMatch(
    clientSource,
    /InMemoryLiveRoomMessageRepository|BrowserLiveRoomFollowRepository|Mock states/,
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

test("Live Room API accepts only message content and event ID from the browser", () => {
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
