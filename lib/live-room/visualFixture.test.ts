import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveLiveRoomTimelinePresentation } from "./messageGrouping.ts";
import {
  LIVE_ROOM_VISUAL_FIXTURE_LINKED_EVENT,
  LIVE_ROOM_VISUAL_FIXTURE_MESSAGES,
  LIVE_ROOM_VISUAL_FIXTURE_STATIC_EVENT,
} from "./visualFixture.ts";

const page = readFileSync(
  "app/development/live-room-visual-fixture/page.tsx",
  "utf8",
);
const client = readFileSync(
  "app/development/live-room-visual-fixture/LiveRoomVisualFixtureClient.tsx",
  "utf8",
);
const timeline = readFileSync(
  "components/live-room/ChatTimeline.tsx",
  "utf8",
);

test("the visual fixture is runtime development-only and performs no data access", () => {
  assert.match(
    page,
    /process\.env\.NODE_ENV !== "development"\) notFound\(\)/,
  );
  assert.match(page, /export const dynamic = "force-dynamic"/);

  const fixtureSources = `${page}\n${client}`;
  assert.doesNotMatch(
    fixtureSources,
    /fetch\s*\(|cookies\s*\(|headers\s*\(|repository\.|supabase|\/api\//i,
  );
  assert.match(client, /not saved · interactions disabled/);
  assert.match(client, /event\.preventDefault\(\)/);
  assert.match(client, /onClickCapture=\{preventFixtureNavigation\}/);
  assert.match(client, /data-sr-theme-mode="user-selectable"/);
});

test("the fixed messages exercise real five-minute and anonymous grouping rules", () => {
  const presentation = resolveLiveRoomTimelinePresentation(
    LIVE_ROOM_VISUAL_FIXTURE_MESSAGES,
    null,
  );

  assert.deepEqual(
    presentation.map((item) => item.groupPosition),
    ["start", "middle", "end", "single", "single", "single"],
  );
  assert.deepEqual(
    presentation.map((item) => item.showHeader),
    [true, false, false, true, true, true],
  );
  assert.deepEqual(
    presentation.map((item) => item.showAvatar),
    [false, false, true, true, true, true],
  );
  assert.equal(
    LIVE_ROOM_VISUAL_FIXTURE_MESSAGES[0].author.publicProfileId,
    LIVE_ROOM_VISUAL_FIXTURE_MESSAGES[3].author.publicProfileId,
  );
  assert.equal(
    LIVE_ROOM_VISUAL_FIXTURE_MESSAGES[4].author.publicProfileId,
    undefined,
  );
  assert.equal(
    LIVE_ROOM_VISUAL_FIXTURE_MESSAGES[5].author.publicProfileId,
    undefined,
  );
});

test("the fixture renders real timeline and linked plus static update components", () => {
  assert.match(
    client,
    /import \{[\s\S]*ChatTimeline,[\s\S]*LatestChatEventStrip,[\s\S]*\} from "@\/components\/live-room\/ChatTimeline"/,
  );
  assert.match(client, /<ChatTimeline[\s\S]*state="ready"[\s\S]*viewerIsGuest/);
  assert.equal(LIVE_ROOM_VISUAL_FIXTURE_LINKED_EVENT.detailHref !== null, true);
  assert.equal(LIVE_ROOM_VISUAL_FIXTURE_STATIC_EVENT.detailHref, null);
  assert.match(
    timeline,
    /resolveLiveRoomTimelinePresentation\([\s\S]*presentationItems\.map/,
  );
});
