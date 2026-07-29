import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const migration = read(
  "supabase/migrations/20260728150000_community_hub.sql",
);
const types = read("lib/community-hub/types.ts");
const serverRepository = read(
  "lib/community-hub/serverRepository.ts",
);
const peopleRoute = read("app/api/community/people/route.ts");
const roomsRoute = read("app/api/community/rooms/route.ts");
const communityFollowRoute = read(
  "app/api/live-room/community/[slug]/follow/route.ts",
);
const hub = read("components/community/CommunityHubClient.tsx");
const header = read("components/shell/LiveRoomUnreadMenu.tsx");
const account = read("app/account/page.tsx");

test("Community hub contracts stay service-only and separate from market Alerts", () => {
  for (const functionName of [
    "get_live_room_member_relationships",
    "set_live_room_member_follow_by_profile",
    "get_live_room_followed_rooms",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]+?from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]+?to service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(
    `${migration}${serverRepository}`,
    /alert_preferences|alert_deliveries|market_alert/i,
  );
  assert.match(
    hub,
    /Stock signal notifications stay in[\s\S]+href="\/alerts"[\s\S]+only[\s\S]+Community and member messages/i,
  );
});

test("People listing is paginated, relationship-complete, and privacy-safe", () => {
  assert.match(
    migration,
    /p_filter not in \('following', 'followers', 'mutual'\)/i,
  );
  assert.match(
    migration,
    /\(selected\.relationship_at, selected\.target_user_id\)[\s\S]+< \(p_after_at, p_after_user_id\)/i,
  );
  assert.match(
    migration,
    /limit v_limit \+ 1[\s\S]+limit v_limit/i,
  );
  assert.match(
    migration,
    /block\.blocker_member_user_id = p_requester_user_id[\s\S]+block\.blocked_member_user_id = relationship\.target_user_id[\s\S]+block\.blocker_member_user_id = relationship\.target_user_id[\s\S]+block\.blocked_member_user_id = p_requester_user_id/i,
  );
  assert.match(migration, /'publicProfileId', page\.public_profile_id/i);
  assert.doesNotMatch(
    types,
    /targetUserId|followerUserId|followedUserId|memberUserId|email/i,
  );
  assert.match(
    serverRepository,
    /rows[\s\S]+map\(mapPerson\)[\s\S]+last\.targetUserId[\s\S]+return \{[\s\S]+items/,
  );
});

test("People actions permit existing unfollows and follower-only follow back", () => {
  assert.match(
    migration,
    /if not p_followed then[\s\S]+delete from public\.live_room_member_follows/i,
  );
  assert.match(
    migration,
    /if not exists \([\s\S]+follower_user_id = v_target_user_id[\s\S]+followed_user_id = p_requester_user_id[\s\S]+COMMUNITY_HUB_FOLLOW_BACK_REQUIRED/i,
  );
  assert.match(
    peopleRoute,
    /assertSameOriginAuthRequest\(request\)[\s\S]+setCommunityHubMemberFollow/,
  );
  assert.match(hub, /Follow back/);
  assert.match(hub, /Unfollow/);
  assert.match(
    hub,
    /person\.relationship === "mutual"[\s\S]+person\.messageId[\s\S]+onMessage/,
  );
});

test("Rooms contract includes company and Community rooms with bounded unread state", () => {
  assert.match(
    migration,
    /room\.room_kind = 'company'[\s\S]+room\.room_kind = 'community'/i,
  );
  assert.match(
    migration,
    /follow\.notification_scope[\s\S]+message\.visibility_status = 'visible'[\s\S]+live_room_actor_blocks/i,
  );
  assert.match(
    migration,
    /'totalUnreadCount'[\s\S]+sum\(enriched\.unread_count\)/i,
  );
  assert.match(
    roomsRoute,
    /resolveLiveRoomActor\(request\)[\s\S]+listCommunityHubRooms/,
  );
  assert.match(
    communityFollowRoute,
    /getCommunityRoomFollow[\s\S]+updateCommunityRoomFollow/,
  );
  assert.match(hub, /Company Live Room/);
  assert.match(hub, /Community room/);
  assert.match(hub, /title="Joined rooms"/);
  assert.match(hub, />\s*Room activity\s*</);
  assert.doesNotMatch(
    hub,
    /title="Followed rooms"|Unfollow \$\{room\.label\}|Leave \$\{room\.label\}|repository\.writeFollow/,
  );
});

test("desktop popup and mobile header lead to the full Community hub without top-nav changes", () => {
  assert.match(
    header,
    /matchMedia\("\(max-width: 760px\)"\)[\s\S]+router\.push\("\/community"\)/,
  );
  assert.match(
    header,
    /href="\/community"[\s\S]+View all Community/,
  );
  assert.match(
    account,
    /href="\/community"[\s\S]+Community &amp; Messages/,
  );
  assert.match(hub, /Inbox/);
  assert.match(hub, /People/);
  assert.match(hub, /Rooms/);
  assert.match(hub, /Activity/);
});

test("message requests retain Accept, Decline, and Block before conversations", () => {
  const requestsAt = hub.indexOf("Message requests");
  const conversationsAt = hub.indexOf("Conversations");
  assert.ok(requestsAt >= 0);
  assert.ok(conversationsAt > requestsAt);
  assert.match(hub, /"accept"/);
  assert.match(hub, /"decline"/);
  assert.match(hub, /"block"/);
  assert.match(
    hub,
    /directRepository\.respond\([\s\S]+requestDirectMessageRefresh\(\)/,
  );
});
