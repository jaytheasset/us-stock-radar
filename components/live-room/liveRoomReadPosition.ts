import type { LiveRoomTimelineItem } from "@/lib/live-room/types";

export function getLatestVisibleLiveRoomMessageId(
  container: HTMLElement,
  items: readonly LiveRoomTimelineItem[],
) {
  const viewport = container.getBoundingClientRect();
  let latestId: string | null = null;
  for (const item of items) {
    if (item.kind !== "message") continue;
    const element = document.getElementById(
      `live-room-message-${item.id}`,
    );
    if (!element || !container.contains(element)) continue;
    const bounds = element.getBoundingClientRect();
    if (
      bounds.bottom > viewport.top &&
      bounds.top < viewport.bottom
    ) {
      latestId = item.id;
    }
  }
  return latestId;
}
