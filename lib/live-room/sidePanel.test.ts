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
      canFollowMember: true,
      isMemberFollowed: true,
      isOnline: false,
      publicProfileId: "member-a",
    }),
    message({
      createdAt: "2026-07-28T09:00:00.000Z",
      displayName: "Ada",
      id: "message-2",
      canMessageMember: true,
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
        canFollowMember: false,
        canMessageMember: false,
        displayName: "Grace",
        emoji: "📈",
        isMemberFollowed: false,
        isOnline: false,
        publicProfileId: "member-b",
        sourceMessageId: null,
      },
      {
        canFollowMember: true,
        canMessageMember: true,
        displayName: "Ada",
        emoji: "🛰️",
        isMemberFollowed: true,
        isOnline: true,
        publicProfileId: "member-a",
        sourceMessageId: "message-1",
      },
    ],
  );
});

test("desktop and mobile members share accessible links, status, and actions", () => {
  const panel = read(
    "components/live-room/LiveRoomDesktopSidePanel.tsx",
  );
  const client = read("components/live-room/LiveRoomClient.tsx");
  const community = read(
    "components/live-room/CommunityRoomClient.tsx",
  );
  const styles = read("components/live-room/LiveRoom.module.css");
  const tabStyles = read("components/live-room/Posts.module.css");
  const tabs = read("components/live-room/RoomTabs.tsx");

  assert.match(panel, /role="tablist"/);
  assert.match(panel, /aria-selected=\{activeTab === tab\.value\}/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(
    styles,
    /\.sidePanelTabs button\s*\{[^}]*border-bottom:\s*2px solid transparent;[^}]*border-radius:\s*0;/,
  );
  assert.match(
    styles,
    /\.sidePanelTabs \.activeSidePanelTab\s*\{[^}]*border-bottom-color:\s*var\(--sr-color-accent-text\);/,
  );
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
    /\.sidePanelMemberProfile small i\s*\{[\s\S]*?background:\s*var\(--sr-color-positive\)/,
  );
  assert.match(client, /onChangeMainTab=\{handleDesktopTabChange\}/);
  assert.match(panel, /className=\{styles\.sidePanelMemberProfile\}/);
  assert.match(panel, /className=\{styles\.sidePanelMemberActions\}/);
  assert.match(panel, /onToggleMemberFollow\([\s\S]*?sourceMessageId/);
  assert.match(panel, /onMessageMember\(sourceMessageId\)/);
  assert.match(panel, /aria-pressed=\{member\.isMemberFollowed\}/);
  assert.match(client, /onMessageMember=\{handleMessageMember\}/);
  assert.match(client, /onToggleMemberFollow=\{handleMemberFollow\}/);
  assert.match(panel, /export function LiveRoomMemberList/);
  assert.match(panel, /<LiveRoomMemberList[\s\S]*members=\{members\}/);
  assert.match(
    client,
    /active=\{mobileSheet \?\? "chat"\}[\s\S]*controlsId: "live-room-members-sheet"[\s\S]*label: "Members"[\s\S]*value: "members"[\s\S]*visibility="mobile"/,
  );
  assert.match(
    client,
    /mobileSheet === "members"[\s\S]*<LiveRoomMemberList[\s\S]*members=\{members\}[\s\S]*onMessageMember=\{handleMobileMessageMember\}[\s\S]*onToggleMemberFollow=\{handleMemberFollow\}/,
  );
  assert.match(
    client,
    /const handleMobileMessageMember = async \(messageId: string\) => \{[\s\S]*setMobileSheet\(null\);[\s\S]*setActiveTab\("chat"\);[\s\S]*await handleMessageMember\(messageId\)/,
  );
  assert.equal(
    client.match(/onMessageMember=\{handleMessageMember\}/g)?.length,
    2,
  );
  assert.match(
    client,
    /selectLiveRoomSidePanelMembers\(\{ posts, timeline \}\)/,
  );
  assert.match(
    panel,
    /<\/Link>\s*\{isGuest \|\|\s*\(sourceMessageId &&\s*\(member\.canFollowMember \|\| member\.canMessageMember\)\)/,
  );
  assert.match(
    panel,
    /isGuest \? \([\s\S]*href=\{loginHref\}[\s\S]*Follow[\s\S]*href=\{loginHref\}[\s\S]*Message/,
  );
  assert.match(
    panel,
    /!isGuest && member\.canFollowMember && sourceMessageId/,
  );
  assert.match(
    panel,
    /!isGuest && member\.canMessageMember && sourceMessageId/,
  );
  assert.match(
    client,
    /const roomLoginHref = createLiveRoomMemberLoginHref\(\s*`\/live\/\$\{ticker\}`/,
  );
  assert.equal(
    client.match(/isGuest=\{profile\?\.isGuest === true\}/g)?.length,
    2,
  );
  assert.match(
    client,
    /<LiveRoomDesktopSidePanel[\s\S]*?loginHref=\{roomLoginHref\}[\s\S]*?\/>/,
  );
  assert.match(
    client,
    /mobileSheet === "members"[\s\S]*?<LiveRoomMemberList[\s\S]*?loginHref=\{roomLoginHref\}[\s\S]*?\/>/,
  );
  assert.match(
    styles,
    /\.sidePanelMemberActions a,\s*\.sidePanelMemberActions button\s*\{/,
  );
  assert.match(tabs, /"--live-room-mobile-tab-count": items\.length/);
  assert.match(
    tabStyles,
    /\.tabs\.mobileDock\s*\{[\s\S]*repeat\(var\(--live-room-mobile-tab-count, 3\), minmax\(0, 1fr\)\)/,
  );
  assert.match(tabStyles, /\.tabs\.mobileOnlyTabs\s*\{[\s\S]*display:\s*none/);
  assert.match(
    tabStyles,
    /@media \(max-width: 760px\)[\s\S]*\.tabs\.mobileOnlyTabs\s*\{[\s\S]*display:\s*grid/,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\)[\s\S]*?\.sidePanelMember\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*var\(--sr-space-1-5\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\)[\s\S]*?\.sidePanelMemberProfile\s*\{\s*min-width:\s*0;\s*flex:\s*1 1 auto;\s*gap:\s*var\(--sr-space-2\);\s*padding:\s*var\(--sr-space-1-5\) var\(--sr-space-1\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\)[\s\S]*?\.sidePanelMemberActions\s*\{\s*min-width:\s*0;\s*flex:\s*0 0 auto;\s*gap:\s*var\(--sr-space-1\);\s*padding:\s*0 var\(--sr-space-1\) 0 0;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\)[\s\S]*?\.sidePanelMemberActions a,\s*\.sidePanelMemberActions button\s*\{\s*height:\s*28px;\s*flex:\s*0 0 auto;\s*gap:\s*var\(--sr-space-1\);\s*padding:\s*0 var\(--sr-space-1-5\);/,
  );
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]+\.desktopSidePanel[\s\S]+display: none/);
  assert.doesNotMatch(community, /LiveRoomDesktopSidePanel/);
  assert.doesNotMatch(community, /label: "Members"/);
});

function message({
  canFollowMember = false,
  canMessageMember = false,
  createdAt,
  displayName,
  id,
  isGuest = false,
  isMemberFollowed = false,
  isOnline,
  publicProfileId,
}: {
  canFollowMember?: boolean;
  canMessageMember?: boolean;
  createdAt: string;
  displayName: string;
  id: string;
  isGuest?: boolean;
  isMemberFollowed?: boolean;
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
    canFollowMember,
    canMessageMember,
    createdAt,
    eventReference: null,
    id,
    isMemberFollowed,
    isOnline,
    kind: "message",
    replyPreview: null,
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
    canLike: true,
    canModerate: false,
    commentCount: 0,
    createdAt,
    eventReference: null,
    id,
    isLiked: false,
    isMine: false,
    likeCount: 0,
    relatedTickers: [],
    room: {
      href: "/live/NVDA",
      kind: "company",
      label: "NVDA",
      ticker: "NVDA",
    },
    signalLabels: [],
    title: "Public member post",
    updatedAt: createdAt,
  };
}

function read(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}
