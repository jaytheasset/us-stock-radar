"use client";

import { useEffect, useState } from "react";
import { SavedContentButton } from "@/components/actions/SavedContentButton";
import { WatchlistButton } from "@/components/actions/WatchlistButton";
import type { DashboardV2Event, DashboardV2TickerDetail } from "@/lib/dashboardV2Types";
import type { SavedContentType } from "@/lib/saved/types";
import {
  getSavedContentOverride,
  getWatchlistOverride,
} from "@/lib/userContentSync";

type MarketsPreviewActionsProps = {
  initialAuthenticated: boolean;
  isOpen: boolean;
  ticker: DashboardV2TickerDetail;
};

type MarketsPreviewViewerState = {
  saved: boolean;
  watched: boolean;
};

export function MarketsPreviewActions({
  initialAuthenticated,
  isOpen,
  ticker,
}: MarketsPreviewActionsProps) {
  const savedReference = getSavedReference(ticker.recentEvents[0]);
  const savedContentId = savedReference?.contentId;
  const savedContentType = savedReference?.contentType;
  const normalizedTicker = ticker.ticker.trim().toUpperCase();
  const [viewerState, setViewerState] = useState<MarketsPreviewViewerState>({
    saved: false,
    watched: false,
  });

  useEffect(() => {
    const localSaved =
      savedContentId && savedContentType
        ? getSavedContentOverride(savedContentType, savedContentId) ?? false
        : false;
    const localWatched = getWatchlistOverride(normalizedTicker) ?? false;
    setViewerState({ saved: localSaved, watched: localWatched });

    if (!initialAuthenticated || !isOpen) return;

    const controller = new AbortController();
    const savedRequest =
      savedContentId && savedContentType
        ? fetch(
            `/api/saved?${new URLSearchParams({
              contentIds: savedContentId,
              contentType: savedContentType,
            }).toString()}`,
            { cache: "no-store", signal: controller.signal },
          ).then(async (response) => {
            if (!response.ok) throw new Error("Saved state unavailable");
            return (await response.json()) as { savedIds?: string[] };
          })
        : Promise.resolve({ savedIds: [] });

    void Promise.all([
      savedRequest,
      fetch("/api/watchlist", {
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error("Watchlist state unavailable");
        return (await response.json()) as {
          data?: { items?: Array<{ ticker?: string }> };
        };
      }),
    ])
      .then(([savedPayload, watchlistPayload]) => {
        const serverSaved = Boolean(
          savedContentId && savedPayload.savedIds?.includes(savedContentId),
        );
        const serverWatched = Boolean(
          watchlistPayload.data?.items?.some(
            (item) => item.ticker?.trim().toUpperCase() === normalizedTicker,
          ),
        );
        setViewerState({
          saved:
            savedContentId && savedContentType
              ? getSavedContentOverride(savedContentType, savedContentId) ??
                serverSaved
              : false,
          watched: getWatchlistOverride(normalizedTicker) ?? serverWatched,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [
    initialAuthenticated,
    isOpen,
    normalizedTicker,
    savedContentId,
    savedContentType,
  ]);

  const returnHref = "/dashboard-v2";

  return (
    <>
      <WatchlistButton
        initialAuthenticated={initialAuthenticated}
        initialWatched={viewerState.watched}
        returnHref={returnHref}
        ticker={normalizedTicker}
      />
      {savedContentId && savedContentType ? (
        <SavedContentButton
          contentId={savedContentId}
          contentType={savedContentType}
          initialAuthenticated={initialAuthenticated}
          initialSaved={viewerState.saved}
          returnHref={returnHref}
        />
      ) : null}
    </>
  );
}

function getSavedReference(event?: DashboardV2Event) {
  if (!event || !isUuid(event.id)) return null;

  const contentType: SavedContentType | null =
    event.sourceGroup === "filings"
      ? "filing"
      : event.sourceGroup === "news"
        ? "news"
        : null;

  return contentType ? { contentId: event.id.toLowerCase(), contentType } : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
