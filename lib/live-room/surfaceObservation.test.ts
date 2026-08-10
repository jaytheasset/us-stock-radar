import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { resolveLiveRoomSurfaceObservation } from "./surfaceObservation.ts";

const base = {
  eventSource: "api" as const,
  hasLatestEvent: true,
  mainSection: "chat" as const,
  profileLoaded: true,
  quickPreviewVisible: true,
  roomReadOnly: false,
  sending: false,
  timelineItemCount: 3,
  timelineState: "ready" as const,
};

test("timeline observations preserve ready, empty, loading, and error states", () => {
  const cases = [
    { count: 3, expected: "ready", state: "ready" },
    { count: 0, expected: "empty", state: "empty" },
    { count: 0, expected: "loading", state: "loading" },
    { count: 0, expected: "error", state: "error" },
  ] as const;

  for (const item of cases) {
    const observation = resolveLiveRoomSurfaceObservation({
      ...base,
      timelineItemCount: item.count,
      timelineState: item.state,
    });
    assert.equal(observation.timeline.state, item.expected);
    assert.equal(observation.timeline.itemCount, item.count);
  }
});

test("no update stays distinct from an update source error", () => {
  const noUpdate = resolveLiveRoomSurfaceObservation({
    ...base,
    eventSource: "api",
    hasLatestEvent: false,
  });
  const sourceError = resolveLiveRoomSurfaceObservation({
    ...base,
    eventSource: "error",
    hasLatestEvent: false,
  });
  const retainedUpdate = resolveLiveRoomSurfaceObservation({
    ...base,
    eventSource: "error",
    hasLatestEvent: true,
  });

  assert.equal(noUpdate.latestUpdate, "no-update");
  assert.equal(sourceError.latestUpdate, "source-error");
  assert.equal(retainedUpdate.latestUpdate, "visible");
});

test("composer state exposes the actual disabled reason", () => {
  const cases = [
    {
      expectedReason: "none",
      expectedState: "available",
      input: {},
    },
    {
      expectedReason: "profile-loading",
      expectedState: "loading",
      input: { profileLoaded: false },
    },
    {
      expectedReason: "timeline-loading",
      expectedState: "loading",
      input: { timelineState: "loading" as const },
    },
    {
      expectedReason: "timeline-error",
      expectedState: "unavailable",
      input: { timelineState: "error" as const },
    },
    {
      expectedReason: "room-read-only",
      expectedState: "read-only",
      input: { roomReadOnly: true },
    },
    {
      expectedReason: "sending",
      expectedState: "busy",
      input: { sending: true },
    },
  ] as const;

  for (const item of cases) {
    const observation = resolveLiveRoomSurfaceObservation({
      ...base,
      ...item.input,
    });
    assert.equal(
      observation.composer.disabledReason,
      item.expectedReason,
    );
    assert.equal(observation.composer.state, item.expectedState);
    assert.equal(
      observation.composer.disabled,
      item.expectedReason !== "none",
    );
  }
});

test("quick preview reports the measured desktop or narrow layout", () => {
  const desktop = resolveLiveRoomSurfaceObservation(base);
  const narrow = resolveLiveRoomSurfaceObservation({
    ...base,
    mainSection: "events",
    quickPreviewVisible: false,
  });
  const checking = resolveLiveRoomSurfaceObservation({
    ...base,
    quickPreviewVisible: null,
  });

  assert.equal(desktop.quickPreview, "visible");
  assert.equal(narrow.quickPreview, "hidden-narrow");
  assert.equal(narrow.mainSection, "events");
  assert.equal(checking.quickPreview, "checking");
});

test("the hidden readout and composer use the same surface observation", () => {
  const root = process.cwd();
  const client = readFileSync(
    path.join(root, "components/live-room/LiveRoomClient.tsx"),
    "utf8",
  );
  const styles = readFileSync(
    path.join(root, "components/live-room/LiveRoom.module.css"),
    "utf8",
  );

  assert.match(client, /resolveLiveRoomSurfaceObservation\(/);
  assert.match(
    client,
    /data-live-room-main-section=\{surfaceObservation\.mainSection\}/,
  );
  assert.match(
    client,
    /data-live-room-timeline-state=\{\s*surfaceObservation\.timeline\.state\s*\}/,
  );
  assert.match(
    client,
    /data-live-room-timeline-count=\{\s*surfaceObservation\.timeline\.itemCount\s*\}/,
  );
  assert.match(
    client,
    /data-live-room-latest-update=\{surfaceObservation\.latestUpdate\}/,
  );
  assert.match(
    client,
    /data-live-room-composer-state=\{\s*surfaceObservation\.composer\.state\s*\}/,
  );
  assert.match(
    client,
    /data-live-room-composer-disabled-reason=\{\s*surfaceObservation\.composer\.disabledReason\s*\}/,
  );
  assert.match(
    client,
    /data-live-room-quick-preview=\{surfaceObservation\.quickPreview\}/,
  );
  assert.match(
    client,
    /disabled=\{surfaceObservation\.composer\.disabled\}/,
  );
  assert.match(client, /ref=\{desktopRailRef\}/);
  assert.match(
    styles,
    /@media \(max-width: 1180px\)[\s\S]*\.desktopRail,[\s\S]*display: none;/,
  );
});
