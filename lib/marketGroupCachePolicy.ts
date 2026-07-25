export type SnapshotCacheResolution<T> =
  | { state: "hit"; value: T }
  | { state: "stale"; value: T }
  | { state: "miss"; value: null };

export function resolveSnapshotCache<TSnapshot, TValue>(
  freshSnapshots: TSnapshot[],
  allSnapshots: TSnapshot[],
  hydrate: (snapshots: TSnapshot[]) => TValue,
  isUsable: (value: TValue, snapshots: TSnapshot[]) => boolean,
): SnapshotCacheResolution<TValue> {
  const freshValue = hydrate(freshSnapshots);
  if (isUsable(freshValue, freshSnapshots)) {
    return { state: "hit", value: freshValue };
  }

  const staleValue = hydrate(allSnapshots);
  if (isUsable(staleValue, allSnapshots)) {
    return { state: "stale", value: staleValue };
  }

  return { state: "miss", value: null };
}
