"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MobileNewsV2FilterSheet } from "@/components/news-v2/MobileNewsV2FilterSheet";
import {
  NewsV2FilterBar,
  type NewsV2FilterGroup,
  type NewsV2Filters,
} from "@/components/news-v2/NewsV2FilterBar";
import { NewsV2InsightRail } from "@/components/news-v2/NewsV2InsightRail";
import { NewsV2List } from "@/components/news-v2/NewsV2List";
import { useLiveReferenceDate } from "@/components/ui/useLiveReferenceDate";
import type {
  NewsV2Cursor,
  NewsV2Item,
  NewsV2PageData,
  NewsV2PageResponse,
  NewsV2SourceActivity,
  NewsV2ThemeActivity,
} from "@/lib/newsV2";
import { hasResettableNewsV2State } from "@/lib/newsV2FilterState";
import { resolveNewsV2FlowState } from "@/lib/newsV2FlowState";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarNewsV2.module.css";

const emptyFilters: NewsV2Filters = {
  sentiments: [],
  marketCaps: [],
  eventTypes: [],
  sources: [],
  sectors: [],
  themes: [],
};

function buildNewsV2RequestUrl(
  filters: NewsV2Filters,
  query: string,
  cursor: NewsV2Cursor | null,
  includeTotal: boolean,
) {
  const searchParams = new URLSearchParams();
  const filterParams: Array<[string, readonly string[]]> = [
    ["sentiments", filters.sentiments],
    ["market_caps", filters.marketCaps],
    ["event_types", filters.eventTypes],
    ["sources", filters.sources],
    ["sectors", filters.sectors],
    ["themes", filters.themes],
  ];

  for (const [name, values] of filterParams) {
    for (const value of values) searchParams.append(name, value);
  }
  if (query.trim()) searchParams.set("query", query.trim());
  if (cursor) {
    searchParams.set("cursor_id", cursor.id);
    searchParams.set("cursor_published_at", cursor.publishedAt);
  }
  searchParams.set("include_total", String(includeTotal));

  return `/api/news-v2?${searchParams.toString()}`;
}

type StockRadarNewsV2Props = NewsV2PageData & {
  preferredSourceUrl?: string | null;
  referenceDate: string;
  viewerPlan: Plan;
};

