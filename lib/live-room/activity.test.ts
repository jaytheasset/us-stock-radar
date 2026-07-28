import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

const migration = readSource(
  "docs/db/migration-archive/pre-canonical-baseline/20260728094224_live_room_post_activity.sql",
);
const unreadRoute = readSource("app/api/live-room/unread/route.ts");
const readRoute = readSource(
  "app/api/live-room/activity/[activityId]/read/route.ts",
);
const serverRepository = readSource(
  "lib/live-room/serverRepository.ts",
);
const apiRepository = readSource("lib/live-room/apiRepository.ts");
const inbox = readSource("components/shell/LiveRoomUnreadMenu.tsx");

test("community activity remains separate from paid market Alerts", () => {
  assert.match(
    migration,
    /Community activity is intentionally separate from paid market Alerts/i,
  );
  assert.doesNotMatch(
    `${migration}${unreadRoute}${readRoute}${serverRepository}${apiRepository}${inbox}`,
    /alert_preferences|alert_deliveries|market_alert/i,
  );
  assert.match(inbox, /Community \+ Messages/);
  assert.match(inbox, /live-room-inbox-tab-activity/);
});

test("post activity is member-only, RLS-protected, and service-role-only", () => {
  assert.match(
    migration,
    /create table public\.live_room_post_activity/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_post_activity enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all privileges[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete[\s\S]+to service_role/i,
  );
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /set search_path = ''/gi);
  assert.doesNotMatch(migration, /security definer|create policy/i);
  assert.match(
    serverRepository,
    /if \(actor\.kind !== "member"\)[\s\S]+LIVE_ROOM_MEMBER_REQUIRED/,
  );
});

test("post follows deduplicate room and member activity and respect blocks", () => {
  assert.match(
    migration,
    /followed_member_post[\s\S]+from public\.live_room_member_follows/,
  );
  assert.match(
    migration,
    /followed_room_post[\s\S]+from public\.live_room_follows[\s\S]+actor_kind = 'member'[\s\S]+followed = true/,
  );
  assert.match(
    migration,
    /distinct on \(candidate\.recipient_user_id\)[\s\S]+order by candidate\.recipient_user_id, candidate\.priority/,
  );
  assert.match(
    migration,
    /unique \(recipient_user_id, source_id\)/,
  );
  assert.match(
    migration,
    /live_room_actor_blocks[\s\S]+blocker_member_user_id = candidate\.recipient_user_id[\s\S]+blocked_member_user_id = new\.author_user_id[\s\S]+blocker_member_user_id = new\.author_user_id[\s\S]+blocked_member_user_id = candidate\.recipient_user_id/,
  );
  assert.match(
    migration,
    /follow\.follower_user_id <> new\.author_user_id/,
  );
  assert.match(
    migration,
    /follow\.member_user_id <> new\.author_user_id/,
  );
  assert.match(
    migration,
    /if new\.visibility_status <> 'visible' then[\s\S]+return new/,
  );
});

test("comments notify the post owner and replies notify the parent author once", () => {
  assert.match(
    migration,
    /new\.parent_comment_id is not null[\s\S]+comment_reply/,
  );
  assert.match(
    migration,
    /v_post\.author_user_id is distinct from new\.author_user_id[\s\S]+v_post\.author_user_id is distinct from v_parent_author_user_id[\s\S]+post_comment/,
  );
  assert.match(
    migration,
    /on conflict \(recipient_user_id, source_id\) do nothing/gi,
  );
  assert.match(
    migration,
    /join public\.live_room_posts[\s\S]+visibility_status = 'visible'[\s\S]+left join public\.live_room_post_comments[\s\S]+visibility_status = 'visible'/,
  );
});

test("activity summary and read mutation are recipient-scoped and indexed", () => {
  assert.match(
    migration,
    /live_room_post_activity_recipient_created_idx[\s\S]+recipient_user_id,[\s\S]+created_at desc,[\s\S]+id desc/,
  );
  assert.match(
    migration,
    /live_room_post_activity_recipient_unread_idx[\s\S]+where read_at is null/,
  );
  assert.match(
    migration,
    /where activity\.recipient_user_id = p_recipient_user_id/,
  );
  assert.match(
    migration,
    /where activity\.id = p_activity_id[\s\S]+activity\.recipient_user_id = p_recipient_user_id/,
  );
  assert.match(
    serverRepository,
    /get_live_room_post_activity_summary[\s\S]+p_recipient_user_id: actor\.userId/,
  );
  assert.match(
    readRoute,
    /assertSameOriginAuthRequest\(request\)[\s\S]+resolveLiveRoomActor\(request\)/,
  );
});

test("activity UI marks the item read and opens the canonical discussion", () => {
  assert.match(
    apiRepository,
    /PUT[\s\S]+\/api\/live-room\/activity\/\$\{encodeURIComponent\([\s\S]+\/read/,
  );
  assert.match(
    inbox,
    /markLiveRoomPostActivityRead\(activity\.activityId\)/,
  );
  assert.match(
    inbox,
    /\/live\/posts\/\$\{encodeURIComponent\(activity\.postId\)\}#comments/,
  );
  assert.match(
    inbox,
    /New comments, replies, and followed posts will appear here/,
  );
  assert.match(
    inbox,
    /summary\.totalUnreadCount \+ directInbox\.totalUnreadCount/,
  );
});
