"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFeedV2.module.css";

type FilterState = LiveFeedV2Page & {
  isLoading: boolean;
  isLoadingMore: boolean;
  loaded: boolean;
};

type StockRadarFeedV2Props = {
  initialData: LiveFeedV2InitialData;
  viewerPlan: Plan;
};

export function StockRadarFeedV2({
  initialData,
  viewerPlan,
}: StockRadarFeedV2Props) {
  const feedColumnRef = useRef<HTMLElement>(null);
  const mobileOpenerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [activeFilter, setActiveFilter] =
    useState<LiveFeedV2Filter>("all");
  const [filterStates, setFilterStates] = useState(() =>
    createInitialFilterStates(initialData.page),
  );
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [previewRequestId, setPreviewRequestId] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialData.page.items[0]?.id || null,
  );

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

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
          throw new Error(page.error || "Feed request failed");
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

  const handleFilterChange = (filter: LiveFeedV2Filter) => {
    setActiveFilter(filter);
    setSelectedEventId(null);
    setMobilePreviewOpen(false);

    const nextState = filterStates[filter];
    if (!nextState.loaded && !nextState.isLoading) {
      void loadPage(filter, null);
    }
  };

  const handlePreviewSelect = (
    item: LiveFeedV2Item,
    opener: HTMLButtonElement,
  ) => {
    setSelectedEventId(item.id);
    if (window.matchMedia("(max-width: 760px)").matches) {
      mobileOpenerRef.current = opener;
      setMobilePreviewOpen(true);
      return;
    }

    if (window.matchMedia("(min-width: 1181px)").matches) {
      setPreviewRequestId((value) => value + 1);
    }
  };
  const closeMobilePreview = useCallback(
    () => setMobilePreviewOpen(false),
    [],
  );

  return (
    <div className={styles.page}>
      <FeedSituationBoard items={initialData.situationItems} />

      <div className={styles.contentGrid}>
        <section
          aria-labelledby="live-feed-stream-title"
          className={styles.feedColumn}
          ref={feedColumnRef}
        >
          <div className={styles.feedHeader}>
            <div className={styles.feedTitle}>
              <span className={styles.liveIndicator}>Live</span>
              <h1 id="live-feed-stream-title">Market Events</h1>
            </div>
            <span className={styles.resultCount}>
              {activeState.isLoading && activeState.items.length === 0
                ? "Updating events"
                : formatResultCount(
                    activeState.items.length,
                    activeState.totalCount,
                  )}
            </span>
          </div>

          <div
            aria-label="Feed filters"
            className={styles.filters}
            role="group"
          >
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

          <FeedEventList
            emptyMessage={activeState.emptyMessage}
            hasError={Boolean(activeState.error)}
            isLoading={activeState.isLoading}
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
        isOpen={mobilePreviewOpen}
        item={selectedItem}
        onClose={closeMobilePreview}
        openerRef={mobileOpenerRef}
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
            availability: "available",
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

function formatResultCount(loaded: number, total: number | null) {
  return total === null ? `${loaded} events` : `${loaded} of ${total} events`;
}
