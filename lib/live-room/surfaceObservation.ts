import type { CompanyEventSource } from "./types.ts";

export type LiveRoomSurfaceMainSection = "chat" | "events" | "posts";
export type LiveRoomSurfaceTimelineState =
  | "empty"
  | "error"
  | "loading"
  | "ready";
export type LiveRoomLatestUpdateState =
  | "loading"
  | "no-update"
  | "source-error"
  | "visible";
export type LiveRoomComposerState =
  | "available"
  | "busy"
  | "loading"
  | "read-only"
  | "unavailable";
export type LiveRoomComposerDisabledReason =
  | "none"
  | "profile-loading"
  | "room-read-only"
  | "sending"
  | "timeline-error"
  | "timeline-loading";
export type LiveRoomQuickPreviewState =
  | "checking"
  | "hidden-narrow"
  | "visible";

export type LiveRoomSurfaceObservation = {
  composer: {
    disabled: boolean;
    disabledReason: LiveRoomComposerDisabledReason;
    state: LiveRoomComposerState;
  };
  latestUpdate: LiveRoomLatestUpdateState;
  mainSection: LiveRoomSurfaceMainSection;
  message: string;
  quickPreview: LiveRoomQuickPreviewState;
  timeline: {
    itemCount: number;
    state: LiveRoomSurfaceTimelineState;
  };
};

export function resolveLiveRoomSurfaceObservation({
  eventSource,
  hasLatestEvent,
  mainSection,
  profileLoaded,
  quickPreviewVisible,
  roomReadOnly,
  sending,
  timelineItemCount,
  timelineState,
}: {
  eventSource: CompanyEventSource;
  hasLatestEvent: boolean;
  mainSection: LiveRoomSurfaceMainSection;
  profileLoaded: boolean;
  quickPreviewVisible: boolean | null;
  roomReadOnly: boolean;
  sending: boolean;
  timelineItemCount: number;
  timelineState: LiveRoomSurfaceTimelineState;
}): LiveRoomSurfaceObservation {
  const itemCount = Number.isFinite(timelineItemCount)
    ? Math.max(0, Math.trunc(timelineItemCount))
    : 0;
  const latestUpdate = resolveLatestUpdateState({
    eventSource,
    hasLatestEvent,
  });
  const composer = resolveComposerState({
    profileLoaded,
    roomReadOnly,
    sending,
    timelineState,
  });
  const quickPreview =
    quickPreviewVisible === null
      ? "checking"
      : quickPreviewVisible
        ? "visible"
        : "hidden-narrow";
  const message =
    `Live Room surface: ${mainSection}; timeline ${timelineState} with ` +
    `${itemCount} rendered ${itemCount === 1 ? "item" : "items"}; ` +
    `latest update ${latestUpdate}; composer ${composer.state}; ` +
    `quick preview ${quickPreview}.`;

  return {
    composer,
    latestUpdate,
    mainSection,
    message,
    quickPreview,
    timeline: {
      itemCount,
      state: timelineState,
    },
  };
}

function resolveLatestUpdateState({
  eventSource,
  hasLatestEvent,
}: {
  eventSource: CompanyEventSource;
  hasLatestEvent: boolean;
}): LiveRoomLatestUpdateState {
  if (hasLatestEvent) return "visible";
  if (eventSource === "loading") return "loading";
  if (eventSource === "error") return "source-error";
  return "no-update";
}

function resolveComposerState({
  profileLoaded,
  roomReadOnly,
  sending,
  timelineState,
}: {
  profileLoaded: boolean;
  roomReadOnly: boolean;
  sending: boolean;
  timelineState: LiveRoomSurfaceTimelineState;
}): LiveRoomSurfaceObservation["composer"] {
  if (roomReadOnly) {
    return {
      disabled: true,
      disabledReason: "room-read-only",
      state: "read-only",
    };
  }
  if (!profileLoaded) {
    return {
      disabled: true,
      disabledReason: "profile-loading",
      state: "loading",
    };
  }
  if (timelineState === "loading") {
    return {
      disabled: true,
      disabledReason: "timeline-loading",
      state: "loading",
    };
  }
  if (timelineState === "error") {
    return {
      disabled: true,
      disabledReason: "timeline-error",
      state: "unavailable",
    };
  }
  if (sending) {
    return {
      disabled: true,
      disabledReason: "sending",
      state: "busy",
    };
  }
  return {
    disabled: false,
    disabledReason: "none",
    state: "available",
  };
}
