import type {
  CompanyEvent,
  LiveRoomChatMessage,
} from "./types";

const PUBLIC_FIXTURE_AUTHOR: LiveRoomChatMessage["author"] = {
  avatarUrl: null,
  displayName: "Avery Chen",
  emoji: "AC",
  isGuest: false,
  plan: "advanced",
  publicProfileId: "fixture-avery-chen",
  socialBadges: [],
};

const ANONYMOUS_FIXTURE_AUTHOR: LiveRoomChatMessage["author"] = {
  avatarUrl: null,
  displayName: "Guest",
  emoji: "G",
  isGuest: true,
  plan: "free",
  socialBadges: [],
};

function fixtureMessage({
  author,
  body,
  createdAt,
  id,
}: {
  author: LiveRoomChatMessage["author"];
  body: string;
  createdAt: string;
  id: string;
}): LiveRoomChatMessage {
  return {
    author,
    body,
    createdAt,
    eventReference: null,
    id,
    isLiked: false,
    isMine: false,
    kind: "message",
    likeCount: 0,
    replyCount: 0,
    replyPreview: null,
  };
}

export const LIVE_ROOM_VISUAL_FIXTURE_MESSAGES = [
  fixtureMessage({
    author: PUBLIC_FIXTURE_AUTHOR,
    body: "The opening move is holding above the first support area.",
    createdAt: "2026-08-11T14:00:00.000Z",
    id: "fixture-public-start",
  }),
  fixtureMessage({
    author: PUBLIC_FIXTURE_AUTHOR,
    body: "Volume is calmer now, so I am watching the next confirmation.",
    createdAt: "2026-08-11T14:02:00.000Z",
    id: "fixture-public-middle",
  }),
  fixtureMessage({
    author: PUBLIC_FIXTURE_AUTHOR,
    body: "I would still keep risk defined around the earlier range.",
    createdAt: "2026-08-11T14:04:00.000Z",
    id: "fixture-public-end",
  }),
  fixtureMessage({
    author: PUBLIC_FIXTURE_AUTHOR,
    body: "This later note must begin a separate message group.",
    createdAt: "2026-08-11T14:10:01.000Z",
    id: "fixture-public-later",
  }),
  fixtureMessage({
    author: ANONYMOUS_FIXTURE_AUTHOR,
    body: "Anonymous fixture message one remains separate.",
    createdAt: "2026-08-11T14:11:00.000Z",
    id: "fixture-anonymous-one",
  }),
  fixtureMessage({
    author: ANONYMOUS_FIXTURE_AUTHOR,
    body: "Anonymous fixture message two also remains separate.",
    createdAt: "2026-08-11T14:12:00.000Z",
    id: "fixture-anonymous-two",
  }),
] satisfies readonly LiveRoomChatMessage[];

export const LIVE_ROOM_VISUAL_FIXTURE_LINKED_EVENT = {
  detailHref: "/development/live-room-visual-fixture#linked-update",
  eventId: "fixture-linked-update",
  kind: "news",
  occurredAt: "2026-08-11T13:40:00.000Z",
  score: 82,
  signal: "volatile",
  source: "Local visual fixture",
  title: "Linked pinned update presentation fixture",
} satisfies CompanyEvent;

export const LIVE_ROOM_VISUAL_FIXTURE_STATIC_EVENT = {
  detailHref: null,
  eventId: "fixture-static-update",
  kind: "filing",
  occurredAt: "2026-08-11T13:30:00.000Z",
  score: 61,
  signal: "neutral",
  source: "Local visual fixture",
  title: "Static pinned update without a detail link",
} satisfies CompanyEvent;
