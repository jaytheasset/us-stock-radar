import type {
  LiveRoomPost,
  LiveRoomTimelineItem,
} from "./types.ts";

export const LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT = 4;

export type LiveRoomSidePanelMember = {
  canFollowMember: boolean;
  canMessageMember: boolean;
  displayName: string;
  emoji: string;
  isMemberFollowed: boolean;
  isOnline: boolean;
  publicProfileId: string;
  sourceMessageId: string | null;
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
      canFollowMember: item.canFollowMember === true,
      canMessageMember: item.canMessageMember === true,
      displayName: item.author.displayName,
      emoji: item.author.emoji,
      isMemberFollowed: item.isMemberFollowed === true,
      isOnline: item.isOnline === true,
      publicProfileId: item.author.publicProfileId,
      sourceMessageId: item.id,
    });
  }

  for (const post of posts) {
    candidates.push({
      createdAt: post.createdAt,
      canFollowMember: false,
      canMessageMember: false,
      displayName: post.author.displayName,
      emoji: post.author.emoji,
      isMemberFollowed: false,
      isOnline: false,
      publicProfileId: post.author.publicProfileId,
      sourceMessageId: null,
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
      members.set(candidate.publicProfileId, {
        ...current,
        canFollowMember:
          current.canFollowMember || candidate.canFollowMember,
        canMessageMember:
          current.canMessageMember || candidate.canMessageMember,
        isMemberFollowed:
          current.sourceMessageId !== null
            ? current.isMemberFollowed
            : candidate.isMemberFollowed,
        isOnline: current.isOnline || candidate.isOnline,
        sourceMessageId:
          current.sourceMessageId || candidate.sourceMessageId,
      });
      continue;
    }
    members.set(candidate.publicProfileId, {
      canFollowMember: candidate.canFollowMember,
      canMessageMember: candidate.canMessageMember,
      displayName: candidate.displayName,
      emoji: candidate.emoji,
      isMemberFollowed: candidate.isMemberFollowed,
      isOnline: candidate.isOnline,
      publicProfileId: candidate.publicProfileId,
      sourceMessageId: candidate.sourceMessageId,
    });
  }

  return [...members.values()].slice(0, Math.max(0, limit));
}
