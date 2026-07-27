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
  isLiveRoomMessageMine,
  LiveRoomPolicyError,
  normalizeLiveRoomProfileInput,
  validateLiveRoomEventReference,
} from "./policy.ts";
import type { CompanyEvent } from "./types.ts";

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
  assert.match(actorSource, /request\.cookies\.get\(LIVE_ROOM_GUEST_COOKIE\)/);
  assert.match(actorSource, /httpOnly:\s*true/);
  assert.doesNotMatch(actorSource, /request\.json/);
  assert.doesNotMatch(clientSource, /SUPABASE_(?:SERVICE_ROLE|ANON)_KEY/);
  assert.match(clientSource, /transport interface|LiveRoomUpdateTransport/i);
});

test("Live Room migration is server-only, RLS-enabled, and atomically moderates writes", () => {
  const migrationName = readdirSync(
    path.join(projectRoot, "supabase", "migrations"),
  ).find((name) => name.endsWith("_live_room_realtime_foundation.sql"));
  assert.ok(migrationName);
  const migration = readSource(
    path.join("supabase", "migrations", migrationName),
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
});