export function StockRadarNewsV2({
  items,
  total,
  hasMore,
  nextCursor,
  filterOptions,
  sourceActivity,
  sectorActivity,
  signalActivity,
  themeActivity,
  error,
  preferredSourceUrl,
  referenceDate,
  viewerPlan,
}: StockRadarNewsV2Props) {
  const liveReferenceDate = useLiveReferenceDate(referenceDate);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<NewsV2Filters>(emptyFilters);
  const [pageItems, setPageItems] = useState<NewsV2Item[]>(items);
  const [pageTotal, setPageTotal] = useState(total);
  const [pageHasMore, setPageHasMore] = useState(hasMore);
  const [pageCursor, setPageCursor] = useState<NewsV2Cursor | null>(nextCursor);
  const [pageSourceActivity, setPageSourceActivity] =
    useState<NewsV2SourceActivity[]>(sourceActivity);
  const [pageThemeActivity, setPageThemeActivity] =
    useState<NewsV2ThemeActivity[]>(themeActivity);
  const [pageError, setPageError] = useState(error);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const mobileFilterOpenerRef = useRef<HTMLButtonElement | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const refreshRequestIdRef = useRef(0);
  const requestKey = useMemo(() => JSON.stringify({ filters, query }), [filters, query]);
  const lastRequestKeyRef = useRef(requestKey);
  const remainingCount = Math.max(pageTotal - pageItems.length, 0);
  const canReset = hasResettableNewsV2State(filters, queryDraft, query);
  const flowState = resolveNewsV2FlowState({
    filters,
    hasError: Boolean(pageError),
    isLoading: isRefreshing || isLoadingMore,
    itemCount: pageItems.length,
    query,
    totalCount: pageTotal,
  });
  const showMarketReaction = pageItems.some(
    (item) =>
      item.priceLabel ||
      item.changePercent ||
      item.trend.length >= 2 ||
      item.relatedTickers.length > 0,
  );

  useEffect(() => {
    if (lastRequestKeyRef.current === requestKey) return;
    lastRequestKeyRef.current = requestKey;

    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setIsLoadingMore(false);
    const controller = new AbortController();
    const requestId = ++refreshRequestIdRef.current;
    setIsRefreshing(true);
    setPageError(undefined);

    void fetch(buildNewsV2RequestUrl(filters, query, null, true), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as NewsV2PageResponse;
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "News data unavailable");
        }
        if (
          controller.signal.aborted ||
          refreshRequestIdRef.current !== requestId ||
          lastRequestKeyRef.current !== requestKey
        ) {
          return;
        }

        setPageItems(payload.items);
        setPageTotal(payload.totalCount ?? payload.items.length);
        setPageHasMore(payload.hasMore);
        setPageCursor(payload.nextCursor);
        setPageSourceActivity(payload.statistics?.sourceActivity ?? []);
        setPageThemeActivity(payload.statistics?.themeActivity ?? []);
      })
      .catch((requestError: unknown) => {
        if (
          controller.signal.aborted ||
          refreshRequestIdRef.current !== requestId ||
          lastRequestKeyRef.current !== requestKey ||
          (requestError instanceof DOMException && requestError.name === "AbortError")
        ) {
          return;
        }
        setPageItems([]);
        setPageTotal(0);
        setPageHasMore(false);
        setPageCursor(null);
        setPageSourceActivity([]);
        setPageThemeActivity([]);
        setPageError("News data is currently unavailable.");
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          refreshRequestIdRef.current === requestId &&
          lastRequestKeyRef.current === requestKey
        ) {
          setIsRefreshing(false);
        }
      });

    return () => controller.abort();
  }, [filters, query, requestKey]);

  useEffect(() => {
    return () => loadMoreControllerRef.current?.abort();
  }, []);

  const toggleFilter = (group: NewsV2FilterGroup, value: string) => {
    setFilters((current) => ({
      ...current,
      [group]: current[group].includes(value as never)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }) as NewsV2Filters);
  };

  const removeFilter = (group: NewsV2FilterGroup, value: string) => {
    setFilters((current) => ({
      ...current,
      [group]: current[group].filter((item) => item !== value),
    }) as NewsV2Filters);
  };

  const clearFilterGroup = (group: NewsV2FilterGroup) => {
    setFilters((current) => ({ ...current, [group]: [] }));
  };

  const resetFilters = () => {
    setQueryDraft("");
    setQuery("");
    setFilters(emptyFilters);
  };

  const showMoreNews = () => {
    if (!pageHasMore || !pageCursor || isLoadingMore) return;

    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    const loadMoreRequestKey = requestKey;
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);

    void fetch(buildNewsV2RequestUrl(filters, query, pageCursor, false), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as NewsV2PageResponse;
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Additional news unavailable");
        }
        if (
          controller.signal.aborted ||
          lastRequestKeyRef.current !== loadMoreRequestKey
        ) {
          return;
        }

        setPageItems((current) => {
          const knownIds = new Set(current.map((item) => item.id));
          return [...current, ...payload.items.filter((item) => !knownIds.has(item.id))];
        });
        setPageHasMore(payload.hasMore);
        setPageCursor(payload.nextCursor);
      })
      .catch((requestError: unknown) => {
        if (
          controller.signal.aborted ||
          lastRequestKeyRef.current !== loadMoreRequestKey ||
          (requestError instanceof DOMException && requestError.name === "AbortError")
        ) {
          return;
        }
        setPageError("Additional news is currently unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingMore(false);
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
      });
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
            canReset={canReset}
            onOpenMobileFilters={() => setIsMobileFilterOpen(true)}
            onQueryDraftChange={setQueryDraft}
            onRemoveFilter={removeFilter}
            onReset={resetFilters}
            onSearch={() => setQuery(queryDraft.trim())}
            onTickerSelect={(ticker) => {
              setQueryDraft(ticker);
              setQuery(ticker);
            }}
            onToggleFilter={toggleFilter}
            preferredSourceUrl={preferredSourceUrl}
            queryDraft={queryDraft}
          />

          <div
            aria-busy={flowState.status === "loading"}
            className={styles.listPanelAnchor}
            data-news-has-active-criteria={flowState.hasActiveCriteria}
            data-news-state={flowState.status}
            data-news-total-count={flowState.totalCount}
            data-news-visible-count={flowState.visibleCount}
          >
            <NewsV2List
              flowState={flowState}
              items={pageItems}
              onLoadMore={pageHasMore && pageCursor ? showMoreNews : undefined}
              preferredSourceUrl={preferredSourceUrl}
              referenceDate={liveReferenceDate}
              remainingCount={remainingCount}
              showMarketReaction={showMarketReaction}
              viewerPlan={viewerPlan}
            />
          </div>
        </div>
        <NewsV2InsightRail
          sectorActivity={sectorActivity}
          signalActivity={signalActivity}
          sourceActivity={pageSourceActivity}
          themeActivity={pageThemeActivity}
          total={pageTotal}
          visibleItemCount={pageItems.length}
          viewerPlan={viewerPlan}
        />
      </div>

      <MobileNewsV2FilterSheet
        filterOptions={filterOptions}
        filters={filters}
        canReset={canReset}
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
