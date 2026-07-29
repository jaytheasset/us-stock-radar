import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseMigration = read(
  "docs/db/migration-archive/pre-canonical-baseline/20260727174043_live_room_mutual_direct_messages.sql",
);
const requestMigration = read(
  "docs/db/migration-archive/pre-canonical-baseline/20260727202901_live_room_message_requests.sql",
);
const reportForeignKeyIndexMigration = read(
  "docs/db/migration-archive/pre-canonical-baseline/20260727204014_add_direct_message_report_fk_index.sql",
);
const socialVerificationMigration = read(
  "docs/db/migration-archive/pre-canonical-baseline/20260727185802_live_room_social_account_verification.sql",
);
const effectivePlanContract = read("lib/subscription/effectivePlan.ts");
const migration = `${baseMigration}\n${requestMigration}`;
const serverRepository = read("lib/direct-messages/serverRepository.ts");
const apiRepository = read("lib/direct-messages/apiRepository.ts");
const publicTypes = read("lib/direct-messages/types.ts");
const inboxComponent = read("components/shell/LiveRoomUnreadMenu.tsx");
const conversationClient = read(
  "components/direct-messages/DirectMessageClient.tsx",
);
const conversationStyles = read(
  "components/direct-messages/DirectMessage.module.css",
);
const liveRoomStyles = read(
  "components/live-room/LiveRoom.module.css",
);
const themeTokens = read("app/stock-radar-tokens.css");
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
    /subscription\.status = 'active'[\s\S]+subscription\.plan in \('pro', 'advanced', 'ultimate'\)[\s\S]+subscription\.trial_plan in \('pro', 'advanced'\)[\s\S]+subscription\.trial_started_at is not null[\s\S]+subscription\.trial_ends_at is not null[\s\S]+subscription\.trial_ends_at > v_now/i,
  );
  assert.match(
    effectivePlanContract,
    /trialPlan === "pro" \|\| trialPlan === "advanced"/,
  );
  assert.match(
    effectivePlanContract,
    /startedAt && Number\.isFinite\(endsTime\) && endsTime > now\.getTime\(\)/,
  );
  assert.match(
    settingsClient,
    /spam controls[\s\S]+do not grant paid investment consulting\s+rights/i,
  );
});

