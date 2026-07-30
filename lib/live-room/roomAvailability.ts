export type LiveRoomAvailabilityStatus = "active" | "archived" | "locked";

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
      : null;
}
