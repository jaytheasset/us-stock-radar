import type {
  LiveRoomPost,
  LiveRoomTimelineItem,
} from "./types.ts";

export const LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT = 4;

export type LiveRoomSidePanelMember = {
  displayName: string;
  emoji: string;
  isOnline: boolean;
  publicProfileId: string;
};

type MemberCandidate = LiveRoomSidePanelMember & {
  createdAt: string;
};

export function selectLiveRoomSidePanelMembers({
  limit = LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT,
  posts,
  timeline,
}: {
  limit?: number;
  posts: readonly LiveRoomPost[];
  timeline: readonly LiveRoomTimelineItem[];
}): LiveRoomSidePanelMember[] {
  const candidates: MemberCandidate[] = [];

  for (const item of timeline) {
    if (
      item.kind !== "message" ||
      item.author.isGuest ||
      !item.author.publicProfileId
    ) {
      continue;
    }
    candidates.push({
      createdAt: item.createdAt,
      displayName: item.author.displayName,
      emoji: item.author.emoji,
      isOnline: item.isOnline === true,
      publicProfileId: item.author.publicProfileId,
    });
  }

  for (const post of posts) {
    candidates.push({
      createdAt: post.createdAt,
      displayName: post.author.displayName,
      emoji: post.author.emoji,
      isOnline: false,
      publicProfileId: post.author.publicProfileId,
    });
  }

  candidates.sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );

  const members = new Map<string, LiveRoomSidePanelMember>();
  for (const candidate of candidates) {
    const current = members.get(candidate.publicProfileId);
    if (current) {
      if (candidate.isOnline && !current.isOnline) {
        members.set(candidate.publicProfileId, {
          ...current,
          isOnline: true,
        });
      }
      continue;
    }
    members.set(candidate.publicProfileId, {
      displayName: candidate.displayName,
      emoji: candidate.emoji,
      isOnline: candidate.isOnline,
      publicProfileId: candidate.publicProfileId,
    });
  }

  return [...members.values()].slice(0, Math.max(0, limit));
}
