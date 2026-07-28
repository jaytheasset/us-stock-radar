export const LIVE_ROOM_REPLY_PREVIEW_MAX_LENGTH = 140;

export function createLiveRoomReplyBodyPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= LIVE_ROOM_REPLY_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, LIVE_ROOM_REPLY_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}
