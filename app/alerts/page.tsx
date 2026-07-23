import type { Metadata } from "next";
import { Suspense } from "react";
import { StockRadarAlertsV2 } from "@/components/alerts-v2/StockRadarAlertsV2";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

export const metadata: Metadata = {
  title: "Alerts | Stock Radar",
  description: "Configure Stock Radar alert coverage, sources, delivery, and SEC filing rules.",
};

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  return (
    <StockRadarAppShell activeNavigationItem="alerts" themeMode="user-selectable">
      <Suspense fallback={null}>
        <StockRadarAlertsV2 />
      </Suspense>
    </StockRadarAppShell>
  );
}
