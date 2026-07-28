import { LiveRoomPolicyError } from "./policy.ts";

export const LIVE_ROOM_POST_COMMENT_BODY_MAX_LENGTH = 2000;
export const LIVE_ROOM_POST_COMMENT_PAGE_SIZE = 50;
export const LIVE_ROOM_POST_COMMENT_PAGE_SIZE_MAX = 100;

export function normalizeLiveRoomPostCommentDraft(value: unknown) {
  const input = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > LIVE_ROOM_POST_COMMENT_BODY_MAX_LENGTH) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_COMMENT",
      `Comments must be between 1 and ${LIVE_ROOM_POST_COMMENT_BODY_MAX_LENGTH} characters.`,
    );
  }
  const parentCommentId =
    typeof input.parentCommentId === "string" && input.parentCommentId.trim()
      ? input.parentCommentId.trim()
      : null;
  return { body, parentCommentId };
}

export function normalizeLiveRoomPostCommentPageLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return LIVE_ROOM_POST_COMMENT_PAGE_SIZE;
  return Math.min(
    LIVE_ROOM_POST_COMMENT_PAGE_SIZE_MAX,
    Math.max(1, Math.floor(parsed)),
  );
}
