import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Live Room message actions use a visible card-corner Lucide menu", () => {
  const timeline = readSource(
    "components/live-room/ChatTimeline.tsx",
  );
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );

  assert.match(timeline, /\bEllipsisVertical,/);
  assert.match(
    timeline,
    /aria-label="Message actions"[\s\S]*?className=\{styles\.messageActionsTrigger\}[\s\S]*?<EllipsisVertical[\s\S]*?aria-hidden="true"[\s\S]*?size=\{18\}[\s\S]*?strokeWidth=\{2\.4\}/,
  );
  assert.doesNotMatch(timeline, /<Ellipsis(?:\s|>)/);
  assert.match(
    styles,
    /\.otherMessage article,[\s\S]*?position:\s*relative;[\s\S]*?\.messageActions\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*var\(--sr-space-1\);[\s\S]*?right:\s*var\(--sr-space-1\)/,
  );
  assert.match(
    styles,
    /\.messageActionsTrigger\s*\{[\s\S]*?width:\s*var\(--sr-space-6\);[\s\S]*?height:\s*var\(--sr-space-6\);[\s\S]*?border:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?background:\s*transparent;/,
  );
  assert.match(
    styles,
    /\.messageActionsTrigger > svg\s*\{[\s\S]*?width:\s*var\(--sr-space-4-5\);[\s\S]*?height:\s*var\(--sr-space-4-5\);[\s\S]*?flex:\s*0 0 auto;[\s\S]*?color:\s*currentColor;[\s\S]*?stroke:\s*currentColor;/,
  );
  assert.match(
    styles,
    /\.messageActionsTrigger:hover,\s*\.messageActionsTrigger:focus-visible,\s*\.messageActionsTrigger\[aria-expanded="true"\]\s*\{[\s\S]*?color:\s*var\(--sr-color-text-strong\);[\s\S]*?background:\s*var\(--sr-color-surface-control-strong\)/,
  );
  assert.match(
    styles,
    /\.messageActions button:focus-visible,[\s\S]*?outline:\s*var\(--sr-focus-ring-width\) solid var\(--sr-focus-ring-color\)/,
  );
  assert.match(
    timeline,
    /const hasActions = Boolean\([\s\S]*?if \(!hasActions\) return null;/,
  );
  assert.match(
    timeline,
    /<ShieldAlert[\s\S]*?size=\{16\}[\s\S]*?strokeWidth=\{2\.25\}[\s\S]*?Report[\s\S]*?<Ban[\s\S]*?size=\{16\}[\s\S]*?strokeWidth=\{2\.25\}[\s\S]*?Block author/,
  );
  assert.match(
    styles,
    /\.messageActionsMenu svg\s*\{[\s\S]*?color:\s*currentColor;[\s\S]*?stroke:\s*currentColor;[\s\S]*?stroke-width:\s*2\.25;/,
  );
});
