import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/shell/MarketActivityRail.tsx", "utf8");
const styles = readFileSync("components/shell/MarketActivityRail.module.css", "utf8");
const shell = readFileSync("components/shell/StockRadarAppShell.tsx", "utf8");

test("the sticky activity rail stays directly below the shared product header", () => {
  assert.match(shell, /<StockRadarProductHeader[\s\S]*?<MarketActivityRail \/>[\s\S]*?<main/);
  assert.match(styles, /\.rail\s*\{[\s\S]*position:\s*sticky;[\s\S]*z-index:\s*var\(--sr-z-sticky-action\);[\s\S]*top:\s*0;/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.rail\s*\{[\s\S]*top:\s*var\(--sr-size-header\);/);
  assert.doesNotMatch(styles, /position:\s*(?:fixed|absolute)/);
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
  assert.match(component, />\s*Indices\s*</);
  assert.match(component, />\s*Chat\s*</);
  assert.match(component, /No active public conversations yet today\./);
  assert.match(component, /Market indices are currently unavailable\./);
  assert.doesNotMatch(component, />—</);
});
