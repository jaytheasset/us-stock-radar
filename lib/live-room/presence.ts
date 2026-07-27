import type {
  LiveRoomPresenceSummary,
  LiveRoomTimelineItem,
} from "./types.ts";

export const LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS = 50_000;
export const LIVE_ROOM_PRESENCE_MESSAGE_LIMIT = 50;

export function shouldRunLiveRoomPresence({
  documentVisible,
  isGuest,
  showPresence,
}: {
  documentVisible: boolean;
  isGuest: boolean | null;
  showPresence: boolean | null;
}) {
  return documentVisible && isGuest === false && showPresence === true;
}

export function getLiveRoomPresenceMessageIds(
  items: readonly LiveRoomTimelineItem[],
) {
  return items
    .filter(
      (item) =>
        item.kind === "message" && item.author.isGuest === false,
    )
    .slice(-LIVE_ROOM_PRESENCE_MESSAGE_LIMIT)
    .map((item) => item.id);
}

export function applyLiveRoomPresence(
  items: readonly LiveRoomTimelineItem[],
  summary: LiveRoomPresenceSummary,
): LiveRoomTimelineItem[] {
  const onlineByMessageId = new Map(
    summary.messages.map((message) => [
      message.messageId,
      message.isOnline,
    ]),
  );

  return items.map((item) =>
    item.kind === "message" && !item.author.isGuest
      ? {
          ...item,
          isOnline: onlineByMessageId.get(item.id) === true,
        }
      : item,
  );
}

export function clearLiveRoomPresence(
  items: readonly LiveRoomTimelineItem[],
): LiveRoomTimelineItem[] {
  return items.map((item) =>
    item.kind === "message" && item.isOnline !== undefined
      ? { ...item, isOnline: false }
      : item,
  );
}
