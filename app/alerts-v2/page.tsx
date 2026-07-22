import type { Metadata } from "next";
import { Suspense } from "react";
import { StockRadarAlertsV2 } from "@/components/alerts-v2/StockRadarAlertsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const metadata: Metadata = {
  title: "Alerts v2 | Stock Radar",
  description: "Mock Stock Radar alerts center v2.",
};

export const dynamic = "force-dynamic";

export default function AlertsV2Page() {
  return (
    <StockRadarAppShell activeNavigationItem="alerts" headerContentMaxWidth="1692px" themeMode="user-selectable">
      <Suspense fallback={null}>
        <StockRadarAlertsV2 />
      </Suspense>
    </StockRadarAppShell>
  );
}
