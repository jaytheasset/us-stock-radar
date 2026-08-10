import type {
  LiveRoomChatMessage,
  LiveRoomTimelineItem,
} from "./types";

export const LIVE_ROOM_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1_000;

export type LiveRoomMessageGroupPosition =
  | "end"
  | "middle"
  | "single"
  | "start";

export type LiveRoomTimelinePresentationItem = {
  groupPosition: LiveRoomMessageGroupPosition | null;
  item: LiveRoomTimelineItem;
  showAvatar: boolean;
  showHeader: boolean;
};

function getStableMessageGroupKey(message: LiveRoomChatMessage) {
  if (message.isMine === true) return "self";

  const publicProfileId = message.author.publicProfileId?.trim();
  return publicProfileId ? `member:${publicProfileId}` : null;
}

function canGroupMessages(
  previous: LiveRoomChatMessage,
  current: LiveRoomChatMessage,
) {
  const previousKey = getStableMessageGroupKey(previous);
  const currentKey = getStableMessageGroupKey(current);
  if (!previousKey || previousKey !== currentKey) return false;

  const previousTime = Date.parse(previous.createdAt);
  const currentTime = Date.parse(current.createdAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }

  const distance = currentTime - previousTime;
  return distance >= 0 && distance <= LIVE_ROOM_MESSAGE_GROUP_WINDOW_MS;
}

export function resolveLiveRoomTimelinePresentation(
  items: readonly LiveRoomTimelineItem[],
  firstUnreadMessageId: string | null,
): LiveRoomTimelinePresentationItem[] {
  return items.map((item, index) => {
    if (item.kind !== "message") {
      return {
        groupPosition: null,
        item,
        showAvatar: false,
        showHeader: false,
      };
    }

    const previous = items[index - 1];
    const next = items[index + 1];
    const joinsPrevious =
      item.id !== firstUnreadMessageId &&
      previous?.kind === "message" &&
      canGroupMessages(previous, item);
    const joinsNext =
      next?.kind === "message" &&
      next.id !== firstUnreadMessageId &&
      canGroupMessages(item, next);

    const groupPosition = joinsPrevious
      ? joinsNext
        ? "middle"
        : "end"
      : joinsNext
        ? "start"
        : "single";

    return {
      groupPosition,
      item,
      showAvatar: groupPosition === "end" || groupPosition === "single",
      showHeader: groupPosition === "start" || groupPosition === "single",
    };
  });
}
