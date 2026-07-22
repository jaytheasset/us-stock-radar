"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { NewsV2InsightInlineAd } from "@/components/news-v2/NewsV2InsightInlineAd";
import { NewsV2RailAdSlot } from "@/components/news-v2/NewsV2RailAdSlot";
import { PremiumUpgradeCard } from "@/components/news-v2/PremiumUpgradeCard";
import type {
  NewsV2Item,
  NewsV2SectorActivity,
  NewsV2Signal,
  NewsV2SignalActivity,
  NewsV2SourceActivity,
} from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

type NewsV2Range = "Today" | "5D" | "1M" | "3M";
const ranges: readonly NewsV2Range[] = ["Today", "5D", "1M", "3M"];

type NewsV2InsightRailProps = {
  items: NewsV2Item[];
  sectorActivity: NewsV2SectorActivity[];
  signalActivity: NewsV2SignalActivity[];
  sourceActivity: NewsV2SourceActivity[];
  total: number;
};

type ThemeSummary = {
  averageMove?: number;
  averageScore: number;
  count: number;
  label: string;
};

type SectorSummary = ThemeSummary & {
  themes: ThemeSummary[];
};

type SignalSummary = {
  averageMove?: number;
  averageScore: number;
  count: number;
  label: string;
  sentiment: NewsV2Signal;
  subThemes: Array<ThemeSummary & { tickers: Array<{ change?: string; symbol: string }> }>;
};

