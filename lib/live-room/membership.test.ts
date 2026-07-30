import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260729073253_live_room_persistent_membership.sql",
);
const resumeMigration = read(
  "supabase/migrations/20260729135952_live_room_resume_and_membership_counts.sql",
);
const privateSchemaGrantMigration = read(
  "supabase/migrations/20260729084500_live_room_private_schema_service_role.sql",
);
const server = read("lib/live-room/serverRepository.ts");
const api = read("lib/live-room/apiRepository.ts");
const types = read("lib/live-room/types.ts");
const companyClient = read("components/live-room/LiveRoomClient.tsx");
const companyHeader = read("components/live-room/CompanyRoomHeader.tsx");
const communityClient = read("components/live-room/CommunityRoomClient.tsx");
const communityHeader = read("components/live-room/CommunityRoomHeader.tsx");
const membershipControl = read(
  "components/live-room/RoomMembershipControl.tsx",
);
const desktopPanel = read("components/live-room/LiveRoomDesktopSidePanel.tsx");
const joinedList = read("components/live-room/JoinedRoomsList.tsx");
const directory = read("app/live/page.tsx");
const companyRoute = read("app/api/live-room/[ticker]/membership/route.ts");
const communityRoute = read(
  "app/api/live-room/community/[slug]/membership/route.ts",
);
const listRoute = read("app/api/live-room/memberships/route.ts");
const liveStyles = read("components/live-room/LiveRoom.module.css");
const tabStyles = read("components/live-room/Posts.module.css");
const communityHub = read("components/community/CommunityHubClient.tsx");

test("room membership storage is default-deny, service-only, and backfills saved rooms", () => {
  assert.match(
    migration,
    /create table public\.live_room_memberships[\s\S]*primary key \(room_id, member_user_id\)/i,
  );
  assert.match(
    migration,
    /references public\.live_room_rooms\(id\) on delete cascade[\s\S]*references public\.user_profiles\(id\) on delete cascade/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_memberships enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.live_room_memberships\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, delete\s+on table public\.live_room_memberships\s+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+\w+(?:,\s*\w+)*\s+on table public\.live_room_memberships\s+to (?:anon|authenticated)/i,
  );
  assert.match(
    migration,
    /insert into public\.live_room_memberships[\s\S]*from public\.live_room_follows[\s\S]*follow\.actor_kind = 'member'[\s\S]*follow\.followed = true/i,
  );
  assert.match(
    privateSchemaGrantMigration,
    /grant usage on schema private to service_role/i,
  );
});

