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
  let occupiedWidth = Math.max(0, moreButtonWidth);
  let visibleItemCount = 0;

  for (const itemWidth of itemWidths) {
    const nextOccupiedWidth =
      occupiedWidth + safeGap + Math.max(0, itemWidth);

    if (nextOccupiedWidth > safeAvailableWidth + 0.5) break;

    occupiedWidth = nextOccupiedWidth;
    visibleItemCount += 1;
  }

  return visibleItemCount;
}
