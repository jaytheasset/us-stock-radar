type InflightLoader<T> = () => Promise<T>;

export function createMarketRequestCoalescer() {
  const inflight = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, loader: InflightLoader<T>): Promise<T> {
      const existing = inflight.get(key) as Promise<T> | undefined;
      if (existing) return existing;

      const request = loader();
      inflight.set(key, request);
      const cleanup = () => {
        if (inflight.get(key) === request) {
          inflight.delete(key);
        }
      };
      void request.then(cleanup, cleanup);
      return request;
    },
  };
}

const marketChartRequestCoalescer = createMarketRequestCoalescer();

export function marketChartRequestKey({
  forceRefresh,
  interval,
  range,
  symbol,
}: {
  forceRefresh: boolean;
  interval: string;
  range: string;
  symbol: string;
}) {
  return `${symbol}:${range}:${interval}:${forceRefresh ? "refresh" : "cached"}`;
}

export function coalesceMarketChartRequest<T>(
  key: string,
  loader: InflightLoader<T>,
) {
  return marketChartRequestCoalescer.run(key, loader);
}
