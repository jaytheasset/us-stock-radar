import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/shell/MarketActivityRail.tsx", "utf8");
const styles = readFileSync("components/shell/MarketActivityRail.module.css", "utf8");
const shell = readFileSync("components/shell/StockRadarAppShell.tsx", "utf8");

test("the activity rail stays directly below the shared product header in normal flow", () => {
  assert.match(shell, /<StockRadarProductHeader[\s\S]*?<MarketActivityRail \/>[\s\S]*?<main/);
  assert.doesNotMatch(styles, /position:\s*(?:fixed|sticky|absolute)/);
  assert.match(styles, /height:\s*34px/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*height:\s*32px/);
});

test("the rail pauses for user interaction and disables automatic motion for reduced motion", () => {
  assert.match(component, /onMouseEnter=\{\(\) => setInteractionPaused\(true\)\}/);
  assert.match(component, /onPointerDown=/);
  assert.match(component, /onFocus=\{\(\) => setInteractionPaused\(true\)\}/);
  assert.match(component, /4_500/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation-play-state:\s*paused/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
});

test("the client performs one bounded read and creates no realtime connection", () => {
  assert.match(component, /marketActivityRequest = fetch\("\/api\/market-activity"/);
  assert.doesNotMatch(component, /WebSocket|EventSource|subscribe\(/);
  assert.doesNotMatch(component, /setTimeout\([^)]*fetch|setInterval\([^)]*fetch/);
});

test("conversation surfaces suppress the rail to protect their composer geometry", () => {
  assert.match(component, /pathname\.startsWith\("\/live\/"\)/);
  assert.match(component, /pathname\.startsWith\("\/messages\/"\)/);
  assert.match(component, /pathname === "\/account\/messages"/);
});

test("compact tabs and safe empty states are present without placeholder dashes", () => {
  assert.match(component, />\s*지수\s*</);
  assert.match(component, />\s*채팅\s*</);
  assert.match(component, /오늘 활발한 공개 대화가 아직 없습니다\./);
  assert.match(component, /시장 지수 정보를 사용할 수 없습니다\./);
  assert.doesNotMatch(component, />—</);
});
