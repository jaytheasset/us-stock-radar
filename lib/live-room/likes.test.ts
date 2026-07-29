import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("post likes migration is service-only, serialized, and count-safe", () => {
  const migration = readSource(
    "supabase/migrations/20260729044356_live_room_post_like_activity.sql",
  );

  assert.match(
    migration,
    /create table public\.live_room_post_likes[\s\S]*primary key \(post_id, actor_user_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(post_id\)[\s\S]*references public\.live_room_posts \(id\)[\s\S]*on delete cascade/i,
  );
  assert.match(
    migration,
    /foreign key \(actor_user_id\)[\s\S]*references public\.live_room_member_profiles \(user_id\)[\s\S]*on delete cascade/i,
  );
  assert.match(
    migration,
    /created_at timestamptz not null default now\(\)/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_post_likes enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.live_room_post_likes\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant all on table public\.live_room_post_likes\s+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete|all)[^;]*live_room_post_likes[^;]*to\s+(?:anon|authenticated)/i,
  );

  assert.match(
    migration,
    /function public\.toggle_live_room_post_like\(\s*p_post_id uuid,\s*p_actor_user_id uuid\s*\)/i,
  );
  assert.match(
    migration,
    /toggle_live_room_post_like[\s\S]*live_room_member_profiles[\s\S]*LIVE_ROOM_MEMBER_REQUIRED/i,
  );
  assert.match(
    migration,
    /toggle_live_room_post_like[\s\S]*visibility_status = 'visible'[\s\S]*LIVE_ROOM_POST_NOT_FOUND/i,
  );
  assert.match(
    migration,
    /pg_catalog\.pg_advisory_xact_lock\([\s\S]*live-room-post-like:/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.toggle_live_room_post_like\(uuid, uuid\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.toggle_live_room_post_like\(uuid, uuid\)\s+to service_role/i,
  );

  assert.match(
    migration,
    /add column like_count bigint not null default 0[\s\S]*add column visible_comment_count bigint not null default 0/i,
  );
  assert.match(
    migration,
    /live_room_post_comments_sync_count[\s\S]*update of post_id, visibility_status/i,
  );
  assert.match(
    migration,
    /create index live_room_posts_room_popular_idx[\s\S]*room_id[\s\S]*like_count desc[\s\S]*where visibility_status = 'visible'/i,
  );
  assert.match(
    migration,
    /get_live_room_member_received_like_count[\s\S]*sum\(post\.like_count\)[\s\S]*visibility_status = 'visible'/i,
  );
});

test("post repositories expose actor-aware engagement and a protected toggle API", () => {
  const types = readSource("lib/live-room/types.ts");
  const serverRepository = readSource(
    "lib/live-room/postServerRepository.ts",
  );
  const timelineRepository = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const apiRepository = readSource("lib/live-room/apiRepository.ts");
  const route = readSource(
    "app/api/live-room/posts/[postId]/like/route.ts",
  );

  for (const field of [
    "canLike",
    "commentCount",
    "isLiked",
    "likeCount",
  ]) {
    assert.match(types, new RegExp(`${field}: (?:boolean|number);`));
  }
  assert.match(types, /receivedLikeCount: number;/);
  assert.match(
    serverRepository,
    /like_count,visible_comment_count/,
  );
  assert.match(
    timelineRepository,
    /like_count,visible_comment_count/,
  );
  assert.match(
    serverRepository,
    /supabaseSelect\("live_room_post_likes", \{[\s\S]*actor_user_id: `eq\.\$\{actor\.userId\}`/,
  );
  assert.match(
    serverRepository,
    /canLike: actor\.kind === "member"/,
  );
  assert.match(
    serverRepository,
    /isLiked: likedPostIds\.has/,
  );
  assert.match(
    serverRepository,
    /supabaseRpc\("toggle_live_room_post_like", \{[\s\S]*p_post_id: postId[\s\S]*p_actor_user_id: actor\.userId/,
  );
  assert.match(
    serverRepository,
    /get_live_room_member_received_like_count/,
  );
  assert.match(
    apiRepository,
    /toggleLike\(postId: string\)[\s\S]*\/like`[\s\S]*method: "POST"/,
  );
  assert.match(route, /assertSameOriginAuthRequest\(request\)/);
  assert.match(route, /resolveLiveRoomActor\(request\)/);
  assert.match(route, /toggleLiveRoomPostLike\(\{[\s\S]*actor: resolution\.actor/);
  assert.doesNotMatch(route, /actorUserId|p_actor_user_id|userId:/);
});

test("detail, cards, chat previews, and member profiles render engagement", () => {
  const detail = readSource(
    "components/live-room/PostDetailClient.tsx",
  );
  const comments = readSource("components/live-room/PostComments.tsx");
  const posts = readSource("components/live-room/PostsPanel.tsx");
  const timeline = readSource("components/live-room/ChatTimeline.tsx");
  const profile = readSource(
    "components/live-room/PublicMemberProfileClient.tsx",
  );

  assert.match(detail, /repository\.toggleLike\(post\.id\)/);
  assert.match(detail, /aria-pressed=\{post\.isLiked\}/);
  assert.match(detail, /createLiveRoomMemberLoginHref\(/);
  assert.match(detail, /\{post\.likeCount\}/);
  assert.match(detail, /\{post\.commentCount\}/);
  assert.match(
    comments,
    /onCommentCountChange\?\.\(1\)[\s\S]*onCommentCountChange\?\.\(-removedCount\)/,
  );
  assert.match(posts, /aria-label="Post activity"/);
  assert.match(posts, /\{post\.likeCount\}/);
  assert.match(posts, /\{post\.commentCount\}/);
  assert.match(timeline, /\{item\.likeCount\}/);
  assert.match(timeline, /\{item\.commentCount\}/);
  assert.match(profile, /Received likes \{member\.receivedLikeCount\}/);
});

test("message engagement migration is service-only, idempotent, and visibility-safe", () => {
  const migration = readSource(
    "supabase/migrations/20260729115507_live_room_message_engagement.sql",
  );

  assert.match(
    migration,
    /create table public\.live_room_message_likes[\s\S]*primary key \(message_id, actor_user_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(message_id\)[\s\S]*references public\.live_room_messages \(id\)[\s\S]*on delete cascade/i,
  );
  assert.match(
    migration,
    /foreign key \(actor_user_id\)[\s\S]*references public\.live_room_member_profiles \(user_id\)[\s\S]*on delete cascade/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_message_likes enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.live_room_message_likes\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, delete\s+on table public\.live_room_message_likes\s+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete|all)[^;]*live_room_message_likes[^;]*to\s+(?:anon|authenticated)/i,
  );
  assert.match(
    migration,
    /add column like_count bigint not null default 0[\s\S]*live_room_messages_like_count_check[\s\S]*like_count >= 0/i,
  );
  assert.match(
    migration,
    /live_room_message_likes_sync_count[\s\S]*after insert or delete/i,
  );

  assert.match(
    migration,
    /function public\.set_live_room_message_like\([\s\S]*p_room_id uuid[\s\S]*p_message_id uuid[\s\S]*p_actor_user_id uuid[\s\S]*p_liked boolean/i,
  );
  assert.match(
    migration,
    /security invoker[\s\S]*set search_path = ''/i,
  );
  assert.match(
    migration,
    /pg_catalog\.pg_advisory_xact_lock\([\s\S]*live-room-message-like:/i,
  );
  assert.match(
    migration,
    /message\.id = p_message_id[\s\S]*message\.room_id = p_room_id[\s\S]*message\.visibility_status = 'visible'/i,
  );
  assert.match(
    migration,
    /live_room_actor_blocks[\s\S]*block\.blocker_member_user_id = p_actor_user_id[\s\S]*block\.blocked_actor_id = v_message\.actor_id[\s\S]*block\.blocker_actor_id = v_message\.actor_id[\s\S]*block\.blocked_member_user_id = p_actor_user_id/i,
  );
  assert.match(
    migration,
    /if p_liked then[\s\S]*on conflict on constraint live_room_message_likes_pkey do nothing[\s\S]*else[\s\S]*delete from public\.live_room_message_likes/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.set_live_room_message_like\([\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.set_live_room_message_like\([\s\S]*to service_role/i,
  );

  assert.match(
    migration,
    /function public\.get_live_room_message_reply_counts\([\s\S]*p_message_ids uuid\[\][\s\S]*p_blocked_actor_ids uuid\[\]/i,
  );
  assert.match(
    migration,
    /reply\.reply_to_message_id = any[\s\S]*reply\.visibility_status = 'visible'[\s\S]*not \([\s\S]*reply\.actor_id = any[\s\S]*group by reply\.reply_to_message_id/i,
  );
  assert.match(
    migration,
    /live_room_messages_touch_reply_parent[\s\S]*update of reply_to_message_id, visibility_status/i,
  );
  assert.match(
    migration,
    /live_room_messages_broadcast_change[\s\S]*update of visibility_status, like_count, updated_at/i,
  );
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|greatest)\s*\(/i,
  );
  assert.doesNotMatch(
    migration,
    /get_live_room_member_received_like_count|received_like_count/i,
  );
});

test("message repositories batch engagement and expose actor-derived PUT routes", () => {
  const types = readSource("lib/live-room/types.ts");
  const repository = readSource(
    "lib/live-room/serverRepository.ts",
  );
  const apiRepository = readSource("lib/live-room/apiRepository.ts");
  const companyRoute = readSource(
    "app/api/live-room/[ticker]/messages/[messageId]/like/route.ts",
  );
  const communityRoute = readSource(
    "app/api/live-room/community/[slug]/messages/[messageId]/like/route.ts",
  );

  for (const field of ["isLiked", "likeCount", "replyCount"]) {
    assert.match(types, new RegExp(`${field}: (?:boolean|number);`));
  }
  assert.ok(
    (repository.match(/reply_to_message_id,like_count/g) || [])
      .length >= 3,
  );
  assert.match(
    repository,
    /function getLiveRoomMessageEngagement[\s\S]*messageIds[\s\S]*supabaseRpc\("get_live_room_message_reply_counts"[\s\S]*p_message_ids: messageIds[\s\S]*p_blocked_actor_ids: blockedActorIds/,
  );
  assert.match(
    repository,
    /supabaseSelect\("live_room_message_likes", \{[\s\S]*actor_user_id: `eq\.\$\{actor\.userId\}`[\s\S]*message_id: `in\.\(\$\{messageIds\.join\(","\)\}\)`/,
  );
  assert.match(
    repository,
    /actor\.kind === "member"[\s\S]*supabaseSelect\("live_room_message_likes"[\s\S]*: Promise\.resolve/,
  );
  assert.match(
    repository,
    /setLiveRoomMessageLike\([\s\S]*assertLiveRoomEngagementMember\(actor\)[\s\S]*supabaseRpc\("set_live_room_message_like"[\s\S]*p_actor_user_id: actor\.userId/,
  );
  assert.match(
    apiRepository,
    /setMessageLike\(messageId: string, liked: boolean\)[\s\S]*\/messages\/\$\{encodeURIComponent\(messageId\)\}\/like`[\s\S]*method: "PUT"[\s\S]*JSON\.stringify\(\{ liked \}\)/,
  );
  for (const route of [companyRoute, communityRoute]) {
    assert.match(route, /assertSameOriginAuthRequest\(request\)/);
    assert.match(route, /resolveLiveRoomActor\(request\)/);
    assert.match(
      route,
      /setLiveRoomMessageLike\(\{[\s\S]*actor: resolution\.actor[\s\S]*liked: input\?\.liked/,
    );
    assert.doesNotMatch(
      route,
      /actorUserId|p_actor_user_id|userId:/,
    );
  }
  assert.match(companyRoute, /ticker,/);
  assert.match(communityRoute, /slug,/);
});

test("ordinary messages use one accessible compact engagement row", () => {
  const timeline = readSource(
    "components/live-room/ChatTimeline.tsx",
  );
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const companyClient = readSource(
    "components/live-room/LiveRoomClient.tsx",
  );
  const communityClient = readSource(
    "components/live-room/CommunityRoomClient.tsx",
  );

  assert.match(
    timeline,
    /<p>\{item\.body\}<\/p>[\s\S]*<MessageEngagement/,
  );
  assert.doesNotMatch(timeline, /messageReplyButton/);
  assert.match(
    timeline,
    /`\$\{item\.likeCount\} likes\.[\s\S]*`\$\{item\.replyCount\} replies\./,
  );
  assert.match(
    timeline,
    /viewerIsGuest \? \([\s\S]*href=\{loginHref\}[\s\S]*title="Like"[\s\S]*href=\{loginHref\}[\s\S]*title="Reply"/,
  );
  assert.match(
    timeline,
    /aria-busy=\{busy\}[\s\S]*disabled=\{busy\}[\s\S]*onToggleLike\?\.\(item, !item\.isLiked\)/,
  );
  assert.match(
    timeline,
    /item\.likeCount > 0 \? <span>\{item\.likeCount\}<\/span> : null[\s\S]*item\.replyCount > 0 \? <span>\{item\.replyCount\}<\/span> : null/,
  );
  assert.match(
    styles,
    /\.messageEngagementControl\s*\{[\s\S]*color:\s*var\(--sr-color-text-meta\)[\s\S]*font-size:\s*var\(--sr-font-size-xs\)/,
  );
  assert.match(
    styles,
    /\.messageEngagementControl\[data-has-count="false"\]\s*\{[\s\S]*pointer-events:\s*none[\s\S]*opacity:\s*0/,
  );
  assert.match(
    styles,
    /article:hover[\s\S]*article:focus-within[\s\S]*pointer-events:\s*auto[\s\S]*opacity:\s*1/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*\.messageEngagementControl\[data-has-count="false"\]\s*\{[\s\S]*pointer-events:\s*auto[\s\S]*opacity:\s*1/,
  );
  assert.doesNotMatch(
    styles.match(/\.messageEngagementControl\s*\{([^}]*)\}/)?.[1] || "",
    /#[\da-f]{3,8}|font-size:\s*\d/i,
  );

  for (const client of [companyClient, communityClient]) {
    assert.match(client, /messageLikeIdsRef/);
    assert.match(
      client,
      /updateLiveRoomMessageEngagement\(current, message\.id,[\s\S]*message\.likeCount \+ \(liked \? 1 : -1\)/,
    );
    assert.match(
      client,
      /catch \(error\) \{[\s\S]*updateLiveRoomMessageEngagement\([\s\S]*previous/,
    );
    assert.match(client, /loginHref=\{roomLoginHref\}/);
    assert.match(
      client,
      /viewerIsGuest=\{profile\?\.isGuest !== false\}/,
    );
  }
});
