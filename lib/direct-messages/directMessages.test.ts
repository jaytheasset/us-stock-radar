import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseMigration = read(
  "supabase/migrations/20260727174043_live_room_mutual_direct_messages.sql",
);
const requestMigration = read(
  "supabase/migrations/20260727192727_live_room_message_requests.sql",
);
const migration = `${baseMigration}\n${requestMigration}`;
const serverRepository = read("lib/direct-messages/serverRepository.ts");
const apiRepository = read("lib/direct-messages/apiRepository.ts");
const publicTypes = read("lib/direct-messages/types.ts");
const inboxComponent = read("components/shell/LiveRoomUnreadMenu.tsx");
const conversationClient = read(
  "components/direct-messages/DirectMessageClient.tsx",
);
const settingsClient = read(
  "components/direct-messages/DirectMessageSettingsClient.tsx",
);
const requestModal = read(
  "components/direct-messages/DirectMessageRequestModal.tsx",
);
const timelineComponent = read("components/live-room/ChatTimeline.tsx");
const liveRoomRepository = read("lib/live-room/serverRepository.ts");
const inboxRoute = read("app/api/messages/route.ts");
const conversationRoute = read(
  "app/api/messages/[conversationId]/route.ts",
);
const readRoute = read(
  "app/api/messages/[conversationId]/read/route.ts",
);
const requestRoute = read(
  "app/api/messages/[conversationId]/request/route.ts",
);
const reportRoute = read(
  "app/api/messages/[conversationId]/reports/route.ts",
);
const settingsRoute = read("app/api/account/message-settings/route.ts");

test("new request and report tables remain service-only with RLS default deny", () => {
  for (const table of [
    "live_room_direct_message_settings",
    "live_room_direct_message_reports",
  ]) {
    assert.match(
      requestMigration,
      new RegExp(
        `alter table public\\.${table}\\s+enable row level security`,
        "i",
      ),
    );
    assert.match(
      requestMigration,
      new RegExp(
        `revoke all privileges\\s+on table public\\.${table}\\s+from public, anon, authenticated`,
        "i",
      ),
    );
  }
  assert.match(
    requestMigration,
    /grant select, insert, update\s+on table public\.live_room_direct_message_settings\s+to service_role/i,
  );
  assert.match(
    requestMigration,
    /grant select, insert\s+on table public\.live_room_direct_message_reports\s+to service_role/i,
  );
  assert.doesNotMatch(requestMigration, /\bgrant\b[\s\S]{0,80}\bto anon\b/i);
  assert.doesNotMatch(
    requestMigration,
    /\bgrant\b[\s\S]{0,80}\bto authenticated\b/i,
  );
});

test("existing conversations migrate to accepted without changing canonical pairs", () => {
  assert.match(
    requestMigration,
    /add column status text not null default 'accepted'/i,
  );
  assert.match(
    requestMigration,
    /update public\.live_room_direct_conversations\s+set accepted_at = created_at/i,
  );
  assert.match(
    requestMigration,
    /status in \('accepted', 'pending', 'declined'\)/i,
  );
  assert.match(
    baseMigration,
    /unique \(member_low_user_id, member_high_user_id\)/i,
  );
  assert.match(
    baseMigration,
    /check \(member_low_user_id::text < member_high_user_id::text\)/i,
  );
  assert.match(requestMigration, /raise exception 'LIVE_ROOM_DIRECT_SELF'/i);
});

