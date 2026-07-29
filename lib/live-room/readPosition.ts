import type { LiveRoomTimelineItem } from "./types.ts";

export function getUnreadMessageIdsThrough(
  items: readonly LiveRoomTimelineItem[],
  firstUnreadMessageId: string | null,
  latestVisibleMessageId: string,
) {
  if (!firstUnreadMessageId) return [];
  let inUnreadRange = false;
  const unreadIds: string[] = [];
  for (const item of items) {
    if (item.kind !== "message") continue;
    if (item.id === firstUnreadMessageId) inUnreadRange = true;
    if (inUnreadRange && item.isMine !== true) {
      unreadIds.push(item.id);
    }
    if (item.id === latestVisibleMessageId) break;
  }
  return unreadIds;
}

export function countIncomingUnreadMessages(
  items: readonly LiveRoomTimelineItem[],
) {
  return items.filter(
    (item) => item.kind === "message" && item.isMine !== true,
  ).length;
}
