"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { NewsV2InsightInlineAd } from "@/components/news-v2/NewsV2InsightInlineAd";
import { NewsV2RailAdSlot } from "@/components/news-v2/NewsV2RailAdSlot";
import { PremiumUpgradeCard } from "@/components/news-v2/PremiumUpgradeCard";
import type {
  NewsV2Item,
  NewsV2SectorActivity,
  NewsV2SignalActivity,
  NewsV2SourceActivity,
} from "@/lib/newsV2";
import {
  buildNewsTrendingSignals,
  mergeThemeMarketData,
  newsSectorRadarFallbacks,
  type NewsSectorRadarItem,
  type NewsThemeMarketData,
} from "@/lib/newsV2MarketRadar";
import styles from "./StockRadarNewsV2.module.css";

type NewsV2Range = "Today" | "5D" | "1M" | "3M";
type SectorApiRange = "1D" | "5D" | "1M" | "3M";

type SectorPerformanceApiResponse = {
  cache?: "hit" | "miss" | "bypass";
  ok?: boolean;
  sectors?: NewsSectorRadarItem[];
};

const ranges: readonly NewsV2Range[] = ["Today", "5D", "1M", "3M"];
const monitoredNewsSources = [
  "Nasdaq Corporate Actions",
  "Business Wire",
  "GlobeNewswire",
  "PR Newswire",
  "Accesswire",
  "Newsfile",
  "SEC",
  "FDA",
  "OFAC",
  "DOJ",
  "DEA",
  "White House",
] as const;
const newsItemsPerTallRailAd = 12;

type NewsV2InsightRailProps = {
  items: NewsV2Item[];
  sectorActivity: NewsV2SectorActivity[];
  signalActivity: NewsV2SignalActivity[];
  sourceActivity: NewsV2SourceActivity[];
  total: number;
  visibleItemCount: number;
};

