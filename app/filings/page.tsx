import type { Metadata } from "next";
import { StockRadarFilingsV2 } from "@/components/filings-v2/StockRadarFilingsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { loadFilingsV2Data } from "@/lib/filingsV2Data";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getViewerContentState, savedContentKey } from "@/lib/saved/server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Filings | Stock Radar",
  description: "Search and review investor-relevant SEC filings.",
};

export default async function FilingsPage() {
  const [data, viewerPlan, userId] = await Promise.all([
    loadFilingsV2Data(),
    getCurrentViewerPlan(),
    getOptionalCurrentUserId(),
  ]);
  const viewerState = await getViewerContentState({
    references: data.records.map((record) => ({
      contentId: record.id,
      contentType: "filing" as const,
    })),
    tickers: data.records.flatMap((record) =>
      record.ticker ? [record.ticker] : [],
    ),
    userId,
  });
  const preferredSourceUrl = buildGooglePreferredSourceUrl();

  return (
    <div className={styles.route}>
      <StockRadarAppShell
        activeNavigationItem="filings"
        themeMode="user-selectable"
      >
        <StockRadarFilingsV2
          {...data}
          initialAuthenticated={viewerState.authenticated}
          initialSavedIds={data.records
            .filter((record) =>
              viewerState.savedKeys.has(savedContentKey("filing", record.id)),
            )
            .map((record) => record.id)}
          initialWatchedTickers={Array.from(viewerState.watchedTickers)}
          preferredSourceUrl={preferredSourceUrl}
          viewerPlan={viewerPlan}
        />
      </StockRadarAppShell>
    </div>
  );
}
