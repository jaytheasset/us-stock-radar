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

export default async function FeedPage() {
  const [initialData, viewerPlan] = await Promise.all([
    getLiveFeedV2InitialData(),
    getCurrentViewerPlan(),
  ]);

  return (
    <StockRadarAppShell
      activeNavigationItem="feed"
      themeMode="user-selectable"
    >
      <StockRadarFeedV2
        initialData={initialData}
        viewerPlan={viewerPlan}
      />
    </StockRadarAppShell>
  );
}