export function NewsV2InsightRail({
  items,
  sourceActivity,
  total,
  visibleItemCount,
}: NewsV2InsightRailProps) {
  const [sourceRange, setSourceRange] = useState<NewsV2Range>("Today");
  const [showAllSources, setShowAllSources] = useState(false);
  const [sectorRange, setSectorRange] = useState<NewsV2Range>("Today");
  const [activeSector, setActiveSector] = useState(newsSectorRadarFallbacks[0]?.sector || "");
  const [sectorDataByRange, setSectorDataByRange] = useState<
    Partial<Record<NewsV2Range, NewsSectorRadarItem[]>>
  >({});
  const [isSectorLoading, setIsSectorLoading] = useState(false);
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);
  const [themeMarketData, setThemeMarketData] = useState<NewsThemeMarketData | null>(null);

  const sourceRows = useMemo(
    () => buildSourceRows(items, sourceRange, sourceActivity),
    [items, sourceActivity, sourceRange],
  );
  const visibleSourceRows = showAllSources ? sourceRows : sourceRows.slice(0, 3);
  const visibleSectors = sectorDataByRange[sectorRange] || newsSectorRadarFallbacks;
  const selectedSector =
    visibleSectors.find((sector) => sector.sector === activeSector) ||
    visibleSectors[0];
  const rawTrendingThemes = useMemo(() => buildNewsTrendingSignals(items), [items]);
  const trendingThemes = useMemo(
    () => mergeThemeMarketData(rawTrendingThemes, themeMarketData),
    [rawTrendingThemes, themeMarketData],
  );
  const tallRailAdCount = Math.max(
    0,
    Math.ceil((visibleItemCount - newsItemsPerTallRailAd) / newsItemsPerTallRailAd),
  );

  useEffect(() => {
    if (!activeSector) return;

    const controller = new AbortController();
    const range = toSectorApiRange(sectorRange);
    const query = new URLSearchParams({ range, sector: activeSector });
    setIsSectorLoading(true);

    fetch(`/api/market/sector-performance?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as SectorPerformanceApiResponse | null;
        if (!response.ok || !data?.ok || !Array.isArray(data.sectors)) return;

        setSectorDataByRange((current) => ({
          ...current,
          [sectorRange]: mergeSectorResults(
            current[sectorRange] || newsSectorRadarFallbacks,
            data.sectors || [],
          ),
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setIsSectorLoading(false);
      });

    return () => controller.abort();
  }, [activeSector, sectorRange]);

  useEffect(() => {
    const subThemeSlugs = rawTrendingThemes.flatMap((theme) =>
      theme.subThemes.map((subTheme) => subTheme.slug),
    );
    if (!subThemeSlugs.length) {
      setThemeMarketData(null);
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      range: "1D",
      subthemes: subThemeSlugs.join(","),
    });

    fetch(`/api/market/theme-performance?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | (NewsThemeMarketData & { ok?: boolean })
          | null;
        if (response.ok && data?.ok) setThemeMarketData(data);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [rawTrendingThemes]);

  return (
    <div className={styles.insightRailAnchor}>
      <aside
        aria-label="News market intelligence"
        className={styles.insightRail}
      >
        <div className={styles.insightRailContent}>
          <section className={styles.insightCard}>
            <header className={styles.insightHeader}>
              <div>
                <h2>Market News Radar</h2>
                <p>{total} market-moving news events</p>
              </div>
              <RangeTabs
                label="News source range"
                onChange={setSourceRange}
                value={sourceRange}
              />
            </header>
            <div className={styles.sourceActivityList} id="news-v2-source-activity-list">
              {visibleSourceRows.length ? (
                visibleSourceRows.map((item) => (
                  <div className={styles.sourceActivityRow} key={item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{sourceCategory(item.label)}</span>
                    </div>
                    <b
                      aria-label={`${item.rangeCount} in selected range, ${item.totalCount} loaded`}
                    >
                      {item.rangeCount} / {item.totalCount}
                    </b>
                  </div>
                ))
              ) : (
                <p className={styles.detailEmptyMeta}>No source activity in this range.</p>
              )}
            </div>
            {sourceRows.length > 3 ? (
              <div className={styles.sourceActivityActions}>
                <button
                  aria-controls="news-v2-source-activity-list"
                  aria-expanded={showAllSources}
                  onClick={() => setShowAllSources((current) => !current)}
                  type="button"
                >
                  {showAllSources ? (
                    <>
                      <span>Close</span>
                      <X aria-hidden="true" size={13} />
                    </>
                  ) : (
                    <>
                      <span>See all sources</span>
                      <ChevronRight aria-hidden="true" size={13} />
                    </>
                  )}
                </button>
              </div>
            ) : null}
          </section>

          <PremiumUpgradeCard className={styles.premiumCtaDesktop} />

          <div
            className={`${styles.contextRailAdAnchor} ${styles.contextRailAdAnchorCompact}`}
          >
            <NewsV2RailAdSlot size="300x250" />
          </div>

          <section className={styles.insightCard}>
            <header className={styles.insightHeader}>
              <div>
                <span>MARKET BREADTH</span>
                <h2>Sector Performance Radar</h2>
              </div>
              <RangeTabs
                label="Sector performance range"
                onChange={setSectorRange}
                value={sectorRange}
              />
            </header>
            <div className={styles.sectorMap}>
              {visibleSectors.map((sector) => (
                <button
                  aria-pressed={sector.sector === selectedSector?.sector}
                  className={
                    sector.sector === selectedSector?.sector
                      ? styles.sectorMapActive
                      : undefined
                  }
                  key={sector.sector}
                  onClick={() => setActiveSector(sector.sector)}
                  type="button"
                >
                  <strong>{sector.sector}</strong>
                  <span className={valueClassName(sector.change)}>
                    {sector.change}
                  </span>
                </button>
              ))}
            </div>
            <div className={styles.industryTable}>
              <div className={styles.industryTableHeader}>
                <span>Industry group</span>
                <span>Change</span>
                <span>Market cap</span>
              </div>
              {selectedSector?.industries.length ? (
                selectedSector.industries.map((industry) => (
                  <article className={styles.industryRow} key={industry.name}>
                    <strong>{industry.name}</strong>
                    <span className={valueClassName(industry.change)}>
                      {industry.change}
                    </span>
                    <span>{industry.marketCap || "\u2014"}</span>
                    <small>{formatIndustryMovers(industry.tickerMovers)}</small>
                  </article>
                ))
              ) : (
                <p className={styles.detailEmptyMeta}>
                  {isSectorLoading ? "Loading industry data..." : "Industry data unavailable."}
                </p>
              )}
            </div>
          </section>

          {tallRailAdCount > 0 ? (
            <div className={styles.contextRailAdAnchor}>
              <NewsV2RailAdSlot size="300x600" />
            </div>
          ) : null}

          <NewsV2InsightInlineAd />

          <section className={styles.insightCard}>
            <header className={styles.insightHeader}>
              <div>
                <h2>Trending Signal Map</h2>
                <p>Market themes moving on high-impact news</p>
              </div>
            </header>
            <div className={styles.themeSignalList}>
              {trendingThemes.length ? (
                trendingThemes.map((theme) => (
                  <details
                    className={styles.themeSignalRow}
                    key={theme.theme}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setExpandedTheme((current) => {
                        if (isOpen) return theme.theme;
                        return current === theme.theme ? null : current;
                      });
                    }}
                    open={expandedTheme === theme.theme}
                  >
                    <summary>
                      <div className={styles.themeSignalTopline}>
                        <strong>{theme.theme}</strong>
                        <span className={styles.themeSignalMetrics}>
                          <span className={valueClassName(theme.momentum)}>
                            {theme.momentum}
                          </span>
                          <b className={styles.themeSignalScore}>{theme.score}</b>
                        </span>
                      </div>
                      <div className={styles.themeSignalMeta}>
                        <span>{theme.newsCount} news</span>
                        <span>Avg {theme.avgScore}</span>
                        <span>{theme.signal}</span>
                      </div>
                      <div
                        aria-label={`${theme.theme} score ${theme.score}`}
                        className={styles.themeSignalMeter}
                      >
                        <span style={{ width: `${theme.score}%` }} />
                      </div>
                      <span className={styles.themeExpandCue}>
                        <span className={styles.themeExpandShow}>
                          Show {theme.subThemes.length} sub themes
                        </span>
                        <span className={styles.themeExpandHide}>Hide sub themes</span>
                        <ChevronDown aria-hidden="true" size={13} />
                      </span>
                    </summary>
                    <div className={styles.subThemeBlock}>
                      <span>All sub themes</span>
                      <div className={styles.subThemeRows}>
                        {theme.subThemes.map((subTheme) => (
                          <article
                            className={styles.subThemeRow}
                            key={`${theme.theme}-${subTheme.name}`}
                          >
                            <div className={styles.subThemeCopy}>
                              <strong>{subTheme.name}</strong>
                              <span>
                                {subTheme.newsCount} news - Score{" "}
                                {subTheme.score ?? "\u2014"}
                              </span>
                            </div>
                            <div className={styles.subThemeTickers}>
                              {subTheme.tickers.map((ticker) => (
                                <span
                                  className={
                                    ticker.change.startsWith("-")
                                      ? styles.subThemeTickerNegative
                                      : styles.subThemeTickerPositive
                                  }
                                  key={`${subTheme.name}-${ticker.symbol}`}
                                >
                                  {ticker.symbol} {ticker.change}
                                </span>
                              ))}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </details>
                ))
              ) : (
                <p className={styles.detailEmptyMeta}>
                  No classified theme activity in the latest 30 days.
                </p>
              )}
            </div>
          </section>

          {tallRailAdCount > 1 ? (
            <div className={styles.contextRailAdContinuation}>
              {Array.from({ length: tallRailAdCount - 1 }, (_, index) => (
                <div className={styles.contextRailAdAnchor} key={`rail-ad-${index + 2}`}>
                  <NewsV2RailAdSlot size="300x600" />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function RangeTabs({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (range: NewsV2Range) => void;
  value: NewsV2Range;
}) {
  return (
    <div aria-label={label} className={styles.rangeTabs} role="group">
      {ranges.map((range) => (
        <button
          aria-pressed={range === value}
          key={range}
          onClick={() => onChange(range)}
          type="button"
        >
          {range}
        </button>
      ))}
    </div>
  );
}

function buildSourceRows(
  items: NewsV2Item[],
  range: NewsV2Range,
  fallback: NewsV2SourceActivity[],
) {
  const rangedItems = itemsInRange(items, range);
  const totalCounts = countBy(items, (item) => item.source);
  const rangeCounts = countBy(rangedItems, (item) => item.source);
  const labels = new Set([
    ...totalCounts.keys(),
    ...fallback.map((item) => item.source),
    ...monitoredNewsSources,
  ]);

  return Array.from(labels)
    .map((label) => ({
      label,
      rangeCount: rangeCounts.get(label) ?? 0,
      totalCount: totalCounts.get(label) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.rangeCount - left.rangeCount ||
        right.totalCount - left.totalCount ||
        left.label.localeCompare(right.label),
    );
}

function itemsInRange(items: NewsV2Item[], range: NewsV2Range) {
  const timestamps = items
    .map((item) => Date.parse(item.publishedAt))
    .filter(Number.isFinite);
  const latestTimestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
  const days = range === "Today" ? 1 : range === "5D" ? 5 : range === "1M" ? 30 : 90;
  const cutoff = latestTimestamp - days * 86_400_000;

  return items.filter((item) => {
    const timestamp = Date.parse(item.publishedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function countBy(items: NewsV2Item[], labelFor: (item: NewsV2Item) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = labelFor(item).trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

function sourceCategory(source: string) {
  return /sec|fda|ofac|doj|dea|white house|federal|nasdaq/i.test(source)
    ? "Official source"
    : "News";
}

function toSectorApiRange(range: NewsV2Range): SectorApiRange {
  return range === "Today" ? "1D" : range;
}

function mergeSectorResults(
  current: NewsSectorRadarItem[],
  incoming: NewsSectorRadarItem[],
) {
  const currentByName = new Map(current.map((sector) => [sector.sector, sector]));
  return incoming.map((sector) => {
    const previous = currentByName.get(sector.sector);
    return {
      ...sector,
      industries: sector.industries.length
        ? sector.industries
        : previous?.industries || [],
    };
  });
}

function formatIndustryMovers(
  tickers: Array<{ symbol: string; change: string }>,
) {
  if (!tickers.length) return "Top movers unavailable";
  return `Top movers ${tickers
    .slice(0, 4)
    .map((ticker) => `${ticker.symbol} ${ticker.change}`)
    .join(" \u00b7 ")}`;
}

function valueClassName(value: string) {
  if (value.startsWith("-")) return styles.negativeValue;
  if (value.startsWith("+")) return styles.positiveValue;
  return styles.neutralValue;
}