export function NewsV2InsightRail({
  items,
  sectorActivity,
  signalActivity,
  sourceActivity,
  total,
}: NewsV2InsightRailProps) {
  const [sourceRange, setSourceRange] = useState<NewsV2Range>("Today");
  const [showAllSources, setShowAllSources] = useState(false);
  const [sectorRange, setSectorRange] = useState<NewsV2Range>("Today");
  const [activeSector, setActiveSector] = useState<string>(sectorActivity[0]?.sector ?? "");
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);
  const sourceRows = useMemo(
    () => buildSourceRows(items, sourceRange, sourceActivity),
    [items, sourceActivity, sourceRange],
  );
  const sectorRows = useMemo(
    () => buildSectorRows(items, sectorRange, sectorActivity),
    [items, sectorActivity, sectorRange],
  );
  const signalRows = useMemo(
    () => buildSignalRows(items, signalActivity),
    [items, signalActivity],
  );
  const visibleSourceRows = showAllSources ? sourceRows : sourceRows.slice(0, 3);
  const selectedSector = sectorRows.find((sector) => sector.label === activeSector) ?? sectorRows[0];

  return (
    <div className={styles.insightRailAnchor}>
      <aside aria-label="News market intelligence" className={styles.insightRail}>
        <div className={styles.insightRailContent}>
          <section className={styles.insightCard}>
            <header className={styles.insightHeader}>
              <div>
                <h2>Market News Radar</h2>
                <p>{total} market-moving news events</p>
              </div>
              <RangeTabs label="News source range" onChange={setSourceRange} value={sourceRange} />
            </header>
            <div className={styles.sourceActivityList} id="news-v2-source-activity-list">
              {visibleSourceRows.length ? visibleSourceRows.map((item) => (
                <div className={styles.sourceActivityRow} key={item.label}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{sourceCategory(item.label)}</span>
                  </div>
                  <b aria-label={`${item.rangeCount} in selected range, ${item.totalCount} loaded`}>
                    {item.rangeCount} / {item.totalCount}
                  </b>
                </div>
              )) : <p className={styles.detailEmptyMeta}>No source activity in this range.</p>}
            </div>
            {sourceRows.length > 3 ? (
              <div className={styles.sourceActivityActions}>
                <button
                  aria-controls="news-v2-source-activity-list"
                  aria-expanded={showAllSources}
                  onClick={() => setShowAllSources((current) => !current)}
                  type="button"
                >
                  {showAllSources ? <><span>Close</span><X aria-hidden="true" size={13} /></> : <><span>See all sources</span><ChevronRight aria-hidden="true" size={13} /></>}
                </button>
              </div>
            ) : null}
          </section>

          <PremiumUpgradeCard className={styles.premiumCtaDesktop} />

          <section className={styles.insightCard}>
            <header className={styles.insightHeader}>
              <div>
                <span>NEWS BREADTH</span>
                <h2>Sector Performance Radar</h2>
              </div>
              <RangeTabs label="Sector news range" onChange={setSectorRange} value={sectorRange} />
            </header>
            {sectorRows.length ? (
              <>
                <div className={styles.sectorMap}>
                  {sectorRows.slice(0, 12).map((sector) => {
                    const selected = sector.label === selectedSector?.label;
                    return (
                      <button
                        aria-pressed={selected}
                        className={selected ? styles.sectorMapActive : undefined}
                        key={sector.label}
                        onClick={() => setActiveSector(sector.label)}
                        type="button"
                      >
                        <strong>{sector.label}</strong>
                        <span className={moveToneClass(sector.averageMove)}>{formatMoveOrCount(sector)}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedSector ? (
                  <div className={styles.industryTable}>
                    <div className={styles.industryTableHeader}>
                      <span>Theme</span>
                      <span>Move</span>
                      <span>Impact</span>
                    </div>
                    {selectedSector.themes.slice(0, 3).map((theme) => (
                      <article className={styles.industryRow} key={`${selectedSector.label}-${theme.label}`}>
                        <strong>{theme.label}</strong>
                        <span className={moveToneClass(theme.averageMove)}>{formatMove(theme.averageMove)}</span>
                        <span>{theme.averageScore}</span>
                        <small>{theme.count} news event{theme.count === 1 ? "" : "s"}</small>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            ) : <p className={styles.detailEmptyMeta}>No sector activity in this range.</p>}
          </section>

          <NewsV2InsightInlineAd />

          <section className={styles.insightCard}>
            <header className={styles.insightHeader}>
              <div>
                <h2>Trending Signal Map</h2>
                <p>Themes moving on high-impact news</p>
              </div>
            </header>
            <div className={styles.themeSignalList}>
              {signalRows.map((theme) => (
                <details
                  className={styles.themeSignalRow}
                  key={theme.label}
                  onToggle={(event) => setExpandedTheme(event.currentTarget.open ? theme.label : null)}
                  open={expandedTheme === theme.label}
                >
                  <summary>
                    <div className={styles.themeSignalTopline}>
                      <strong>{theme.label}</strong>
                      <span className={styles.themeSignalMetrics}>
                        <span className={moveToneClass(theme.averageMove)}>{formatMove(theme.averageMove)}</span>
                        <b className={styles.themeSignalScore}>{theme.averageScore}</b>
                      </span>
                    </div>
                    <div className={styles.themeSignalMeta}>
                      <span>{theme.count} news</span>
                      <span>Avg {theme.averageScore}</span>
                      <span>{theme.sentiment}</span>
                    </div>
                    <div aria-label={`${theme.label} score ${theme.averageScore}`} className={styles.themeSignalMeter}>
                      <span style={{ width: `${theme.averageScore}%` }} />
                    </div>
                    {theme.subThemes.length ? (
                      <span className={styles.themeExpandCue}>
                        <span className={styles.themeExpandShow}>Show {theme.subThemes.length} sub themes</span>
                        <span className={styles.themeExpandHide}>Hide sub themes</span>
                        <ChevronDown aria-hidden="true" size={13} />
                      </span>
                    ) : null}
                  </summary>
                  {theme.subThemes.length ? (
                    <div className={styles.subThemeBlock}>
                      <span>All sub themes</span>
                      <div className={styles.subThemeRows}>
                        {theme.subThemes.map((subTheme) => (
                          <article className={styles.subThemeRow} key={`${theme.label}-${subTheme.label}`}>
                            <div className={styles.subThemeCopy}>
                              <strong>{subTheme.label}</strong>
                              <span>{subTheme.count} news - Score {subTheme.averageScore}</span>
                            </div>
                            <div className={styles.subThemeTickers}>
                              {subTheme.tickers.map((ticker) => (
                                <span className={ticker.change?.startsWith("-") ? styles.subThemeTickerNegative : styles.subThemeTickerPositive} key={`${subTheme.label}-${ticker.symbol}`}>
                                  {ticker.symbol}{ticker.change ? ` ${ticker.change}` : ""}
                                </span>
                              ))}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          </section>
        </div>

        <div className={styles.contextRailAdAnchor}>
          <div className={styles.contextRailAdFill}><NewsV2RailAdSlot /></div>
        </div>
      </aside>
    </div>
  );
}

function RangeTabs({ label, onChange, value }: { label: string; onChange: (range: NewsV2Range) => void; value: NewsV2Range }) {
  return (
    <div aria-label={label} className={styles.rangeTabs} role="group">
      {ranges.map((range) => (
        <button aria-pressed={range === value} key={range} onClick={() => onChange(range)} type="button">
          {range}
        </button>
      ))}
    </div>
  );
}

function buildSourceRows(items: NewsV2Item[], range: NewsV2Range, fallback: NewsV2SourceActivity[]) {
  const rangedItems = itemsInRange(items, range);
  const totalCounts = countBy(items, (item) => item.source);
  const rangeCounts = countBy(rangedItems, (item) => item.source);
  const labels = new Set([...totalCounts.keys(), ...fallback.map((item) => item.source)]);
  return Array.from(labels)
    .map((label) => ({ label, rangeCount: rangeCounts.get(label) ?? 0, totalCount: totalCounts.get(label) ?? 0 }))
    .filter((item) => item.rangeCount > 0 || range === "3M")
    .sort((left, right) => right.rangeCount - left.rangeCount || right.totalCount - left.totalCount);
}

function buildSectorRows(items: NewsV2Item[], range: NewsV2Range, fallback: NewsV2SectorActivity[]): SectorSummary[] {
  const rangedItems = itemsInRange(items, range);
  const groups = groupItems(rangedItems, (item) => item.sector || "");
  if (!groups.size && range === "3M") {
    return fallback.map((item) => ({
      label: item.sector,
      count: item.count,
      averageScore: item.averageScore,
      themes: [],
    }));
  }
  return Array.from(groups.entries())
    .map(([label, rows]) => ({
      label,
      count: rows.length,
      averageScore: average(rows.map((row) => row.score)),
      averageMove: averageMove(rows),
      themes: summarizeGroups(rows, (row) => row.themes[0] || row.eventType),
    }))
    .sort((left, right) => right.count - left.count || right.averageScore - left.averageScore);
}

function buildSignalRows(items: NewsV2Item[], fallback: NewsV2SignalActivity[]): SignalSummary[] {
  const groups = groupItems(items, (item) => item.themes[0] || item.eventType);
  if (!groups.size) {
    return fallback.map((item) => ({ ...item, label: item.label, averageMove: undefined, subThemes: [] }));
  }
  return Array.from(groups.entries())
    .map(([label, rows]) => {
      const subGroups = groupItems(rows, (row) => row.themes[1] || row.eventType);
      return {
        label,
        count: rows.length,
        averageScore: average(rows.map((row) => row.score)),
        averageMove: averageMove(rows),
        sentiment: dominantSignal(rows),
        subThemes: Array.from(subGroups.entries())
          .map(([subLabel, subRows]) => ({
            label: subLabel,
            count: subRows.length,
            averageScore: average(subRows.map((row) => row.score)),
            averageMove: averageMove(subRows),
            tickers: uniqueTickers(subRows),
          }))
          .sort((left, right) => right.count - left.count || right.averageScore - left.averageScore)
          .slice(0, 6),
      };
    })
    .sort((left, right) => right.count - left.count || right.averageScore - left.averageScore)
    .slice(0, 6);
}

function summarizeGroups(items: NewsV2Item[], labelFor: (item: NewsV2Item) => string): ThemeSummary[] {
  return Array.from(groupItems(items, labelFor).entries())
    .map(([label, rows]) => ({
      label,
      count: rows.length,
      averageScore: average(rows.map((row) => row.score)),
      averageMove: averageMove(rows),
    }))
    .sort((left, right) => right.count - left.count || right.averageScore - left.averageScore);
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

function groupItems(items: NewsV2Item[], labelFor: (item: NewsV2Item) => string) {
  const groups = new Map<string, NewsV2Item[]>();
  for (const item of items) {
    const label = labelFor(item).trim();
    if (!label) continue;
    const rows = groups.get(label) ?? [];
    rows.push(item);
    groups.set(label, rows);
  }
  return groups;
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function averageMove(items: NewsV2Item[]) {
  const values = items
    .map((item) => Number.parseFloat(item.changePercent?.replace("%", "") ?? ""))
    .filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function dominantSignal(items: NewsV2Item[]): NewsV2Signal {
  const counts = new Map<NewsV2Signal, number>();
  for (const item of items) counts.set(item.sentiment, (counts.get(item.sentiment) ?? 0) + 1);
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Neutral";
}

function uniqueTickers(items: NewsV2Item[]) {
  const tickers = new Map<string, string | undefined>();
  for (const item of items) {
    for (const ticker of item.relatedTickers) {
      if (!tickers.has(ticker)) tickers.set(ticker, item.changePercent);
    }
  }
  return Array.from(tickers, ([symbol, change]) => ({ symbol, change })).slice(0, 3);
}

function sourceCategory(source: string) {
  return /sec|fda|ofac|doj|dea|white house|federal/i.test(source) ? "Official source" : "News";
}

function formatMove(value?: number) {
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMoveOrCount(item: ThemeSummary) {
  return item.averageMove === undefined ? `${item.count} news` : formatMove(item.averageMove);
}

function moveToneClass(value?: number) {
  if (value === undefined || value === 0) return styles.neutralValue;
  return value > 0 ? styles.positiveValue : styles.negativeValue;
}