test("Join and Leave are serialized and keep unread tracking in the same canonical state", () => {
  const setMembership =
    migration.match(
      /create function public\.set_live_room_membership\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  const ensureMembership =
    migration.match(
      /create function private\.ensure_live_room_membership\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  assert.match(setMembership, /security invoker/i);
  assert.match(setMembership, /set search_path = ''/i);
  assert.match(
    setMembership,
    /pg_advisory_xact_lock[\s\S]*private\.ensure_live_room_membership/i,
  );
  assert.match(
    setMembership,
    /delete from public\.live_room_memberships[\s\S]*delete from public\.live_room_follows/i,
  );
  assert.match(
    ensureMembership,
    /insert into public\.live_room_memberships[\s\S]*on conflict \(room_id, member_user_id\) do nothing/i,
  );
  assert.match(
    ensureMembership,
    /insert into public\.live_room_follows[\s\S]*followed[\s\S]*notification_scope[\s\S]*'new_chat_messages'/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.set_live_room_membership\(uuid, uuid, boolean\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.set_live_room_membership\(uuid, uuid, boolean\)\s+to service_role/i,
  );
});

test("successful member contributions idempotently Join both company and Community rooms", () => {
  for (const table of [
    "live_room_messages",
    "live_room_posts",
    "live_room_post_comments",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `create trigger ${table}[\\s\\S]*after insert on public\\.${table}`,
        "i",
      ),
    );
  }
  assert.equal(
    (migration.match(/perform private\.ensure_live_room_membership\(/gi) ?? [])
      .length >= 3,
    true,
  );
});

test("member and visitor aggregates stay separate while total cannot trail online", () => {
  const roomState =
    migration.match(
      /create function public\.get_live_room_room_state\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  assert.match(
    roomState,
    /public_members[\s\S]*live_room_memberships[\s\S]*live_room_messages[\s\S]*live_room_posts[\s\S]*live_room_post_comments/i,
  );
  assert.match(
    roomState,
    /online_guests[\s\S]*live_room_guest_presence[\s\S]*interval '2 minutes'/i,
  );
  assert.match(
    roomState,
    /online_member_visitors[\s\S]*not exists[\s\S]*public_members[\s\S]*'memberCount'[\s\S]*'visitorCount'[\s\S]*online_member_visitor_count \+ count\.online_guest_count[\s\S]*'participantCount'[\s\S]*member_count[\s\S]*online_member_visitor_count[\s\S]*online_guest_count[\s\S]*'onlineCount'[\s\S]*online_member_count \+ count\.online_guest_count/i,
  );
  assert.match(
    types,
    /LiveRoomPublicRoomCounts[\s\S]*memberCount: number[\s\S]*visitorCount: number[\s\S]*participantCount: number[\s\S]*onlineCount: number/,
  );
  assert.match(
    companyHeader,
    /roomCounts\.memberCount\} members[\s\S]*roomCounts\.visitorCount\} visitors[\s\S]*roomCounts\.onlineCount\} online/,
  );
});

test("membership APIs derive actors, require same-origin mutations, and accept no browser user IDs", () => {
  for (const route of [companyRoute, communityRoute]) {
    assert.match(route, /resolveLiveRoomActor\(request\)/);
    assert.match(
      route,
      /export async function PUT[\s\S]*assertSameOriginAuthRequest\(request\)/,
    );
    assert.match(
      route,
      /export async function DELETE[\s\S]*assertSameOriginAuthRequest\(request\)/,
    );
    assert.doesNotMatch(
      route,
      /request\.json\(|memberUserId|member_user_id|ownerUserId|owner_user_id/,
    );
  }
  assert.match(
    listRoute,
    /resolveLiveRoomActor\(request\)[\s\S]*listLiveRoomMemberships/,
  );
  assert.match(
    server,
    /supabaseRpc\("list_live_room_memberships"[\s\S]*p_member_user_id: actor\.userId/,
  );
  assert.match(
    api,
    /readMembership\(\)[\s\S]*joinRoom\(\)[\s\S]*leaveRoom\(\)[\s\S]*listJoinedRooms\(limit = 8\)/,
  );
  assert.doesNotMatch(api, /\breadFollow\(\)|\bwriteFollow\(/);
});

test("room UI exposes one Join state, safe guest return, Leave confirmation, and no room Follow control", () => {
  assert.match(
    membershipControl,
    /aria-label="Join room"[\s\S]*title="Join room"[\s\S]*membershipActionLabel\}>Join room<\/span>/,
  );
  assert.match(
    membershipControl,
    /aria-label="Joined"[\s\S]*title="Joined"[\s\S]*membershipActionLabel\}>Joined<\/span>/,
  );
  assert.match(
    membershipControl,
    /aria-label="Leave room"[\s\S]*title="Leave room"[\s\S]*membershipActionLabel\}>\s*Leave room/,
  );
  assert.match(
    membershipControl,
    /aria-label="Loading room membership"[\s\S]*title="Loading room membership"[\s\S]*membershipActionLabel\}>Loading<\/span>/,
  );
  assert.match(membershipControl, /window\.location\.assign\(loginHref\)/);
  assert.match(
    membershipControl,
    /role="dialog"[\s\S]*Leave \{roomLabel\}\?[\s\S]*removes the room from My Rooms[\s\S]*You can still read the room/,
  );
  assert.match(
    membershipControl,
    /confirmLeaveButtonRef\.current\?\.focus\(\)[\s\S]*event\.key !== "Escape"/,
  );
  assert.match(
    companyHeader,
    /<RoomMembershipControl[\s\S]*loginHref=\{loginHref\}/,
  );
  assert.match(
    communityHeader,
    /<RoomMembershipControl[\s\S]*loginHref=\{loginHref\}/,
  );
  assert.doesNotMatch(
    companyClient,
    /readFollow\(|writeFollow\(|Follow this room|Following this room/,
  );
  assert.doesNotMatch(
    communityClient,
    /readFollow\(|writeFollow\(|Follow this room|Following this room|communityFollowButton/,
  );
  assert.doesNotMatch(
    communityHub,
    /Followed rooms|No followed rooms|Unfollow \$\{room\.label\}|repository\.writeFollow/,
  );
});

test("My Rooms is bounded, membership-only, and discoverable on desktop, mobile, and the directory", () => {
  const listFunction =
    resumeMigration.match(
      /create or replace function public\.list_live_room_memberships\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  assert.match(
    listFunction,
    /join public\.live_room_memberships[\s\S]*member_user_id = p_member_user_id/i,
  );
  assert.doesNotMatch(
    listFunction,
    /pg_catalog\.greatest|cross join public\.live_room_memberships[\s\S]*\bon\b/i,
  );
  assert.match(
    listFunction,
    /least\(greatest\(coalesce\(p_limit, 20\), 1\), 100\)/i,
  );
  assert.match(
    listFunction,
    /'recentActivityAt'[\s\S]*'participantCount'[\s\S]*'onlineCount'[\s\S]*'unreadCount'/i,
  );
  assert.match(
    listFunction,
    /public_members[\s\S]*online_members[\s\S]*online_member_visitors[\s\S]*online_guests[\s\S]*group by member\.room_id/i,
  );
  assert.doesNotMatch(
    listFunction,
    /get_live_room_room_state|foreach|for\s+\w+\s+in/i,
  );
  assert.match(
    listFunction,
    /block\.blocker_member_user_id = p_member_user_id[\s\S]*block\.blocked_actor_id = message\.actor_id[\s\S]*block\.blocker_actor_id = message\.actor_id[\s\S]*block\.blocked_member_user_id = p_member_user_id/i,
  );
  assert.match(desktopPanel, /label: "My Rooms"[\s\S]*value: "rooms"/);
  assert.match(
    companyClient,
    /label: "Rooms"[\s\S]*value: "rooms"[\s\S]*mobileSheet === "rooms"/,
  );
  assert.match(
    companyClient,
    /profile\?\.isGuest[\s\S]*href=\{roomLoginHref\}[\s\S]*Sign in to view My Rooms/,
  );
  assert.match(
    directory,
    /readQuery\(query\.view\) === "joined"[\s\S]*<JoinedRoomsDirectory/,
  );
  assert.match(
    joinedList,
    /room\.kind === "company"[\s\S]*room\.ticker[\s\S]*room\.participantCount\} participants[\s\S]*room\.onlineCount\} online[\s\S]*room\.recentActivityAt[\s\S]*formatUnreadCount\(room\.unreadCount\)/,
  );
  assert.match(joinedList, /value > 99 \? "99\+" : String\(value\)/);
  assert.match(
    types,
    /LiveRoomMembershipListItem[\s\S]*onlineCount: number;[\s\S]*participantCount: number;/,
  );
  assert.match(
    server,
    /mapMembershipListItem[\s\S]*onlineCount: readNonnegativeCount[\s\S]*participantCount: readNonnegativeCount/,
  );
  assert.doesNotMatch(joinedList, /Leave room|onLeave/);
});

test("joined room resume reuses the canonical read cursor with visible block-safe fallback", () => {
  const resumeFunction =
    resumeMigration.match(
      /create function public\.get_live_room_resume_state\([\s\S]+?\$\$;/i,
    )?.[0] ?? "";
  const companyMessagesRoute = read(
    "app/api/live-room/[ticker]/messages/route.ts",
  );
  const communityMessagesRoute = read(
    "app/api/live-room/community/[slug]/messages/route.ts",
  );
  const communityPage = read("app/live/community/[slug]/page.tsx");
  const readHook = read("components/live-room/useLiveRoomReadPosition.ts");
  const latestButton = read("components/live-room/LiveRoomLatestButton.tsx");
  const companyLatestHandler =
    companyClient.match(
      /const handleLatest = async \(\) => \{[\s\S]+?\n  \};/,
    )?.[0] ?? "";
  const communityLatestHandler =
    communityClient.match(
      /const handleLatest = async \(\) => \{[\s\S]+?\n  \};/,
    )?.[0] ?? "";

  assert.match(
    resumeFunction,
    /join public\.live_room_follows[\s\S]*last_read_at[\s\S]*last_read_message_id/i,
  );
  assert.match(
    resumeFunction,
    /message\.visibility_status = 'visible'[\s\S]*message\.member_user_id is distinct from p_member_user_id/i,
  );
  assert.match(
    resumeFunction,
    /block\.blocker_member_user_id = p_member_user_id[\s\S]*block\.blocked_actor_id = message\.actor_id[\s\S]*block\.blocker_actor_id = message\.actor_id[\s\S]*block\.blocked_member_user_id = p_member_user_id/i,
  );
  assert.match(
    resumeFunction,
    /first_unread[\s\S]*context_message[\s\S]*order by message\.created_at desc, message\.id desc[\s\S]*limit 1/i,
  );
  assert.match(resumeFunction, /security invoker[\s\S]*set search_path = ''/i);
  assert.match(
    resumeMigration,
    /revoke all on function public\.get_live_room_resume_state\(uuid, uuid\)\s+from public, anon, authenticated[\s\S]*grant execute on function public\.get_live_room_resume_state\(uuid, uuid\)\s+to service_role/i,
  );
  assert.match(
    server,
    /supabaseRpc\("get_live_room_resume_state"[\s\S]*p_member_user_id: memberUserId[\s\S]*p_room_id: roomId/,
  );
  assert.match(api, /if \(options\.resume\) search\.set\("resume", "true"\)/);
  assert.match(
    companyMessagesRoute,
    /searchParams\.get\("resume"\) === "true"/,
  );
  assert.match(
    communityMessagesRoute,
    /searchParams\.get\("resume"\) === "true"/,
  );
  assert.match(
    companyClient,
    /repository\.list\(\{ resume: !activityMessageId \}\)/,
  );
  assert.match(
    communityClient,
    /repository\.list\(\{ resume: !activityMessageId \}\)/,
  );
  assert.match(
    communityClient,
    /if \(initial && highlightedMessageId\)[\s\S]*scheduleTimelineScroll\(\(element\) => \{[\s\S]*live-room-message-\$\{highlightedMessageId\}[\s\S]*element\.contains\(target\)[\s\S]*element\.scrollTo\(\{[\s\S]*\(element\.clientHeight - bounds\.height\) \/ 2[\s\S]*handleTimelineScroll\(\);[\s\S]*scheduleVisibleRead\(\);/,
  );
  assert.doesNotMatch(communityClient, /markMemberActivityRead/);
  assert.match(
    communityPage,
    /searchParams[\s\S]*activityMessageId=\{[\s\S]*query\.message/,
  );
  assert.doesNotMatch(companyClient, /\.markRead\(latestMessageId\)/);
  assert.doesNotMatch(communityClient, /\.markRead\(null\)/);
  assert.match(
    readHook,
    /getLatestVisibleLiveRoomMessageId[\s\S]*repository\.markRead\(latestVisibleMessageId\)[\s\S]*LIVE_ROOM_MARK_READ_THROTTLE_MS/,
  );
  assert.match(
    readHook,
    /item\.kind === "message"\s*&&\s*item\.isMine !== true/,
  );
  assert.match(
    companyClient,
    /firstUnreadMessageId=\{firstUnreadMessageId\}[\s\S]*<LiveRoomLatestButton/,
  );
  assert.match(
    communityClient,
    /firstUnreadMessageId=\{firstUnreadMessageId\}[\s\S]*<LiveRoomLatestButton/,
  );
  assert.match(
    latestButton,
    /Go to latest messages[\s\S]*<ChevronDown[\s\S]*size=\{18\}[\s\S]*latestMessagesBadge[\s\S]*unreadCount > 99 \? "99\+"/,
  );
  assert.doesNotMatch(latestButton, /<span>Latest<\/span>|ArrowDown/);
  assert.match(
    liveStyles,
    /\.latestMessagesButton\s*\{[\s\S]*width:\s*calc\(var\(--sr-size-icon-button\) \+ var\(--sr-space-0-5\)\);[\s\S]*height:\s*calc\(var\(--sr-size-icon-button\) \+ var\(--sr-space-0-5\)\);[\s\S]*border-radius:\s*var\(--sr-radius-pill\);[\s\S]*\.latestMessagesBadge\s*\{[\s\S]*position:\s*absolute;/,
  );
  for (const latestHandler of [companyLatestHandler, communityLatestHandler]) {
    assert.match(
      latestHandler,
      /repository\.list\(\)[\s\S]*setTimeline\(replaceLiveRoomTimeline\(page\.items\)\)[\s\S]*scheduleTimelineScroll\(\(element\) => \{[\s\S]*top: element\.scrollHeight[\s\S]*timelineSticksToBottomRef\.current = true[\s\S]*handleTimelineScroll\(\);[\s\S]*scheduleVisibleRead\(\);/,
    );
  }
});

test("membership controls and five-tab mobile navigation remain compact without arbitrary tokens", () => {
  assert.match(
    liveStyles,
    /@media \(max-width: 760px\)[\s\S]*\.roomActions \.membershipButton,[\s\S]*\.roomActions \.membershipLeaveButton[\s\S]*width:\s*auto[\s\S]*min-width:\s*0/,
  );
  assert.match(
    liveStyles,
    /\.membershipDialogBackdrop[\s\S]*background:\s*var\(--sr-color-overlay-full-scroll\)/,
  );
  assert.match(
    liveStyles,
    /@media \(max-width: 360px\)\s*\{[\s\S]*\.roomActions \.membershipButton,[\s\S]*\.roomActions \.membershipLeaveButton,[\s\S]*\.membershipJoinedStatus[\s\S]*width:\s*calc\(var\(--sr-size-control\) - var\(--sr-space-2\)\);[\s\S]*flex:\s*0 0 calc\(var\(--sr-size-control\) - var\(--sr-space-2\)\);/,
  );
  assert.match(
    liveStyles,
    /@media \(max-width: 360px\)[\s\S]*\.roomActions \.membershipActionLabel\s*\{[\s\S]*position:\s*absolute;[\s\S]*clip-path:\s*inset\(50%\);[\s\S]*white-space:\s*nowrap;/,
  );
  assert.match(
    liveStyles,
    /@media \(max-width: 360px\)[\s\S]*\.roomMeta \.roomCounts\s*\{[\s\S]*display:\s*contents;/,
  );
  assert.match(
    tabStyles,
    /repeat\(var\(--live-room-mobile-tab-count, 3\), minmax\(0, 1fr\)\)/,
  );
  assert.equal(
    (
      companyClient.match(
        /controlsId: "live-room-(?:posts|events|members|rooms)-sheet"/g,
      ) ?? []
    ).length,
    4,
  );
});
