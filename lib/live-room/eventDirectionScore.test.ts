import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  directionalScoreThreshold,
  getDirectionalScoreTone,
} from "../directionalScore.ts";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Live Room event scores switch to direction color exactly at 75", () => {
  assert.equal(directionalScoreThreshold, 75);

  for (const signal of [
    "bullish",
    "bearish",
    "volatile",
    "neutral",
  ] as const) {
    assert.equal(getDirectionalScoreTone(74, signal), "default");
    assert.equal(getDirectionalScoreTone(75, signal), signal);
  }
});

test("latest update card and desktop Updates rows share explicit direction and score UI", () => {
  const signalScore = readSource(
    "components/live-room/CompanyEventSignalScore.tsx",
  );
  const eventCard = readSource(
    "components/live-room/CompanyEventCard.tsx",
  );
  const sidePanel = readSource(
    "components/live-room/LiveRoomDesktopSidePanel.tsx",
  );
  const room = readSource("components/live-room/LiveRoomClient.tsx");

  assert.match(signalScore, /normalizeDirectionalScoreSignal\(signal\)/);
  assert.match(signalScore, /data-signal=\{direction\}/);
  assert.match(signalScore, />\s*Score\{" "\}/);
  assert.match(
    signalScore,
    /data-score-tone=\{getDirectionalScoreTone\(score, signal\)\}/,
  );
  assert.match(
    eventCard,
    /<CompanyEventSignalScore[\s\S]*score=\{event\.score\}[\s\S]*signal=\{event\.signal\}/,
  );
  assert.match(
    room,
    /<CompanyEventCard event=\{latestEvent\} latest/,
  );
  assert.equal(
    sidePanel.match(/<CompanyEventSignalScore/g)?.length,
    2,
  );
});

test("direction is always token-colored while sub-75 score text stays neutral", () => {
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const scoreStyles = styles.slice(
    styles.indexOf(".eventSignalDirection[data-signal"),
    styles.indexOf(".latestEventCard footer"),
  );

  for (const [signal, token] of [
    ["bullish", "--sr-color-positive"],
    ["bearish", "--sr-color-negative"],
    ["volatile", "--sr-color-warning"],
    ["neutral", "--sr-color-event-neutral"],
  ]) {
    assert.match(
      scoreStyles,
      new RegExp(
        `\\.eventSignalDirection\\[data-signal="${signal}"\\][\\s\\S]*?color:\\s*var\\(${token}\\)`,
      ),
    );
  }
  assert.match(
    scoreStyles,
    /\.eventScore b\s*\{[\s\S]*?color:\s*var\(--sr-color-text-secondary\)/,
  );
  for (const [tone, token] of [
    ["bullish", "--sr-color-positive"],
    ["bearish", "--sr-color-negative"],
    ["volatile", "--sr-color-warning"],
    ["neutral", "--sr-color-event-neutral"],
  ]) {
    assert.match(
      scoreStyles,
      new RegExp(
        `\\.eventScore b\\[data-score-tone="${tone}"\\][\\s\\S]*?color:\\s*var\\(${token}\\)`,
      ),
    );
  }
  assert.doesNotMatch(scoreStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
});

test("event score UI remains compact without overflowing desktop or mobile cards", () => {
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );
  const signalRule = styles.match(
    /\.eventSignalScore\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(signalRule);
  assert.match(signalRule, /min-width:\s*0/);
  assert.match(signalRule, /max-width:\s*100%/);
  assert.match(signalRule, /flex:\s*0 0 auto/);
  assert.match(signalRule, /overflow:\s*hidden/);
  assert.match(signalRule, /white-space:\s*nowrap/);
  assert.match(
    styles,
    /\.eventMeta\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  );
  assert.match(
    styles,
    /\.sidePanelItem,[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.latestEventCard\s*\{[\s\S]*?padding:/,
  );
});

test("latest event meta wraps the score instead of shrinking it to zero", () => {
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );

  assert.match(
    styles,
    /\.eventMeta\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  );
  assert.match(
    styles,
    /\.eventSignalScore\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?flex:\s*0 0 auto/,
  );
  assert.match(
    styles,
    /\.sidePanelItem \.eventSignalScore\s*\{[\s\S]*?flex:\s*0 1 auto/,
  );
  assert.doesNotMatch(
    styles,
    /\.eventMeta \.eventSignalScore\s*\{[\s\S]*?flex:\s*0 1 auto/,
  );
});
