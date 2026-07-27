import type { LiveRoomSocialBadge } from "./types.ts";

export const LIVE_ROOM_SOCIAL_BADGE_MAX_MESSAGE_IDS = 100;
export const LIVE_ROOM_SOCIAL_BADGE_RPC_CHUNK_SIZE = 50;

export type LiveRoomSocialBadgeEntry = LiveRoomSocialBadge & {
  messageId: string;
};

export function chunkLiveRoomSocialBadgeMessageIds(
  messageIds: readonly string[],
) {
  const boundedIds = [
    ...new Set(messageIds.filter(Boolean)),
  ].slice(0, LIVE_ROOM_SOCIAL_BADGE_MAX_MESSAGE_IDS);
  const chunks: string[][] = [];

  for (
    let index = 0;
    index < boundedIds.length;
    index += LIVE_ROOM_SOCIAL_BADGE_RPC_CHUNK_SIZE
  ) {
    chunks.push(
      boundedIds.slice(
        index,
        index + LIVE_ROOM_SOCIAL_BADGE_RPC_CHUNK_SIZE,
      ),
    );
  }

  return chunks;
}

export function mergeLiveRoomSocialBadgeEntries(
  entryBatches: readonly (readonly LiveRoomSocialBadgeEntry[])[],
) {
  const map = new Map<string, LiveRoomSocialBadge[]>();

  for (const entries of entryBatches) {
    for (const entry of entries) {
      const badges = map.get(entry.messageId) || [];
      badges.push({
        label: entry.label,
        platform: entry.platform,
        profileUrl: entry.profileUrl,
      });
      map.set(entry.messageId, badges);
    }
  }

  return map;
}
