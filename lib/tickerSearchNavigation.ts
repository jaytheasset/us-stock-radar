export type TickerSearchArrowKey = "ArrowDown" | "ArrowUp";

export function moveTickerSearchIndex(
  currentIndex: number,
  resultCount: number,
  key: TickerSearchArrowKey,
) {
  if (resultCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= resultCount) {
    return key === "ArrowDown" ? 0 : resultCount - 1;
  }
  return key === "ArrowDown"
    ? (currentIndex + 1) % resultCount
    : (currentIndex - 1 + resultCount) % resultCount;
}
