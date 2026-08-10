import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(
  "components/live-room/LiveRoomClient.tsx",
  "utf8",
);
const composer = readFileSync(
  "components/live-room/MessageComposer.tsx",
  "utf8",
);
const header = readFileSync(
  "components/live-room/CompanyRoomHeader.tsx",
  "utf8",
);
const membership = readFileSync(
  "components/live-room/RoomMembershipControl.tsx",
  "utf8",
);
const sidePanel = readFileSync(
  "components/live-room/LiveRoomDesktopSidePanel.tsx",
  "utf8",
);
const timeline = readFileSync(
  "components/live-room/ChatTimeline.tsx",
  "utf8",
);
const styles = readFileSync(
  "components/live-room/LiveRoom.module.css",
  "utf8",
);

test("the flat header keeps Leave inside the keyboard-safe Joined popover", () => {
  assert.match(header, /className=\{styles\.roomTicker\}>\{identity\.ticker\}/);
  assert.match(header, /className=\{styles\.roomLabel\}>Live Room/);
  assert.match(
    membership,
    /const joinedPopoverId = useId\(\)[\s\S]*?aria-controls=\{joinedPopoverId\}[\s\S]*?aria-expanded=\{menuOpen\}[\s\S]*?className=\{styles\.membershipMenu\} id=\{joinedPopoverId\}[\s\S]*?Leave room/,
  );
  assert.doesNotMatch(membership, /aria-haspopup="menu"|role="menu(?:item)?"/);
  assert.match(
    membership,
    /event\.key !== "Escape"[\s\S]*?menuButtonRef\.current\?\.focus\(\)/,
  );
  assert.doesNotMatch(client, /Joined\. This room stays in My Rooms/);
  assert.match(
    styles,
    /\.page\[data-room-kind="company"\] \.roomHeader \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;/,
  );
  assert.match(
    styles,
    /\.membershipDialogBackdrop\s*\{[\s\S]*?z-index:\s*calc\(var\(--sr-z-sticky-action\) \+ 4\)/,
  );
});

test("the latest real event renders once above the workspace and remains static without a detail link", () => {
  assert.equal(client.match(/<LatestChatEventStrip event=\{latestEvent\} \/>/g)?.length, 1);
  assert.ok((client.match(/events=\{historicalEvents\}/g)?.length ?? 0) >= 2);
  assert.ok((client.match(/allEvents=\{events\}/g)?.length ?? 0) >= 2);
  assert.match(timeline, /return event\.detailHref \? \(/);
  assert.match(
    timeline,
    /aria-label=\{`Latest company update: \$\{event\.title\}`\}[\s\S]*?role="group"/,
  );
  assert.match(timeline, />Pinned update<\/span>/);
  assert.match(
    client,
    /<RoomTabs[\s\S]*?attached[\s\S]*?<LatestChatEventStrip event=\{latestEvent\}/,
  );
});

test("the hidden desktop rail is exposed through the same tablet drawer content", () => {
  assert.match(header, /aria-controls="live-room-info-drawer"/);
  assert.match(client, /id="live-room-info-drawer"[\s\S]*?viewport="tablet"/);
  assert.match(
    client,
    /<LiveRoomDesktopSidePanel[\s\S]*?events=\{historicalEvents\}[\s\S]*?variant="drawer"/,
  );
  assert.match(
    sidePanel,
    /data-live-room-preview-surface=\{variant\}/,
  );
  assert.match(
    sidePanel,
    /label: "Activity"[\s\S]*?label: "Posts"[\s\S]*?label: "Events"[\s\S]*?label: "Members"/,
  );
  assert.match(
    sidePanel,
    /activeTab === "activity"[\s\S]*?events=\{events\}[\s\S]*?activeTab === "events"[\s\S]*?events=\{allEvents \?\? events\}/,
  );
  assert.match(
    sidePanel,
    /activeTab === "activity"[\s\S]*?"Recent updates"/,
  );
  assert.match(
    sidePanel,
    /className=\{styles\.sidePanelSectionHeading\}[\s\S]*?\{sectionTitle\}[\s\S]*?\{viewAllAction\}/,
  );
  assert.match(
    styles,
    /\.drawerSidePanel\s*\{[\s\S]*?display:\s*grid/,
  );
  assert.match(
    styles,
    /\.sidePanelSectionHeading \.sidePanelViewAll\s*\{[\s\S]*?width:\s*auto/,
  );
});

test("the compact composer preserves Enter behavior and exposes help without visible helper copy", () => {
  assert.match(composer, /aria-describedby="live-room-composer-help"/);
  assert.match(
    composer,
    /event\.key === "Enter"[\s\S]*?!event\.shiftKey[\s\S]*?!event\.nativeEvent\.isComposing[\s\S]*?event\.preventDefault\(\)[\s\S]*?requestSend\(\)/,
  );
  assert.match(
    composer,
    /className=\{styles\.visuallyHidden\} id="live-room-composer-help"/,
  );
  assert.match(
    composer,
    /Math\.min\(120, Math\.max\(52, textarea\.scrollHeight\)\)/,
  );
  assert.doesNotMatch(composer, /<span>Enter to send/);
  assert.match(
    styles,
    /\.composerSurface \{[\s\S]*?min-height: 60px;[\s\S]*?border-radius: var\(--sr-radius-popover\);/,
  );
  assert.match(composer, /className=\{styles\.composerSurface\}/);
});

test("grouped messages retain per-message anchors and focus-visible controls", () => {
  assert.match(timeline, /id=\{`live-room-message-\$\{item\.id\}`\}/);
  assert.match(timeline, /data-group-position=\{groupPosition\}/);
  assert.match(timeline, /showAvatar && publicProfileHref/);
  assert.match(timeline, /showHeader \? \(/);
  assert.match(
    styles,
    /\.otherMessage:focus-within \.messageContinuationControls,[\s\S]*?\.myMessage:focus-within \.messageContinuationControls \{[\s\S]*?opacity: 1;/,
  );
  assert.match(
    styles,
    /max-width: min\(550px, calc\(100% - 46px\)\);[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/,
  );
});
