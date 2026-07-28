export const LIVE_ROOM_TIMELINE_STICKY_THRESHOLD_PX = 80;

export type LiveRoomTimelineScrollReason =
  | "incoming"
  | "initial"
  | "older-prepend"
  | "own-send";

type TimelineScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export function getLiveRoomTimelineDistanceFromBottom({
  clientHeight,
  scrollHeight,
  scrollTop,
}: TimelineScrollMetrics) {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function shouldScrollLiveRoomTimelineToBottom(
  reason: LiveRoomTimelineScrollReason,
  distanceFromBottom: number,
) {
  if (reason === "older-prepend") return false;
  if (reason === "initial" || reason === "own-send") return true;
  return distanceFromBottom <= LIVE_ROOM_TIMELINE_STICKY_THRESHOLD_PX;
}

export function preserveLiveRoomTimelinePrependPosition({
  nextScrollHeight,
  previousScrollHeight,
  previousScrollTop,
}: {
  nextScrollHeight: number;
  previousScrollHeight: number;
  previousScrollTop: number;
}) {
  return Math.max(
    0,
    previousScrollTop + nextScrollHeight - previousScrollHeight,
  );
}
