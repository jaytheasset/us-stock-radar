"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilingsV2DetailPanel, MobileFilingsV2DetailSheet } from "@/components/filings-v2/FilingsV2Detail";
import { FilingsV2FilterBar } from "@/components/filings-v2/FilingsV2FilterBar";
import { FilingsV2List, type FilingsV2ListState } from "@/components/filings-v2/FilingsV2List";
import { FilingsRailAdSlot } from "@/components/filings-v2/FilingsRailAdSlot";
import { FilingsV2Summary } from "@/components/filings-v2/FilingsV2Summary";
import { MobileFilingsV2FilterSheet } from "@/components/filings-v2/MobileFilingsV2FilterSheet";
import { PremiumUpgradeCard } from "@/components/filings-v2/PremiumUpgradeCard";
import { resolveFilingsV2SelectedRecord } from "@/components/filings-v2/filingsV2Selection";
import { useLiveReferenceDate } from "@/components/ui/useLiveReferenceDate";
import {
  filingsV2DefaultFilters,
  type FilingsV2Cursor,
  type FilingsV2FilterGroup,
  type FilingsV2FilterState,
  type FilingsV2PageResponse,
  type FilingsV2Record,
  type FilingsV2SummaryMetrics,
} from "@/lib/filingsV2Model";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFilingsV2.module.css";

