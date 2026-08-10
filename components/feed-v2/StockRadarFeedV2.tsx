"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { FeedContextRail } from "@/components/feed-v2/FeedContextRail";
import { FeedEventList } from "@/components/feed-v2/FeedEventList";
import { FeedSituationBoard } from "@/components/feed-v2/FeedSituationBoard";
import { MobileFeedPreviewSheet } from "@/components/feed-v2/MobileFeedPreviewSheet";
import {
  liveFeedV2Filters,
  type LiveFeedV2Filter,
  type LiveFeedV2Item,
  type LiveFeedV2Page,
} from "@/lib/liveFeedV2Contract";
import type { LiveFeedV2InitialData } from "@/lib/liveFeedV2";
import {
  resolveLiveFeedV2FlowState,
  type LiveFeedV2ObservedAvailability,
} from "@/lib/liveFeedV2FlowState";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFeedV2.module.css";

type FilterState = Omit<LiveFeedV2Page, "availability"> & {
  availability: LiveFeedV2ObservedAvailability;
  isLoading: boolean;
  isLoadingMore: boolean;
  loaded: boolean;
};

type StockRadarFeedV2Props = {
  initialData: LiveFeedV2InitialData;
  initialPreviewId?: string;
  viewerPlan: Plan;
};

type PreviewViewport = "mobile" | "intermediate";

const mobilePrimaryFilters = liveFeedV2Filters.filter(
  (filter) => filter.value !== "alerts" && filter.value !== "watchlist",
);
const mobileMoreFilters = liveFeedV2Filters.filter(
  (filter) => filter.value === "alerts" || filter.value === "watchlist",
);

