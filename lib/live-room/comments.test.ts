import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  normalizeLiveRoomPostCommentDraft,
  normalizeLiveRoomPostCommentPageLimit,
} from "./commentPolicy.ts";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("comment drafts are bounded and replies use an explicit parent ID", () => {
  assert.deepEqual(
    normalizeLiveRoomPostCommentDraft({
      body: "  Useful context for this post.  ",
      parentCommentId: "11111111-1111-4111-8111-111111111111",
    }),
    {
      body: "Useful context for this post.",
      parentCommentId: "11111111-1111-4111-8111-111111111111",
    },
  );
  assert.throws(() =>
    normalizeLiveRoomPostCommentDraft({ body: "   " }),
  );
  assert.throws(() =>
    normalizeLiveRoomPostCommentDraft({ body: "x".repeat(2001) }),
  );
  assert.equal(normalizeLiveRoomPostCommentPageLimit(500), 100);
  assert.equal(normalizeLiveRoomPostCommentPageLimit(0), 1);
});

test("comment migration is canonical, one-level, indexed, and service-only", () => {
  const migration = readSource(
    "docs/db/migration-archive/pre-canonical-baseline/20260728082957_live_room_post_comments.sql",
  );

  assert.match(
    migration,
    /create table public\.live_room_post_comments[\s\S]+post_id uuid not null[\s\S]+references public\.live_room_posts\(id\) on delete cascade/i,
  );
  assert.match(
    migration,
    /parent_comment_id uuid[\s\S]+references public\.live_room_post_comments\(id\) on delete cascade/i,
  );
  assert.match(
    migration,
    /v_parent\.post_id <> new\.post_id[\s\S]+v_parent\.parent_comment_id is not null/i,
  );
  assert.match(
    migration,
    /live_room_post_comments_post_created_idx[\s\S]+post_id, created_at asc, id asc[\s\S]+visibility_status = 'visible'/i,
  );
  assert.match(
    migration,
    /alter table public\.live_room_post_comments enable row level security/i,
  );
  assert.match(migration, /from public, anon, authenticated/gi);
  assert.match(migration, /to service_role/gi);
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /set search_path = ''/gi);
  assert.doesNotMatch(migration, /security definer|create policy/i);
});

test("comment APIs derive the actor, require same-origin writes, and bind comments to the canonical post", () => {
  const listRoute = readSource(
    "app/api/live-room/posts/[postId]/comments/route.ts",
  );
  const itemRoute = readSource(
    "app/api/live-room/posts/[postId]/comments/[commentId]/route.ts",
  );
  const reportRoute = readSource(
    "app/api/live-room/posts/[postId]/comments/[commentId]/reports/route.ts",
  );
  const repository = readSource("lib/live-room/postServerRepository.ts");

  assert.match(listRoute, /resolveLiveRoomActor\(request\)/);
  assert.match(listRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(itemRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(reportRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.doesNotMatch(
    `${listRoute}${itemRoute}${reportRoute}`,
    /authorUserId|ownerUserId|memberUserId/,
  );
  assert.match(
    repository,
    /assertCommentBelongsToPost\(commentId, postId\)/,
  );
  assert.match(
    repository,
    /post_id: `eq\.\$\{postId\}`[\s\S]+visibility_status: "eq\.visible"/,
  );
});

test("comment reads preserve canonical cross-post discussion and safety filters", () => {
  const repository = readSource("lib/live-room/postServerRepository.ts");
  const detail = readSource("components/live-room/PostDetailClient.tsx");
  const comments = readSource("components/live-room/PostComments.tsx");

  assert.match(
    repository,
    /await getLiveRoomPost\(actor, postId\)[\s\S]+getBlockedMemberIds\(actor\)/,
  );
  assert.match(
    repository,
    /search\.author_user_id = `not\.in\.\(\$\{blockedMemberIds\.join\(","\)\}\)`/,
  );
  assert.match(repository, /order: "created_at\.asc,id\.asc"/);
  assert.match(detail, /<PostComments postId=\{post\.id\}/);
  assert.match(comments, /parentCommentId \|\| replyTo\.id/);
  assert.match(comments, /Sign in to join this post discussion/);
  assert.match(comments, /repository\.reportComment/);
});
