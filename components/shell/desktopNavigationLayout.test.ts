import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleNavigationItemCount } from "./desktopNavigationLayout.ts";

const itemWidths = [72, 88, 92, 68, 74, 70, 86, 82];

test("does not reserve More when every navigation item fits directly", () => {
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

test("moves only one trailing item into More when that is sufficient", () => {
  assert.equal(
    getVisibleNavigationItemCount({
      availableWidth: 657,
      gap: 4,
      itemWidths,
      moreButtonWidth: 76,
    }),
    itemWidths.length - 1,
  );
});

test("moves multiple trailing items into More when measured space is short", () => {
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

test("reserves room for More only after overflow and tolerates unusably small widths", () => {
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
