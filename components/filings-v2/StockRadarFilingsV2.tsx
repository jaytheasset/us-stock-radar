"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilingsV2DetailPanel, MobileFilingsV2DetailSheet } from "@/components/filings-v2/FilingsV2Detail";
import { FilingsV2FilterBar } from "@/components/filings-v2/FilingsV2FilterBar";
import { FilingsV2Header } from "@/components/filings-v2/FilingsV2Header";
import { FilingsV2List, type FilingsV2ListState } from "@/components/filings-v2/FilingsV2List";
import { FilingsV2Summary } from "@/components/filings-v2/FilingsV2Summary";
import { MobileFilingsV2FilterSheet } from "@/components/filings-v2/MobileFilingsV2FilterSheet";
import type { PaginationItem } from "@/components/ui/Pagination";
import {
  filingsV2DefaultFilters,
  filingsV2EventLabels,
  filingsV2LastUpdated,
  filingsV2Records,
  filingsV2ReferenceDate,
  matchesFilingsV2ImpactFilter,
  type FilingsV2DateRange,
  type FilingsV2FilterGroup,
  type FilingsV2FilterState,
  type FilingsV2Record,
  type FilingsV2Sort,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

const pageSize = 100;
const mockAvailability: "available" | "unavailable" = "available";

function daysForRange(range: FilingsV2DateRange) {
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
  const [filters, setFilters] = useState<FilingsV2FilterState>(filingsV2DefaultFilters);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FilingsV2Sort>("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState(filingsV2Records[0].id);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [detailNotice, setDetailNotice] = useState("");
  const [previewRequestId, setPreviewRequestId] = useState(0);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const detailPreviewRef = useRef<HTMLDivElement | null>(null);
  const detailRailRef = useRef<HTMLElement | null>(null);
  const filterOpenerRef = useRef<HTMLButtonElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const referenceTime = new Date(filingsV2ReferenceDate).getTime();

    return filingsV2Records
      .filter((record) => {
        if (filters.formTypes.length && !filters.formTypes.includes(record.formType)) return false;
        if (filters.eventTypes.length && !filters.eventTypes.some((event) => record.events.includes(event))) return false;
        if (filters.impacts.length && !filters.impacts.some((impact) => matchesFilingsV2ImpactFilter(record.impact, impact))) return false;
        if (filters.signals.length && !filters.signals.includes(record.signal)) return false;
        if (filters.marketCaps.length && !filters.marketCaps.includes(record.marketCap)) return false;
        if (filters.dateRanges.length) {
          const age = referenceTime - new Date(record.filedAt).getTime();
          const isInSelectedRange = filters.dateRanges.some((range) => {
            const rangeDays = daysForRange(range);
            return rangeDays !== null && age >= 0 && age <= rangeDays * 24 * 60 * 60 * 1000;
          });
          if (!isInSelectedRange) return false;
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
  }, [filters, query, sort]);

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
  }, [filters, query, sort]);

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

  useEffect(() => {
    if (previewRequestId === 0) return;

    const preview = detailPreviewRef.current;
    const rail = detailRailRef.current;
    if (!preview || !rail) return;

    const previewTop = preview.getBoundingClientRect().top;
    const railTop = rail.getBoundingClientRect().top;
    rail.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      top: rail.scrollTop + previewTop - railTop,
    });
  }, [previewRequestId]);

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
  };
  const selectRecord = (record: FilingsV2Record, opener: HTMLElement) => {
    const usesDesktopRail = window.matchMedia("(min-width: 1181px)").matches;

    setSelectedId(record.id);
    setDetailNotice("");
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
          <FilingsV2FilterBar
            filters={filters}
            isMobileSheetOpen={isFilterSheetOpen}
            mobileFilterOpenerRef={filterOpenerRef}
            onClearFilterGroup={clearFilterGroup}
            onOpenMobileFilters={openMobileFilters}
            onRemoveFilter={removeFilter}
            onReset={resetFilters}
            onToggleFilter={toggleFilter}
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

      <aside className={styles.detailRail} ref={detailRailRef}>
        <div className={styles.detailRailPreview} ref={detailPreviewRef}>
          <FilingsV2DetailPanel
            detailNotice={detailNotice}
            onMockDetails={showMockDetailNotice}
            record={selectedRecord}
            relatedRecords={relatedRecords}
          />
        </div>
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
        filters={filters}
        isOpen={isFilterSheetOpen}
        onClearFilterGroup={clearFilterGroup}
        onDismiss={() => setIsFilterSheetOpen(false)}
        onReset={resetFilters}
        onToggleFilter={toggleFilter}
        openerRef={filterOpenerRef}
      />
    </div>
  );
}
