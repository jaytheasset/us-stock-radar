import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyLiveRoomPresence,
  clearLiveRoomPresence,
  getLiveRoomPresenceMessageIds,
  LIVE_ROOM_PRESENCE_MESSAGE_LIMIT,
  LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS,
  shouldRunLiveRoomPresence,
} from "./presence.ts";
import {
  LiveRoomPolicyError,
  normalizeLiveRoomPresenceTicker,
} from "./policy.ts";
import type {
  LiveRoomChatMessage,
  LiveRoomTimelineItem,
} from "./types.ts";

const projectRoot = process.cwd();
const migration = read(
  "supabase/migrations/20260727181214_live_room_member_presence.sql",
);
const client = read("components/live-room/LiveRoomClient.tsx");
const composer = read("components/live-room/MessageComposer.tsx");
const timeline = read("components/live-room/ChatTimeline.tsx");
const serverRepository = read("lib/live-room/serverRepository.ts");
const browserTypes = read("lib/live-room/types.ts");
const presenceRoute = read(
  "app/api/live-room/[ticker]/presence/route.ts",
);
const settingsRoute = read(
  "app/api/live-room/presence/settings/route.ts",
);

test("presence migration is default-deny service-only with indexed TTL storage", () => {
  assert.match(
    migration,
    /show_presence boolean not null default true/i,
  );
  assert.match(
    migration,
    /member_user_id uuid primary key\s+references public\.user_profiles\(id\) on delete cascade/i,
  );
  assert.match(
    migration,
    /live_room_member_presence_ticker_seen_idx\s+on public\.live_room_member_presence \(ticker, last_seen_at desc\)/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_member_presence enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.live_room_member_presence\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete\s+on table public\.live_room_member_presence\s+to service_role/i,
  );
  assert.equal(
    (migration.match(/security invoker/gi) || []).length,
    4,
  );
  assert.doesNotMatch(migration, /security definer/i);
  assert.equal(
    (migration.match(/set search_path = ''/gi) || []).length,
    4,
  );
  assert.match(
    migration,
    /revoke execute on function public\.get_live_room_member_presence_summary[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_live_room_member_presence_summary[\s\S]+to service_role/i,
  );
});

test("presence migration only qualifies real pg_catalog functions", () => {
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
      "btrim",
      "count",
      "jsonb_agg",
      "jsonb_build_object",
      "now",
      "unnest",
      "upper",
    ],
  );
});

