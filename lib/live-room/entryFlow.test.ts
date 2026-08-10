import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { resolveLiveRoomEntryFlowState } from "./entryFlow.ts";
import {
  isLiveRoomReadOnly,
  liveRoomReadOnlyMessage,
} from "./roomAvailability.ts";

const activeGuestEmpty = {
  availability: "active" as const,
  isGuest: true,
  membershipJoined: false,
  request: { resultCount: 0, status: "success" as const },
  surfaceState: "empty" as const,
};

test("a confirmed public zero-result response is the normal empty state", () => {
  const state = resolveLiveRoomEntryFlowState(activeGuestEmpty);

  assert.equal(state.status, "empty");
  assert.equal(state.requestStatus, "success");
  assert.equal(state.resultCount, 0);
  assert.equal(state.viewerAccess, "guest");
  assert.match(state.message, /0 recent items/);
  assert.match(state.message, /Sign in to join this room/);
});

test("signed-in reading stays distinct from joined room membership", () => {
  const state = resolveLiveRoomEntryFlowState({
    availability: "active",
    isGuest: false,
    membershipJoined: false,
    request: { resultCount: 2, status: "success" },
    surfaceState: "ready",
  });

  assert.equal(state.status, "ready");
  assert.equal(state.viewerAccess, "member-not-joined");
  assert.equal(state.resultCount, 2);
  assert.match(state.message, /Join the room to add it to My Rooms/);
});

test("non-active availability stays distinct from an empty active room", () => {
  const state = resolveLiveRoomEntryFlowState({
    ...activeGuestEmpty,
    availability: "archived",
  });

  assert.equal(state.status, "unavailable");
  assert.equal(state.availability, "archived");
  assert.equal(state.resultCount, 0);
  assert.match(state.message, /Archived room/);
  assert.match(state.message, /New activity is unavailable/);
});

test("request permission boundaries are not reported as empty", () => {
  const state = resolveLiveRoomEntryFlowState({
    ...activeGuestEmpty,
    request: { httpStatus: 403, status: "error" },
    surfaceState: "error",
  });

  assert.equal(state.status, "permission");
  assert.equal(state.resultCount, null);
  assert.equal(state.role, "alert");
  assert.match(state.message, /not confirmed empty/);
});

test("request failures keep their result count unknown", () => {
  const state = resolveLiveRoomEntryFlowState({
    ...activeGuestEmpty,
    request: { httpStatus: null, status: "error" },
    surfaceState: "error",
  });

  assert.equal(state.status, "error");
  assert.equal(state.resultCount, null);
  assert.match(state.message, /Retry before treating this room as empty/);
});

test("unconfirmed availability is an unknown safe read-only state", () => {
  const state = resolveLiveRoomEntryFlowState({
    ...activeGuestEmpty,
    availability: "unknown",
  });

  assert.equal(state.status, "unknown");
  assert.equal(state.availability, "unknown");
  assert.match(state.message, /availability could not be confirmed/);
  assert.equal(isLiveRoomReadOnly({ status: "unknown" }), true);
  assert.match(
    liveRoomReadOnlyMessage({ status: "unknown" }) || "",
    /joins are disabled/,
  );
});

test("a successful count that disagrees with the surface stays unknown", () => {
  const state = resolveLiveRoomEntryFlowState({
    ...activeGuestEmpty,
    surfaceState: "ready",
  });

  assert.equal(state.status, "unknown");
  assert.equal(state.requestStatus, "success");
  assert.equal(state.resultCount, 0);
  assert.match(state.message, /do not agree/);
});

test("the rendered copy and safe DOM observations use the same resolver", () => {
  const root = process.cwd();
  const client = readFileSync(
    path.join(root, "components/live-room/LiveRoomClient.tsx"),
    "utf8",
  );
  const availabilityServer = readFileSync(
    path.join(root, "lib/live-room/roomAvailabilityServer.ts"),
    "utf8",
  );
  const styles = readFileSync(
    path.join(root, "components/live-room/LiveRoom.module.css"),
    "utf8",
  );

  assert.match(client, /resolveLiveRoomEntryFlowState\(/);
  assert.match(
    client,
    /data-live-room-entry-state=\{entryFlow\.status\}/,
  );
  assert.match(
    client,
    /data-live-room-result-count=\{entryFlow\.resultCount \?\? "unknown"\}/,
  );
  assert.match(
    client,
    /data-live-room-availability=\{entryFlow\.availability\}/,
  );
  assert.match(
    client,
    /data-live-room-viewer-access=\{entryFlow\.viewerAccess\}/,
  );
  assert.match(client, /\{entryFlow\.message\}/);
  assert.match(
    availabilityServer,
    /if \(!result\.ok\) return \{ status: "unknown" \}/,
  );
  assert.match(
    styles,
    /\.entryFlowStatus\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-wrap:\s*anywhere;/,
  );
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.entryFlowStatus\s*\{[\s\S]*margin-inline:\s*8px;/,
  );
});
