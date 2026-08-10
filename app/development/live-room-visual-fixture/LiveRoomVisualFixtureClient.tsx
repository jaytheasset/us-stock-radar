"use client";

import type { MouseEvent } from "react";
import {
  ChatTimeline,
  LatestChatEventStrip,
} from "@/components/live-room/ChatTimeline";
import {
  LIVE_ROOM_VISUAL_FIXTURE_LINKED_EVENT,
  LIVE_ROOM_VISUAL_FIXTURE_MESSAGES,
  LIVE_ROOM_VISUAL_FIXTURE_STATIC_EVENT,
} from "@/lib/live-room/visualFixture";
import styles from "./live-room-visual-fixture.module.css";

const FIXTURE_PATH = "/development/live-room-visual-fixture";

export function LiveRoomVisualFixtureClient() {
  const preventFixtureNavigation = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) {
      event.preventDefault();
    }
  };

  return (
    <main
      className={styles.page}
      data-live-room-visual-fixture="local-only"
      data-sr-theme-mode="user-selectable"
      onClickCapture={preventFixtureNavigation}
    >
      <header className={styles.fixtureHeader}>
        <span>Local visual fixture</span>
        <h1>Live Room grouped timeline</h1>
        <p>Fixed presentation data only · not saved · interactions disabled</p>
      </header>

      <section aria-labelledby="fixture-pinned-updates" className={styles.surface}>
        <h2 id="fixture-pinned-updates">Pinned update variants</h2>
        <div data-fixture-update="linked">
          <LatestChatEventStrip event={LIVE_ROOM_VISUAL_FIXTURE_LINKED_EVENT} />
        </div>
        <div data-fixture-update="static">
          <LatestChatEventStrip event={LIVE_ROOM_VISUAL_FIXTURE_STATIC_EVENT} />
        </div>
      </section>

      <section aria-labelledby="fixture-timeline" className={styles.surface}>
        <h2 id="fixture-timeline">Real ChatTimeline grouping</h2>
        <div className={styles.timelineViewport} data-fixture-timeline="grouping">
          <ChatTimeline
            ariaLabel="Local Live Room grouping fixture messages"
            currentProfileName="Local fixture viewer"
            items={LIVE_ROOM_VISUAL_FIXTURE_MESSAGES}
            loginHref={FIXTURE_PATH}
            state="ready"
            viewerIsGuest
          />
        </div>
      </section>
    </main>
  );
}
