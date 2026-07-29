import type { LiveRoomTimelineItem } from "./types.ts";

export function mergeLiveRoomTimeline(
  current: readonly LiveRoomTimelineItem[],
  incoming: readonly LiveRoomTimelineItem[],
) {
  const byId = new Map(
    current.map((item) => [item.id, item] as const),
  );
  incoming.forEach((item) => byId.set(item.id, item));
  return sortLiveRoomTimeline([...byId.values()]);
}

export function removeLiveRoomTimelineItems(
  current: readonly LiveRoomTimelineItem[],
  removedIds: ReadonlySet<string>,
) {
  return current
    .filter((item) => !removedIds.has(item.id))
    .map((item) =>
      item.kind === "message" &&
      item.replyPreview &&
      removedIds.has(item.replyPreview.messageId)
        ? { ...item, replyPreview: null }
        : item,
    );
}

export function replaceLiveRoomTimeline(
  items: readonly LiveRoomTimelineItem[],
) {
  return sortLiveRoomTimeline([...items]);
}

export function updateLiveRoomMessageEngagement(
  items: readonly LiveRoomTimelineItem[],
  messageId: string,
  engagement: { isLiked: boolean; likeCount: number },
) {
  return items.map((item) =>
    item.kind === "message" && item.id === messageId
      ? { ...item, ...engagement }
      : item,
  );
}

export function isCurrentLiveRoomTimelineGeneration(
  currentGeneration: number,
  responseGeneration: number,
) {
  return currentGeneration === responseGeneration;
}

function sortLiveRoomTimeline(items: LiveRoomTimelineItem[]) {
  return items.sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}
