import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleNavigationItemCount } from "./desktopNavigationLayout.ts";

const itemWidths = [72, 88, 92, 68, 74, 70, 86];

test("keeps every core navigation item visible when the measured space fits", () => {
  assert.equal(
    getVisibleNavigationItemCount({
      availableWidth: 660,
      gap: 4,
      itemWidths,
      moreButtonWidth: 76,
    }),
    itemWidths.length,
  );
});

test("moves only the trailing items into More when measured space is short", () => {
  assert.equal(
    getVisibleNavigationItemCount({
      availableWidth: 430,
      gap: 4,
      itemWidths,
      moreButtonWidth: 76,
    }),
    4,
  );
});

test("always reserves room for More and tolerates unusably small widths", () => {
  assert.equal(
    getVisibleNavigationItemCount({
      availableWidth: 60,
      gap: 4,
      itemWidths,
      moreButtonWidth: 76,
    }),
    0,
  );
});