test("heartbeat and privacy setting use server time and remove presence immediately when disabled", () => {
  assert.match(
    migration,
    /profile\.show_presence[\s\S]+if v_show_presence is distinct from true[\s\S]+delete from public\.live_room_member_presence/i,
  );
  assert.match(
    migration,
    /on conflict \(member_user_id\) do update[\s\S]+last_seen_at = pg_catalog\.now\(\)/i,
  );
  assert.match(
    migration,
    /if not p_show_presence then[\s\S]+delete from public\.live_room_member_presence/i,
  );
  assert.match(
    migration,
    /presence\.last_seen_at >= pg_catalog\.now\(\) - interval '2 minutes'/i,
  );
  assert.doesNotMatch(
    client,
    /addEventListener\(\s*"(?:beforeunload|unload|mousemove|scroll)"/,
  );
});

test("presence ticker validation is stricter than general room routing", () => {
  assert.equal(normalizeLiveRoomPresenceTicker(" brk.b "), "BRK.B");
  assert.equal(normalizeLiveRoomPresenceTicker("1234567890"), "1234567890");
  assert.throws(
    () => normalizeLiveRoomPresenceTicker("12345678901"),
    (error) =>
      error instanceof LiveRoomPolicyError &&
      error.code === "LIVE_ROOM_PRESENCE_INVALID_TICKER",
  );
  assert.throws(() => normalizeLiveRoomPresenceTicker("AAPL/USD"));
  assert.match(
    migration,
    /ticker ~ '\^\[A-Z0-9\]\[A-Z0-9\.\-\]\{0,9\}\$'/i,
  );
});

test("presence summary bulk-enriches bounded visible room messages and hides bilateral blocks", () => {
  const summaryFunction =
    migration.match(
      /function public\.get_live_room_member_presence_summary\([\s\S]+?\$\$;/i,
    )?.[0] || "";
  assert.match(
    summaryFunction,
    /p_message_ids\[1:context\.message_limit\]/i,
  );
  assert.match(
    summaryFunction,
    /greatest\(1, least\(coalesce\(p_message_limit, 50\), 50\)\)/i,
  );
  assert.match(
    summaryFunction,
    /message\.author_kind = 'member'[\s\S]+message\.visibility_status = 'visible'/i,
  );
  assert.match(
    summaryFunction,
    /room\.ticker = p_ticker/i,
  );
  assert.match(
    summaryFunction,
    /block\.blocker_member_user_id = p_member_user_id[\s\S]+block\.blocked_member_user_id = message\.member_user_id[\s\S]+block\.blocker_member_user_id = message\.member_user_id[\s\S]+block\.blocked_member_user_id = p_member_user_id/i,
  );
  assert.match(
    serverRepository,
    /supabaseRpc\(\s*"get_live_room_member_presence_summary"/,
  );
  assert.doesNotMatch(
    serverRepository,
    /messageIds\.map\([\s\S]{0,160}supabase(?:Select|Rpc)/,
  );
});

test("presence response exposes only aggregate count, public message IDs, and booleans", () => {
  assert.doesNotMatch(
    browserTypes,
    /LiveRoomPresence[\s\S]{0,300}(?:memberUserId|userId|email|lastSeen|guestToken)/,
  );
  assert.match(
    migration,
    /'onlineMemberCount'[\s\S]+'messages'[\s\S]+'messageId'[\s\S]+'isOnline'/i,
  );
  assert.doesNotMatch(
    presenceRoute,
    /memberUserId|member_user_id|lastSeen|last_seen|email|guestToken/i,
  );
  assert.doesNotMatch(
    settingsRoute,
    /memberUserId|member_user_id|lastSeen|last_seen|email|guestToken/i,
  );
});

test("guest access is rejected and presence mutations require same-origin requests", () => {
  assert.match(
    serverRepository,
    /function assertLiveRoomPresenceMember[\s\S]+actor\.kind !== "member"[\s\S]+LIVE_ROOM_MEMBER_REQUIRED/,
  );
  assert.match(
    presenceRoute,
    /export async function POST[\s\S]+assertSameOriginAuthRequest\(request\)/,
  );
  assert.match(
    presenceRoute,
    /export async function PUT[\s\S]+assertSameOriginAuthRequest\(request\)/,
  );
  assert.match(
    settingsRoute,
    /export async function PUT[\s\S]+assertSameOriginAuthRequest\(request\)/,
  );
  assert.match(settingsRoute, /resolveLiveRoomActor\(request\)/);
});

test("presence state maps a page in one pass without marking guests online", () => {
  const items: LiveRoomTimelineItem[] = [
    message("00000000-0000-4000-8000-000000000001", false),
    message("00000000-0000-4000-8000-000000000002", true),
    message("00000000-0000-4000-8000-000000000003", false),
  ];
  const mapped = applyLiveRoomPresence(items, {
    onlineMemberCount: 2,
    messages: [
      {
        isOnline: true,
        messageId: "00000000-0000-4000-8000-000000000001",
      },
      {
        isOnline: false,
        messageId: "00000000-0000-4000-8000-000000000003",
      },
    ],
  });

  assert.equal(
    mapped[0]?.kind === "message" && mapped[0].isOnline,
    true,
  );
  assert.equal(
    mapped[1]?.kind === "message" && mapped[1].isOnline,
    undefined,
  );
  assert.equal(
    mapped[2]?.kind === "message" && mapped[2].isOnline,
    false,
  );
  const cleared = clearLiveRoomPresence(mapped);
  assert.equal(
    cleared[0]?.kind === "message" && cleared[0].isOnline,
    false,
  );
});

test("presence lifecycle is member-only, opt-in, visible, bounded, and cleaned up", () => {
  assert.equal(LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS, 50_000);
  assert.equal(LIVE_ROOM_PRESENCE_MESSAGE_LIMIT, 50);
  assert.equal(
    shouldRunLiveRoomPresence({
      documentVisible: true,
      isGuest: false,
      showPresence: true,
    }),
    true,
  );
  for (const input of [
    { documentVisible: false, isGuest: false, showPresence: true },
    { documentVisible: true, isGuest: true, showPresence: true },
    { documentVisible: true, isGuest: false, showPresence: false },
    { documentVisible: true, isGuest: null, showPresence: true },
  ]) {
    assert.equal(shouldRunLiveRoomPresence(input), false);
  }

  const many = Array.from(
    { length: LIVE_ROOM_PRESENCE_MESSAGE_LIMIT + 8 },
    (_, index) =>
      message(
        `00000000-0000-4000-8${String(index).padStart(3, "0")}-000000000001`,
        false,
      ),
  );
  assert.equal(
    getLiveRoomPresenceMessageIds(many).length,
    LIVE_ROOM_PRESENCE_MESSAGE_LIMIT,
  );
  assert.match(client, /document\.visibilityState !== "visible"/);
  assert.match(client, /window\.addEventListener\("focus"/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /window\.clearInterval\(timer\)/);
  assert.match(client, /removeEventListener\(\s*"visibilitychange"/);
  assert.match(client, /removeEventListener\("focus"/);
});

test("presence UI remains subordinate and explains the room-scoped privacy setting", () => {
  assert.match(composer, /Show when I&apos;m active in Live Rooms/);
  assert.match(
    composer,
    /only in the company room you are\s+currently viewing/,
  );
  assert.match(composer, /role="switch"/);
  assert.match(timeline, /item\.isOnline === true/);
  assert.match(timeline, />\s*Online\s*</);
  assert.match(client, /onlineMemberCount=\{onlineMemberCount\}/);
});

function message(id: string, isGuest: boolean): LiveRoomChatMessage {
  return {
    author: {
      displayName: isGuest ? "Guest" : "Member",
      emoji: "👋",
      isGuest,
      plan: "free",
    },
    body: "Presence test",
    createdAt: "2026-07-28T00:00:00.000Z",
    eventReference: null,
    id,
    kind: "message",
  };
}

function read(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}
