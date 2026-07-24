"use client";

import { useMemo, useRef, useState } from "react";
import { MobileNewsV2FilterSheet } from "@/components/news-v2/MobileNewsV2FilterSheet";
import {
  NewsV2FilterBar,
  type NewsV2FilterGroup,
  type NewsV2FilterOptions,
  type NewsV2Filters,
} from "@/components/news-v2/NewsV2FilterBar";
import { NewsV2InsightRail } from "@/components/news-v2/NewsV2InsightRail";
import { NewsV2List } from "@/components/news-v2/NewsV2List";
import type {
  NewsV2Item,
  NewsV2PageData,
} from "@/lib/newsV2";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarNewsV2.module.css";

const newsBatchSize = 25;

const emptyFilters: NewsV2Filters = {
  sentiments: [],
  marketCaps: [],
  eventTypes: [],
  sources: [],
  sectors: [],
  themes: [],
};

type StockRadarNewsV2Props = NewsV2PageData & {
  preferredSourceUrl?: string | null;
  viewerPlan: Plan;
};

export function StockRadarNewsV2({
  items,
  total,
  sourceActivity,
  sectorActivity,
  signalActivity,
  error,
  preferredSourceUrl,
  viewerPlan,
}: StockRadarNewsV2Props) {
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<NewsV2Filters>(emptyFilters);
  const [visibleCount, setVisibleCount] = useState(newsBatchSize);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const mobileFilterOpenerRef = useRef<HTMLButtonElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filterOptions = useMemo(() => buildFilterOptions(items), [items]);

  const filteredItems = items.filter((item) => {
    const queryTarget = [
      item.headline,
      item.summary,
      item.source,
      item.eventType,
      ...item.relatedTickers,
      ...item.relatedSectors,
      ...item.themes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (!normalizedQuery || queryTarget.includes(normalizedQuery)) &&
      (!filters.sentiments.length || filters.sentiments.includes(item.sentiment)) &&
      (!filters.marketCaps.length ||
        (item.marketCapBand !== undefined && filters.marketCaps.includes(item.marketCapBand))) &&
      (!filters.eventTypes.length || filters.eventTypes.includes(item.eventType)) &&
      (!filters.sources.length || filters.sources.includes(item.source)) &&
      (!filters.sectors.length || item.relatedSectors.some((sector) => filters.sectors.includes(sector))) &&
      (!filters.themes.length || item.themes.some((theme) => filters.themes.includes(theme)))
    );
  });

  const visibleItems = filteredItems.slice(0, visibleCount);
  const remainingCount = filteredItems.length - visibleItems.length;
  const showMarketReaction = visibleItems.some(
    (item) => item.priceLabel || item.changePercent || item.trend.length >= 2 || item.relatedTickers.length > 0,
  );

  const toggleFilter = (group: NewsV2FilterGroup, value: string) => {
    setFilters((current) => ({
      ...current,
      [group]: current[group].includes(value as never)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }) as NewsV2Filters);
    setVisibleCount(newsBatchSize);
  };

  const removeFilter = (group: NewsV2FilterGroup, value: string) => {
    setFilters((current) => ({
      ...current,
      [group]: current[group].filter((item) => item !== value),
    }) as NewsV2Filters);
    setVisibleCount(newsBatchSize);
  };

  const clearFilterGroup = (group: NewsV2FilterGroup) => {
    setFilters((current) => ({ ...current, [group]: [] }));
    setVisibleCount(newsBatchSize);
  };

  const resetFilters = () => {
    setQueryDraft("");
    setQuery("");
    setFilters(emptyFilters);
    setVisibleCount(newsBatchSize);
  };

  return (
    <div className={styles.root}>
      <div className={styles.workspace}>
        <div className={styles.mainColumn}>
          <NewsV2FilterBar
            filterOptions={filterOptions}
            filters={filters}
            mobileFilterOpenerRef={mobileFilterOpenerRef}
            onClearFilterGroup={clearFilterGroup}
            onOpenMobileFilters={() => setIsMobileFilterOpen(true)}
            onQueryDraftChange={setQueryDraft}
            onRemoveFilter={removeFilter}
            onReset={resetFilters}
            onSearch={() => {
              setQuery(queryDraft);
              setVisibleCount(newsBatchSize);
            }}
            onToggleFilter={toggleFilter}
            queryDraft={queryDraft}
          />

          <NewsV2List
            error={error}
            items={visibleItems}
            loadedTotal={items.length}
            onLoadMore={remainingCount > 0
              ? () => setVisibleCount((count) => Math.min(count + newsBatchSize, filteredItems.length))
              : undefined}
            preferredSourceUrl={preferredSourceUrl}
            remainingCount={remainingCount}
            showMarketReaction={showMarketReaction}
            totalItems={filteredItems.length}
            totalNews={total}
            viewerPlan={viewerPlan}
          />
        </div>
        <NewsV2InsightRail
          items={items}
          sectorActivity={sectorActivity}
          signalActivity={signalActivity}
          sourceActivity={sourceActivity}
          total={total}
          visibleItemCount={visibleItems.length}
          viewerPlan={viewerPlan}
        />
      </div>

      <MobileNewsV2FilterSheet
        filterOptions={filterOptions}
        filters={filters}
        isOpen={isMobileFilterOpen}
        onClearFilterGroup={clearFilterGroup}
        onDismiss={() => setIsMobileFilterOpen(false)}
        onReset={resetFilters}
        onToggleFilter={toggleFilter}
        openerRef={mobileFilterOpenerRef}
      />
    </div>
  );
}

function buildFilterOptions(items: NewsV2Item[]): NewsV2FilterOptions {
  const unique = (values: Array<string | undefined>) =>
    Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();

  return {
    eventTypes: unique(items.map((item) => item.eventType)),
    sources: unique(items.map((item) => item.source)),
    sectors: unique(items.flatMap((item) => item.relatedSectors)),
    themes: unique(items.flatMap((item) => item.themes)),
  };
}
