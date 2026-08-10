export type LiveRoomAvailabilityStatus =
  | "active"
  | "archived"
  | "locked"
  | "unknown";

export type LiveRoomAvailability = {
  status: LiveRoomAvailabilityStatus;
};

export function isLiveRoomReadOnly(
  availability: LiveRoomAvailability,
) {
  return availability.status !== "active";
}

export function liveRoomReadOnlyMessage(
  availability: LiveRoomAvailability,
) {
  return availability.status === "archived"
    ? "This room is archived. Public history remains readable, but new messages, posts, comments, and joins are disabled."
    : availability.status === "locked"
      ? "This room is locked by the moderation team. Public history remains readable, but new messages, posts, comments, and joins are disabled."
      : availability.status === "unknown"
        ? "Room availability could not be confirmed. Reading may remain available, but new messages, posts, comments, and joins are disabled."
      : null;
}