export function StockRadarFeedV2({
  initialData,
  initialPreviewId,
  viewerPlan,
}: StockRadarFeedV2Props) {
  const feedColumnRef = useRef<HTMLElement>(null);
  const mobileFilterRef = useRef<HTMLDivElement>(null);
  const mobileMoreButtonRef = useRef<HTMLButtonElement>(null);
  const mobileOpenerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mobileMoreId = useId();
  const [activeFilter, setActiveFilter] =
    useState<LiveFeedV2Filter>("all");
  const [filterStates, setFilterStates] = useState(() =>
    createInitialFilterStates(initialData.page),
  );
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [previewViewport, setPreviewViewport] =
    useState<PreviewViewport | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialData.page.items.some((item) => item.id === initialPreviewId)
      ? initialPreviewId || null
      : initialData.page.items[0]?.id || null,
  );

  useEffect(() => {
    if (
      initialPreviewId &&
      initialData.page.items.some((item) => item.id === initialPreviewId) &&
      window.matchMedia("(max-width: 959.98px)").matches
    ) {
      setPreviewViewport(
        window.matchMedia("(max-width: 760.98px)").matches
          ? "mobile"
          : "intermediate",
      );
    }
  }, [initialData.page.items, initialPreviewId]);

  useEffect(() => {
    if (!previewViewport) return;

    const query = window.matchMedia(
      previewViewport === "mobile"
        ? "(max-width: 760.98px)"
        : "(min-width: 761px) and (max-width: 959.98px)",
    );
    const dismissOutsideViewport = () => {
      if (!query.matches) setPreviewViewport(null);
    };

    query.addEventListener("change", dismissOutsideViewport);
    return () => query.removeEventListener("change", dismissOutsideViewport);
  }, [previewViewport]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!mobileMoreOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!mobileFilterRef.current?.contains(event.target as Node)) {
        setMobileMoreOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileMoreOpen(false);
      mobileMoreButtonRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMoreOpen]);

  const loadPage = useCallback(
    async (filter: LiveFeedV2Filter, cursor: string | null) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const initialRequest = cursor === null;

      setFilterStates((current) => ({
        ...current,
        [filter]: {
          ...current[filter],
          availability: initialRequest
            ? "unknown"
            : current[filter].availability,
          error: undefined,
          isLoading: initialRequest,
          isLoadingMore: !initialRequest,
        },
      }));

      try {
        const params = new URLSearchParams({ filter });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/feed-v2?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const page = (await response.json()) as LiveFeedV2Page;
        if (!response.ok) {
          setFilterStates((current) => {
            const previous = current[filter];
            const items = initialRequest
              ? page.items
              : mergeItems(previous.items, page.items);
            return {
              ...current,
              [filter]: {
                ...page,
                error: page.error || "Feed request failed",
                isLoading: false,
                isLoadingMore: false,
                items,
                loaded: true,
              },
            };
          });
          return;
        }

        setFilterStates((current) => {
          const previous = current[filter];
          const items = initialRequest
            ? page.items
            : mergeItems(previous.items, page.items);
          return {
            ...current,
            [filter]: {
              ...page,
              isLoading: false,
              isLoadingMore: false,
              items,
              loaded: true,
            },
          };
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setFilterStates((current) => ({
            ...current,
            [filter]: {
              ...current[filter],
              isLoading: false,
              isLoadingMore: false,
            },
          }));
          return;
        }

        setFilterStates((current) => ({
          ...current,
          [filter]: {
            ...current[filter],
            availability: "unknown",
            error:
              error instanceof Error ? error.message : "Feed request failed",
            isLoading: false,
            isLoadingMore: false,
            loaded: true,
          },
        }));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
        }
      }
    },
    [],
  );

  const activeState = filterStates[activeFilter];
  const selectedItem =
    activeState.items.find((item) => item.id === selectedEventId) ||
    activeState.items[0] ||
    null;
  const effectiveSelectedId = selectedItem?.id || null;
  const remainingCount =
    activeState.totalCount === null
      ? null
      : Math.max(activeState.totalCount - activeState.items.length, 0);
  const flowState = resolveLiveFeedV2FlowState({
    availability: activeState.availability,
    emptyMessage: activeState.emptyMessage,
    filter: activeFilter,
    hasError: Boolean(activeState.error),
    isLoading: activeState.isLoading,
    rowCount: activeState.items.length,
    totalCount: activeState.totalCount,
  });

  const handleFilterChange = (filter: LiveFeedV2Filter) => {
    setActiveFilter(filter);
    setSelectedEventId(null);
    setMobileMoreOpen(false);
    setPreviewViewport(null);

    const nextState = filterStates[filter];
    if (!nextState.loaded && !nextState.isLoading) {
      void loadPage(filter, null);
    }
  };

  const handleMobileMoreFilterChange = (filter: LiveFeedV2Filter) => {
    handleFilterChange(filter);
    setMobileMoreOpen(false);
    requestAnimationFrame(() => {
      mobileMoreButtonRef.current?.focus({ preventScroll: true });
    });
  };

  const handlePreviewSelect = (
    item: LiveFeedV2Item,
    opener: HTMLButtonElement,
  ) => {
    setSelectedEventId(item.id);
    mobileOpenerRef.current = opener;
    if (window.matchMedia("(max-width: 760.98px)").matches) {
      setPreviewViewport("mobile");
      return;
    }

    if (window.matchMedia("(min-width: 960px)").matches) {
      setPreviewViewport(null);
      setPreviewRequestId((value) => value + 1);
      return;
    }

    setPreviewViewport("intermediate");
  };
  const closePreview = useCallback(() => setPreviewViewport(null), []);
  const activeMobileMoreFilter = mobileMoreFilters.find(
    (filter) => filter.value === activeFilter,
  );

  return (
    <div className={styles.page}>
      <FeedSituationBoard
        items={initialData.situationItems}
        totalEvents={initialData.page.totalCount}
      />

      <div className={styles.contentGrid}>
        <section
          aria-busy={flowState.status === "loading"}
          aria-labelledby="live-feed-stream-title"
          className={styles.feedColumn}
          data-feed-availability={flowState.availability}
          data-feed-filter={flowState.filter}
          data-feed-row-count={flowState.rowCount}
          data-feed-state={flowState.status}
          data-feed-total-count={flowState.totalCount ?? "unknown"}
          ref={feedColumnRef}
        >
          <div className={styles.feedHeader}>
            <div className={styles.feedTitle}>
              <span className={styles.liveIndicator}>Live</span>
              <h1 id="live-feed-stream-title">Market Events</h1>
            </div>
            <span
              aria-atomic="true"
              aria-live="polite"
              className={styles.resultCount}
              data-feed-result-count={flowState.rowCount}
            >
              {flowState.resultLabel}
            </span>
          </div>

          <div
            aria-label="Feed filters"
            className={styles.filters}
            role="group"
          >
            <div className={styles.desktopFilters}>
              {liveFeedV2Filters.map((filter) => (
                <button
                  aria-pressed={filter.value === activeFilter}
                  className={
                    filter.value === activeFilter
                      ? styles.filterActive
                      : undefined
                  }
                  key={filter.value}
                  onClick={() => handleFilterChange(filter.value)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className={styles.mobileFilters} ref={mobileFilterRef}>
              <div className={styles.mobileFilterRow}>
                {mobilePrimaryFilters.map((filter) => (
                  <button
                    aria-pressed={filter.value === activeFilter}
                    className={
                      filter.value === activeFilter
                        ? styles.filterActive
                        : undefined
                    }
                    key={filter.value}
                    onClick={() => handleFilterChange(filter.value)}
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
                <button
                  aria-controls={mobileMoreId}
                  aria-expanded={mobileMoreOpen}
                  aria-label={
                    activeMobileMoreFilter
                      ? `More filters, ${activeMobileMoreFilter.label} selected`
                      : "More filters"
                  }
                  aria-pressed={Boolean(activeMobileMoreFilter)}
                  className={
                    [
                      styles.mobileMoreButton,
                      activeMobileMoreFilter ? styles.filterActive : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                  onClick={() => setMobileMoreOpen((current) => !current)}
                  ref={mobileMoreButtonRef}
                  type="button"
                >
                  <span>More</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={styles.mobileMoreChevron}
                    size={14}
                  />
                </button>
              </div>
              {mobileMoreOpen ? (
                <div
                  aria-label="Additional feed filters"
                  className={styles.mobileMoreFilters}
                  id={mobileMoreId}
                  role="group"
                >
                  {mobileMoreFilters.map((filter) => (
                    <button
                      aria-pressed={filter.value === activeFilter}
                      className={
                        filter.value === activeFilter
                          ? styles.filterActive
                          : undefined
                      }
                      key={filter.value}
                      onClick={() =>
                        handleMobileMoreFilterChange(filter.value)
                      }
                      type="button"
                    >
                      <span>{filter.label}</span>
                      {filter.value === activeFilter ? (
                        <Check aria-hidden="true" size={15} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <FeedEventList
            isLoadingMore={activeState.isLoadingMore}
            items={activeState.items}
            onLoadMore={
              activeState.nextCursor
                ? () =>
                    void loadPage(activeFilter, activeState.nextCursor)
                : undefined
            }
            onPreviewSelect={handlePreviewSelect}
            onRetry={() => void loadPage(activeFilter, null)}
            remainingCount={remainingCount}
            selectedEventId={effectiveSelectedId}
            state={flowState}
            viewerPlan={viewerPlan}
          />
        </section>

        <FeedContextRail
          alertFilings={initialData.alertFilings}
          highImpactNews={initialData.highImpactNews}
          marketMovingNews={initialData.marketMovingNews}
          marketPulse={initialData.marketPulse}
          previewRequestId={previewRequestId}
          selectedItem={selectedItem}
          viewerPlan={viewerPlan}
        />
      </div>

      <MobileFeedPreviewSheet
        isOpen={previewViewport !== null}
        item={selectedItem}
        onClose={closePreview}
        openerRef={mobileOpenerRef}
        viewport={previewViewport ?? "mobile"}
        viewerPlan={viewerPlan}
      />
    </div>
  );
}

function createInitialFilterStates(
  initialPage: LiveFeedV2Page,
): Record<LiveFeedV2Filter, FilterState> {
  return Object.fromEntries(
    liveFeedV2Filters.map((filter) => [
      filter.value,
      filter.value === "all"
        ? {
            ...initialPage,
            isLoading: false,
            isLoadingMore: false,
            loaded: true,
          }
        : {
            availability: "unknown",
            filter: filter.value,
            isLoading: false,
            isLoadingMore: false,
            items: [],
            loaded: false,
            nextCursor: null,
            totalCount: null,
          },
    ]),
  ) as Record<LiveFeedV2Filter, FilterState>;
}

function mergeItems(
  current: readonly LiveFeedV2Item[],
  incoming: readonly LiveFeedV2Item[],
) {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...incoming.filter((item) => !seen.has(item.id)),
  ];
}
