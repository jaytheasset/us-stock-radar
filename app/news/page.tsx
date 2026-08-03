import type { Metadata } from "next";
import { StockRadarNewsV2 } from "@/components/news-v2/StockRadarNewsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import { getNewsV2PageData } from "@/lib/newsV2Data";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";

export const metadata: Metadata = {
  title: "News",
};

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const [data, viewerPlan] = await Promise.all([
    getNewsV2PageData(),
    getCurrentViewerPlan(),
  ]);
  const preferredSourceUrl = buildGooglePreferredSourceUrl();

  return (
    <StockRadarAppShell activeNavigationItem="news" themeMode="user-selectable">
      <StockRadarNewsV2
        {...data}
        preferredSourceUrl={preferredSourceUrl}
        referenceDate={new Date().toISOString()}
        viewerPlan={viewerPlan}
      />
    </StockRadarAppShell>
  );
}
