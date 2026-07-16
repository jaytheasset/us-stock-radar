"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilingsV2DetailPanel, MobileFilingsV2DetailSheet } from "@/components/filings-v2/FilingsV2Detail";
import { FilingsV2FilterBar } from "@/components/filings-v2/FilingsV2FilterBar";
import { FilingsV2Header } from "@/components/filings-v2/FilingsV2Header";
import { FilingsV2List, type FilingsV2ListState } from "@/components/filings-v2/FilingsV2List";
import { FilingsV2Summary } from "@/components/filings-v2/FilingsV2Summary";
import { MobileFilingsV2FilterSheet } from "@/components/filings-v2/MobileFilingsV2FilterSheet";
import { SegmentedControl, type SegmentedControlItem } from "@/components/ui/SegmentedControl";
import type { PaginationItem } from "@/components/ui/Pagination";
import {
  filingsV2DefaultFilters,
  filingsV2EventLabels,
  filingsV2HighImpactMinimum,
  filingsV2LastUpdated,
  filingsV2Records,
  filingsV2ReferenceDate,
  matchesFilingsV2ImpactFilter,
  type FilingsV2Category,
  type FilingsV2FilterState,
  type FilingsV2Record,
  type FilingsV2Sort,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

const pageSize = 25;
const mockAvailability: "available" | "unavailable" = "available";

const categoryItems: readonly SegmentedControlItem<FilingsV2Category>[] = [
  { label: "All Filings", value: "all" },
  { label: "High Impact", value: "high-impact" },
  { label: "Watchlist", value: "watchlist" },
];

function daysForRange(range: FilingsV2FilterState["dateRange"]) {
  if (range === "24 Hours") return 1;
  if (range === "7 Days") return 7;
  if (range === "30 Days") return 30;
  return null;
}

function getPaginationItems(totalPages: number, currentPage: number): readonly PaginationItem[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const middle = Math.min(Math.max(currentPage, 2), totalPages - 1);
  return [1, middle, "ellipsis", totalPages];
}

export function StockRadarFilingsV2() {
  const [category, setCategory] = useState<FilingsV2Category>("all");
  const [filters, setFilters] = useState<FilingsV2FilterState>(filingsV2DefaultFilters);
  const [draftFilters, setDraftFilters] = useState<FilingsV2FilterState>(filingsV2DefaultFilters);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FilingsV2Sort>("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState(filingsV2Records[0].id);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [detailNotice, setDetailNotice] = useState("");
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const filterOpenerRef = useRef<HTMLElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const referenceTime = new Date(filingsV2ReferenceDate).getTime();
    const rangeDays = daysForRange(filters.dateRange);

    return filingsV2Records
      .filter((record) => {
        if (category === "high-impact" && record.impact < filingsV2HighImpactMinimum) return false;
        if (category === "watchlist" && !record.watchlist) return false;
        if (filters.formType !== "All" && record.formType !== filters.formType) return false;
        if (filters.eventType !== "All" && !record.events.includes(filters.eventType)) return false;
        if (!matchesFilingsV2ImpactFilter(record.impact, filters.impact)) return false;
        if (filters.signal !== "All" && record.signal !== filters.signal) return false;
        if (filters.marketCap !== "All" && record.marketCap !== filters.marketCap) return false;
        if (rangeDays !== null) {
          const age = referenceTime - new Date(record.filedAt).getTime();
          if (age < 0 || age > rangeDays * 24 * 60 * 60 * 1000) return false;
        }
        if (!normalizedQuery) return true;

        const searchText = [
          record.ticker,
          record.company,
          record.formType,
          record.title,
          record.summary,
          record.accession,
          ...record.events.map((event) => filingsV2EventLabels[event]),
        ].filter(Boolean).join(" ").toLowerCase();
        return searchText.includes(normalizedQuery);
      })
      .sort((left, right) => {
        const difference = new Date(right.filedAt).getTime() - new Date(left.filedAt).getTime();
        return sort === "newest" ? difference : -difference;
      });
  }, [category, filters, query, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const visibleRecords = filteredRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedRecord = filingsV2Records.find((record) => record.id === selectedId) ?? filingsV2Records[0];
  const relatedRecords = selectedRecord.relatedIds
    .map((id) => filingsV2Records.find((record) => record.id === id))
    .filter((record): record is FilingsV2Record => Boolean(record));
  const listState: FilingsV2ListState = isRefreshing
    ? "loading"
    : mockAvailability === "unavailable"
      ? "unavailable"
      : "ready";

  useEffect(() => {
    setCurrentPage(1);
  }, [category, filters, query, sort]);

  useEffect(() => {
    if (filteredRecords.length > 0 && !filteredRecords.some((record) => record.id === selectedId)) {
      setSelectedId(filteredRecords[0].id);
    }
  }, [filteredRecords, selectedId]);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const updateFilters = (key: keyof FilingsV2FilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value } as FilingsV2FilterState));
  };
  const updateDraftFilters = (key: keyof FilingsV2FilterState, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value } as FilingsV2FilterState));
  };
  const selectRecord = (record: FilingsV2Record, opener: HTMLElement) => {
    setSelectedId(record.id);
    setDetailNotice("");
    if (window.matchMedia("(max-width: 760px)").matches) {
      detailOpenerRef.current = opener;
      setIsFilterSheetOpen(false);
      setIsDetailSheetOpen(true);
    }
  };
  const openMobileFilters = (trigger: HTMLButtonElement) => {
    filterOpenerRef.current = trigger;
    setDraftFilters(filters);
    setIsDetailSheetOpen(false);
    setIsFilterSheetOpen(true);
  };
  const refreshMockData = () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    setIsRefreshing(true);
    refreshTimerRef.current = window.setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 560);
  };
  const showMockDetailNotice = () => {
    setDetailNotice("Mock only — the filing analysis route is not connected.");
  };

  return (
    <div className={styles.root}>
      <section className={styles.primaryColumn}>
        <FilingsV2Header
          count={filteredRecords.length}
          isRefreshing={isRefreshing}
          lastUpdated={filingsV2LastUpdated}
          onQueryChange={setQuery}
          onRefresh={refreshMockData}
          onSortChange={setSort}
          query={query}
          sort={sort}
        />
        <FilingsV2Summary records={filingsV2Records} />
        <div className={styles.controlBand}>
          <SegmentedControl
            ariaLabel="Filing category"
            items={categoryItems}
            onValueChange={setCategory}
            value={category}
          />
          <FilingsV2FilterBar
            filters={filters}
            isMobileSheetOpen={isFilterSheetOpen}
            onChange={updateFilters}
            onOpenMobileFilters={openMobileFilters}
          />
        </div>
        <FilingsV2List
          currentPage={currentPage}
          items={getPaginationItems(totalPages, currentPage)}
          onPageChange={setCurrentPage}
          onSelect={selectRecord}
          records={visibleRecords}
          selectedId={selectedId}
          state={listState}
          totalCount={filteredRecords.length}
          totalPages={totalPages}
        />
      </section>

      <aside className={styles.detailRail}>
        <FilingsV2DetailPanel
          detailNotice={detailNotice}
          onMockDetails={showMockDetailNotice}
          record={selectedRecord}
          relatedRecords={relatedRecords}
        />
      </aside>

      <MobileFilingsV2DetailSheet
        detailNotice={detailNotice}
        isOpen={isDetailSheetOpen}
        onDismiss={() => setIsDetailSheetOpen(false)}
        onMockDetails={showMockDetailNotice}
        openerRef={detailOpenerRef}
        record={selectedRecord}
        relatedRecords={relatedRecords}
      />
      <MobileFilingsV2FilterSheet
        filters={draftFilters}
        isOpen={isFilterSheetOpen}
        onApply={() => {
          setFilters(draftFilters);
          setIsFilterSheetOpen(false);
        }}
        onChange={updateDraftFilters}
        onClear={() => setDraftFilters(filingsV2DefaultFilters)}
        onDismiss={() => setIsFilterSheetOpen(false)}
        openerRef={filterOpenerRef}
      />
    </div>
  );
}
