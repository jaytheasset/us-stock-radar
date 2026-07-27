import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = read(
  "supabase/migrations/20260728000000_live_room_mutual_direct_messages.sql",
);
const serverRepository = read(
  "lib/direct-messages/serverRepository.ts",
);
const inboxComponent = read(
  "components/shell/LiveRoomUnreadMenu.tsx",
);
const timelineComponent = read(
  "components/live-room/ChatTimeline.tsx",
);
const liveRoomRepository = read(
  "lib/live-room/serverRepository.ts",
);
const apiRepository = read(
  "lib/direct-messages/apiRepository.ts",
);
const publicTypes = read("lib/direct-messages/types.ts");
const inboxRoute = read("app/api/messages/route.ts");
const conversationRoute = read(
  "app/api/messages/[conversationId]/route.ts",
);
const readRoute = read(
  "app/api/messages/[conversationId]/read/route.ts",
);

test("direct-message tables are default-deny service-only with bounded identities", () => {
  for (const table of [
    "live_room_direct_conversations",
    "live_room_direct_messages",
    "live_room_direct_reads",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all privileges\\s+on table public\\.${table}\\s+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant select, insert, update\\s+on table public\\.${table}\\s+to service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(migration, /\bgrant\b[\s\S]{0,80}\bto anon\b/i);
  assert.doesNotMatch(
    migration,
    /\bgrant\b[\s\S]{0,80}\bto authenticated\b/i,
  );
  assert.match(migration, /references public\.user_profiles\(id\) on delete cascade/i);
  assert.doesNotMatch(
    [publicTypes, apiRepository, inboxComponent].join("\n"),
    /guest_session_id|guestToken|email\b|userId\b/,
  );
});

test("canonical member pair is unique, ordered, and cannot contain self", () => {
  assert.match(
    migration,
    /unique \(member_low_user_id, member_high_user_id\)/i,
  );
  assert.match(
    migration,
    /check \(member_low_user_id <> member_high_user_id\)/i,
  );
  assert.match(
    migration,
    /check \(member_low_user_id::text < member_high_user_id::text\)/i,
  );
  assert.match(migration, /raise exception 'LIVE_ROOM_DIRECT_SELF'/i);
  assert.match(
    migration,
    /on conflict \(member_low_user_id, member_high_user_id\)/i,
  );
});

test("guest and unilateral follows cannot open or send direct messages", () => {
  assert.match(
    serverRepository,
    /if \(actor\.kind !== "member"\)[\s\S]+LIVE_ROOM_MEMBER_REQUIRED/,
  );
  assert.match(
    migration,
    /LIVE_ROOM_DIRECT_MUTUAL_REQUIRED/,
  );
  assert.match(
    migration,
    /follower_user_id = p_requester_user_id[\s\S]+followed_user_id = v_peer_user_id[\s\S]+follower_user_id = v_peer_user_id[\s\S]+followed_user_id = p_requester_user_id/,
  );
  assert.match(
    migration,
    /raise exception 'LIVE_ROOM_DIRECT_READ_ONLY'/,
  );
});

test("conversation start resolves a visible member from a public message ID", () => {
  assert.match(
    migration,
    /where message\.id = p_source_message_id[\s\S]+message\.author_kind = 'member'[\s\S]+message\.visibility_status = 'visible'/,
  );
  assert.match(
    serverRepository,
    /p_source_message_id: normalizeLiveRoomUuid\(messageId\)/,
  );
  assert.match(timelineComponent, /Message member/);
  assert.match(liveRoomRepository, /canMessageMember/);
  assert.doesNotMatch(inboxRoute, /peer_user_id|member_user_id/);
});

test("both block directions hide inbox/history and reject start/send/read", () => {
  const bilateralBlockChecks =
    migration.match(
      /block\.blocker_member_user_id = p_requester_user_id[\s\S]{0,220}block\.blocked_member_user_id = v_peer_user_id[\s\S]{0,220}block\.blocker_member_user_id = v_peer_user_id[\s\S]{0,220}block\.blocked_member_user_id = p_requester_user_id/g,
    ) || [];
  assert.ok(
    bilateralBlockChecks.length >= 4,
    "start, send, conversation read, and mark-read must check both directions",
  );
  assert.match(
    migration,
    /visible_conversations[\s\S]+not exists[\s\S]+actor\.peer_user_id/,
  );
});

test("every conversation operation rechecks participant membership for BOLA", () => {
  const participantChecks =
    migration.match(
      /p_requester_user_id in \(\s*conversation\.member_low_user_id,\s*conversation\.member_high_user_id\s*\)/g,
    ) || [];
  assert.ok(
    participantChecks.length >= 3,
    "send, history, and mark-read must each verify the participant",
  );
  assert.match(conversationRoute, /resolveLiveRoomActor\(request\)/);
  assert.match(readRoute, /resolveLiveRoomActor\(request\)/);
  assert.match(inboxRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(
    conversationRoute,
    /assertSameOriginAuthRequest\(request\)/,
  );
  assert.match(readRoute, /assertSameOriginAuthRequest\(request\)/);
});

test("unfollow preserves history but makes the conversation read-only", () => {
  assert.match(
    migration,
    /'canSend', v_mutual_follow/,
  );
  assert.match(
    migration,
    /'readOnlyReason'[\s\S]+messaging requires a mutual follow/,
  );
  assert.doesNotMatch(
    migration,
    /delete from public\.live_room_direct_(?:conversations|messages)[\s\S]+live_room_member_follows/i,
  );
});

test("read cursor counts only peer messages and advances monotonically", () => {
  assert.match(
    migration,
    /unread\.sender_user_id <> p_requester_user_id/,
  );
  assert.match(
    migration,
    /last_read_message_id uuid[\s\S]+references public\.live_room_direct_messages\(id\) on delete set null/,
  );
  assert.match(
    migration,
    /create index live_room_direct_reads_message_idx[\s\S]+last_read_message_id[\s\S]+where last_read_message_id is not null/,
  );
  assert.match(
    migration,
    /last_read_at = greatest\([\s\S]+live_room_direct_reads\.last_read_at[\s\S]+excluded\.last_read_at/,
  );
  assert.match(
    migration,
    /message\.id = p_message_id[\s\S]+message\.conversation_id = v_conversation\.id/,
  );
});

test("send is transactionally moderated for length, words, links, duplicate, and burst", () => {
  assert.match(migration, /char_length\(v_body\) > 600/);
  assert.match(migration, /guaranteed return/);
  assert.match(migration, /regexp_count\(v_body/);
  assert.match(migration, /interval '120 seconds'/);
  assert.match(migration, /LIVE_ROOM_DUPLICATE/);
  assert.match(migration, /interval '20 seconds'/);
  assert.match(migration, /LIVE_ROOM_RATE_LIMIT/);
  assert.match(
    migration,
    /pg_advisory_xact_lock\(\s*hashtextextended\(p_requester_user_id::text, 0\)/,
  );
  assert.match(serverRepository, /evaluateLiveRoomMessage\(rawBody/);
});

test("cursor pages and inbox are bounded without per-row browser requests", () => {
  assert.match(
    migration,
    /least\(greatest\(coalesce\(p_limit, 50\), 1\), 50\)/,
  );
  assert.match(
    migration,
    /limit least\(greatest\(coalesce\(p_limit, 30\), 1\), 50\)/,
  );
  assert.match(
    migration,
    /actor_conversations[\s\S]+order by conversation\.updated_at desc, conversation\.id desc[\s\S]+limit 50/,
  );
  assert.match(
    migration,
    /\(message\.created_at, message\.id\)\s+< \(p_before_created_at, p_before_message_id\)/,
  );
  assert.match(
    serverRepository,
    /get_live_room_direct_inbox/,
  );
  assert.match(apiRepository, /DIRECT_MESSAGE_POLL_INTERVAL_MS = 12_000/);
  assert.match(
    inboxComponent,
    /document\.visibilityState === "visible"/,
  );
});

test("public functions are invoker-only and executable only by service_role", () => {
  const functions = [
    "start_live_room_direct_conversation",
    "send_live_room_direct_message",
    "get_live_room_direct_inbox",
    "get_live_room_direct_conversation",
    "mark_live_room_direct_conversation_read",
  ];
  for (const functionName of functions) {
    assert.match(
      migration,
      new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]+?security invoker[\\s\\S]+?set search_path = ''`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all privileges\\s+on function public\\.${functionName}[\\s\\S]+?from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute\\s+on function public\\.${functionName}[\\s\\S]+?to service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|greatest|least)\s*\(/i,
  );
});

test("Messages stays inside Live Room activity and separate from paid Alerts", () => {
  assert.match(inboxComponent, /Rooms \+ People \+ Messages/);
  assert.match(inboxComponent, /type InboxTab = "messages" \| "people" \| "rooms"/);
  assert.match(
    inboxComponent,
    /summary\.totalUnreadCount \+ directInbox\.totalUnreadCount/,
  );
  assert.doesNotMatch(
    [serverRepository, apiRepository, inboxComponent, conversationRoute].join(
      "\n",
    ),
    /alert_preferences|alert_deliver/i,
  );
});

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
