export type FilingsV2LoadState = "partial" | "ready" | "unavailable";

export function resolveFilingsV2LoadState(
  successfulRequestCount: number,
  totalRequestCount: number,
): FilingsV2LoadState {
  if (successfulRequestCount <= 0) return "unavailable";
  if (successfulRequestCount >= totalRequestCount) return "ready";
  return "partial";
}