function buildFilingsV2RequestUrl(
  filters: FilingsV2FilterState,
  query: string,
  cursor: FilingsV2Cursor | null,
  includeTotal: boolean,
) {
  const searchParams = new URLSearchParams();
  const filterParams: Array<[string, readonly string[]]> = [
    ["signals", filters.signals],
    ["market_caps", filters.marketCaps],
    ["form_types", filters.formTypes],
    ["event_types", filters.eventTypes],
    ["impacts", filters.impacts],
    ["date_ranges", filters.dateRanges],
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

  return `/api/filings-v2?${searchParams.toString()}`;
}

type StockRadarFilingsV2Props = {
  formOptions: readonly string[];
  hasMore: boolean;
  nextCursor: FilingsV2Cursor | null;
  preferredSourceUrl?: string | null;
  records: readonly FilingsV2Record[];
  referenceDate: string;
  state: FilingsV2ListState;
  summary: FilingsV2SummaryMetrics;
  totalCount: number;
  viewerPlan: Plan;
};

export function StockRadarFilingsV2({
  formOptions,
  hasMore,
  nextCursor,
  preferredSourceUrl,
  records,
  referenceDate,
  state,
  summary,
  totalCount,
  viewerPlan,
}: StockRadarFilingsV2Props) {
  const liveReferenceDate = useLiveReferenceDate(referenceDate);
  const [filters, setFilters] = useState<FilingsV2FilterState>(filingsV2DefaultFilters);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [pageRecords, setPageRecords] = useState<FilingsV2Record[]>([...records]);
  const [pageTotalCount, setPageTotalCount] = useState(totalCount);
  const [pageHasMore, setPageHasMore] = useState(hasMore);
  const [pageCursor, setPageCursor] = useState<FilingsV2Cursor | null>(nextCursor);
  const [listState, setListState] = useState<FilingsV2ListState>(state);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? "");
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [previewRequestId, setPreviewRequestId] = useState(0);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const detailSelectionAnchorRef = useRef<HTMLDivElement | null>(null);
  const detailRailRef = useRef<HTMLElement | null>(null);
  const detailRailScrollProgressRef = useRef(0);
  const filterOpenerRef = useRef<HTMLButtonElement | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const requestKey = useMemo(() => JSON.stringify({ filters, query }), [filters, query]);
  const lastRequestKeyRef = useRef(requestKey);
  const remainingCount = Math.max(pageTotalCount - pageRecords.length, 0);
  const tallRailAdCount = Math.max(1, Math.ceil(pageRecords.length / 12) - 1);
  const selectedRecord = resolveFilingsV2SelectedRecord(pageRecords, selectedId);
  const relatedRecords = selectedRecord?.relatedFilings ?? [];

  useEffect(() => {
    if (pageRecords.length > 0 && !pageRecords.some((record) => record.id === selectedId)) {
      setSelectedId(pageRecords[0].id);
    }
  }, [pageRecords, selectedId]);

  useEffect(() => {
    if (lastRequestKeyRef.current === requestKey) return;
    lastRequestKeyRef.current = requestKey;

    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    setIsRefreshing(true);
    setIsDetailSheetOpen(false);

    void fetch(buildFilingsV2RequestUrl(filters, query, null, true), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as FilingsV2PageResponse;
        if (!response.ok || payload.state !== "ready") {
          throw new Error("Filing data unavailable");
        }

        setPageRecords(payload.records);
        setPageTotalCount(payload.totalCount ?? payload.records.length);
        setPageHasMore(payload.hasMore);
        setPageCursor(payload.nextCursor);
        setListState("ready");
        setSelectedId(payload.records[0]?.id ?? "");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPageRecords([]);
        setPageTotalCount(0);
        setPageHasMore(false);
        setPageCursor(null);
        setListState("unavailable");
        setSelectedId("");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsRefreshing(false);
      });

    return () => controller.abort();
  }, [filters, query, requestKey]);

  useEffect(() => {
    return () => loadMoreControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (previewRequestId === 0) return;

    const selectionAnchor = detailSelectionAnchorRef.current;
    const rail = detailRailRef.current;
    if (!selectionAnchor || !rail) return;

    const selectionAnchorTop = selectionAnchor.getBoundingClientRect().top;
    const railTop = rail.getBoundingClientRect().top;
    const maxScrollTop = Math.max(rail.scrollHeight - rail.clientHeight, 0);
    const selectionScrollTop = Math.min(
      Math.max(rail.scrollTop + selectionAnchorTop - railTop, 0),
      maxScrollTop,
    );
    detailRailScrollProgressRef.current = selectionScrollTop;
    rail.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      top: selectionScrollTop,
    });
  }, [previewRequestId]);

  useEffect(() => {
    const desktopRailQuery = window.matchMedia("(min-width: 1181px)");
    let previousScrollY = window.scrollY;
    let pendingScrollDelta = 0;
    let animationFrameId: number | null = null;

    const syncDetailRail = () => {
      animationFrameId = null;

      const rail = detailRailRef.current;
      const scrollDelta = pendingScrollDelta;
      pendingScrollDelta = 0;

      if (!desktopRailQuery.matches) {
        detailRailScrollProgressRef.current = 0;
        return;
      }
      if (!rail) return;

      if (window.scrollY <= 0) {
        detailRailScrollProgressRef.current = 0;
        rail.scrollTo({ behavior: "auto", top: 0 });
        return;
      }

      if (scrollDelta === 0) return;

      const stickyTop = Number.parseFloat(window.getComputedStyle(rail).top) || 0;
      if (rail.getBoundingClientRect().top > stickyTop + 1) return;

      const maxScrollTop = Math.max(rail.scrollHeight - rail.clientHeight, 0);
      detailRailScrollProgressRef.current = Math.max(
        detailRailScrollProgressRef.current + scrollDelta,
        0,
      );
      const nextScrollTop = Math.min(detailRailScrollProgressRef.current, maxScrollTop);
      rail.scrollTo({ behavior: "auto", top: nextScrollTop });
    };

    const handlePageScroll = () => {
      const currentScrollY = window.scrollY;
      pendingScrollDelta += currentScrollY - previousScrollY;
      previousScrollY = currentScrollY;

      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(syncDetailRail);
      }
    };

    window.addEventListener("scroll", handlePageScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handlePageScroll);
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const toggleFilter = (group: FilingsV2FilterGroup, value: string) => {
    setFilters((current) => ({
      ...current,
      [group]: current[group].includes(value as never)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }) as FilingsV2FilterState);
  };
  const removeFilter = (group: FilingsV2FilterGroup, value: string) => {
    setFilters((current) => ({
      ...current,
      [group]: current[group].filter((item) => item !== value),
    }) as FilingsV2FilterState);
  };
  const clearFilterGroup = (group: FilingsV2FilterGroup) => {
    setFilters((current) => ({ ...current, [group]: [] }));
  };
  const resetFilters = () => {
    setFilters(filingsV2DefaultFilters);
    setSearchInput("");
    setQuery("");
  };
  const clearSearch = () => {
    setSearchInput("");
    setQuery("");
  };
  const showMoreRecords = () => {
    if (!pageHasMore || !pageCursor || isLoadingMore) return;

    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);

    void fetch(buildFilingsV2RequestUrl(filters, query, pageCursor, false), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as FilingsV2PageResponse;
        if (!response.ok || payload.state !== "ready") {
          throw new Error("Additional filings unavailable");
        }

        setPageRecords((current) => {
          const knownIds = new Set(current.map((record) => record.id));
          return [...current, ...payload.records.filter((record) => !knownIds.has(record.id))];
        });
        setPageHasMore(payload.hasMore);
        setPageCursor(payload.nextCursor);
        setListState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setListState("partial");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingMore(false);
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
      });
  };
  const searchFilings = () => {
    setQuery(searchInput.trim());
  };
  const closeMobileFilters = () => {
    setIsFilterSheetOpen(false);
  };
  const selectRecord = (record: FilingsV2Record, opener: HTMLElement) => {
    const usesDesktopRail = window.matchMedia("(min-width: 1181px)").matches;

    setSelectedId(record.id);
    if (usesDesktopRail) {
      setPreviewRequestId((current) => current + 1);
    }
    if (window.matchMedia("(max-width: 760px)").matches) {
      detailOpenerRef.current = opener;
      setIsFilterSheetOpen(false);
      setIsDetailSheetOpen(true);
    }
  };
  const openMobileFilters = () => {
    setIsDetailSheetOpen(false);
    setIsFilterSheetOpen(true);
  };

  return (
    <div className={styles.root}>
      <section className={styles.primaryColumn}>
        <h1 className={styles.visuallyHidden}>Filings</h1>
        <FilingsV2Summary summary={summary} />
        <div className={styles.controlBand}>
          <FilingsV2FilterBar
            appliedQuery={query}
            filters={filters}
            formOptions={formOptions}
            isMobileSheetOpen={isFilterSheetOpen}
            mobileFilterOpenerRef={filterOpenerRef}
            onClearQuery={clearSearch}
            onClearFilterGroup={clearFilterGroup}
            onOpenMobileFilters={openMobileFilters}
            onQueryChange={setSearchInput}
            onRemoveFilter={removeFilter}
            onReset={resetFilters}
            onSearch={searchFilings}
            onToggleFilter={toggleFilter}
            query={searchInput}
          />
        </div>
        <FilingsV2List
          isLoadingMore={isLoadingMore}
          onLoadMore={pageHasMore && remainingCount > 0 ? showMoreRecords : undefined}
          onSelect={selectRecord}
          preferredSourceUrl={preferredSourceUrl}
          records={pageRecords}
          referenceDate={liveReferenceDate}
          remainingCount={remainingCount}
          selectedId={selectedId}
          state={isRefreshing ? "loading" : listState}
          totalCount={pageTotalCount}
          viewerPlan={viewerPlan}
        />
      </section>

      <aside className={styles.detailRail} ref={detailRailRef}>
        {viewerPlan !== "ultimate" ? (
          <div>
            <PremiumUpgradeCard
              className={styles.premiumCtaDesktop}
              viewerPlan={viewerPlan}
            />
          </div>
        ) : null}
        {selectedRecord ? (
          <div
            className={styles.detailRailPreview}
            ref={detailSelectionAnchorRef}
          >
            <FilingsV2DetailPanel
              record={selectedRecord}
              relatedRecords={relatedRecords}
            />
          </div>
        ) : null}
        <div className={styles.detailRailAdFill}>
          {Array.from({ length: tallRailAdCount }, (_, index) => (
            <div className={styles.detailRailAdAnchor} key={`filings-rail-ad-${index}`}>
              <FilingsRailAdSlot size="300x600" />
            </div>
          ))}
        </div>
      </aside>

      {selectedRecord ? (
        <MobileFilingsV2DetailSheet
          isOpen={isDetailSheetOpen}
          onDismiss={() => setIsDetailSheetOpen(false)}
          openerRef={detailOpenerRef}
          record={selectedRecord}
          relatedRecords={relatedRecords}
        />
      ) : null}
      <MobileFilingsV2FilterSheet
        filters={filters}
        formOptions={formOptions}
        isOpen={isFilterSheetOpen}
        onApply={closeMobileFilters}
        onClearFilterGroup={clearFilterGroup}
        onDismiss={() => setIsFilterSheetOpen(false)}
        onReset={resetFilters}
        onToggleFilter={toggleFilter}
        openerRef={filterOpenerRef}
      />
    </div>
  );
}
