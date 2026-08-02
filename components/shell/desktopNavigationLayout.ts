export type DesktopNavigationLayout = {
  availableWidth: number;
  gap: number;
  itemWidths: readonly number[];
  moreButtonWidth: number;
};

export function getVisibleNavigationItemCount({
  availableWidth,
  gap,
  itemWidths,
  moreButtonWidth,
}: DesktopNavigationLayout) {
  const safeAvailableWidth = Math.max(0, availableWidth);
  const safeGap = Math.max(0, gap);
  const safeItemWidths = itemWidths.map((itemWidth) =>
    Math.max(0, itemWidth),
  );
  const allItemsWidth = safeItemWidths.reduce(
    (total, itemWidth) => total + itemWidth,
    safeGap * Math.max(0, safeItemWidths.length - 1),
  );

  if (allItemsWidth <= safeAvailableWidth + 0.5) {
    return safeItemWidths.length;
  }

  let occupiedWidth = Math.max(0, moreButtonWidth);
  let visibleItemCount = 0;

  for (const itemWidth of safeItemWidths) {
    const nextOccupiedWidth = occupiedWidth + safeGap + itemWidth;

    if (nextOccupiedWidth > safeAvailableWidth + 0.5) break;

    occupiedWidth = nextOccupiedWidth;
    visibleItemCount += 1;
  }

  return visibleItemCount;
}
