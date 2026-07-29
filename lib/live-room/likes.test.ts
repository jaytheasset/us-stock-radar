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