test("DM inbox and conversation peer plans use the effective base-or-trial rank", () => {
  const inboxFunction = between(
    requestMigration,
    "create or replace function public.get_live_room_direct_inbox",
    "create or replace function public.get_live_room_direct_conversation",
  );
  const conversationFunction = between(
    requestMigration,
    "create or replace function public.get_live_room_direct_conversation",
    "create or replace function public.mark_live_room_direct_conversation_read",
  );

  for (const functionBody of [inboxFunction, conversationFunction]) {
    assert.match(
      functionBody,
      /subscription\.status = 'active'[\s\S]+case subscription\.plan[\s\S]+when 'ultimate' then 4[\s\S]+when 'advanced' then 3[\s\S]+when 'pro' then 2[\s\S]+when 'ad_free' then 1/i,
    );
    assert.match(
      functionBody,
      /subscription\.trial_plan in \('pro', 'advanced'\)[\s\S]+subscription\.trial_started_at is not null[\s\S]+subscription\.trial_ends_at is not null/i,
    );
    assert.match(
      functionBody,
      /case subscription\.trial_plan[\s\S]+when 'advanced' then 3[\s\S]+when 'pro' then 2/i,
    );
    assert.match(
      functionBody,
      /case greatest\([\s\S]+when 4 then 'ultimate'[\s\S]+when 3 then 'advanced'[\s\S]+when 2 then 'pro'[\s\S]+when 1 then 'ad_free'[\s\S]+else 'free'/i,
    );
  }
  assert.match(
    inboxFunction,
    /subscription\.trial_ends_at > now\(\)/i,
  );
  assert.match(
    conversationFunction,
    /v_now timestamptz := now\(\)[\s\S]+subscription\.trial_ends_at > v_now/i,
  );
  assert.match(
    effectivePlanContract,
    /free: 0,[\s\S]+ad_free: 1,[\s\S]+pro: 2,[\s\S]+advanced: 3,[\s\S]+ultimate: 4/,
  );
});

test("selective filters are available only to verified creators or active trusted moderators", () => {
  const startFunction = between(
    requestMigration,
    "create function public.start_live_room_direct_conversation",
    "create or replace function public.send_live_room_direct_message",
  );
  const getSettingsFunction = between(
    requestMigration,
    "create function public.get_live_room_direct_message_settings",
    "create function public.set_live_room_direct_message_settings",
  );
  const setSettingsFunction = between(
    requestMigration,
    "create function public.set_live_room_direct_message_settings",
    "create function public.report_live_room_direct_message",
  );

  for (const functionBody of [
    startFunction,
    getSettingsFunction,
    setSettingsFunction,
  ]) {
    assert.match(
      functionBody,
      /live_room_social_verifications[\s\S]+status = 'verified'/i,
    );
    assert.match(
      functionBody,
      /live_room_moderators[\s\S]+active = true[\s\S]+role in \('moderator', 'admin'\)/i,
    );
  }
  assert.match(
    socialVerificationMigration,
    /status = 'verified'/i,
  );
  assert.match(
    getSettingsFunction,
    /when eligibility\.can_use_selective_filters[\s\S]+coalesce\(setting\.request_filter, 'any'\)[\s\S]+else 'any'/i,
  );
  assert.match(
    getSettingsFunction,
    /'canUseSelectiveFilters',\s+eligibility\.can_use_selective_filters/i,
  );
  assert.match(
    setSettingsFunction,
    /p_request_filter <> 'any'[\s\S]+not v_can_use_selective_filters[\s\S]+LIVE_ROOM_DIRECT_SELECTIVE_FILTER_FORBIDDEN/i,
  );
  assert.match(
    startFunction,
    /if not v_recipient_can_use_selective_filters then\s+v_filter := 'any'/i,
  );
  assert.match(
    serverRepository,
    /requestFilter !== "any" && !currentSettings\.canUseSelectiveFilters[\s\S]+LIVE_ROOM_DIRECT_SELECTIVE_FILTER_FORBIDDEN/,
  );
  assert.match(
    serverRepository,
    /canUseSelectiveFilters[\s\S]+canUseSelectiveFilters[\s\S]+\?[\s\S]+requestFilter[\s\S]+: "any"/,
  );
  assert.match(publicTypes, /canUseSelectiveFilters: boolean/);
  assert.match(
    settingsClient,
    /settings\.canUseSelectiveFilters \?[\s\S]+Optional request filter[\s\S]+approved social verification[\s\S]+active trusted/,
  );
  assert.match(
    apiRepository,
    /JSON\.stringify\(\{\s+receiveMode: settings\.receiveMode,\s+requestFilter: settings\.requestFilter/,
  );
});

test("selective filters apply only after accepted and mutual conversation paths", () => {
  const startFunction = between(
    requestMigration,
    "create function public.start_live_room_direct_conversation",
    "create or replace function public.send_live_room_direct_message",
  );
  const acceptedIndex = startFunction.indexOf(
    "v_conversation.status = 'accepted'",
  );
  const mutualIndex = startFunction.indexOf("if v_is_mutual then");
  const settingsIndex = startFunction.indexOf(
    "v_recipient_can_use_selective_filters :=",
  );
  const filterIndex = startFunction.indexOf("case v_filter");
  assert.ok(acceptedIndex >= 0 && acceptedIndex < settingsIndex);
  assert.ok(mutualIndex >= 0 && mutualIndex < settingsIndex);
  assert.ok(settingsIndex >= 0 && settingsIndex < filterIndex);
});

test("send RPC uses one declared server timestamp for every time comparison and write", () => {
  const sendFunction = between(
    requestMigration,
    "create or replace function public.send_live_room_direct_message",
    "create or replace function public.get_live_room_direct_inbox",
  );
  assertNoUndeclaredPlpgsqlLocals(sendFunction);
  assert.match(sendFunction, /v_now timestamptz := now\(\)/i);
  assert.equal(sendFunction.match(/\bnow\(\)/gi)?.length, 1);
  assert.match(
    sendFunction,
    /recent\.created_at >= v_now - interval '120 seconds'/i,
  );
  assert.match(
    sendFunction,
    /recent\.created_at >= v_now - interval '20 seconds'/i,
  );
  assert.match(
    sendFunction,
    /risk_score,\s+created_at[\s\S]+v_risk_score,\s+v_now/i,
  );
  assert.match(
    sendFunction,
    /set updated_at = v_now[\s\S]+last_read_at[\s\S]+v_now,\s+v_now/i,
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
  assert.equal(
    reportForeignKeyIndexMigration.replace(/\s+/g, " ").trim().toLowerCase(),
    [
      "begin;",
      "create index if not exists",
      "live_room_direct_message_reports_conversation_message_idx",
      "on public.live_room_direct_message_reports (conversation_id, message_id);",
      "commit;",
    ].join(" "),
  );
});

test("Messages remains in Live Room activity and separate from paid Alerts", () => {
  assert.match(inboxComponent, /Community \+ Messages/);
  assert.match(inboxComponent, />\s*Activity\s*/);
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

test("direct-message bubbles share the financial-chat colors, radii, and responsive bounds", () => {
  assert.match(
    conversationClient,
    /className=\{message\.isMine \? styles\.mine : styles\.theirs\}[\s\S]*?<p>\{message\.body\}<\/p>/,
  );
  assert.match(
    conversationStyles,
    /\.conversation\s*\{[\s\S]*?background:\s*var\(--sr-color-chat-timeline-background\)/,
  );
  assert.match(
    conversationStyles,
    /\.timeline li\s*\{[\s\S]*?width:\s*fit-content[\s\S]*?max-width:\s*min\(72%, 620px\)/,
  );
  assert.match(
    conversationStyles,
    /\.timeline p\s*\{[\s\S]*?overflow-wrap:\s*anywhere[\s\S]*?var\(--sr-color-chat-bubble-other-border\)[\s\S]*?border-radius:\s*var\(--sr-radius-chat-message\)[\s\S]*?background:\s*var\(--sr-color-chat-bubble-other-background\)/,
  );
  assert.match(
    conversationStyles,
    /\.mine p\s*\{[\s\S]*?border-color:\s*var\(--sr-color-chat-bubble-mine-border\)[\s\S]*?background:\s*var\(--sr-color-chat-bubble-mine-background\)/,
  );
  assert.match(
    conversationStyles,
    /\.requestLabel\s*\{[\s\S]*?border-radius:\s*var\(--sr-radius-chat-control\)/,
  );
  assert.match(
    conversationStyles,
    /\.reportControl > button\s*\{[\s\S]*?border-radius:\s*var\(--sr-radius-chat-control\)/,
  );
  assert.match(
    conversationStyles,
    /\.composer button\s*\{[\s\S]*?border-radius:\s*var\(--sr-radius-chat-control\)/,
  );
  assert.match(
    conversationStyles,
    /@media \(max-width: 720px\)[\s\S]*?\.timeline\s*\{[\s\S]*?padding:\s*var\(--sr-space-3\)[\s\S]*?\.timeline li\s*\{[\s\S]*?max-width:\s*86%/,
  );
  assert.doesNotMatch(
    conversationStyles,
    /#(?:ffffff|fff1e6|f6cba8|f7f9fb)/i,
  );
});

test("Live Room and direct messages consume the exact shared financial-chat token contract", () => {
  const darkTokens = themeTokens.slice(
    0,
    themeTokens.indexOf('[data-sr-theme="light"]'),
  );
  const lightTokens = themeTokens.slice(
    themeTokens.indexOf('[data-sr-theme="light"]'),
  );

  assert.match(themeTokens, /--sr-radius-chat-message:\s*6px/);
  assert.match(themeTokens, /--sr-radius-chat-control:\s*4px/);
  assert.match(
    darkTokens,
    /--sr-color-chat-timeline-background:\s*#08111a/i,
  );
  assert.match(
    darkTokens,
    /--sr-color-chat-bubble-other-background:\s*#131f2b/i,
  );
  assert.match(
    darkTokens,
    /--sr-color-chat-bubble-other-border:\s*#2a3a4a/i,
  );
  assert.match(
    darkTokens,
    /--sr-color-chat-bubble-mine-background:\s*#2b171a/i,
  );
  assert.match(
    darkTokens,
    /--sr-color-chat-bubble-mine-border:\s*#8c4a32/i,
  );
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

  for (const background of ["#08111a", "#131f2b", "#2b171a"]) {
    assert.ok(
      contrastRatio(background, "#d7dbe0") >= 4.5,
      `${background} must preserve body text contrast`,
    );
    assert.ok(
      contrastRatio(background, "#8a929d") >= 4.5,
      `${background} must preserve metadata contrast`,
    );
  }

  for (const styles of [liveRoomStyles, conversationStyles]) {
    assert.match(
      styles,
      /background:\s*var\(--sr-color-chat-timeline-background\)/,
    );
    assert.match(
      styles,
      /border-radius:\s*var\(--sr-radius-chat-message\)/,
    );
    assert.match(
      styles,
      /var\(--sr-color-chat-bubble-other-background\)/,
    );
    assert.match(
      styles,
      /var\(--sr-color-chat-bubble-mine-background\)/,
    );
    assert.match(
      styles,
      /var\(--sr-color-chat-bubble-mine-border\)/,
    );
    assert.match(
      styles,
      /border-radius:\s*var\(--sr-radius-chat-control\)/,
    );
  }

  assert.match(
    liveRoomStyles,
    /\.otherMessage article,\s*\.myMessage article\s*\{[\s\S]*?min-width:\s*0[\s\S]*?border-radius:\s*var\(--sr-radius-chat-message\)/,
  );
  assert.match(
    liveRoomStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.otherMessage article,\s*\.myMessage article\s*\{[\s\S]*?max-width:\s*85%/,
  );
});

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return source.slice(startIndex, endIndex);
}

function assertNoUndeclaredPlpgsqlLocals(functionSql: string) {
  const declaration = between(functionSql, "declare", "begin");
  const declared = new Set(
    [...declaration.matchAll(/^\s*(v_[a-z0-9_]+)\s+/gim)].map(
      (match) => match[1]!.toLowerCase(),
    ),
  );
  const referenced = new Set(
    [...functionSql.matchAll(/\b(v_[a-z0-9_]+)\b/gi)].map(
      (match) => match[1]!.toLowerCase(),
    ),
  );
  assert.deepEqual(
    [...referenced].filter((identifier) => !declared.has(identifier)),
    [],
  );
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function relativeLuminance(color: string) {
  const channels = color
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return (
    0.2126 * channels[0]! +
    0.7152 * channels[1]! +
    0.0722 * channels[2]!
  );
}

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
