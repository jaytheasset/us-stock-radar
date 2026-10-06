// Product cache policy, not a statement about SEC publication frequency.
export const SEC_TICKER_CATALOG_TTL_MS = 15 * 60 * 1_000;

/** Process-local single-flight cache. The loader must fully validate before resolving. */
export function createTickerCatalogCache<Catalog>(load: () => Promise<Catalog>, now: () => number = () => Date.now()) {
  let snapshot: { value: Catalog; checkedAt: number } | null = null;
  let inFlight: Promise<Catalog> | null = null;
  let refreshFailed = false;

  return {
    async get(fresh = false): Promise<Catalog> {
      // Even ordinary reads wait for an already-requested refresh.
      if (!inFlight && (fresh || refreshFailed || !snapshot || now() - snapshot.checkedAt >= SEC_TICKER_CATALOG_TTL_MS)) {
        inFlight = Promise.resolve().then(load).then((value) => {
          snapshot = { value: structuredClone(value), checkedAt: now() };
          refreshFailed = false;
          return snapshot.value;
        }).catch((error: unknown) => {
          // Keep the last good snapshot/time, but require a retry before serving again.
          refreshFailed = true;
          throw error;
        }).finally(() => { inFlight = null; });
      }
      return structuredClone(inFlight ? await inFlight : snapshot!.value);
    },
    // Scalar diagnostic state only; never exposes the shared Map or its row arrays.
    state() {
      return { lastSuccessAt: snapshot?.checkedAt ?? null, refreshing: inFlight !== null, refreshFailed };
    },
  };
}
