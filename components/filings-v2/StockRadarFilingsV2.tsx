"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilingsV2DetailPanel, MobileFilingsV2DetailSheet } from "@/components/filings-v2/FilingsV2Detail";
import { FilingsV2FilterBar } from "@/components/filings-v2/FilingsV2FilterBar";
import { FilingsV2List, type FilingsV2ListState } from "@/components/filings-v2/FilingsV2List";
import { FilingsRailAdSlot } from "@/components/filings-v2/FilingsRailAdSlot";
import { FilingsV2Summary } from "@/components/filings-v2/FilingsV2Summary";
import { MobileFilingsV2FilterSheet } from "@/components/filings-v2/MobileFilingsV2FilterSheet";
import { PremiumUpgradeCard } from "@/components/filings-v2/PremiumUpgradeCard";
import {
  filingsV2DefaultFilters,
  filingsV2EventLabels,
  matchesFilingsV2ImpactFilter,
  type FilingsV2DateRange,
  type FilingsV2FilterGroup,
  type FilingsV2FilterState,
  type FilingsV2Record,
} from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

const loadMoreSize = 25;

function daysForRange(range: FilingsV2DateRange) {
  if (range === "24 Hours") return 1;
  if (range === "7 Days") return 7;
  if (range === "30 Days") return 30;
  return null;
}

type StockRadarFilingsV2Props = {
  formOptions: readonly string[];
  records: readonly FilingsV2Record[];
  referenceDate: string;
  state: FilingsV2ListState;
};

export function StockRadarFilingsV2({
  formOptions,
  records,
  referenceDate,
  state,
}: StockRadarFilingsV2Props) {
  const [draftFilters, setDraftFilters] = useState<FilingsV2FilterState>(filingsV2DefaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilingsV2FilterState>(filingsV2DefaultFilters);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(loadMoreSize);
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? "");
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [previewRequestId, setPreviewRequestId] = useState(0);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const detailSelectionAnchorRef = useRef<HTMLDivElement | null>(null);
  const detailRailRef = useRef<HTMLElement | null>(null);
  const detailRailScrollProgressRef = useRef(0);
  const filterOpenerRef = useRef<HTMLButtonElement | null>(null);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const referenceTime = new Date(referenceDate).getTime();

    return records
      .filter((record) => {
        if (appliedFilters.formTypes.length && !appliedFilters.formTypes.includes(record.formType)) return false;
        if (appliedFilters.eventTypes.length && !appliedFilters.eventTypes.some((event) => record.events.includes(event))) return false;
        if (appliedFilters.impacts.length && !appliedFilters.impacts.some((impact) => matchesFilingsV2ImpactFilter(record.impact, impact))) return false;
        if (appliedFilters.signals.length && !appliedFilters.signals.includes(record.signal)) return false;
        if (
          appliedFilters.marketCaps.length &&
          (!record.marketCap || !appliedFilters.marketCaps.includes(record.marketCap))
        ) return false;
        if (appliedFilters.dateRanges.length) {
          const age = referenceTime - new Date(record.filedAt).getTime();
          const isInSelectedRange = appliedFilters.dateRanges.some((range) => {
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
        return new Date(right.filedAt).getTime() - new Date(left.filedAt).getTime();
      });
  }, [appliedFilters, query, records, referenceDate]);

  const visibleRecords = filteredRecords.slice(0, visibleCount);
  const remainingCount = Math.max(filteredRecords.length - visibleRecords.length, 0);
  const tallRailAdCount = Math.max(1, Math.ceil(visibleRecords.length / 12) - 1);
  const selectedRecord = records.find((record) => record.id === selectedId) ?? records[0];
  const relatedRecords = selectedRecord?.relatedFilings ?? [];

  useEffect(() => {
    setVisibleCount(loadMoreSize);
  }, [appliedFilters, query]);

  useEffect(() => {
    if (filteredRecords.length > 0 && !filteredRecords.some((record) => record.id === selectedId)) {
      setSelectedId(filteredRecords[0].id);
    }
  }, [filteredRecords, selectedId]);

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
    setDraftFilters((current) => ({
      ...current,
      [group]: current[group].includes(value as never)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }) as FilingsV2FilterState);
  };
  const removeFilter = (group: FilingsV2FilterGroup, value: string) => {
    setDraftFilters((current) => ({
      ...current,
      [group]: current[group].filter((item) => item !== value),
    }) as FilingsV2FilterState);
  };
  const clearFilterGroup = (group: FilingsV2FilterGroup) => {
    setDraftFilters((current) => ({ ...current, [group]: [] }));
  };
  const resetFilters = () => {
    setDraftFilters(filingsV2DefaultFilters);
  };
  const showMoreRecords = () => {
    setVisibleCount((current) => Math.min(current + loadMoreSize, filteredRecords.length));
  };
  const searchFilings = () => {
    setQuery(searchInput.trim());
    setAppliedFilters(draftFilters);
    setVisibleCount(loadMoreSize);
  };
  const showMobileFilterResults = () => {
    searchFilings();
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
        <FilingsV2Summary records={records} referenceDate={referenceDate} />
        <div className={styles.controlBand}>
          <FilingsV2FilterBar
            filters={draftFilters}
            formOptions={formOptions}
            isMobileSheetOpen={isFilterSheetOpen}
            mobileFilterOpenerRef={filterOpenerRef}
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
          onLoadMore={remainingCount > 0 ? showMoreRecords : undefined}
          onSelect={selectRecord}
          records={visibleRecords}
          referenceDate={referenceDate}
          remainingCount={remainingCount}
          selectedId={selectedId}
          state={state}
          totalCount={filteredRecords.length}
        />
      </section>

      <aside className={styles.detailRail} ref={detailRailRef}>
        <div ref={detailSelectionAnchorRef}>
          <PremiumUpgradeCard className={styles.premiumCtaDesktop} />
        </div>
        {selectedRecord ? (
          <div className={styles.detailRailPreview}>
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
        filters={draftFilters}
        formOptions={formOptions}
        isOpen={isFilterSheetOpen}
        onApply={showMobileFilterResults}
        onClearFilterGroup={clearFilterGroup}
        onDismiss={() => setIsFilterSheetOpen(false)}
        onReset={resetFilters}
        onToggleFilter={toggleFilter}
        openerRef={filterOpenerRef}
      />
    </div>
  );
}
