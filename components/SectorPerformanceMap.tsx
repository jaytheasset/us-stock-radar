"use client";

import { useEffect, useState } from "react";

type SectorRange = "1D" | "5D" | "1M" | "3M";
type TrendTone = "bullish" | "bearish";

type SectorMoverTone = "bullish" | "warm" | "flat" | "bearish";

type SectorPerformanceMapProps = {
  sectors: Array<{
    sector: string;
    change: string;
    tone: SectorMoverTone;
    industries: Array<{
      name: string;
      change: string;
      tickers: string[];
      tickerMovers: Array<{
        symbol: string;
        change: string;
      }>;
      coverageLabel?: string;
      marketCap?: string;
      trend?: number[];
    }>;
  }>;
};

type SectorPerformanceApiResponse = {
  ok?: boolean;
  cache?: "hit" | "miss" | "bypass";
  sectors?: SectorPerformanceMapProps["sectors"];
};

const rangeOptions: Array<{ label: string; value: SectorRange }> = [
  { label: "Today", value: "1D" },
  { label: "5D", value: "5D" },
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
];

export function SectorPerformanceMap({ sectors }: SectorPerformanceMapProps) {
  const [range, setRange] = useState<SectorRange>("1D");
  const [liveSectorsByRange, setLiveSectorsByRange] = useState<
    Partial<Record<SectorRange, SectorPerformanceMapProps["sectors"]>>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [cacheLabel, setCacheLabel] = useState("Fallback data");
  const visibleSectors = liveSectorsByRange[range] || sectors;
  const selectedSector = visibleSectors[0];

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);

    fetch(`/api/market/sector-performance?range=${range}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as SectorPerformanceApiResponse | null;
        if (!response.ok || !data?.ok || !Array.isArray(data.sectors)) return;

        setLiveSectorsByRange((current) => ({
          ...current,
          [range]: data.sectors || [],
        }));
        setCacheLabel(data.cache === "hit" ? "Cached market data" : "Live market data");
      })
      .catch(() => {
        if (!controller.signal.aborted) setCacheLabel("Fallback data");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [range]);

  if (!selectedSector) return null;

  return (
    <section className="sector-movers-card">
      <div className="news-insight-header sector-map-header">
        <div>
          <h2>Sector Performance Map</h2>
        </div>
        <div className="map-range-controls" aria-label="Sector value map range">
          {rangeOptions.map((option) => (
            <button
              className={range === option.value ? "active" : ""}
              key={option.value}
              onClick={() => setRange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sector-map-grid">
        {visibleSectors.map((sector) => (
          <article
            className={`sector-map-tile ${sector.tone}${sector.sector === selectedSector.sector ? " active" : ""}`}
            key={sector.sector}
          >
            <div className="sector-map-title">
              <strong>{sector.sector}</strong>
              <b>{sector.change}</b>
            </div>
          </article>
        ))}
      </div>

      <div className="sector-detail-card">
        <div className="sector-detail-heading">
          <strong>{selectedSector.sector}</strong>
        </div>

        <div className="sector-detail-table">
          <div className="sector-detail-row head">
            <span>Industry Group</span>
            <span>Daily Change</span>
            <span>Market Cap</span>
            <span>Trend</span>
          </div>
          {selectedSector.industries.map((industry) => (
            <div className="sector-detail-row with-tickers" key={`detail-${industry.name}`}>
              <div className="industry-name-stack">
                <strong>{industry.name}</strong>
                {industry.coverageLabel ? <span className="industry-coverage-label">{industry.coverageLabel}</span> : null}
              </div>
              <b className={industry.change.startsWith("-") ? "bearish" : "bullish"}>{industry.change}</b>
              <span>{industry.marketCap || "-"}</span>
              <TrendMini
                isLoading={isLoading && !liveSectorsByRange[range]}
                sourceLabel={`${industry.name} ${range} cached market trend`}
                tone={industry.change.startsWith("-") ? "bearish" : "bullish"}
                values={industry.trend || []}
              />
              <div className="industry-ticker-list" aria-label={`${industry.name} top movers`}>
                <span className="ticker-list-label">Top movers</span>
                {industry.tickerMovers.slice(0, 4).map((ticker) => (
                  <span className={`ticker-mover ${ticker.change.startsWith("-") ? "bearish" : "bullish"}`} key={`${industry.name}-${ticker.symbol}`}>
                    {ticker.symbol} {ticker.change}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="sector-detail-foot">
          <span>Color by daily change</span>
          <span>{cacheLabel}</span>
        </div>
      </div>
    </section>
  );
}

function TrendMini({
  isLoading,
  sourceLabel,
  tone,
  values,
}: {
  isLoading: boolean;
  sourceLabel: string;
  tone: TrendTone;
  values: number[];
}) {
  const width = 92;
  const height = 34;
  const topPadding = 4;
  const bottomPadding = 8;
  const chartHeight = height - topPadding - bottomPadding;
  const safeValues = values.length > 1 ? values : [50, 50];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const range = Math.max(max - min, 1);
  const points = safeValues.map((value, index) => {
    const x = 2 + (index / Math.max(safeValues.length - 1, 1)) * (width - 4);
    const y = topPadding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y };
  });
  const pointString = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const lastPoint = points[points.length - 1];
  const baselineY = height - 4;

  return (
    <svg
      className={`trend-mini ${tone}${isLoading ? " is-loading" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={sourceLabel}
    >
      <title>{sourceLabel}</title>
      <line className="trend-mini-baseline" x1="2" x2={width - 2} y1={baselineY} y2={baselineY} />
      <polyline className="trend-mini-line" points={pointString} />
      {lastPoint ? <circle className="trend-mini-dot" cx={lastPoint.x} cy={lastPoint.y} r="1.8" /> : null}
    </svg>
  );
}
