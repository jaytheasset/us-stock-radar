import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  selectLiveRoomSidePanelMembers,
} from "./sidePanel.ts";
import type {
  LiveRoomChatMessage,
  LiveRoomPost,
  LiveRoomTimelineItem,
} from "./types.ts";

const projectRoot = process.cwd();

test("side panel members use only real public member authors and deduplicate them", () => {
  const timeline: LiveRoomTimelineItem[] = [
    message({
      createdAt: "2026-07-28T10:00:00.000Z",
      displayName: "Ada",
      id: "message-1",
      isOnline: false,
      publicProfileId: "member-a",
    }),
    message({
      createdAt: "2026-07-28T09:00:00.000Z",
      displayName: "Ada",
      id: "message-2",
      isOnline: true,
      publicProfileId: "member-a",
    }),
    message({
      createdAt: "2026-07-28T11:00:00.000Z",
      displayName: "Guest",
      id: "message-3",
      isGuest: true,
    }),
    message({
      createdAt: "2026-07-28T12:00:00.000Z",
      displayName: "Private member",
      id: "message-4",
    }),
  ];
  const posts = [
    post({
      createdAt: "2026-07-28T08:00:00.000Z",
      displayName: "Ada",
      id: "post-a",
      publicProfileId: "member-a",
    }),
    post({
      createdAt: "2026-07-28T10:30:00.000Z",
      displayName: "Grace",
      id: "post-b",
      publicProfileId: "member-b",
    }),
  ];

  assert.deepEqual(
    selectLiveRoomSidePanelMembers({ posts, timeline }),
    [
      {
        displayName: "Grace",
        emoji: "📈",
        isOnline: false,
        publicProfileId: "member-b",
      },
      {
        displayName: "Ada",
        emoji: "🛰️",
        isOnline: true,
        publicProfileId: "member-a",
      },
    ],
  );
});

test("side panel has accessible tabs, canonical links, and a desktop-only contract", () => {
  const panel = read(
    "components/live-room/LiveRoomDesktopSidePanel.tsx",
  );
  const client = read("components/live-room/LiveRoomClient.tsx");
  const community = read(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const styles = read("components/live-room/LiveRoom.module.css");

  assert.match(panel, /role="tablist"/);
  assert.match(panel, /aria-selected=\{activeTab === tab\.value\}/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /event\.detailHref/);
  assert.match(panel, /\/live\/posts\/\$\{post\.id\}/);
  assert.match(
    panel,
    /\/live\/members\/\$\{member\.publicProfileId\}/,
  );
  assert.match(
    panel,
    /member\.isOnline \? \([\s\S]*?Online[\s\S]*?: \([\s\S]*?"Member"/,
  );
  assert.match(
    styles,
    /\.sidePanelMember small i\s*\{[\s\S]*?background:\s*var\(--sr-color-positive\)/,
  );
  assert.match(client, /onChangeMainTab=\{setActiveTab\}/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]+\.desktopSidePanel[\s\S]+display: none/);
  assert.doesNotMatch(community, /LiveRoomDesktopSidePanel/);
});

function message({
  createdAt,
  displayName,
  id,
  isGuest = false,
  isOnline,
  publicProfileId,
}: {
  createdAt: string;
  displayName: string;
  id: string;
  isGuest?: boolean;
  isOnline?: boolean;
  publicProfileId?: string;
}): LiveRoomChatMessage {
  return {
    author: {
      displayName,
      emoji: "🛰️",
      isGuest,
      plan: "free",
      publicProfileId,
    },
    body: "Side panel test",
    createdAt,
    eventReference: null,
    id,
    isOnline,
    kind: "message",
  };
}

function post({
  createdAt,
  displayName,
  id,
  publicProfileId,
}: {
  createdAt: string;
  displayName: string;
  id: string;
  publicProfileId: string;
}): LiveRoomPost {
  return {
    author: {
      displayName,
      emoji: "📈",
      publicProfileId,
    },
    body: "A sufficiently detailed public post body.",
    canModerate: false,
    createdAt,
    eventReference: null,
    id,
    isMine: false,
    relatedTickers: [],
    room: {
      href: "/live/NVDA",
      kind: "company",
      label: "NVDA",
      ticker: "NVDA",
    },
    title: "Public member post",
    updatedAt: createdAt,
  };
}

function read(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}
