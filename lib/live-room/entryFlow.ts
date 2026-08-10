import type { LiveRoomAvailabilityStatus } from "./roomAvailability.ts";

export type LiveRoomEntryRequestState =
  | { status: "loading" }
  | { resultCount: number; status: "success" }
  | { httpStatus: number | null; status: "error" };

export type LiveRoomEntryStatus =
  | "loading"
  | "unavailable"
  | "permission"
  | "error"
  | "empty"
  | "ready"
  | "unknown";

export type LiveRoomEntryViewerAccess =
  | "checking"
  | "guest"
  | "member-joined"
  | "member-not-joined"
  | "unknown";

export type LiveRoomEntryFlowState = {
  availability: LiveRoomAvailabilityStatus;
  message: string;
  requestStatus: LiveRoomEntryRequestState["status"];
  resultCount: number | null;
  role: "alert" | "status";
  status: LiveRoomEntryStatus;
  viewerAccess: LiveRoomEntryViewerAccess;
};

export function resolveLiveRoomEntryFlowState({
  availability,
  isGuest,
  membershipJoined,
  request,
  surfaceState,
}: {
  availability: LiveRoomAvailabilityStatus;
  isGuest: boolean | null;
  membershipJoined: boolean | null;
  request: LiveRoomEntryRequestState;
  surfaceState: "empty" | "error" | "loading" | "ready";
}): LiveRoomEntryFlowState {
  const resultCount =
    request.status === "success"
      ? Math.max(0, Math.trunc(request.resultCount))
      : null;
  const viewerAccess = resolveViewerAccess({
    isGuest,
    membershipJoined,
    surfaceState,
  });
  const base = {
    availability,
    requestStatus: request.status,
    resultCount,
    viewerAccess,
  };

  if (
    request.status === "error" &&
    (request.httpStatus === 401 || request.httpStatus === 403)
  ) {
    return {
      ...base,
      message:
        "Recent room messages require additional access. This room is not confirmed empty.",
      role: "alert",
      status: "permission",
    };
  }

  if (request.status === "error") {
    return {
      ...base,
      message:
        "Recent room messages could not be confirmed. Retry before treating this room as empty.",
      role: "alert",
      status: "error",
    };
  }

  if (availability === "unknown") {
    return {
      ...base,
      message:
        "Room availability could not be confirmed. Reading may continue, but joining and contributing stay unavailable.",
      role: "status",
      status: "unknown",
    };
  }

  if (availability !== "active") {
    const roomLabel = availability === "archived" ? "Archived" : "Locked";
    const resultLabel =
      resultCount === null
        ? "Recent public history is still being checked."
        : `${formatItemCount(resultCount)} returned from public history.`;
    return {
      ...base,
      message: `${roomLabel} room. ${resultLabel} New activity is unavailable.`,
      role: "status",
      status: "unavailable",
    };
  }

  if (surfaceState === "error") {
    return {
      ...base,
      message:
        resultCount === null
          ? "The room surface did not finish loading, so its entry state is unknown."
          : `${formatItemCount(resultCount)} returned, but the room surface did not finish loading.`,
      role: "status",
      status: "unknown",
    };
  }

  if (
    request.status === "loading" ||
    surfaceState === "loading" ||
    viewerAccess === "checking"
  ) {
    return {
      ...base,
      message: "Checking public room access and recent messages.",
      role: "status",
      status: "loading",
    };
  }

  if (
    request.status === "success" &&
    resultCount === 0 &&
    surfaceState === "empty"
  ) {
    return {
      ...base,
      message: `Public room · 0 recent items. ${formatAccessBoundary(viewerAccess)}`,
      role: "status",
      status: "empty",
    };
  }

  if (
    request.status === "success" &&
    resultCount !== null &&
    resultCount > 0 &&
    surfaceState === "ready"
  ) {
    return {
      ...base,
      message: `Public room · ${formatItemCount(resultCount)}. ${formatAccessBoundary(viewerAccess)}`,
      role: "status",
      status: "ready",
    };
  }

  return {
    ...base,
    message:
      "The recent-message result and visible room state do not agree, so the entry state is unknown.",
    role: "status",
    status: "unknown",
  };
}

function resolveViewerAccess({
  isGuest,
  membershipJoined,
  surfaceState,
}: {
  isGuest: boolean | null;
  membershipJoined: boolean | null;
  surfaceState: "empty" | "error" | "loading" | "ready";
}): LiveRoomEntryViewerAccess {
  if (isGuest === true) return "guest";
  if (isGuest === false && membershipJoined === true) return "member-joined";
  if (isGuest === false && membershipJoined === false) {
    return "member-not-joined";
  }
  return surfaceState === "error" ? "unknown" : "checking";
}

function formatAccessBoundary(access: LiveRoomEntryViewerAccess) {
  if (access === "guest") return "Sign in to join this room.";
  if (access === "member-joined") return "This room is in My Rooms.";
  if (access === "member-not-joined") {
    return "Join the room to add it to My Rooms.";
  }
  return "Membership access is not confirmed.";
}

function formatItemCount(count: number) {
  return `${count} recent ${count === 1 ? "item" : "items"}`;
}
