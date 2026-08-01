import type { Metadata } from "next";
import { StockRadarFeedV2 } from "@/components/feed-v2/StockRadarFeedV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { getLiveFeedV2InitialData } from "@/lib/liveFeedV2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Feed | Stock Radar",
  description:
    "Live market-moving news, filings, alerts, and market context.",
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const [initialData, viewerPlan, params] = await Promise.all([
    getLiveFeedV2InitialData(),
    getCurrentViewerPlan(),
    searchParams,
  ]);
  const requestedPreview = Array.isArray(params.preview)
    ? params.preview[0]
    : params.preview;

  return (
    <StockRadarAppShell
      activeNavigationItem="feed"
      themeMode="user-selectable"
    >
      <StockRadarFeedV2
        initialData={initialData}
        initialPreviewId={requestedPreview}
        viewerPlan={viewerPlan}
      />
    </StockRadarAppShell>
  );
}
