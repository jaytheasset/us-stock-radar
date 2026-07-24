import type { Metadata } from "next";
import { StockRadarNewsV2 } from "@/components/news-v2/StockRadarNewsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getServerEnv } from "@/lib/env";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import { getNewsV2PageData } from "@/lib/newsV2";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";

export const metadata: Metadata = {
  title: "News | Stock Radar",
};

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const [data, userId] = await Promise.all([
    getNewsV2PageData(),
    getOptionalCurrentUserId(),
  ]);
  const viewerPlan = userId
    ? (await getEffectiveUserPlan(userId)).effectivePlan
    : "free";
  const preferredSourceUrl = buildGooglePreferredSourceUrl(getServerEnv().appBaseUrl);

  return (
    <StockRadarAppShell activeNavigationItem="news" themeMode="user-selectable">
      <StockRadarNewsV2
        {...data}
        preferredSourceUrl={preferredSourceUrl}
        viewerPlan={viewerPlan}
      />
    </StockRadarAppShell>
  );
}
