import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Live Room message actions use a visible accessible Lucide ellipsis button", () => {
  const timeline = readSource(
    "components/live-room/ChatTimeline.tsx",
  );
  const styles = readSource(
    "components/live-room/LiveRoom.module.css",
  );

  assert.match(timeline, /\bEllipsis,/);
  assert.match(
    timeline,
    /aria-label="Message actions"[\s\S]*?className=\{styles\.messageActionsTrigger\}[\s\S]*?<Ellipsis[\s\S]*?aria-hidden="true"[\s\S]*?size=\{18\}[\s\S]*?strokeWidth=\{2\.5\}/,
  );
  assert.doesNotMatch(timeline, /<MoreHorizontal/);
  assert.match(
    styles,
    /\.messageActionsTrigger\s*\{[\s\S]*?border:\s*var\(--sr-border-width\) solid var\(--sr-color-border-section\)[\s\S]*?border-radius:\s*var\(--sr-radius-sm\)[\s\S]*?color:\s*var\(--sr-color-text-secondary\)[\s\S]*?background:\s*var\(--sr-color-surface-control\)/,
  );
  assert.match(
    styles,
    /\.messageActionsTrigger:hover,\s*\.messageActionsTrigger\[aria-expanded="true"\]\s*\{[\s\S]*?border-color:\s*var\(--sr-color-border-control\)[\s\S]*?color:\s*var\(--sr-color-text-strong\)[\s\S]*?background:\s*var\(--sr-color-surface-control-strong\)/,
  );
  assert.match(
    styles,
    /\.messageActions button:focus-visible,[\s\S]*?outline:\s*var\(--sr-focus-ring-width\) solid var\(--sr-focus-ring-color\)/,
  );
});
