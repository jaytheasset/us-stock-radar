import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_ROOM_MESSAGE_GROUP_WINDOW_MS,
  resolveLiveRoomTimelinePresentation,
} from "./messageGrouping.ts";
import type {
  LiveRoomChatMessage,
  LiveRoomTimelineItem,
} from "./types.ts";

function message({
  createdAt,
  id,
  isMine = false,
  publicProfileId = "member-a",
}: {
  createdAt: string;
  id: string;
  isMine?: boolean;
  publicProfileId?: string;
}): LiveRoomChatMessage {
  return {
    author: {
      avatarUrl: null,
      displayName: "Member",
      emoji: "M",
      isGuest: !publicProfileId,
      plan: "free",
      publicProfileId: publicProfileId || undefined,
    },
    body: id,
    createdAt,
    eventReference: null,
    id,
    isLiked: false,
    isMine,
    kind: "message",
    likeCount: 0,
    replyCount: 0,
    replyPreview: null,
  };
}

const start = Date.parse("2026-08-11T12:00:00.000Z");
const at = (offset: number) => new Date(start + offset).toISOString();

test("adjacent public-member messages group through the five minute boundary", () => {
  const result = resolveLiveRoomTimelinePresentation(
    [
      message({ createdAt: at(0), id: "one" }),
      message({
        createdAt: at(LIVE_ROOM_MESSAGE_GROUP_WINDOW_MS),
        id: "two",
      }),
    ],
    null,
  );

  assert.deepEqual(
    result.map(({ groupPosition, showAvatar, showHeader }) => ({
      groupPosition,
      showAvatar,
      showHeader,
    })),
    [
      { groupPosition: "start", showAvatar: false, showHeader: true },
      { groupPosition: "end", showAvatar: true, showHeader: false },
    ],
  );
});

test("messages outside five minutes, non-message items, and unread boundaries break groups", () => {
  const divider: LiveRoomTimelineItem = {
    createdAt: at(60_000),
    event: {
      detailHref: null,
      eventId: "event",
      kind: "news",
      occurredAt: at(60_000),
      score: null,
      signal: "neutral",
      source: "Fixture",
      title: "Update",
    },
    id: "event",
    kind: "company_update",
  };
  const result = resolveLiveRoomTimelinePresentation(
    [
      message({ createdAt: at(0), id: "one" }),
      message({ createdAt: at(LIVE_ROOM_MESSAGE_GROUP_WINDOW_MS + 1), id: "two" }),
      divider,
      message({ createdAt: at(60_000), id: "three" }),
      message({ createdAt: at(120_000), id: "four" }),
    ],
    "four",
  );

  assert.deepEqual(
    result.map(({ groupPosition }) => groupPosition),
    ["single", "single", null, "single", "single"],
  );
});

test("anonymous non-self messages never group by a shared display name", () => {
  const result = resolveLiveRoomTimelinePresentation(
    [
      message({ createdAt: at(0), id: "one", publicProfileId: "" }),
      message({ createdAt: at(60_000), id: "two", publicProfileId: "" }),
    ],
    null,
  );

  assert.deepEqual(
    result.map(({ groupPosition }) => groupPosition),
    ["single", "single"],
  );
});

test("explicit self messages can group without exposing an actor identifier", () => {
  const result = resolveLiveRoomTimelinePresentation(
    [
      message({ createdAt: at(0), id: "one", isMine: true, publicProfileId: "" }),
      message({ createdAt: at(60_000), id: "two", isMine: true, publicProfileId: "" }),
    ],
    null,
  );

  assert.deepEqual(
    result.map(({ groupPosition }) => groupPosition),
    ["start", "end"],
  );
});
