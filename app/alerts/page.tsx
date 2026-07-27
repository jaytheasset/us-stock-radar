import type { Metadata } from "next";
import { Suspense } from "react";
import { StockRadarAlertsV2 } from "@/components/alerts-v2/StockRadarAlertsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { normalizeAlertTickerSearchParam } from "@/lib/alerts/tickers/query";

export const metadata: Metadata = {
  title: "Alerts | Stock Radar",
  description: "Configure Stock Radar alert coverage, sources, delivery, and SEC filing rules.",
};

export const dynamic = "force-dynamic";

type AlertsPageProps = {
  searchParams: Promise<{
    ticker?: string | string[];
  }>;
};

export default async function AlertsPage({
  searchParams,
}: AlertsPageProps) {
  const params = await searchParams;
  const initialTicker = normalizeAlertTickerSearchParam(params.ticker);

  return (
    <StockRadarAppShell activeNavigationItem="alerts" themeMode="user-selectable">
      <Suspense fallback={null}>
        <StockRadarAlertsV2 initialTicker={initialTicker} />
      </Suspense>
    </StockRadarAppShell>
  );
}
