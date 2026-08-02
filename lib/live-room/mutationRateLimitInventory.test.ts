import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const serverRepository = read("lib/live-room/serverRepository.ts");
const postRepository = read("lib/live-room/postServerRepository.ts");
const memberRepository = read("lib/live-room/memberActionServerRepository.ts");
const communityHubRepository = read("lib/community-hub/serverRepository.ts");
const directMessageRepository = read("lib/direct-messages/serverRepository.ts");

test("room follows converge on the rate-limited membership boundary", () => {
  assertFunctionContains(
    serverRepository,
    "updateLiveRoomMembership",
    /assertLiveRoomMutationRateLimit\(actor, "follow"\)[\s\S]*supabaseRpc\("set_live_room_membership"/,
  );
  assertFunctionContains(
    serverRepository,
    "updateLiveRoomFollow",
    /updateLiveRoomMembership\(/,
  );
  assertFunctionContains(
    serverRepository,
    "updateCommunityRoomFollow",
    /updateLiveRoomMembership\(/,
  );
});

test("company and community message likes and reports consume one shared bucket", () => {
  assertFunctionContains(
    serverRepository,
    "setLiveRoomMessageLike",
    /assertLiveRoomMutationRateLimit\(actor, "like"\)[\s\S]*supabaseRpc\("set_live_room_message_like"/,
  );
  assertFunctionContains(
    serverRepository,
    "reportLiveRoomMessage",
    /assertLiveRoomMutationRateLimit\(actor, "report"\)[\s\S]*supabaseRpc\("report_live_room_message"/,
  );
});

test("post like and post/comment reports consume the matching bucket", () => {
  assertFunctionContains(
    postRepository,
    "toggleLiveRoomPostLike",
    /assertLiveRoomMutationRateLimit\(actor, "like"\)[\s\S]*supabaseRpc\("toggle_live_room_post_like"/,
  );
  assertFunctionContains(
    postRepository,
    "reportLiveRoomPost",
    /assertLiveRoomMutationRateLimit\(actor, "report"\)[\s\S]*supabaseRpc\("report_live_room_post"/,
  );
  assertFunctionContains(
    postRepository,
    "reportLiveRoomPostComment",
    /assertLiveRoomMutationRateLimit\(actor, "report"\)[\s\S]*supabaseRpc\("report_live_room_post_comment"/,
  );
});

test("all member-follow entry points consume the follow bucket", () => {
  assertFunctionContains(
    serverRepository,
    "updateLiveRoomMemberFollow",
    /assertLiveRoomMutationRateLimit\(actor, "follow"\)[\s\S]*supabaseRpc\("set_live_room_member_follow"/,
  );
  assertFunctionContains(
    memberRepository,
    "updateLiveRoomPublicMemberFollow",
    /assertLiveRoomMutationRateLimit\(actor, "follow"\)[\s\S]*supabaseRpc\("set_live_room_member_follow"/,
  );
  assertFunctionContains(
    communityHubRepository,
    "setCommunityHubMemberFollow",
    /assertLiveRoomMutationRateLimit\(actor, "follow"\)[\s\S]*supabaseRpc\([\s\S]*"set_live_room_member_follow_by_profile"/,
  );
});

test("direct-message reports consume the report bucket", () => {
  assertFunctionContains(
    directMessageRepository,
    "reportDirectMessage",
    /assertLiveRoomMutationRateLimit\(actor, "report"\)[\s\S]*supabaseRpc\([\s\S]*"report_live_room_direct_message"/,
  );
});

function assertFunctionContains(
  source: string,
  functionName: string,
  contract: RegExp,
) {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.ok(start >= 0, `${functionName} is missing`);
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next >= 0 ? next : undefined);
  assert.match(body, contract, functionName);
}