test("canonical pair state transitions are serialized and decline prevents repeats", () => {
  assert.match(
    requestMigration,
    /pg_advisory_xact_lock\(\s*hashtextextended\(\s*v_member_low::text \|\| ':' \|\| v_member_high::text/i,
  );
  assert.match(
    requestMigration,
    /create unique index live_room_direct_messages_one_request_idx[\s\S]+where message_kind = 'request'/i,
  );
  assert.match(
    requestMigration,
    /if v_conversation\.status = 'pending'[\s\S]+mode', 'pending'/i,
  );
  assert.match(
    requestMigration,
    /raise exception 'LIVE_ROOM_DIRECT_REQUEST_UNAVAILABLE'/i,
  );
  assert.match(
    requestMigration,
    /set status = 'declined'[\s\S]+declined_at = v_now/i,
  );
  assert.doesNotMatch(
    requestMigration,
    /delete from public\.live_room_direct_conversations/i,
  );
});

test("mutual follows accept immediately while non-mutual requests use privacy settings", () => {
  assert.match(
    requestMigration,
    /if v_is_mutual then[\s\S]+status = 'accepted'/i,
  );
  assert.match(
    requestMigration,
    /coalesce\(setting\.receive_mode, 'followers'\)/i,
  );
  for (const mode of [
    "mutual_only",
    "people_i_follow",
    "followers",
    "everyone",
    "nobody",
  ]) {
    assert.match(requestMigration, new RegExp(`'${mode}'`));
    assert.match(publicTypes, new RegExp(`"${mode}"`));
  }
  assert.match(
    requestMigration,
    /when 'people_i_follow'[\s\S]+follower_user_id = v_peer_user_id[\s\S]+followed_user_id = p_requester_user_id/i,
  );
  assert.match(
    requestMigration,
    /when 'followers'[\s\S]+follower_user_id = p_requester_user_id[\s\S]+followed_user_id = v_peer_user_id/i,
  );
});

test("optional filters use only trusted moderator, verified, and active plan contracts", () => {
  for (const filter of [
    "any",
    "moderators",
    "verified",
    "pro_members",
  ]) {
    assert.match(requestMigration, new RegExp(`'${filter}'`));
  }
  assert.match(
    requestMigration,
    /live_room_moderators[\s\S]+active = true[\s\S]+role in \('moderator', 'admin'\)/i,
  );
  assert.match(
    requestMigration,
    /live_room_social_verifications[\s\S]+status = 'verified'/i,
  );
  assert.match(
    requestMigration,
    /subscription\.status = 'active'[\s\S]+subscription\.plan in \('pro', 'advanced', 'ultimate'\)/i,
  );
  assert.match(
    settingsClient,
    /spam controls[\s\S]+do not grant paid investment consulting\s+rights/i,
  );
});

test("start resolves a visible member message and guests remain rejected", () => {
  assert.match(
    requestMigration,
    /where message\.id = p_source_message_id[\s\S]+message\.author_kind = 'member'[\s\S]+message\.visibility_status = 'visible'/i,
  );
  assert.match(
    serverRepository,
    /if \(actor\.kind !== "member"\)[\s\S]+LIVE_ROOM_MEMBER_REQUIRED/,
  );
  assert.match(timelineComponent, /Message member/);
  assert.match(requestModal, /Message request/);
  assert.match(requestModal, /No links, files, images, or position cards/);
  assert.match(
    liveRoomRepository,
    /const messageableUserIds = new Set\([\s\S]+!blockedUserIds\.has\(userId\)/,
  );
});

test("bilateral blocks hide every direct operation and request Block reuses actor blocks", () => {
  const checks =
    requestMigration.match(
      /block\.blocker_member_user_id = p_requester_user_id[\s\S]{0,240}block\.blocked_member_user_id = v_peer_user_id[\s\S]{0,240}block\.blocker_member_user_id = v_peer_user_id[\s\S]{0,240}block\.blocked_member_user_id = p_requester_user_id/g,
    ) || [];
  assert.ok(checks.length >= 5, "all operations must check both block directions");
  assert.match(
    requestMigration,
    /respond_live_room_direct_request[\s\S]+insert into public\.live_room_actor_blocks/i,
  );
  assert.match(requestRoute, /assertSameOriginAuthRequest\(request\)/);
});

test("pending is body-only, link-free, single-message, and cannot send again", () => {
  assert.match(
    requestMigration,
    /message_kind in \('chat', 'request'\)/i,
  );
  assert.match(
    requestMigration,
    /if v_body ~\* \([\s\S]+LIVE_ROOM_DIRECT_REQUEST_LINK/i,
  );
  assert.match(
    requestMigration,
    /insert into public\.live_room_direct_messages[\s\S]+v_body,[\s\S]+'request'/i,
  );
  assert.match(
    requestMigration,
    /if v_conversation\.status <> 'accepted' then[\s\S]+LIVE_ROOM_DIRECT_READ_ONLY/i,
  );
  assert.match(requestModal, /one introductory text/i);
  assert.doesNotMatch(publicTypes, /attachment|imageUrl|positionCard/i);
});

test("accepted status, not current mutual follow, controls future sending", () => {
  const sendFunction = between(
    requestMigration,
    "create or replace function public.send_live_room_direct_message",
    "create or replace function public.get_live_room_direct_inbox",
  );
  assert.match(
    sendFunction,
    /v_conversation\.status <> 'accepted'/i,
  );
  assert.doesNotMatch(sendFunction, /live_room_member_follows/i);
  assert.match(
    conversationClient,
    /conversation\.status === "pending"[\s\S]+Accepted conversation/,
  );
  assert.doesNotMatch(
    requestMigration,
    /delete from public\.live_room_direct_(?:conversations|messages)[\s\S]+live_room_member_follows/i,
  );
});

test("pending inbox is separated and sender receives no read state", () => {
  assert.match(requestMigration, /'incomingRequests'/);
  assert.match(requestMigration, /'outgoingRequests'/);
  assert.match(requestMigration, /'pendingRequestCount'/);
  assert.match(
    requestMigration,
    /conversation\.status = 'accepted'[\s\S]+unread\.sender_user_id <> p_requester_user_id/i,
  );
  assert.match(
    requestMigration,
    /conversation\.status = 'accepted'[\s\S]+mark_live_room_direct_conversation_read/i,
  );
  assert.match(inboxComponent, /Message requests/);
  assert.match(inboxComponent, /Sent requests/);
  assert.match(inboxComponent, /Accept/);
  assert.match(inboxComponent, /Decline/);
  assert.match(inboxComponent, /Block/);
  assert.doesNotMatch(
    [publicTypes, inboxComponent, conversationClient].join("\n"),
    /readReceipt|requestRead|seenByRecipient/i,
  );
});

test("risk flags warn instead of blocking and raise report priority", () => {
  for (const flag of [
    "off_platform_contact",
    "money_transfer",
    "guaranteed_return",
    "paid_room",
    "crypto_wallet",
    "repeated_contact",
  ]) {
    assert.match(requestMigration, new RegExp(`'${flag}'`));
    assert.match(publicTypes, new RegExp(`"${flag}"`));
  }
  const sendFunction = between(
    requestMigration,
    "create or replace function public.send_live_room_direct_message",
    "create or replace function public.get_live_room_direct_inbox",
  );
  assert.doesNotMatch(sendFunction, /LIVE_ROOM_BLOCKED_WORD/i);
  assert.match(
    requestMigration,
    /when v_message\.risk_score > 0[\s\S]+100 \+ v_message\.risk_score/i,
  );
  assert.match(conversationClient, /Safety warning/);
  assert.match(conversationClient, /report suspicious requests/);
});

test("reports are participant-only, peer-message-only, and same-origin", () => {
  const reportFunction = between(
    requestMigration,
    "create function public.report_live_room_direct_message",
    "revoke all privileges",
  );
  assert.match(
    reportFunction,
    /p_requester_user_id in \([\s\S]+member_low_user_id[\s\S]+member_high_user_id/i,
  );
  assert.match(
    reportFunction,
    /message\.conversation_id = v_conversation\.id[\s\S]+message\.sender_user_id <> p_requester_user_id/i,
  );
  assert.match(
    requestMigration,
    /unique \(message_id, reporter_user_id\)/i,
  );
  assert.match(reportRoute, /assertSameOriginAuthRequest\(request\)/);
});

test("all mutation routes re-resolve actors, enforce same origin, and expose no member UUID", () => {
  for (const route of [
    inboxRoute,
    conversationRoute,
    readRoute,
    requestRoute,
    reportRoute,
    settingsRoute,
  ]) {
    assert.match(route, /resolveLiveRoomActor\(request\)/);
  }
  for (const route of [
    inboxRoute,
    conversationRoute,
    readRoute,
    requestRoute,
    reportRoute,
    settingsRoute,
  ]) {
    assert.match(route, /assertSameOriginAuthRequest\(request\)/);
  }
  assert.doesNotMatch(
    [publicTypes, apiRepository, inboxComponent, conversationClient].join(
      "\n",
    ),
    /guest_session_id|guestToken|member_user_id|peer_user_id|email\b|userId\b/,
  );
});

test("inbox/history stay bounded and Live Room author state remains bulk", () => {
  assert.match(
    requestMigration,
    /least\(greatest\(coalesce\(p_limit, 50\), 1\), 50\)/,
  );
  assert.match(
    requestMigration,
    /limit least\(greatest\(coalesce\(p_limit, 30\), 1\), 50\)/,
  );
  assert.match(requestMigration, /incoming_limited[\s\S]+limit 20/i);
  assert.match(requestMigration, /outgoing_limited[\s\S]+limit 20/i);
  assert.match(
    requestMigration,
    /\(message\.created_at, message\.id\)\s+< \(p_before_created_at, p_before_message_id\)/,
  );
  assert.match(serverRepository, /get_live_room_direct_inbox/);
  assert.match(
    liveRoomRepository,
    /Promise\.all\(\[[\s\S]+live_room_member_follows[\s\S]+live_room_actor_blocks/,
  );
  assert.match(apiRepository, /DIRECT_MESSAGE_POLL_INTERVAL_MS = 12_000/);
});

test("new and replaced functions are invoker-only and service-role executable", () => {
  const functions = [
    "start_live_room_direct_conversation",
    "send_live_room_direct_message",
    "get_live_room_direct_inbox",
    "get_live_room_direct_conversation",
    "mark_live_room_direct_conversation_read",
    "respond_live_room_direct_request",
    "get_live_room_direct_message_settings",
    "set_live_room_direct_message_settings",
    "report_live_room_direct_message",
  ];
  for (const functionName of functions) {
    assert.match(
      requestMigration,
      new RegExp(
        `(?:create|create or replace) function public\\.${functionName}[\\s\\S]+?security invoker[\\s\\S]+?set search_path = ''`,
        "i",
      ),
    );
    assert.match(
      requestMigration,
      new RegExp(
        `revoke all privileges\\s+on function public\\.${functionName}[\\s\\S]+?from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      requestMigration,
      new RegExp(
        `grant execute\\s+on function public\\.${functionName}[\\s\\S]+?to service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(requestMigration, /security definer/i);
  assert.doesNotMatch(
    requestMigration,
    /pg_catalog\.(?:coalesce|greatest|least)\s*\(/i,
  );
});

test("every new FK and inbox/status access path has a covering index", () => {
  assert.match(
    requestMigration,
    /live_room_direct_conversations_request_sender_idx[\s\S]+request_sender_user_id/i,
  );
  assert.match(
    requestMigration,
    /low_status_updated_idx[\s\S]+member_low_user_id, status, updated_at desc/i,
  );
  assert.match(
    requestMigration,
    /high_status_updated_idx[\s\S]+member_high_user_id, status, updated_at desc/i,
  );
  for (const index of [
    "live_room_direct_message_reports_conversation_idx",
    "live_room_direct_message_reports_message_idx",
    "live_room_direct_message_reports_reporter_idx",
    "live_room_direct_message_reports_priority_idx",
  ]) {
    assert.match(requestMigration, new RegExp(`create index ${index}`, "i"));
  }
});

test("Messages remains in Live Room activity and separate from paid Alerts", () => {
  assert.match(inboxComponent, /Rooms \+ People \+ Messages/);
  assert.match(
    inboxComponent,
    /summary\.totalUnreadCount \+ directInbox\.totalUnreadCount/,
  );
  assert.doesNotMatch(
    [
      requestMigration,
      serverRepository,
      apiRepository,
      inboxComponent,
      conversationRoute,
      settingsRoute,
    ].join("\n"),
    /alert_preferences|alert_deliver|premium entitlement/i,
  );
});

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return source.slice(startIndex, endIndex);
}

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
